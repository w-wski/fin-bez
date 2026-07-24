const express = require('express');
const { q } = require('../db');
const { ledgerScope } = require('../auth');

const router = express.Router();

function scopeWhere(user, params) {
  const scope = ledgerScope(user);
  if (!scope.ledgers.length) return null;
  let where = `t.ledger_id IN (${scope.ledgers.join(',')}) AND t.deleted_at IS NULL`;
  if (scope.ownOnly) { where += ' AND t.user_id = :uid'; params.uid = user.uid; }
  return where;
}

// GET /api/v1/transactions?ledger=&from=&to=&category=&user=&type=&limit=&offset=
router.get('/', async (req, res, next) => {
  try {
    const params = {};
    let where = scopeWhere(req.user, params);
    if (!where) return res.json({ rows: [], total: 0 });
    const { ledger, from, to, category, user, type } = req.query;
    if (ledger) { where += ' AND t.ledger_id = :ledger'; params.ledger = parseInt(ledger, 10); }
    if (from) { where += ' AND t.tx_date >= :from'; params.from = from; }
    if (to) { where += ' AND t.tx_date <= :to'; params.to = to; }
    if (category) { where += ' AND t.category_id = :cat'; params.cat = parseInt(category, 10); }
    if (user) { where += ' AND u.name = :uname'; params.uname = user; }
    if (type) { where += ' AND t.type = :type'; params.type = type; }
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
    const rows = await q(
      `SELECT t.id, t.ledger_id, t.tx_date, t.type, t.amount, t.currency, t.description,
              t.source, t.bank_tx_id, c.name AS category, u.name AS user_name
       FROM transactions t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${where}
       ORDER BY t.tx_date DESC, t.id DESC
       LIMIT ${limit} OFFSET ${offset}`, params);
    const [{ n }] = await q(
      `SELECT COUNT(*) AS n FROM transactions t JOIN users u ON u.id=t.user_id WHERE ${where}`, params);
    res.json({ rows, total: n });
  } catch (e) { next(e); }
});

// POST /api/v1/transactions  {ledger_id, tx_date, type, amount, category_id?, category_name?, description?}
router.post('/', async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    const b = req.body || {};
    const ledgerId = parseInt(b.ledger_id || 1, 10);
    if (!scope.ledgers.includes(ledgerId)) return res.status(403).json({ error: 'ledger_forbidden' });
    const amount = Math.abs(parseFloat(String(b.amount).replace(',', '.')));
    if (!b.tx_date || !['WYDATEK', 'PRZYCHÓD'].includes(b.type) || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'bad_input', fields: ['tx_date', 'type', 'amount'] });
    }
    // Idempotencja kolejki offline: client_ref (legacy_id) — ponowna wysyłka tego samego
    // wpisu (np. sieć padła po INSERT, przed odpowiedzią) zwraca istniejący rekord, nie dubluje.
    const clientRef = typeof b.client_ref === 'string' && /^off:[\w-]{6,64}$/.test(b.client_ref) ? b.client_ref : null;
    if (clientRef) {
      const dupe = await q('SELECT id FROM transactions WHERE legacy_id = :r AND user_id = :u LIMIT 1',
        { r: clientRef, u: req.user.uid });
      if (dupe.length) return res.status(200).json({ id: dupe[0].id, deduped: true });
    }
    let categoryId = b.category_id ? parseInt(b.category_id, 10) : null;
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
    const r = await q(
      `INSERT INTO transactions (ledger_id, user_id, tx_date, type, amount, currency, category_id, description, source, legacy_id)
       VALUES (:l, :u, :d, :t, :a, :c, :cat, :desc, 'MANUAL', :ref)`,
      { l: ledgerId, u: req.user.uid, d: b.tx_date, t: b.type, a: amount,
        c: (b.currency || 'PLN').slice(0, 3), cat: categoryId, desc: (b.description || '').slice(0, 512) || null,
        ref: clientRef });
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
});

// PATCH /api/v1/transactions/:id — edycja własnych (junior) / w zasięgu księgi
router.patch('/:id', async (req, res, next) => {
  try {
    const params = { id: parseInt(req.params.id, 10) };
    const where = scopeWhere(req.user, params);
    if (!where) return res.status(403).json({ error: 'forbidden' });
    const cur = await q(`SELECT t.id FROM transactions t WHERE t.id = :id AND ${where}`, params);
    if (!cur.length) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const sets = [], p2 = { id: params.id };
    if (b.tx_date) { sets.push('tx_date = :d'); p2.d = b.tx_date; }
    if (b.type && ['WYDATEK', 'PRZYCHÓD'].includes(b.type)) { sets.push('type = :t'); p2.t = b.type; }
    if (b.amount !== undefined) {
      const a = Math.abs(parseFloat(String(b.amount).replace(',', '.')));
      if (Number.isFinite(a) && a > 0) { sets.push('amount = :a'); p2.a = a; }
    }
    if (b.category_id !== undefined) { sets.push('category_id = :c'); p2.c = b.category_id || null; }
    if (b.description !== undefined) { sets.push('description = :desc'); p2.desc = String(b.description).slice(0, 512) || null; }
    if (!sets.length) return res.status(400).json({ error: 'nothing_to_update' });
    await q(`UPDATE transactions SET ${sets.join(', ')} WHERE id = :id`, p2);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// DELETE — soft delete
router.delete('/:id', async (req, res, next) => {
  try {
    const params = { id: parseInt(req.params.id, 10) };
    const where = scopeWhere(req.user, params);
    if (!where) return res.status(403).json({ error: 'forbidden' });
    const r = await q(`UPDATE transactions t SET t.deleted_at = NOW() WHERE t.id = :id AND ${where}`, params);
    if (!r.affectedRows) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
