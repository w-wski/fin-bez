// imports-archiwum.js — wycofanie/przywrócenie importu CSV (Z19, K4/K5). Wydzielone z
// imports.js, żeby ten plik zostawał pod limitem 300 linii.
//
// Decyzja Szymona 2026-07-30 (3a): NIC nie znika twardo. Wycofanie importu = soft-delete
// bank_imports + soft-delete WSZYSTKICH wpisów księgi z niego powstałych (łańcuch
// transactions.bank_tx_id → bank_transactions.import_id), w JEDNEJ transakcji SQL.
// bank_transactions ZOSTAJĄ (ślad audytowy) — K4 tego wprost wymaga, restore jest symetryczny.
const express = require('express');
const { q, pool } = require('../db');
const { ledgerScope } = require('../auth');

const router = express.Router();

// Import + zasięg: 404, gdy import nie istnieje albo żaden jego wiersz nie leży w księdze
// dostępnej temu użytkownikowi. Junior/ownOnly nie wycofuje importów — jak /match i /book.
async function wlasnyImport(req, res) {
  const scope = ledgerScope(req.user);
  if (scope.ownOnly) { res.status(403).json({ error: 'forbidden' }); return null; }
  const id = parseInt(req.params.id, 10) || 0;
  const rows = await q('SELECT * FROM bank_imports WHERE id = :id', { id });
  const imp = rows[0];
  if (!imp) { res.status(404).json({ error: 'not_found' }); return null; }
  const ledgery = await q('SELECT DISTINCT ledger_id FROM bank_transactions WHERE import_id = :id', { id });
  if (ledgery.length && !ledgery.some((l) => scope.ledgers.includes(l.ledger_id))) {
    res.status(404).json({ error: 'not_found' }); return null;
  }
  return imp;
}

// K5: zapisane analizy okresów obejmujących wycofane wpisy dostają w JSON `dane.nieaktualna_od`.
// Porównanie robimy na napisach ISO (`od`/`do` z analizy.js#policzOkres) — działa jak porównanie
// dat, bo mają stałą długość. Zawężone do ksiąg dotkniętych wpisów (plus wspólne analizy „obu
// ksiąg", sentinel ledger_id=0 — patrz migracja 020), żeby wycofanie importu w RODZINIE
// nie oznaczało jako nieaktualnej analizy samej PERSEVERY.
async function oznaczAnalizyNieaktualne(conn, tx) {
  if (!tx.length) return;
  const daty = tx.map((t) => t.tx_date);
  const od = daty.reduce((a, b) => (b < a ? b : a));
  const doD = daty.reduce((a, b) => (b > a ? b : a));
  const ledgery = [...new Set(tx.map((t) => t.ledger_id)), 0];
  const inL = ledgery.map(() => '?').join(',');
  await conn.query(
    `UPDATE analizy SET dane = JSON_SET(dane, '$.nieaktualna_od', NOW())
      WHERE ledger_id IN (${inL})
        AND JSON_UNQUOTE(JSON_EXTRACT(dane, '$.od')) <= ? AND JSON_UNQUOTE(JSON_EXTRACT(dane, '$.do')) >= ?`,
    [...ledgery, doD, od]);
}

// DELETE /api/v1/imports/:id — wycofanie importu (K4), jedna transakcja.
router.delete('/:id', async (req, res, next) => {
  try {
    const imp = await wlasnyImport(req, res); if (!imp) return;
    if (imp.deleted_at) return res.status(409).json({ error: 'already_archived' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // TYLKO wpisy, które import STWORZYŁ (/book ustawia source='CSV'). Wpis ręczny, jedynie
      // DOPASOWANY do wiersza wyciągu (/match), nie jest dzieckiem importu — wycofanie
      // importu nie ma prawa go chować (weryfikacja Z19, K4: decyzja Szymona mówi o wpisach,
      // które import „zaksięgował", nie „dotknął").
      const [tx] = await conn.query(
        `SELECT t.id, t.tx_date, t.ledger_id FROM transactions t
           JOIN bank_transactions bt ON bt.id = t.bank_tx_id
          WHERE bt.import_id = ? AND t.source = 'CSV' AND t.deleted_at IS NULL`, [imp.id]);
      // Jeden JAWNY znacznik czasu dla importu i wpisów: restore przywraca wyłącznie wpisy
      // z tym samym deleted_at, więc nie wskrzesi wpisu skasowanego ręcznie kiedy indziej.
      const ts = new Date(Math.floor(Date.now() / 1000) * 1000);
      if (tx.length) {
        await conn.query(
          `UPDATE transactions SET deleted_at = ?, deleted_by = ? WHERE id IN (${tx.map(() => '?').join(',')})`,
          [ts, req.user.uid, ...tx.map((t) => t.id)]);
        await oznaczAnalizyNieaktualne(conn, tx);
      }
      await conn.execute('UPDATE bank_imports SET deleted_at = ?, deleted_by = ? WHERE id = ?', [ts, req.user.uid, imp.id]);
      await conn.commit();
      res.json({ ok: true, wycofane_wpisy: tx.length });
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  } catch (e) { next(e); }
});

// POST /api/v1/imports/:id/restore — przywrócenie, symetryczne do DELETE.
router.post('/:id/restore', async (req, res, next) => {
  try {
    const imp = await wlasnyImport(req, res); if (!imp) return;
    if (!imp.deleted_at) return res.status(409).json({ error: 'not_archived' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Symetria wobec DELETE: tylko wpisy skasowane TĄ operacją (ten sam deleted_at co import).
      const [tx] = await conn.query(
        `SELECT t.id FROM transactions t JOIN bank_transactions bt ON bt.id = t.bank_tx_id
          WHERE bt.import_id = ? AND t.source = 'CSV' AND t.deleted_at = ?`, [imp.id, imp.deleted_at]);
      if (tx.length) {
        await conn.query(
          `UPDATE transactions SET deleted_at = NULL, deleted_by = NULL WHERE id IN (${tx.map(() => '?').join(',')})`,
          tx.map((t) => t.id));
      }
      await conn.execute('UPDATE bank_imports SET deleted_at = NULL, deleted_by = NULL WHERE id = ?', [imp.id]);
      await conn.commit();
      res.json({ ok: true, przywrocone_wpisy: tx.length });
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  } catch (e) { next(e); }
});

module.exports = router;
