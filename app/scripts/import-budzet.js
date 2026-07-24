// Import transakcji-wydatków z arkusza „Budżet Domowy" (Kopia_Budzet_Domowy…xlsx).
// Każda zakładka = miesiąc (STY..MAJ); dane w sekcji „ŚLEDZENIE TRANSAKCJI":
// nagłówek DATA | KWOTA | NAZWA BUDŻETU. Wszystkie pozycje to WYDATKI (brak typu,
// brak opisu, brak użytkownika w źródle).
//
// Decyzje importu (patrz raport w rozmowie / RUNBOOK):
//  - source = 'BUDZET' (odróżnialne, odwracalne: DELETE ... WHERE source='BUDZET')
//  - ledger: PERSEVERA gdy nazwa kategorii zaczyna się od "PERSEVERA", inaczej RODZINA
//  - user  : Szymon (źródło nie rozróżnia osób)
//  - kategoria: findOrCreate po nazwie w danym ledgerze
//  - legacy_id = 'budzet:'+sha1(miesiąc|data|kwota|kategoria|nr-w-grupie) → idempotencja,
//    a licznik-w-grupie chroni realnie różne, identyczne kwotowo transakcje przed scaleniem
//
// UWAGA NAKŁADANIA: okres STY–13.05 pokrywa się z już wgranym CSV PKO BP (bank_transactions)
// i z księgą APP_FINANSOWA (od 08.05). Import NIE dedupuje względem tamtych — te budżetowe
// wydatki to skategoryzowana księga; nakładki z bankowymi rozstrzygniesz w UI „Do uzgodnienia".
// Dlatego domyślnie uruchamiaj najpierw z --dry-run i podejmij decyzję (patrz raport).
//
// Użycie:  node scripts/import-budzet.js /ścieżka/Budzet.xlsx [--dry-run]
const crypto = require('crypto');
const XLSX = require('xlsx');
require('../src/config');
const mysql = require('mysql2/promise');

const DRY = process.argv.includes('--dry-run');
const file = process.argv[2];
if (!file) { console.error('Podaj ścieżkę do pliku Budżet Domowy .xlsx'); process.exit(1); }

const d = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null);

function parseSheet(rows) {
  let hdr = -1;
  for (let r = 0; r < rows.length; r++) {
    if (String(rows[r][0]).trim() === 'DATA' && String(rows[r][2]).trim() === 'KWOTA') { hdr = r; break; }
  }
  const out = [];
  if (hdr < 0) return out;
  for (let r = hdr + 1; r < rows.length; r++) {
    const date = d(rows[r][0]);
    const amt = rows[r][2];
    const cat = String(rows[r][5] || '').trim();
    if (!date || typeof amt !== 'number' || amt === 0) continue;
    out.push({ date, amount: Math.round(Math.abs(amt) * 100) / 100, category: cat });
  }
  return out;
}

(async () => {
  const wb = XLSX.readFile(file, { cellDates: true });
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASS, database: process.env.DB_NAME, charset: 'utf8mb4',
  });
  const [[uszymon]] = await conn.query("SELECT id FROM users WHERE name='Szymon' LIMIT 1");
  if (!uszymon) { console.error('Brak użytkownika Szymon — uruchom najpierw migrate-xlsx.'); process.exit(1); }
  const userId = uszymon.id;

  const catCache = new Map();
  async function findOrCreateCat(ledgerId, name) {
    if (!name) return null;
    const key = ledgerId + '|' + name;
    if (catCache.has(key)) return catCache.get(key);
    // preferuj istniejący liść (parent_id NOT NULL) — nie twórz korzenia-duplikatu, jeśli
    // migracja założyła tę kategorię jako podkategorię
    const [[found]] = await conn.query(
      'SELECT id FROM categories WHERE ledger_id=? AND name=? ORDER BY (parent_id IS NULL) LIMIT 1', [ledgerId, name]);
    let id = found ? found.id : null;
    if (!id && !DRY) {
      const [r] = await conn.execute('INSERT INTO categories (ledger_id, parent_id, name) VALUES (?, NULL, ?)', [ledgerId, name]);
      id = r.insertId;
    }
    catCache.set(key, id);
    return id;
  }

  // Anty-nakładka (HIGH: potrójne liczenie): NIE importuj wydatków budżetowych z okresu,
  // który pokrywa już księga APP_FINANSOWA (source=MIGRACJA) — inaczej ten sam wydatek
  // liczyłby się podwójnie w /summary. Budżet uzupełnia okres SPRZED tej daty.
  // Wyłączenie: --allow-overlap (wtedy nakładki rozstrzygniesz ręcznie w UI).
  const allowOverlap = process.argv.includes('--allow-overlap');
  const [[mig]] = await conn.query("SELECT MIN(tx_date) d FROM transactions WHERE source='MIGRACJA'");
  const cutoff = (!allowOverlap && mig && mig.d) ? d(mig.d) : null;
  if (cutoff) console.log(`Granica anty-nakładkowa: pomijam wydatki budżetowe od ${cutoff} (pokryte przez APP_FINANSOWA).`);

  const report = { perMonth: {}, added: 0, dup: 0, skippedOverlap: 0, newCats: 0, byLedger: { RODZINA: 0, PERSEVERA: 0 } };
  const before = (await conn.query("SELECT COUNT(*) n FROM categories"))[0][0].n;

  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });
    const tx = parseSheet(rows);
    report.perMonth[name] = tx.length;
    const groupCount = new Map(); // klucz treści -> licznik, by rozróżnić identyczne
    for (const t of tx) {
      if (cutoff && t.date >= cutoff) { report.skippedOverlap++; continue; }
      const ledgerId = /^PERSEVERA\b/i.test(t.category) ? 2 : 1;
      const base = `${name}|${t.date}|${t.amount}|${t.category}`;
      const n = (groupCount.get(base) || 0) + 1; groupCount.set(base, n);
      const legacy = 'budzet:' + crypto.createHash('sha1').update(base + '|' + n).digest('hex').slice(0, 24);
      const [[dupe]] = await conn.query('SELECT id FROM transactions WHERE legacy_id=? LIMIT 1', [legacy]);
      if (dupe) { report.dup++; continue; }
      const catId = await findOrCreateCat(ledgerId, t.category);
      if (!DRY) {
        await conn.execute(
          `INSERT INTO transactions (ledger_id, user_id, tx_date, type, amount, category_id, description, source, legacy_id)
           VALUES (?, ?, ?, 'WYDATEK', ?, ?, ?, 'BUDZET', ?)`,
          [ledgerId, userId, t.date, t.amount, catId, `Budżet ${name.trim()}`, legacy]);
      }
      report.added++;
      report.byLedger[ledgerId === 2 ? 'PERSEVERA' : 'RODZINA']++;
    }
  }
  const after = DRY ? before : (await conn.query("SELECT COUNT(*) n FROM categories"))[0][0].n;
  report.newCats = after - before;

  console.log(DRY ? '== DRY RUN — nic nie zapisano ==' : '== IMPORT BUDŻETU WYKONANY ==');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nSuma dodanych: ${report.added} (duplikaty pominięte: ${report.dup}).`);
  console.log('Uwaga: to wydatki skategoryzowane; nakładki z CSV PKO/księgą uzgodnisz w UI „Do uzgodnienia".');
  await conn.end();
})().catch((e) => { console.error('BŁĄD:', e.message); process.exit(1); });
