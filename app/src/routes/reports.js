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
    // Grupujemy po IDENTYFIKATORZE kategorii, nie po nazwie: w nowym drzewie są i
    // „Transport > Bilety", i „Bartuś > Bilety" — po nazwie skleiłyby się w jeden wiersz
    // „Bilety", którego nie da się uzgodnić z sekcją „Konto Bartusia". Pokazujemy ścieżkę.
    const byCategory = await q(
      `SELECT t.category_id AS category_id,
              COALESCE(CONCAT(COALESCE(CONCAT(p.name,' > '),''), c.name),'(bez kategorii)') AS category,
              ROUND(SUM(t.amount),2) AS total, COUNT(*) AS n
       FROM transactions t
       LEFT JOIN categories c ON c.id=t.category_id AND c.ledger_id=t.ledger_id
       LEFT JOIN categories p ON p.id=c.parent_id
       WHERE t.ledger_id=:l AND t.deleted_at IS NULL AND t.type='WYDATEK'
         AND DATE_FORMAT(t.tx_date,'%Y-%m')=:m ${own}
       GROUP BY t.category_id, category ORDER BY total DESC LIMIT 12`, p);
    // trend[] jest kontraktem widgetu dashboardu (kod poza tym repo): wyłącznie WYDATEK
    // i PRZYCHÓD. TRANSFER powstał dopiero przy reorganizacji — widget takiej serii nigdy
    // nie widział i nie umie jej narysować.
    const trend = await q(
      `SELECT DATE_FORMAT(t.tx_date,'%Y-%m') AS month, t.type, ROUND(SUM(t.amount),2) AS total
       FROM transactions t
       WHERE t.ledger_id=:l AND t.deleted_at IS NULL AND t.type IN ('WYDATEK','PRZYCHÓD')
         AND t.tx_date >= DATE_SUB(CONCAT(:m,'-01'), INTERVAL 5 MONTH) ${own}
       GROUP BY month, t.type ORDER BY month`, p);
    const unmatched = scope.ownOnly ? [{ n: null }] : await q(
      `SELECT COUNT(*) AS n FROM bank_transactions WHERE ledger_id=:l AND matched_transaction_id IS NULL`, p);
    // „Zobowiązania i cele" (E4): TRANSFER poza konsumpcją — nie wchodzi ani do expenses,
    // ani do by_category, ani do balance. Grupa = korzeń (Spłaty / Cele), pozycja = liść.
    const transfers = await q(
      `SELECT COALESCE(p.name, c.name, '(bez kategorii)') AS grupa,
              COALESCE(c.name,'(bez kategorii)') AS category, ROUND(SUM(t.amount),2) AS total, COUNT(*) AS n
       FROM transactions t LEFT JOIN categories c ON c.id=t.category_id AND c.ledger_id=t.ledger_id
       LEFT JOIN categories p ON p.id=c.parent_id
       WHERE t.ledger_id=:l AND t.deleted_at IS NULL AND t.type='TRANSFER'
         AND DATE_FORMAT(t.tx_date,'%Y-%m')=:m ${own}
       GROUP BY grupa, category ORDER BY total DESC`, p);

    const get = (type) => totals.find((x) => x.type === type) || { total: 0, n: 0 };
    res.json({
      ledger, month,
      expenses: Number(get('WYDATEK').total) || 0,
      income: Number(get('PRZYCHÓD').total) || 0,
      balance: Math.round(((Number(get('PRZYCHÓD').total) || 0) - (Number(get('WYDATEK').total) || 0)) * 100) / 100,
      // „Wpisy" to licznik WPISÓW miesiąca, a nie konsumpcji: transfery (np. osiem rat)
      // też są wpisami. Konsumpcję odcinamy w expenses/by_category, nie tutaj.
      tx_count: totals.reduce((s, x) => s + (Number(x.n) || 0), 0),
      by_category: byCategory,
      trend,
      unmatched_bank_rows: unmatched[0].n,
      transfers,
      transfers_total: Number(get('TRANSFER').total) || 0,
    });
  } catch (e) { next(e); }
});

// Kategorie po nazwie korzenia (drzewo jest płytkie: korzeń + dzieci) — raporty nie
// trzymają id na sztywno, bo powstają dopiero przy scripts/reorganize-categories.js.
async function drzewo(ledger, root) {
  return q(
    `SELECT c.id, c.name, c.parent_id FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
      WHERE c.ledger_id = :l AND ((c.name = :r AND c.parent_id IS NULL) OR (p.name = :r AND p.parent_id IS NULL))`,
    { l: ledger, r: root });
}
const idList = (rows) => rows.map((r) => Number(r.id)).filter(Number.isInteger).join(',');

// §7.5 „Konto Bartusia": kieszonkowe to **WYDATEK** rodzica w kategorii `Bartuś > Kieszonkowe`
// (rodzic wydaje → dziecko dostaje), a jego przeciwwagą jest suma wydatków ZAKSIĘGOWANYCH
// PRZEZ BARTKA (rola junior), gdziekolwiek je zapisał. Wydatki rodziców na dziecko (wyprawka,
// bilet miesięczny) NIE obciążają konta Bartusia — mają osobny kubełek, poza saldem.
// Wcześniej do „wydatków" leciał KAŻDY wpis z drzewa „Bartuś", łącznie z samym kieszonkowym:
// przy 100 zł kieszonkowego, 166 zł wydatków rodziców i 25 zł wydanych przez Bartka wychodziło
// „Kieszonkowe 0,00 · Wydatki 291,00 · Saldo −291,00" zamiast +75,00.
function kubelBartusia(r) {
  if (Number(r.kieszonkowa)) return 'kieszonkowe';   // linia zasilenia konta — niezależnie od typu wpisu
  if (r.typ === 'PRZYCHÓD') return Number(r.wdrzewie) ? 'wplywy' : null;
  return Number(r.junior) ? 'wydatki' : (Number(r.wdrzewie) ? 'rodzice' : null);
}

// Wiersze z SQL (miesiąc × typ × czy-kieszonkowe × czy-junior × czy-w-drzewie) → miesiące
// z saldem narastającym: saldo = kieszonkowe + inne wpływy − wydatki Bartka.
function miesiaceBartusia(rows) {
  const per = new Map();
  for (const r of rows) {
    const b = kubelBartusia(r);
    if (!b) continue;
    const m = per.get(r.month) || { month: r.month, kieszonkowe: 0, wplywy: 0, wydatki: 0, rodzice: 0 };
    m[b] = Math.round((m[b] + Number(r.total || 0)) * 100) / 100;
    per.set(r.month, m);
  }
  const out = [...per.values()].sort((a, b) => String(a.month).localeCompare(String(b.month)));
  let saldo = 0;
  for (const m of out) {
    saldo = Math.round((saldo + m.kieszonkowe + m.wplywy - m.wydatki) * 100) / 100;
    m.saldo = saldo;
  }
  return out;
}

// GET /api/v1/reports/bartus?month=RRRR-MM — „Konto Bartusia" (§7.5), saldo narastająco od
// początku księgi. Junior widzi ten raport w całości (to jego konto — kieszonkowe księgują
// rodzice, więc filtr „tylko własne wpisy" pokazywałby mu zero zasileń).
router.get('/reports/bartus', requireAuth, async (req, res, next) => {
  try {
    if (!ledgerScope(req.user).ledgers.includes(1)) return res.status(403).json({ error: 'ledger_forbidden' });
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
    const drzewko = await drzewo(1, 'Bartuś');
    const ids = idList(drzewko);
    if (!ids) return res.json({ month, brak_kategorii: true, months: [], saldo: 0, kieszonkowe: 0, wplywy: 0, wydatki: 0, rodzice: 0 });
    // Porównanie bez wielkości liter: MySQL w utf8mb4_polish_ci dopasuje istniejące
    // „kieszonkowe" i reorganizacja użyje właśnie tej kategorii — ścisłe === w JS gubiłoby
    // ją i Bartuś widziałby „Kieszonkowe 0,00 zł" przy saldzie minus wszystko.
    const kieszonka = drzewko.find((c) => c.parent_id && c.name.toLowerCase() === 'kieszonkowe');
    // Dwa zbiory naraz: całe drzewo „Bartuś" (zasilenia + wydatki rodziców na dziecko) ORAZ
    // wydatki juniora spoza drzewa. Kubełki rozstrzyga kubelBartusia() w JS — ta sama reguła
    // §7.5 daje się wtedy przetestować bez bazy (scripts/test-reorganize.js).
    const rows = await q(
      `SELECT DATE_FORMAT(t.tx_date,'%Y-%m') AS month, t.type AS typ,
              (t.category_id = :k) AS kieszonkowa, (u.role = 'junior') AS junior,
              (t.category_id IN (${ids})) AS wdrzewie, ROUND(SUM(t.amount),2) AS total
       FROM transactions t JOIN users u ON u.id = t.user_id
       WHERE t.ledger_id=1 AND t.deleted_at IS NULL AND t.type <> 'TRANSFER'
         AND DATE_FORMAT(t.tx_date,'%Y-%m') <= :m
         AND (t.category_id IN (${ids}) OR (u.role='junior' AND t.type='WYDATEK'))
       GROUP BY month, typ, kieszonkowa, junior, wdrzewie ORDER BY month`,
      { k: kieszonka ? kieszonka.id : 0, m: month });
    const months = miesiaceBartusia(rows);
    const b = months.find((m) => m.month === month) || { kieszonkowe: 0, wplywy: 0, wydatki: 0, rodzice: 0 };
    res.json({ month, months, saldo: months.length ? months[months.length - 1].saldo : 0,
      kieszonkowe: b.kieszonkowe, wplywy: b.wplywy, wydatki: b.wydatki, rodzice: b.rodzice });
  } catch (e) { next(e); }
});

// GET /api/v1/reports/najem?month=RRRR-MM — para najmu Kamil↔Darek (§7.3): przepływ,
// nie dochód, więc obie strony obok siebie plus różnica.
router.get('/reports/najem', requireAuth, async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    // Karta Raporty nie jest bramkowana rolą, a to są finanse rodziców (3 000 zł od Kamila,
    // 2 400 zł do Darka). Role z ownOnly (junior) widzą wyłącznie swoje wpisy — nie ten raport.
    if (!scope.ledgers.includes(1) || scope.ownOnly) return res.status(403).json({ error: 'forbidden' });
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
    const suma = async (root, type) => {
      const ids = idList(await drzewo(1, root));
      if (!ids) return { total: 0, n: 0, brak_kategorii: true };
      const r = await q(
        `SELECT ROUND(IFNULL(SUM(t.amount),0),2) AS total, COUNT(*) AS n FROM transactions t
          WHERE t.ledger_id=1 AND t.deleted_at IS NULL AND t.type=:t
            AND t.category_id IN (${ids}) AND DATE_FORMAT(t.tx_date,'%Y-%m')=:m`, { t: type, m: month });
      return { total: Number(r[0].total) || 0, n: r[0].n };
    };
    const od_kamila = await suma('Najem (od Kamila)', 'PRZYCHÓD');
    const do_darka = await suma('Najem (pass-through)', 'WYDATEK');
    res.json({ month, od_kamila, do_darka, roznica: Math.round((od_kamila.total - do_darka.total) * 100) / 100 });
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
// Czysta logika §7.5 wystawiona do testów (wzorzec z src/routes/categories.js).
module.exports.kubelBartusia = kubelBartusia;
module.exports.miesiaceBartusia = miesiaceBartusia;
