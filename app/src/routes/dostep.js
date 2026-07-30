// routes/dostep.js — panel Admin „Dostęp" (Z12): wyłączniki modalności + housekeeping
// tokenów RO-API. Admin only. Zapis houskeepingu tokenów dalej mieszka WYŁĄCZNIE w
// src/ro/auth.js (Z10) — ten plik go tylko woła, samych tokenów/haszy nie dotyka.
const express = require('express');
const { q } = require('../db');
const { stanWszystkich, ustaw, KLUCZE } = require('../wylaczniki');
const { wydajToken, uniewaznij } = require('../ro/auth');
const { ostatnieDostepy, ostatnieWyjscia } = require('../rejestr');

const router = express.Router();

router.use((req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
  next();
});

// GET /api/v1/dostep/modalnosci — pełny stan, zawsze świeży z bazy (ekran decyzji).
router.get('/modalnosci', async (req, res, next) => {
  try {
    res.json({ modalnosci: await stanWszystkich() });
  } catch (e) { next(e); }
});

// PATCH /api/v1/dostep/modalnosci { klucz, wlaczona } — przełącznik jednej modalności.
router.patch('/modalnosci', async (req, res, next) => {
  try {
    const klucz = String(req.body?.klucz || '');
    if (!KLUCZE.includes(klucz)) return res.status(400).json({ error: 'bad_klucz' });
    // Ścisła flaga jak w categories.js: `!!"0"` to true, więc napis "0" WŁĄCZAŁBY modalność —
    // dokładnie odwrotnie niż prosił wywołujący. Śmieć = 400, nie zgadywanie.
    const v = req.body?.wlaczona;
    let wlaczona;
    if (v === true || v === 1 || v === '1' || v === 'true') wlaczona = true;
    else if (v === false || v === 0 || v === '0' || v === 'false') wlaczona = false;
    else return res.status(400).json({ error: 'bad_wlaczona' });
    await ustaw(klucz, wlaczona, req.user.uid);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/v1/dostep/tokeny { name, scope_ledgers? } — wydanie tokenu, sekret wraca RAZ.
// Właściciel tokenu = admin, który go wydał (uniewaznij niżej pilnuje tego samego user_id).
router.post('/tokeny', async (req, res, next) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 48) : '';
    if (!name) return res.status(400).json({ error: 'bad_name' });
    const wydany = await wydajToken(req.user.uid, name, req.body?.scope_ledgers);
    res.json({ id: wydany.id, token: wydany.token });
  } catch (e) { next(e); }
});

// GET /api/v1/dostep/tokeny — lista BEZ hashy i BEZ sekretów, do wglądu w Adminie.
router.get('/tokeny', async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT id, name, scope_ledgers, created_at, last_used_at, revoked_at
         FROM api_tokens WHERE user_id=:u ORDER BY id DESC`, { u: req.user.uid });
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// DELETE /api/v1/dostep/tokeny/:id — unieważnienie (tylko WŁASNY token, patrz ro/auth.js).
router.delete('/tokeny/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10) || 0;
    const ok = await uniewaznij(id, req.user.uid);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/v1/dostep/rejestr — ostatnie 50 wpisów „kto CZYTA nasze dane" (src/rejestr.js#17).
router.get('/rejestr', async (req, res, next) => {
  try {
    res.json({ items: await ostatnieDostepy(50) });
  } catch (e) { next(e); }
});

// GET /api/v1/dostep/wyjscia — ostatnie 50 wpisów „co MY wysyłamy" (src/rejestr.js#26).
router.get('/wyjscia', async (req, res, next) => {
  try {
    res.json({ items: await ostatnieWyjscia(50) });
  } catch (e) { next(e); }
});

module.exports = router;
