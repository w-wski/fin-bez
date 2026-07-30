const express = require('express');
const { q } = require('../db');
const { ledgerScope } = require('../auth');
const { parseKwota } = require('../kwota');   // jedyne miejsce, gdzie napis staje się kwotą
const { domyslnaPlatnosc, platnoscDoPatcha } = require('../platnosc');

const router = express.Router();

// TRANSFER = przesunięcie własnych pieniędzy (rata kredytu, wpłata na cel). Nie jest
// konsumpcją, więc raporty trzymają go poza wydatkami — ale wpisać go musi się dać,
// inaczej każda ręcznie wpisana rata wpada do wydatków i psuje raport miesiąca.
const TYPY = ['WYDATEK', 'PRZYCHÓD', 'TRANSFER'];

// Zasięg wierszy księgi — jedno źródło prawdy: ledgerScope() z auth.js.
// Decyzja Szymona (2026-07-24): DOROSŁY widzi całą historię i raporty swojej księgi (Anna
// współprowadzi finanse rodziny), ograniczony do własnych wpisów jest tylko `junior`.
// Telemetria zostaje wyłącznie dla admina — pilnuje tego osobno /reports/telemetry.
// deleted=true odwraca filtr kosza: zamiast wpisów żywych zwraca wyłącznie usunięte miękko.
function scopeWhere(user, params, deleted = false) {
  const scope = ledgerScope(user);
  if (!scope.ledgers.length) return null;
  let where = `t.ledger_id IN (${scope.ledgers.join(',')})`;
  where += deleted ? ' AND t.deleted_at IS NOT NULL' : ' AND t.deleted_at IS NULL';
  if (scope.ownOnly) { where += ' AND t.user_id = :uid'; params.uid = user.uid; }
  return where;
}

// Z8/#25: klik w kategorię-RODZICA w Raportach filtruje też podkategorie — `category` przyjmuje
// wtedy listę id po przecinku (wzorzec z reports.js: idList()). Czysta funkcja — testowalna
// bez bazy (scripts/test-raport-wpisy.js), tak jak kategorie.js/idCalkowite().
function idyKategorii(category) {
  return String(category).split(',').map((s) => parseInt(s, 10)).filter(Number.isInteger);
}

// Kategoria musi należeć do TEJ SAMEJ księgi co wpis. Bez tego junior z RODZINY podpina wpisowi
// kategorię PERSEVERY, a `LEFT JOIN categories` w Historii i w raportach pokazuje jej nazwę.
async function kategoriaWKsiedze(catId, ledgerId) {
  const rows = await q('SELECT id FROM categories WHERE id = :c AND ledger_id = :l', { c: catId, l: ledgerId });
  return rows.length > 0;
}

// GET /api/v1/transactions?ledger=&from=&to=&category=&user=&type=&deleted=&limit=&offset=
router.get('/', async (req, res, next) => {
  try {
    const params = {};
    let where = scopeWhere(req.user, params, req.query.deleted === '1');
    if (!where) return res.json({ rows: [], total: 0 });
    const { ledger, from, to, category, user, type } = req.query;
    if (ledger) { where += ' AND t.ledger_id = :ledger'; params.ledger = parseInt(ledger, 10); }
    if (from) { where += ' AND t.tx_date >= :from'; params.from = from; }
    if (to) { where += ' AND t.tx_date <= :to'; params.to = to; }
    // Same liczby (nie napisy) wklejone do SQL-a — bez ryzyka wstrzyknięcia (patrz idyKategorii).
    if (category) {
      const ids = idyKategorii(category);
      // category PODANE, ale śmieciowe (nic się nie sparsowało) → pusta lista, nie cała
      // (IN (0) nie trafia w żadne realne id — category_id jest AUTO_INCREMENT od 1).
      where += ids.length ? ` AND t.category_id IN (${ids.join(',')})` : ' AND t.category_id IN (0)';
    }
    if (user) { where += ' AND u.name = :uname'; params.uname = user; }
    if (type) { where += ' AND t.type = :type'; params.type = type; }
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
    // Nazwę kategorii pokazujemy tylko wtedy, gdy kategoria jest z tej samej księgi co wpis —
    // stary wpis z kategorią cudzej księgi (dane sprzed walidacji w PATCH) ma pokazać „—", nie nazwę.
    const rows = await q(
      `SELECT t.id, t.ledger_id, t.tx_date, t.type, t.amount, t.currency, t.payment_method, t.description,
              t.source, t.bank_tx_id, t.category_id, c.name AS category, u.name AS user_name
       FROM transactions t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN categories c ON c.id = t.category_id AND c.ledger_id = t.ledger_id
       WHERE ${where}
       ORDER BY t.tx_date DESC, t.id DESC
       LIMIT ${limit} OFFSET ${offset}`, params);
    const [{ n }] = await q(
      `SELECT COUNT(*) AS n FROM transactions t JOIN users u ON u.id=t.user_id WHERE ${where}`, params);
    res.json({ rows, total: n });
  } catch (e) { next(e); }
});

// GET /api/v1/transactions/skroty — Z22: 5 najczęstszych par (kategoria, zaokrąglona kwota)
// z własnych żywych wydatków ostatnich 90 dni. Jeden klik nad formularzem Nowego Wpisu ma
// wypełnić najczęściej powtarzaną czynność — więc liczy się WYDATEK, nie każdy typ wpisu.
router.get('/skroty', async (req, res, next) => {
  try {
    const params = {};
    let where = scopeWhere(req.user, params);
    if (!where) return res.json({ rows: [] });
    where += " AND t.type = 'WYDATEK' AND t.tx_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)";
    const rows = await q(
      `SELECT t.category_id, c.name AS category_name, ROUND(t.amount) AS kwota, COUNT(*) AS n
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id AND c.ledger_id = t.ledger_id
       WHERE ${where}
       GROUP BY t.category_id, ROUND(t.amount)
       ORDER BY n DESC
       LIMIT 5`, params);
    res.json({ rows });
  } catch (e) { next(e); }
});

// POST /api/v1/transactions  {ledger_id, tx_date, type, amount, category_id?, category_name?, description?}
router.post('/', async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    const b = req.body || {};
    const ledgerId = parseInt(b.ledger_id || 1, 10);
    if (!scope.ledgers.includes(ledgerId)) return res.status(403).json({ error: 'ledger_forbidden' });
    const amount = parseKwota(b.amount);
    if (!b.tx_date || !TYPY.includes(b.type) || amount === null || amount <= 0) {
      return res.status(400).json({ error: 'bad_input', fields: ['tx_date', 'type', 'amount'] });
    }
    // Brak pola przy WYDATEK/PRZYCHÓD -> domyślna ELEKTRONICZNA (decyzja Szymona 2026-07-28).
    // TRANSFER nie jest płatnością: zapisujemy NULL, a jawnie podaną wartość odrzucamy — to nie
    // pole klienta do wypełnienia przy przesunięciu między własnymi kontami.
    const platnoscWynik = domyslnaPlatnosc(b);
    if (platnoscWynik.error) return res.status(400).json({ error: platnoscWynik.error });
    const paymentMethod = platnoscWynik.value;
    // Idempotencja kolejki offline: client_ref (legacy_id) — ponowna wysyłka tego samego
    // wpisu (np. sieć padła po INSERT, przed odpowiedzią) zwraca istniejący rekord, nie dubluje.
    const clientRef = typeof b.client_ref === 'string' && /^off:[\w-]{6,64}$/.test(b.client_ref) ? b.client_ref : null;
    if (clientRef) {
      const dupe = await q('SELECT id FROM transactions WHERE legacy_id = :r AND user_id = :u LIMIT 1',
        { r: clientRef, u: req.user.uid });
      if (dupe.length) return res.status(200).json({ id: dupe[0].id, deduped: true });
    }
    let categoryId = b.category_id ? Number(b.category_id) : null;
    if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId <= 0
        || !(await kategoriaWKsiedze(categoryId, ledgerId)))) {
      return res.status(400).json({ error: 'bad_category' });
    }
    // tworzenie kategorii w locie — sprawdzony wzorzec z prototypu
    if (!categoryId && b.category_name) {
      const name = String(b.category_name).trim().slice(0, 96);
      const parentId = b.parent_id ? parseInt(b.parent_id, 10) : null;
      await q('INSERT IGNORE INTO categories (ledger_id, parent_id, name) VALUES (:l, :p, :n)',
        { l: ledgerId, p: parentId, n: name });
      const found = await q(
        'SELECT id FROM categories WHERE ledger_id=:l AND name=:n AND (parent_id <=> :p) LIMIT 1',
        { l: ledgerId, n: name, p: parentId });
      categoryId = found[0]?.id || null;
    }
    let r;
    try {
      r = await q(
        `INSERT INTO transactions (ledger_id, user_id, tx_date, type, amount, currency, payment_method, category_id, description, source, legacy_id)
         VALUES (:l, :u, :d, :t, :a, :c, :pm, :cat, :desc, 'MANUAL', :ref)`,
        { l: ledgerId, u: req.user.uid, d: b.tx_date, t: b.type, a: amount,
          c: (b.currency || 'PLN').slice(0, 3), pm: paymentMethod, cat: categoryId,
          desc: (b.description || '').slice(0, 512) || null, ref: clientRef });
    } catch (e) {
      // Z22: migracja 021 dodała UNIQUE (user_id, off_ref) — dwa równoległe retry tego samego
      // client_ref mijają się w oknie między SELECT-dedupe wyżej a tym INSERT-em. Zamiast 500
      // dociągamy wpis, który wygrał wyścig, i mówimy klientowi to samo co przy zwykłym dedupe.
      if (e.code === 'ER_DUP_ENTRY' && clientRef) {
        const wygrany = await q('SELECT id FROM transactions WHERE legacy_id = :r AND user_id = :u LIMIT 1',
          { r: clientRef, u: req.user.uid });
        if (wygrany.length) return res.status(200).json({ id: wygrany[0].id, deduped: true });
      }
      throw e;
    }
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
});

// PATCH /api/v1/transactions/:id — edycja własnego wpisu (admin: dowolnego w swoich księgach).
// Cudzy wpis = 404, nie 403 — nie zdradzamy, że taki wpis w ogóle istnieje.
// Pole nie do przyjęcia = 400 z nazwą pola. Ciche „ok" przy odrzuconej wartości było gorsze niż
// błąd: front robi Object.assign(wpis, body) i pokazywał kwotę, której w bazie nigdy nie było.
router.patch('/:id', async (req, res, next) => {
  try {
    const params = { id: parseInt(req.params.id, 10) };
    const where = scopeWhere(req.user, params);
    if (!where) return res.status(403).json({ error: 'forbidden' });
    const cur = await q(`SELECT t.id, t.ledger_id, t.type FROM transactions t WHERE t.id = :id AND ${where}`, params);
    if (!cur.length) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const sets = [], p2 = { ...params };
    if (b.tx_date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.tx_date))) return res.status(400).json({ error: 'bad_date' });
      sets.push('t.tx_date = :d'); p2.d = b.tx_date;
    }
    if (b.type !== undefined) {
      if (!TYPY.includes(b.type)) return res.status(400).json({ error: 'bad_type' });
      sets.push('t.type = :t'); p2.t = b.type;
    }
    if (b.amount !== undefined) {
      const a = parseKwota(b.amount);
      if (a === null || a <= 0) return res.status(400).json({ error: 'bad_amount' });
      sets.push('t.amount = :a'); p2.a = a;
    }
    if (b.category_id !== undefined) {
      const c = (b.category_id === null || b.category_id === '') ? null : Number(b.category_id);
      if (c !== null && (!Number.isInteger(c) || c <= 0 || !(await kategoriaWKsiedze(c, cur[0].ledger_id)))) {
        return res.status(400).json({ error: 'bad_category' });
      }
      sets.push('t.category_id = :c'); p2.c = c;
    }
    if (b.description !== undefined) {
      sets.push('t.description = :desc');
      p2.desc = (b.description === null ? '' : String(b.description)).slice(0, 512) || null;
    }
    // Formę płatności można PRZEŁĄCZYĆ (elektroniczna <-> gotówka), ale nie wyczyścić na NULL
    // (patrz migracja 015), i nigdy przy TRANSFER — typ liczy się PO tym PATCH-u (nowy z body,
    // jeśli podany, inaczej ten z bazy), więc zmiana typu na TRANSFER też odrzuca płatność.
    const platnoscWynik = platnoscDoPatcha(b, b.type !== undefined ? b.type : cur[0].type);
    if (platnoscWynik.error) return res.status(400).json({ error: platnoscWynik.error });
    if (platnoscWynik.touched) { sets.push('t.payment_method = :pm'); p2.pm = platnoscWynik.value; }
    if (!sets.length) return res.status(400).json({ error: 'nothing_to_update' });
    // Warunek zasięgu wchodzi TAKŻE do UPDATE: między SELECT-em a zapisem wpis mógł trafić do Kosza
    // (admin, druga karta) — bez tego zapis lądowałby na rekordzie usuniętym albo cudzym.
    // affectedRows liczy wiersze DOPASOWANE (mysql2 łączy się z FOUND_ROWS), więc zapis wartością
    // identyczną z obecną nie udaje 404.
    const r = await q(`UPDATE transactions t SET ${sets.join(', ')} WHERE t.id = :id AND ${where}`, p2);
    if (!r.affectedRows) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// DELETE — soft delete z audytem (deleted_by: kto usunął, kolumna z migracji 006)
router.delete('/:id', async (req, res, next) => {
  try {
    const params = { id: parseInt(req.params.id, 10) };
    const where = scopeWhere(req.user, params);
    if (!where) return res.status(403).json({ error: 'forbidden' });
    params.by = req.user.uid;
    const r = await q(
      `UPDATE transactions t SET t.deleted_at = NOW(), t.deleted_by = :by WHERE t.id = :id AND ${where}`, params);
    if (!r.affectedRows) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/v1/transactions/:id/restore — cofnięcie usunięcia („Cofnij" w Historii i Kosz).
// 404, gdy wpisu nie ma, nie jest usunięty albo należy do kogoś innego (jak w PATCH).
router.post('/:id/restore', async (req, res, next) => {
  try {
    const params = { id: parseInt(req.params.id, 10) };
    const where = scopeWhere(req.user, params, true);
    if (!where) return res.status(403).json({ error: 'forbidden' });
    const r = await q(
      `UPDATE transactions t SET t.deleted_at = NULL, t.deleted_by = NULL WHERE t.id = :id AND ${where}`, params);
    if (!r.affectedRows) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.idyKategorii = idyKategorii;   // eksport dla scripts/test-raport-wpisy.js
