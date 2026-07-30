// receipts-archiwum.js — archiwizacja/przywracanie paragonu (Z19, K1). Wydzielone z
// receipts.js (limit 300 linii): tu tylko DELETE/restore, reszta tras zostaje tam.
//
// Decyzja Szymona 2026-07-30 (3a): NIC nie znika twardo. Paragon i wpis w księdze, który
// z niego powstał, dostają deleted_at/deleted_by TĄ SAMĄ operacją co transactions.delete
// (routes/transactions.js) — jedna transakcja SQL, żeby paragon i księga nigdy się nie rozjechały
// (ani „paragon w koszu, wpis żywy", ani odwrotnie).
const express = require('express');
const { pool } = require('../db');
const { wlasnyParagon } = require('../ocr/dostep');

const router = express.Router();

// DELETE /api/v1/receipts/:id — archiwizacja (K1). Cudzy/nieznany paragon = 404 (jak reszta tras).
router.delete('/:id', async (req, res, next) => {
  try {
    const rc = await wlasnyParagon(req, res); if (!rc) return;
    if (rc.deleted_at) return res.status(409).json({ error: 'already_archived' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Jeden JAWNY znacznik czasu dla paragonu i wpisu (sekundowa precyzja, jak TIMESTAMP):
      // restore przywraca wpis TYLKO gdy jego deleted_at równa się paragonowemu — czyli gdy
      // skasowała go TA archiwizacja. Wpis skasowany ręcznie wcześniej ma inny znacznik
      // i restore go nie wskrzesi (weryfikacja Z19, K1).
      const ts = new Date(Math.floor(Date.now() / 1000) * 1000);
      await conn.execute('UPDATE receipts SET deleted_at = ?, deleted_by = ? WHERE id = ?', [ts, req.user.uid, rc.id]);
      if (rc.transaction_id) {
        await conn.execute(
          'UPDATE transactions SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL',
          [ts, req.user.uid, rc.transaction_id]);
      }
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/v1/receipts/:id/restore — przywrócenie, symetryczne do DELETE.
router.post('/:id/restore', async (req, res, next) => {
  try {
    const rc = await wlasnyParagon(req, res); if (!rc) return;
    if (!rc.deleted_at) return res.status(409).json({ error: 'not_archived' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (rc.transaction_id) {
        // Wskrzeszamy wpis wyłącznie skasowany RAZEM z paragonem (ten sam deleted_at) — patrz DELETE.
        await conn.execute(
          'UPDATE transactions SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND deleted_at = ?',
          [rc.transaction_id, rc.deleted_at]);
      }
      await conn.execute('UPDATE receipts SET deleted_at = NULL, deleted_by = NULL WHERE id = ?', [rc.id]);
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
