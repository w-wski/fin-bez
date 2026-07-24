const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { q } = require('../db');
const { readSession, ledgerScope, requireAuth } = require('../auth');

const router = express.Router();

// /api/v1/summary jest też kontraktem widgetu dashboardu:
// wpuszcza ALBO zalogowanego użytkownika, ALBO nagłówek X-Widget-Token (read-only).
function summaryAuth(req, res, next) {
  const s = readSession(req);
  if (s) { req.user = s; return next(); }
  const tok = req.headers['x-widget-token'];
  // widget = wyłącznie księga RODZINA, read-only (NIE admin — nie może czytać PERSEVERA)
  if (config.widgetToken && tok && tok.length === config.widgetToken.length &&
      crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(config.widgetToken))) {
    req.user = { uid: 0, name: 'widget', role: 'widget', widget: true };
    return next();
  }
  return res.status(401).json({ error: 'auth_required' });
}

// GET /api/v1/summary?ledger=1&month=2026-07
router.get('/summary', summaryAuth, async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    const ledger = parseInt(req.query.ledger || 1, 10);
    if (!scope.ledgers.includes(ledger)) return res.status(403).json({ error: 'ledger_forbidden' });
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month
      : new Date().toISOString().slice(0, 7);
    const own = scope.ownOnly ? 'AND t.user_id = :uid' : '';
    const p = { l: ledger, m: month, uid: req.user.uid };

    const totals = await q(
      `SELECT t.type, ROUND(SUM(t.amount),2) AS total, COUNT(*) AS n
       FROM transactions t
       WHERE t.ledger_id=:l AND t.deleted_at IS NULL AND DATE_FORMAT(t.tx_date,'%Y-%m')=:m ${own}
       GROUP BY t.type`, p);
    const byCategory = await q(
      `SELECT COALESCE(c.name,'(bez kategorii)') AS category, ROUND(SUM(t.amount),2) AS total, COUNT(*) AS n
       FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
       WHERE t.ledger_id=:l AND t.deleted_at IS NULL AND t.type='WYDATEK'
         AND DATE_FORMAT(t.tx_date,'%Y-%m')=:m ${own}
       GROUP BY category ORDER BY total DESC LIMIT 12`, p);
    const trend = await q(
      `SELECT DATE_FORMAT(t.tx_date,'%Y-%m') AS month, t.type, ROUND(SUM(t.amount),2) AS total
       FROM transactions t
       WHERE t.ledger_id=:l AND t.deleted_at IS NULL
         AND t.tx_date >= DATE_SUB(CONCAT(:m,'-01'), INTERVAL 5 MONTH) ${own}
       GROUP BY month, t.type ORDER BY month`, p);
    const unmatched = scope.ownOnly ? [{ n: null }] : await q(
      `SELECT COUNT(*) AS n FROM bank_transactions WHERE ledger_id=:l AND matched_transaction_id IS NULL`, p);

    const get = (type) => totals.find((x) => x.type === type) || { total: 0, n: 0 };
    res.json({
      ledger, month,
      expenses: Number(get('WYDATEK').total) || 0,
      income: Number(get('PRZYCHÓD').total) || 0,
      balance: Math.round(((Number(get('PRZYCHÓD').total) || 0) - (Number(get('WYDATEK').total) || 0)) * 100) / 100,
      tx_count: (get('WYDATEK').n || 0) + (get('PRZYCHÓD').n || 0),
      by_category: byCategory,
      trend,
      unmatched_bank_rows: unmatched[0].n,
    });
  } catch (e) { next(e); }
});

// GET /api/v1/reports/family-vs-persevera?month= (tylko admin) — wymaga sesji (requireAuth
// ustawia req.user; router jest montowany bez globalnego auth ze względu na /summary)
router.get('/reports/family-vs-persevera', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month
      : new Date().toISOString().slice(0, 7);
    const rows = await q(
      `SELECT l.name AS ledger, t.type, ROUND(SUM(t.amount),2) AS total, COUNT(*) AS n
       FROM transactions t JOIN ledgers l ON l.id=t.ledger_id
       WHERE t.deleted_at IS NULL AND DATE_FORMAT(t.tx_date,'%Y-%m')=:m
       GROUP BY l.name, t.type ORDER BY l.name, t.type`, { m: month });
    res.json({ month, rows });
  } catch (e) { next(e); }
});

// GET /api/v1/reports/telemetry?days=30 (tylko admin) — analityka użycia jak LOGI prototypu
router.get('/reports/telemetry', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
    const days = Math.min(Math.max(parseInt(req.query.days || '30', 10) || 30, 1), 365);
    const p = { d: days };
    const byView = await q(
      `SELECT view_name, user_name, ROUND(SUM(duration_s)/60,1) AS minutes, COUNT(*) AS events
       FROM telemetry WHERE ts >= DATE_SUB(NOW(), INTERVAL :d DAY) AND duration_s IS NOT NULL
       GROUP BY view_name, user_name ORDER BY minutes DESC`, p);
    const byAction = await q(
      `SELECT action, user_name, COUNT(*) AS n, SUM(offline) AS offline_n
       FROM telemetry WHERE ts >= DATE_SUB(NOW(), INTERVAL :d DAY)
       GROUP BY action, user_name ORDER BY n DESC LIMIT 40`, p);
    const daily = await q(
      `SELECT DATE(ts) AS day, user_name, COUNT(*) AS events
       FROM telemetry WHERE ts >= DATE_SUB(NOW(), INTERVAL :d DAY)
       GROUP BY day, user_name ORDER BY day DESC LIMIT 120`, p);
    res.json({ days, by_view: byView, by_action: byAction, daily });
  } catch (e) { next(e); }
});

module.exports = router;
