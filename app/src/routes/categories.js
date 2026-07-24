const express = require('express');
const { q } = require('../db');
const { ledgerScope } = require('../auth');

const router = express.Router();

// GET /api/v1/categories?ledger=1 — drzewo (parent + dzieci)
router.get('/', async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    const ledger = parseInt(req.query.ledger || scope.ledgers[0] || 1, 10);
    if (!scope.ledgers.includes(ledger)) return res.status(403).json({ error: 'ledger_forbidden' });
    const rows = await q(
      'SELECT id, parent_id, name FROM categories WHERE ledger_id = :l AND active = 1 ORDER BY name',
      { l: ledger });
    const roots = rows.filter((r) => !r.parent_id).map((r) => ({ ...r, children: [] }));
    const byId = Object.fromEntries(roots.map((r) => [r.id, r]));
    for (const r of rows.filter((x) => x.parent_id)) byId[r.parent_id]?.children.push(r);
    res.json({ categories: roots });
  } catch (e) { next(e); }
});

// POST /api/v1/categories {ledger_id, name, parent_id?}
router.post('/', async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    const b = req.body || {};
    const ledger = parseInt(b.ledger_id || 1, 10);
    if (!scope.ledgers.includes(ledger)) return res.status(403).json({ error: 'ledger_forbidden' });
    const name = String(b.name || '').trim().slice(0, 96);
    if (!name) return res.status(400).json({ error: 'bad_input' });
    const parent = b.parent_id ? parseInt(b.parent_id, 10) : null;
    await q('INSERT IGNORE INTO categories (ledger_id, parent_id, name) VALUES (:l, :p, :n)',
      { l: ledger, p: parent, n: name });
    const found = await q(
      'SELECT id FROM categories WHERE ledger_id=:l AND name=:n AND (parent_id <=> :p) LIMIT 1',
      { l: ledger, n: name, p: parent });
    res.status(201).json({ id: found[0].id });
  } catch (e) { next(e); }
});

module.exports = router;
