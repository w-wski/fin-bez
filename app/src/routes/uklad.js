// Układ kafli/widgetów raportu — PER UŻYTKOWNIK, w bazie (Z9, migracja 017). GET oddaje
// `{ layout: null }`, gdy Szymon nigdy nie zapisał własnego układu — DECYZJA o domyślnym
// układzie (kolejność kafli w HTML-u) zostaje po stronie klienta, backend jej nie zna i nie
// zgaduje. PUT zawsze pisze WYŁĄCZNIE wiersz zalogowanego (`req.user.uid`) — id z body
// ignorujemy, inaczej ktoś mógłby nadpisać cudzy układ samym numerem w żądaniu.
const express = require('express');
const { q } = require('../db');

const router = express.Router();

const MAX_ELEMENTOW = 40;   // tyle kafli z zapasem starczy na każdy przyszły widget raportu
const MAX_DLUGOSC = 32;     // id kafla to krótki identyfikator (np. "by-cat"), nie zdanie

// Tablica napisów, każdy ≤32 znaki, ≤40 elementów. Osobna funkcja, bo oba pola layoutu
// (kolejnosc, ukryte) mają identyczny kształt — jedna reguła zamiast dwóch kopii.
function tablicaNapisow(v) {
  return Array.isArray(v) && v.length <= MAX_ELEMENTOW
    && v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= MAX_DLUGOSC);
}

// Ścisła walidacja: layout to obiekt z DOKŁADNIE kluczami kolejnosc/ukryte — nieznany klucz
// (literówka, stara/nowa wersja frontu wysyłająca coś więcej) = 400, nie ciche zignorowanie.
// Eksportowana czysta funkcja — testowana w scripts/test-uklad.js bez bazy i bez HTTP.
function walidujLayout(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return false;
  const klucze = Object.keys(layout).sort().join(',');
  if (klucze !== 'kolejnosc,ukryte') return false;
  return tablicaNapisow(layout.kolejnosc) && tablicaNapisow(layout.ukryte);
}

// GET /api/v1/uklad — układ zalogowanego. Brak wiersza ≠ błąd: klient dopiero decyduje,
// co pokazać (domyślną kolejność z HTML-a/orkiestratora).
router.get('/', async (req, res, next) => {
  try {
    const rows = await q('SELECT layout FROM report_layout WHERE user_id = :u', { u: req.user.uid });
    res.json({ layout: rows.length ? rows[0].layout : null });
  } catch (e) { next(e); }
});

// PUT /api/v1/uklad — UPSERT. `CAST(:l AS JSON)` zamiast wprost stringa: mysql2 wysyła JSON.stringify
// jako zwykły napis, a kolumna typu JSON wymaga jawnego rzutowania przy INSERT-owanym literale.
router.put('/', async (req, res, next) => {
  try {
    const layout = (req.body || {}).layout;
    if (!walidujLayout(layout)) return res.status(400).json({ error: 'bad_layout' });
    await q(
      `INSERT INTO report_layout (user_id, layout) VALUES (:u, CAST(:l AS JSON))
       ON DUPLICATE KEY UPDATE layout = VALUES(layout)`,
      { u: req.user.uid, l: JSON.stringify(layout) });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
// eksport dla scripts/test-uklad.js — czysta walidacja, bez bazy.
module.exports.walidujLayout = walidujLayout;
