// K5 (Z15): lista wpisów BEZ kategorii danego okresu — klik w „(bez kategorii)" na wykresie
// „Wydatki wg kategorii" (public/js/raporty.js) otwiera ją w miejscu, żeby dało się każdemu
// wpisowi nadać kategorię bez wychodzenia do pełnej Historii (routes/transactions.js nie jest
// naszym plikiem — PATCH pojedynczego wpisu leci na istniejącą trasę PATCH /transactions/:id).
// Wydzielone z reports.js (limit 300 linii, konwencja repo — patrz raporty-uklad.js).
const express = require('express');
const { q } = require('../db');
const { ledgerScope, requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Czysta funkcja filtrująca — mirror logiki SQL niżej, testowalna bez bazy
// (scripts/test-raporty-ui.js): category_id IS NULL i wewnątrz zakresu dat.
function filtrujBezKategorii(rows, from, to) {
  return rows.filter((r) => r.category_id == null
    && (!from || r.tx_date >= from) && (!to || r.tx_date <= to));
}

// GET /api/v1/reports/no-category?ledger=&from=&to()
router.get('/reports/no-category', async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    const ledger = parseInt(req.query.ledger || 1, 10);
    if (!scope.ledgers.includes(ledger)) return res.status(403).json({ error: 'ledger_forbidden' });
    const own = scope.ownOnly ? 'AND t.user_id = :uid' : '';
    const p = {
      l: ledger, uid: req.user.uid,
      from: req.query.from || '0001-01-01', to: req.query.to || '9999-12-31',
    };
    const rows = await q(
      `SELECT t.id, t.tx_date, t.amount, t.description, t.category_id
       FROM transactions t
       WHERE t.ledger_id=:l AND t.deleted_at IS NULL AND t.category_id IS NULL
         AND t.tx_date BETWEEN :from AND :to ${own}
       ORDER BY t.tx_date DESC LIMIT 200`, p);
    res.json({ rows });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.filtrujBezKategorii = filtrujBezKategorii;
