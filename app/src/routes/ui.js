// Ustawienia UI per użytkownik, na serwerze (Z15, migracja 024, decyzja 2026-07-30 pkt 12):
// worek klucz→JSON, np. które sekcje Raportów są zwinięte. Wzorzec 1:1 z routes/uklad.js
// (GET zwraca null gdy nikt jeszcze nie zapisał, PUT to UPSERT wyłącznie WŁASNEGO wiersza).
const express = require('express');
const { q } = require('../db');

const router = express.Router();

// Klucz to krótki identyfikator ustawienia ("raporty.zwiniete"), nie dowolny napis —
// bez tej walidacji ktoś mógłby zapisać milion wierszy pod losowymi kluczami.
const KLUCZ_RE = /^[a-z0-9.-]{1,64}$/;

// GET /api/v1/ui/:klucz — wartość zalogowanego użytkownika. Brak wiersza ≠ błąd: klient
// dopiero decyduje, co pokazać (domyślnie rozłożone sekcje — patrz raporty.js).
router.get('/:klucz', async (req, res, next) => {
  try {
    if (!KLUCZ_RE.test(req.params.klucz)) return res.status(400).json({ error: 'bad_key' });
    const rows = await q('SELECT wartosc FROM user_ui WHERE user_id = :u AND klucz = :k',
      { u: req.user.uid, k: req.params.klucz });
    res.json({ wartosc: rows.length ? rows[0].wartosc : null });
  } catch (e) { next(e); }
});

// PUT /api/v1/ui/:klucz  { wartosc: <cokolwiek serializowalne do JSON> }
// user ZAWSZE z req.user.uid, nigdy z body — inaczej dałoby się czytać/pisać cudze ustawienia
// samym numerem w żądaniu (patrz K4 zlecenia Z15).
router.put('/:klucz', async (req, res, next) => {
  try {
    if (!KLUCZ_RE.test(req.params.klucz)) return res.status(400).json({ error: 'bad_key' });
    const wartosc = (req.body || {}).wartosc;
    if (wartosc === undefined) return res.status(400).json({ error: 'bad_value' });
    // CAST(:w AS JSON) zamiast wprost stringa: mysql2 wysyła JSON.stringify jako zwykły
    // napis, a kolumna typu JSON wymaga jawnego rzutowania przy INSERT-owanym literale
    // (ten sam wzorzec co PUT /api/v1/uklad w routes/uklad.js).
    await q(
      `INSERT INTO user_ui (user_id, klucz, wartosc) VALUES (:u, :k, CAST(:w AS JSON))
       ON DUPLICATE KEY UPDATE wartosc = VALUES(wartosc)`,
      { u: req.user.uid, k: req.params.klucz, w: JSON.stringify(wartosc) });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
