#!/usr/bin/env node
// Test filtra kategorii w GET /api/v1/transactions (Z8/#25): klik w kategorię-RODZICA
// w Raportach filtruje też podkategorie, więc `category` przyjmuje listę id po przecinku,
// nie tylko pojedyncze id. Czysta funkcja `idyKategorii()` — zero bazy.
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
rowne(idyKategorii('abc'), [], 'śmieć zamiast id → pusta lista (filtr się nie stosuje)');
rowne(idyKategorii('5,abc,12'), [5, 12], 'śmieć w środku listy jest odsiany, reszta zostaje');
rowne(idyKategorii(''), [], 'pusty napis → pusta lista');

if (bledy) {
  console.error(`\nNIEUDANE: test-raport-wpisy — ${bledy} błędów`);
  process.exit(1);
}
console.log('\nOK: test-raport-wpisy — 0 błędów');
