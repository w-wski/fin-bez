#!/usr/bin/env node
// Test filtra kategorii w GET /api/v1/transactions (Z8/#25): klik w kategorię-RODZICA
// w Raportach filtruje też podkategorie, więc `category` przyjmuje listę id po przecinku,
// nie tylko pojedyncze id. Czysta funkcja `idyKategorii()` — zero bazy.
const path = require('path');
const Module = require('module');
const { idyKategorii } = require('../src/routes/transactions');

let bledy = 0;
function ok(warunek, opis) {
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}
const rowne = (a, b, opis) => ok(JSON.stringify(a) === JSON.stringify(b), `${opis} → ${JSON.stringify(a)}`);

rowne(idyKategorii('5'), [5], 'pojedyncze id (klik w kategorię bez podkategorii)');
rowne(idyKategorii('5,12,13'), [5, 12, 13], 'lista id po przecinku (klik w kategorię-rodzica)');
rowne(idyKategorii('5, 12'), [5, 12], 'spacja po przecinku nie psuje parsowania');
rowne(idyKategorii('abc'), [], 'śmieć zamiast id → pusta lista (parsowanie samo w sobie nic nie znajduje)');
rowne(idyKategorii('5,abc,12'), [5, 12], 'śmieć w środku listy jest odsiany, reszta zostaje');
rowne(idyKategorii(''), [], 'pusty napis → pusta lista');

// --- Z14 #2: category PODANE, ale śmieciowe → trasa ma zwrócić PUSTĄ listę, nie CAŁĄ ---
// (fail-open był tu: ids.length===0 pomijało filtr całkiem, więc śmieć w URL-u pokazywał
// wszystkie wpisy pod paskiem, który mówił, że to wycinek — patrz Z14 #1).
const baza = { zapytania: [], odpowiedzi: [] };
const q = async (sql, par) => {
  baza.zapytania.push({ sql: sql.replace(/\s+/g, ' ').trim(), par });
  const gotowa = baza.odpowiedzi.shift();
  return gotowa === undefined ? [] : gotowa;
};
function podstawDb() {
  require.cache[require.resolve('../src/db')] = new Module(require.resolve('../src/db'));
  require.cache[require.resolve('../src/db')].exports = { q, pool: null };
  require.cache[require.resolve('../src/db')].loaded = true;
}
function resetModuly() {
  for (const m of ['../src/db', '../src/routes/transactions']) delete require.cache[require.resolve(m)];
  podstawDb();
}
const zeruj = (...odp) => { baza.zapytania = []; baza.odpowiedzi = odp; };
function fakeRes() {
  const res = { statusCode: 200, body: null, status(c) { res.statusCode = c; return res; }, json(b) { res.body = b; return res; } };
  return res;
}
function wywolajTrase(router, req, res) {
  return new Promise((resolve) => {
    res.json = (b) => { res.body = b; resolve(); return res; };
    router(req, res, resolve);
  });
}

(async () => {
  resetModuly();
  const router = require('../src/routes/transactions');
  zeruj([], [{ n: 0 }]); // najpierw sama lista wierszy, potem COUNT(*) — obie mają zwrócić pusto
  const req = { method: 'GET', url: '/?category=abc', query: { category: 'abc' }, user: { role: 'adult', uid: 1 } };
  const res = fakeRes();
  await wywolajTrase(router, req, res);
  rowne(res.body && res.body.rows, [], 'category=abc (śmieć) przez CAŁĄ trasę → rows:[] (nie cała lista)');
  ok(baza.zapytania.some((z) => /category_id IN \(0\)/.test(z.sql)),
    'zapytanie SQL dostało "category_id IN (0)" — filtr się zastosował, nie został pominięty');

  console.log(`\n${bledy === 0 ? 'OK' : 'BŁĄD'}: test-raport-wpisy — ${bledy} błędów`);
  process.exit(bledy === 0 ? 0 : 1);
})();
