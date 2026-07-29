#!/usr/bin/env node
// Testy układu kafli raportu (Z9): walidacja PUT /api/v1/uklad (src/routes/uklad.js) i czysta
// logika porządkowania/ukrywania kafli (public/js/raporty-uklad.js). Bez bazy i bez DOM-u —
// dlatego obie warstwy trzymają logikę w funkcjach bezstanowych (ten sam wzorzec co
// scripts/test-kategorie.js dla src/routes/categories.js + public/js/paleta.js).
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { walidujLayout } = require('../src/routes/uklad');

let bledy = 0;
function t(opis, fn) {
  try { fn(); console.log('OK  ', opis); }
  catch (e) { bledy++; console.error('BŁĄD', opis, '—', e.message); }
}

// ---------- walidacja PUT (bez bazy — walidujLayout to czysta funkcja) ----------

t('dobry layout przechodzi', () => {
  assert.strictEqual(walidujLayout({ kolejnosc: ['kpi', 'by-cat'], ukryte: [] }), true);
});

t('pusty layout (nic jeszcze nieukładane inaczej niż domyślnie) przechodzi', () => {
  assert.strictEqual(walidujLayout({ kolejnosc: [], ukryte: [] }), true);
});

t('nieznany klucz w body = odmowa', () => {
  assert.strictEqual(walidujLayout({ kolejnosc: [], ukryte: [], kolor: 'red' }), false);
});

t('brakujący klucz (tylko kolejnosc) = odmowa — wymagane DOKŁADNIE oba klucze', () => {
  assert.strictEqual(walidujLayout({ kolejnosc: ['kpi'] }), false);
});

t('element tablicy dłuższy niż 32 znaki = odmowa', () => {
  assert.strictEqual(walidujLayout({ kolejnosc: ['x'.repeat(33)], ukryte: [] }), false);
});

t('tablica z ponad 40 elementami = odmowa', () => {
  const dluga = Array.from({ length: 41 }, (_, i) => 'k' + i);
  assert.strictEqual(walidujLayout({ kolejnosc: dluga, ukryte: [] }), false);
});

t('element tablicy nie-napis (liczba) = odmowa', () => {
  assert.strictEqual(walidujLayout({ kolejnosc: [1, 2], ukryte: [] }), false);
});

t('kolejnosc nie-tablica (obiekt) = odmowa', () => {
  assert.strictEqual(walidujLayout({ kolejnosc: { a: 1 }, ukryte: [] }), false);
});

t('layout nie-obiekt (null/napis/tablica) = odmowa', () => {
  assert.strictEqual(walidujLayout(null), false);
  assert.strictEqual(walidujLayout('kpi,by-cat'), false);
  assert.strictEqual(walidujLayout(['kpi']), false);
});

// ---------- porządkowanie/ukrywanie kafli (public/js/raporty-uklad.js), bez DOM-u ----------

(async () => {
  const { uporzadkuj } = await import(
    pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'raporty-uklad.js')).href);

  t('uporzadkuj: layout null → kolejność z DOM-u, nic nie ukryte', () => {
    const w = uporzadkuj(['kpi', 'by-cat', 'trend'], null);
    assert.deepStrictEqual(w, [
      { id: 'kpi', ukryty: false }, { id: 'by-cat', ukryty: false }, { id: 'trend', ukryty: false },
    ]);
  });

  t('uporzadkuj: respektuje zapisaną kolejność i ukrycie', () => {
    const w = uporzadkuj(['kpi', 'by-cat', 'trend'],
      { kolejnosc: ['trend', 'kpi', 'by-cat'], ukryte: ['by-cat'] });
    assert.deepStrictEqual(w, [
      { id: 'trend', ukryty: false }, { id: 'kpi', ukryty: false }, { id: 'by-cat', ukryty: true },
    ]);
  });

  t('uporzadkuj: kafel nieznany w layout.kolejnosc (skasowany/przemianowany) jest pomijany', () => {
    const w = uporzadkuj(['kpi', 'by-cat'], { kolejnosc: ['trend', 'kpi'], ukryte: [] });
    assert.deepStrictEqual(w, [{ id: 'kpi', ukryty: false }, { id: 'by-cat', ukryty: false }]);
  });

  t('uporzadkuj: nowy kafel spoza starego layoutu ląduje na końcu, widoczny', () => {
    const w = uporzadkuj(['kpi', 'by-cat', 'nowy-widget'],
      { kolejnosc: ['by-cat', 'kpi'], ukryte: [] });
    assert.deepStrictEqual(w, [
      { id: 'by-cat', ukryty: false }, { id: 'kpi', ukryty: false }, { id: 'nowy-widget', ukryty: false },
    ]);
  });

  console.log(bledy ? `\n${bledy} testów układu NIE przeszło.` : '\nWszystkie testy układu przeszły.');
  process.exit(bledy ? 1 : 0);
})();
