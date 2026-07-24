// Jednorazowa migracja danych ze starej aplikacji (plik APP_FINANSOWA.xlsx).
// Użycie: node scripts/migrate-xlsx.js /ścieżka/APP_FINANSOWA.xlsx [--dry-run]
// Wymaga: npm install (devDependency 'xlsx'), skonfigurowane .env, wykonane migracje.
//
// Co robi (plan §3):
//  1) users — upewnia się, że istnieją Szymon/Anna/Bartek/PERSEVERA (e-maile z env lub placeholder)
//  2) KATEGORIE -> categories (drzewo, księga RODZINA; wiersz = rodzic + dzieci w kolumnach B+)
//  3) APP_FINANSOWA -> transactions (source=MIGRACJA, legacy_id z kolumny "Data KOD")
//  4) CSV -> bank_transactions (zachowując oryginalne hashe SHA-256)
//  5) mapping_cache -> mapping_cache (pattern -> kategoria po nazwie)
// Wiersze nieparsowalne trafiają do raportu, nic nie jest nadpisywane (INSERT IGNORE po legacy_id/hash).
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
require('../src/config');
const mysql = require('mysql2/promise');

// legacy_id ze starej aplikacji: preferuj komórkę wyglądającą jak znacznik czasu
// ISO (…THH:MM…, ew. z sufiksem -xxxx) albo długi hash paragonu; NIGDY nie bierz
// flag typu "NIE"/"TAK" ani krótkich wartości (błąd pierwszej wersji: 8 wierszy
// scalonych pod wspólnym legacy_id="NIE"). Brak wiarygodnego ID → null (wiersz
// wchodzi bez dedupu; migracja jest idempotentna po TRUNCATE, patrz runbook).
function extractLegacy(row) {
  const cells = row.slice(6).map((x) => (x === null ? '' : String(x).trim())).filter(Boolean);
  const iso = cells.find((c) => /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(c));
  if (iso) return iso.slice(0, 128);
  const hash = cells.find((c) => /^[0-9a-f]{32,}$/i.test(c));
  if (hash) return hash.slice(0, 128);
  return null;
}

const DRY = process.argv.includes('--dry-run');
const file = process.argv[2];
if (!file) { console.error('Podaj ścieżkę do APP_FINANSOWA.xlsx'); process.exit(1); }

const USERS = [
  { name: 'Szymon', role: 'admin', email: process.env.EMAIL_SZYMON || 'szymon@example.invalid' },
  { name: 'Anna', role: 'adult', email: process.env.EMAIL_ANNA || 'anna@example.invalid' },
  { name: 'Bartek', role: 'junior', email: process.env.EMAIL_BARTEK || 'bartek@example.invalid' },
  { name: 'PERSEVERA', role: 'company', email: process.env.EMAIL_PERSEVERA || 'persevera@example.invalid' },
];

function excelDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') { // liczba dni Excela
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
function money(v) {
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  let t = String(v || '').replace(/\s/g, '').replace(/zł/gi, '');
  if (t === '') return null;
  // 1.234,56 -> usun kropki-tysiecy; 1234,56 -> przecinek na kropke
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const f = parseFloat(t);
  return Number.isFinite(f) ? Math.round(f * 100) / 100 : null;
}

(async () => {
  const wb = XLSX.readFile(file, { cellDates: true });
  const sheet = (name) => {
    const ws = wb.Sheets[name];
    return ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) : [];
  };
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASS, database: process.env.DB_NAME, charset: 'utf8mb4',
  });
  const report = { users: 0, categories: 0, transactions: 0, tx_skipped: [], bank_rows: 0, bank_dup: 0, mapping: 0 };
  const run = async (sql, params) => { if (!DRY) return (await conn.execute(sql, params))[0]; return { insertId: 0, affectedRows: 1 }; };

  // 1) users
  for (const u of USERS) {
    await run('INSERT IGNORE INTO users (email, name, role) VALUES (?, ?, ?)', [u.email, u.name, u.role]);
    report.users++;
  }
  const [urows] = await conn.query('SELECT id, name FROM users');
  const userId = Object.fromEntries(urows.map((r) => [r.name, r.id]));

  // 2) KATEGORIE (drzewo; księga RODZINA=1) — kategorie z nazwami "PERSEVERA ..." też zostają w RODZINA,
  // bo tak używała ich stara aplikacja; rozdział ksiąg dotyczy nowych wpisów.
  // SELECT-first (idempotentne): nie polegaj na INSERT IGNORE, bo unikat z parent_id
  // NULL nie łapie duplikatów korzeni w MySQL — dwukrotny import dublowałby kategorie.
  async function findOrCreateCat(ledgerId, parentId, name) {
    const [[found]] = await conn.query(
      'SELECT id FROM categories WHERE ledger_id=? AND (parent_id <=> ?) AND name=? LIMIT 1',
      [ledgerId, parentId, name]);
    if (found) return found.id;
    const r = await run('INSERT INTO categories (ledger_id, parent_id, name) VALUES (?, ?, ?)', [ledgerId, parentId, name]);
    report.categories++;
    return r.insertId;
  }
  for (const row of sheet('KATEGORIE')) {
    const parent = String(row[0] || '').trim();
    if (!parent) continue;
    const pid = await findOrCreateCat(1, null, parent);
    for (const cell of row.slice(1)) {
      const child = String(cell || '').trim();
      if (!child) continue;
      await findOrCreateCat(1, pid, child);
    }
  }
  // Kategorię transakcji zakładamy/znajdujemy W JEJ księdze (PERSEVERA=2 dostaje własne
  // kategorie — inaczej transakcja spółki wskazywałaby kategorię z księgi RODZINA).
  // Preferuj istniejący liść (parent_id NOT NULL) o tej nazwie; brak → utwórz korzeń.
  const catResolveCache = new Map();
  async function resolveCatForTx(ledgerId, name) {
    if (!name) return null;
    const key = ledgerId + '|' + name;
    if (catResolveCache.has(key)) return catResolveCache.get(key);
    const [[f]] = await conn.query(
      'SELECT id FROM categories WHERE ledger_id=? AND name=? ORDER BY (parent_id IS NULL) LIMIT 1', [ledgerId, name]);
    let id = f ? f.id : null;
    if (!id && !DRY) {
      const r = await run('INSERT INTO categories (ledger_id, parent_id, name) VALUES (?, NULL, ?)', [ledgerId, name]);
      id = r.insertId; report.categories++;
    }
    catResolveCache.set(key, id);
    return id;
  }

  // 3) księga główna
  const ledger = sheet('APP_FINANSOWA');
  for (const row of ledger.slice(1)) {
    const [data, pw, kategoria, wartosc, opis, uzytkownik] = row;
    const legacy = extractLegacy(row);
    const d = excelDate(data), amt = money(wartosc);
    if (!d || !amt || !['WYDATEK', 'PRZYCHÓD'].includes(String(pw || '').trim())) {
      if (data !== null || pw !== null) report.tx_skipped.push(row.slice(0, 7));
      continue;
    }
    const uname = String(uzytkownik || '').trim();
    const uid = userId[uname] || userId['Szymon'];
    const ledgerId = uname === 'PERSEVERA' ? 2 : 1;
    let catName = String(kategoria || '').trim();
    if (catName.includes('>')) catName = catName.split('>').pop().trim(); // "A > B" -> B
    const catId = await resolveCatForTx(ledgerId, catName);
    // idempotencja po legacy_id
    if (legacy) {
      const [[dupe]] = await conn.query('SELECT id FROM transactions WHERE legacy_id = ? LIMIT 1', [legacy]);
      if (dupe) continue;
    }
    await run(
      `INSERT INTO transactions (ledger_id, user_id, tx_date, type, amount, category_id, description, source, legacy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'MIGRACJA', ?)`,
      [ledgerId, uid, d, String(pw).trim(), Math.abs(amt), catId,
       String(opis || '').slice(0, 512) || null, legacy]);
    report.transactions++;
  }

  // 4) CSV bankowe (hash z arkusza zachowany 1:1)
  for (const row of sheet('CSV')) {
    const [user, _email, bank, acct, _iban, tdate, bdate, amount, curr, cp, title, balance, hash] = row;
    const d = excelDate(tdate);
    const h = String(hash || '').trim();
    if (!d || !/^[0-9a-f]{64}$/.test(h)) continue;
    try {
      const r = await run(
        `INSERT INTO bank_transactions
           (ledger_id, transaction_date, booking_date, amount, currency, counterparty, title, balance, tx_hash)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d, excelDate(bdate), money(amount) ?? 0, String(curr || 'PLN').slice(0, 3),
         String(cp || '').slice(0, 255) || null, String(title || '').slice(0, 512) || null,
         money(balance), h]);
      if (r.affectedRows) report.bank_rows++;
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') report.bank_dup++; else throw e;
    }
  }

  // 5) mapping_cache: OCR_NAME -> SUBCATEGORY (lub CATEGORY)
  for (const row of sheet('mapping_cache')) {
    const [pattern, _full, _short, cat, subcat] = row;
    const p = String(pattern || '').trim().slice(0, 255);
    if (!p) continue;
    const catId = catByName[String(subcat || '').trim()] || catByName[String(cat || '').trim()] || null;
    await run('INSERT IGNORE INTO mapping_cache (pattern, category_id, updated_by) VALUES (?, ?, ?)',
      [p, catId, String(row[6] || '').trim() || null]);
    report.mapping++;
  }

  console.log(DRY ? '== DRY RUN — nic nie zapisano ==' : '== MIGRACJA WYKONANA ==');
  console.log(JSON.stringify({ ...report, tx_skipped_count: report.tx_skipped.length }, null, 2));
  if (report.tx_skipped.length) {
    console.log('\nWiersze pominięte (do ręcznej decyzji):');
    for (const r of report.tx_skipped) console.log('  ', JSON.stringify(r));
  }
  await conn.end();
})().catch((e) => { console.error('BŁĄD:', e); process.exit(1); });
