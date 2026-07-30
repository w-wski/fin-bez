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
      await conn.execute('UPDATE receipts SET deleted_at = NOW(), deleted_by = ? WHERE id = ?', [req.user.uid, rc.id]);
      // Paragon zaksięgowany ma wpis w księdze (transaction_id) — ten wpis idzie do kosza
      // RAZEM z paragonem, tym samym mechanizmem co DELETE /api/v1/transactions/:id.
      if (rc.transaction_id) {
        await conn.execute(
          'UPDATE transactions SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL',
          [req.user.uid, rc.transaction_id]);
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
      await conn.execute('UPDATE receipts SET deleted_at = NULL, deleted_by = NULL WHERE id = ?', [rc.id]);
      if (rc.transaction_id) {
        await conn.execute(
          'UPDATE transactions SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND deleted_at IS NOT NULL',
          [rc.transaction_id]);
      }
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
