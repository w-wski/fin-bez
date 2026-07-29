const express = require('express');
const multer = require('multer');
const config = require('../config');
const { q, pool } = require('../db');
const { ledgerScope } = require('../auth');
const { parseBankFile } = require('../banks');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxCsvBytes } });

// ---------- SAMOUCZENIE KATEGORYZACJI ----------
// System uczy się z DECYZJI Szymona: każde uzgodnienie (match/book) zapisuje wzorzec
// kontrahenta -> kategoria do mapping_cache (hits++, confidence rośnie). Przy kolejnych
// importach ten sam kontrahent dostaje kategorię automatycznie (sugestia w /unmatched,
// prefill w /book). Zero LLM — czysta statystyka z realnych decyzji.
function normPattern(counterparty, title) {
  const raw = `${counterparty || ''} ${title || ''}`;
  return raw.toUpperCase()
    .replace(/[0-9]/g, '')                      // numery sklepów/kas/dat nie niosą sygnału
    .replace(/[^\p{L} ]/gu, ' ')                  // interpunkcja out (litery PL zostają)
    .replace(/\s+/g, ' ').trim().slice(0, 64) || null;
}

async function learnMapping(bankTx, categoryId, userName) {
  if (!categoryId) return;
  const pattern = normPattern(bankTx.counterparty, bankTx.title);
  if (!pattern || pattern.length < 3) return;
  // nowy wzorzec: confidence 0.6; każde potwierdzenie: hits++ i +0.1 (max 0.99);
  // zmiana kategorii przez użytkownika NADPISUJE starą (ostatnia decyzja człowieka wygrywa)
  await q(
    `INSERT INTO mapping_cache (pattern, category_id, hits, confidence, updated_by)
     VALUES (:p, :c, 1, 0.60, :u)
     ON DUPLICATE KEY UPDATE
       hits = IF(category_id = VALUES(category_id), hits + 1, 1),
       confidence = IF(category_id = VALUES(category_id), LEAST(confidence + 0.10, 0.99), 0.60),
       category_id = VALUES(category_id),
       updated_by = VALUES(updated_by)`,
    { p: pattern, c: categoryId, u: userName });
}

async function suggestCategory(bankTx) {
  const pattern = normPattern(bankTx.counterparty, bankTx.title);
  if (!pattern) return null;
  const rows = await q(
    `SELECT m.category_id, m.confidence, m.hits, c.name
     FROM mapping_cache m JOIN categories c ON c.id = m.category_id AND c.active = 1
     WHERE m.pattern = :p LIMIT 1`, { p: pattern });
  return rows[0] || null;
}

// POST /api/v1/imports/csv  (multipart: file, ledger_id?, bank?, iban?)
// Zwraca raport: bank, dodane, duplikaty, odrzucone + propozycje uzgodnień.
router.post('/csv', upload.single('file'), async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    const ledgerId = parseInt(req.body.ledger_id || 1, 10);
    if (!scope.ledgers.includes(ledgerId) || scope.ownOnly) {
      return res.status(403).json({ error: 'import_forbidden' }); // junior nie importuje
    }
    if (!req.file) return res.status(400).json({ error: 'no_file' });

    const { bank, rows, errors } = parseBankFile(req.file.buffer, {
      bank: req.body.bank || undefined, iban: req.body.iban || undefined,
    });
    if (!bank) return res.status(422).json({ error: 'bank_not_detected', details: errors });

    const imp = await q(
      'INSERT INTO bank_imports (bank_name, filename, imported_by) VALUES (:b, :f, :u)',
      { b: bank, f: req.file.originalname.slice(0, 255), u: req.user.uid });
    const importId = imp.insertId;

    let ok = 0, dup = 0;
    for (const t of rows) {
      try {
        await q(
          `INSERT INTO bank_transactions
             (import_id, ledger_id, transaction_date, booking_date, amount, currency, counterparty, title, balance, tx_hash)
           VALUES (:imp, :l, :td, :bd, :a, :c, :cp, :ti, :bal, :h)`,
          { imp: importId, l: ledgerId, td: t.transaction_date, bd: t.booking_date,
            a: t.amount, c: t.currency, cp: t.counterparty, ti: t.title, bal: t.balance, h: t.tx_hash });
        ok++;
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') dup++; else throw e;
      }
    }
    await q('UPDATE bank_imports SET rows_ok=:o, rows_dup=:d, rows_err=:e WHERE id=:id',
      { o: ok, d: dup, e: errors.length, id: importId });

    res.status(201).json({ import_id: importId, bank, added: ok, duplicates: dup, rejected: errors.length });
  } catch (e) { next(e); }
});

// GET /api/v1/imports — historia importów
router.get('/', async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT bi.id, bi.bank_name, bi.filename, bi.imported_at, bi.rows_ok, bi.rows_dup, bi.rows_err, u.name AS imported_by
       FROM bank_imports bi JOIN users u ON u.id = bi.imported_by
       ORDER BY bi.id DESC LIMIT 50`);
    res.json({ imports: rows });
  } catch (e) { next(e); }
});

// GET /api/v1/imports/unmatched?ledger=1 — bankowe bez uzgodnienia + kandydaci z księgi
// Kandydat: wpis ręczny o tej samej kwocie ±0.01 i dacie ±3 dni (heurystyka z planu §2.4).
router.get('/unmatched', async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    const ledger = parseInt(req.query.ledger || 1, 10);
    if (!scope.ledgers.includes(ledger) || scope.ownOnly) return res.status(403).json({ error: 'forbidden' });
    const bts = await q(
      `SELECT id, transaction_date, amount, currency, counterparty, title
       FROM bank_transactions
       WHERE ledger_id = :l AND matched_transaction_id IS NULL
       ORDER BY transaction_date DESC LIMIT 200`, { l: ledger });
    for (const bt of bts) {
      bt.suggestion = await suggestCategory(bt); // samouczenie: kategoria z wcześniejszych decyzji
      // Kandydat musi mieć zgodny KIERUNEK: bank -100 nie proponuje księgowego PRZYCHODU +100.
      // TRANSFER (rata, wpłata na cel) idzie w obie strony, więc pasuje do obu znaków — bez tego
      // wiersz bankowy raty nigdy nie dostałby kandydata i wisiałby „do uzgodnienia" na zawsze.
      bt.candidates = await q(
        `SELECT t.id, t.tx_date, t.type, t.amount, t.description, u.name AS user_name
         FROM transactions t JOIN users u ON u.id = t.user_id
         WHERE t.ledger_id = :l AND t.deleted_at IS NULL AND t.bank_tx_id IS NULL
           AND t.type IN (IF(:a < 0, 'WYDATEK', 'PRZYCHÓD'), 'TRANSFER')
           AND ABS(t.amount - ABS(:a)) < 0.011
           AND ABS(DATEDIFF(t.tx_date, :d)) <= 3
         LIMIT 5`, { l: ledger, a: bt.amount, d: bt.transaction_date });
    }
    res.json({ unmatched: bts });
  } catch (e) { next(e); }
});

// POST /api/v1/imports/match {bank_tx_id, transaction_id}  — ręczne uzgodnienie
// POST /api/v1/imports/book {bank_tx_id, category_id?, user_id?} — zaksięguj bankową jako nowy wpis
router.post('/match', async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    if (scope.ownOnly) return res.status(403).json({ error: 'forbidden' });
    const bankTxId = parseInt(req.body?.bank_tx_id, 10);
    const txId = parseInt(req.body?.transaction_id, 10);
    if (!Number.isInteger(bankTxId) || !Number.isInteger(txId)) return res.status(400).json({ error: 'bad_input' });
    const bt = await q('SELECT id, ledger_id, matched_transaction_id FROM bank_transactions WHERE id = :id', { id: bankTxId });
    if (!bt.length || !scope.ledgers.includes(bt[0].ledger_id)) return res.status(404).json({ error: 'bank_tx_not_found' });
    if (bt[0].matched_transaction_id) return res.status(409).json({ error: 'already_matched' });
    // transakcja docelowa MUSI być w tej samej księdze, żywa i jeszcze nieuzgodniona (IDOR guard)
    const tx = await q(
      'SELECT id FROM transactions WHERE id = :t AND ledger_id = :l AND deleted_at IS NULL AND bank_tx_id IS NULL',
      { t: txId, l: bt[0].ledger_id });
    if (!tx.length) return res.status(404).json({ error: 'transaction_not_matchable' });
    // /match TYLKO spina istniejący wiersz bankowy z istniejącym wpisem księgi — typ wpisu
    // (WYDATEK/PRZYCHÓD/TRANSFER) już tam jest, ustalony przy jego utworzeniu. Właściwa logika
    // wyznaczania typu (kierunek + „dominujący typ kategorii") żyje w /book niżej, bo TAM
    // dopiero powstaje NOWY wpis. Martwy blok, który tu kiedyś liczył `typ` z odwołaniem do
    // niezadeklarowanego `effectiveCategory` (zmienna z /book), usunięty — nikt go nie używał.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('UPDATE bank_transactions SET matched_transaction_id = ? WHERE id = ?', [txId, bankTxId]);
      await conn.execute('UPDATE transactions SET bank_tx_id = ? WHERE id = ?', [bankTxId, txId]);
      await conn.commit();
      // SAMOUCZENIE: kontrahent tego wiersza bankowego -> kategoria ręcznego wpisu Szymona
      const [[full]] = await conn.query('SELECT counterparty, title FROM bank_transactions WHERE id = ?', [bankTxId]);
      const [[cat]] = await conn.query('SELECT category_id FROM transactions WHERE id = ?', [txId]);
      if (full && cat) learnMapping(full, cat.category_id, req.user.name).catch(() => {});
      res.json({ ok: true });
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (e) { next(e); }
});

router.post('/book', async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    if (scope.ownOnly) return res.status(403).json({ error: 'forbidden' });
    const { bank_tx_id, category_id } = req.body || {};
    const rows = await q('SELECT * FROM bank_transactions WHERE id = :id AND matched_transaction_id IS NULL', { id: bank_tx_id });
    if (!rows.length || !scope.ledgers.includes(rows[0].ledger_id)) return res.status(404).json({ error: 'not_found' });
    const bt = rows[0];
    // SAMOUCZENIE: brak kategorii od użytkownika -> weź nauczoną sugestię; jawny wybór -> zapamiętaj
    let effectiveCategory = category_id || null;
    let autoCategorized = false;
    if (!effectiveCategory) {
      const sug = await suggestCategory(bt);
      if (sug) { effectiveCategory = sug.category_id; autoCategorized = true; }
    } else {
      learnMapping(bt, effectiveCategory, req.user.name).catch(() => {});
    }
    // Typ wpisu: kierunek ze znaku kwoty, a gdy kategoria jest w praktyce transferowa (spłaty,
    // cele), TRANSFER — uczymy się z decyzji człowieka, zamiast trzymać listę „kategorii
    // transferowych". Do 2026-07-28 ten handler używał `typ` zadeklarowanego wyłącznie w /match
    // — każdy realny POST /book kończył się ReferenceError (bug złapany przy zleceniu Z6).
    let typ = bt.amount < 0 ? 'WYDATEK' : 'PRZYCHÓD';
    if (effectiveCategory) {
      // Zawężone do księgi wiersza bankowego (K1b, poprawka po recenzji): bez tego dominujący
      // typ liczył się ze WSZYSTKICH ksiąg naraz, więc kategoria o tym samym id w cudzej księdze
      // (np. RODZINA vs PERSEVERA) mogła przegłosować typ wpisu, którego wcale nie dotyczyła.
      const dom = await q(
        `SELECT type FROM transactions WHERE category_id = :c AND ledger_id = :l AND deleted_at IS NULL
         GROUP BY type ORDER BY COUNT(*) DESC LIMIT 1`, { c: effectiveCategory, l: bt.ledger_id });
      if (dom[0]?.type === 'TRANSFER') typ = 'TRANSFER';
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Wyciąg bankowy z definicji nie jest gotówką (Z6) — forma płatności jest tu twarda,
      // nie domyślna: nikt nie może jej zmienić przy zaksięgowaniu, bo to nie decyzja użytkownika.
      const [r] = await conn.execute(
        `INSERT INTO transactions (ledger_id, user_id, tx_date, type, amount, currency, payment_method, category_id, description, source, bank_tx_id)
         VALUES (?, ?, ?, ?, ?, ?, 'ELEKTRONICZNA', ?, ?, 'CSV', ?)`,
        [bt.ledger_id, req.user.uid, bt.transaction_date,
         typ, Math.abs(bt.amount), bt.currency,
         effectiveCategory,
         [bt.counterparty, bt.title].filter(Boolean).join(' — ').slice(0, 512) || null,
         bt.id]);
      await conn.execute('UPDATE bank_transactions SET matched_transaction_id = ? WHERE id = ?', [r.insertId, bt.id]);
      await conn.commit();
      res.status(201).json({ id: r.insertId, auto_categorized: autoCategorized, category_id: effectiveCategory });
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (e) { next(e); }
});

module.exports = router;
