#!/usr/bin/env node
// Testy obsługi OPUSTÓW w parserze paragonów (src/ocr/parse-receipt.js).
//
// Osobny plik, bo bramka preflight nie wpuściła ich do test-receipt-parser.js — i słusznie:
// rabaty to własny temat, z własnym słownikiem pojęć (rabat pozycji, bon całego rachunku,
// podsumowanie opustów), a nie kolejny wariant „czy parser widzi towar".
//
// Zgłoszenie Szymona (2026-07-28): „Interpretuje Odpusty jako produkty" — paragon na
// 107,24 zł dawał sumę pozycji 443,90 zł, bo każda linia rabatu wchodziła jako towar.
const assert = require('assert');
const { parseReceipt } = require('../src/ocr/parse-receipt');
const { isInconsistent } = require('../src/ocr/pola');

let failures = 0;
function t(name, fn) {
  try { fn(); console.log('OK  ', name); }
  catch (e) { failures++; console.error('FAIL', name, '—', e.message); }
}

// ---------- OPUSTY (Szymon 07-28: „interpretuje Odpusty jako produkty") ----------
// Fragment PRAWDZIWEGO odczytu OCR paragonu z Brennej (27.07.2026), łącznie z tym, co
// tesseract przekręcił („(©;" zamiast litery stawki VAT). Trzy rodzaje linii naraz:
// rabat pozycji, bon całego rachunku i podsumowanie opustów.
const PARAGON_Z_OPUSTAMI = [
  'Biedronka',
  'PARAGON FISKALNY',
  'Czereśnie Luz C 1,980x 24,99 49,48',
  'Opust -26,73',
  '22,75',
  'Schiacciata 80g (©; 4x 2,49 9,96',
  'KarmaPuff1250g B 6x 6,49 38,94',
  'Opust -15,00',
  '23,94',
  'Opust Voucher B -3,92',
  'Opust Voucher (©; -11,08',
  'OPUSTY ŁĄCZNIE: -112,22',
  'Suma PLN 41,65',
].join('\n');

t('Opust NIE jest towarem: rabat idzie do pozycji wyżej, a linia „po rabacie" staje się wartością', () => {
  const p = parseReceipt(PARAGON_Z_OPUSTAMI);
  assert.strictEqual(p.items.length, 3, 'trzy towary, nie sześć — rabaty i bony to nie pozycje');
  assert.strictEqual(p.items[0].ocr_name, 'Czereśnie Luz C');
  assert.strictEqual(p.items[0].unit_price, 24.99);        // cena KATALOGOWA zostaje
  assert.strictEqual(p.items[0].value, 22.75);             // wartość = ile ZAPŁACONO
  assert.strictEqual(p.items[0].discount, 26.73);
  assert.strictEqual(p.items[0].low_confidence, false);    // rabat TŁUMACZY ilość×cena ≠ wartość
  assert.strictEqual(p.items[1].discount, undefined);      // pozycja bez rabatu zostaje bez
  assert.strictEqual(p.items[1].value, 9.96);
  assert.strictEqual(p.items[2].value, 23.94);
});

t('Bon nie jest ani towarem, ani rabatem pozycji — obniża CAŁY rachunek', () => {
  const p = parseReceipt(PARAGON_Z_OPUSTAMI);
  assert.strictEqual(p.discount_global, 15);               // 3,92 + 11,08 — dwa bony
  assert.strictEqual(p.discount_total, 112.22);            // „OPUSTY ŁĄCZNIE" to osobna liczba
  assert.strictEqual(p.items[2].discount, 15);             // rabat pozycji, mimo tej samej kwoty
  // Równanie, po którym poznajemy kompletny odczyt: pozycje − bony = SUMA.
  const s = p.items.reduce((a, i) => a + i.value, 0);
  assert.strictEqual(Math.round((s - p.discount_global) * 100) / 100, 41.65);
  assert.deepStrictEqual(p.warnings, [], 'skoro rachunek się spina, nie ma o czym ostrzegać');
});

t('Linia „po rabacie" sprzeczna z arytmetyką: liczymy sami, nie wierzymy odczytowi', () => {
  const p = parseReceipt(['Sklep', 'Mleko C 1x 4,00 4,00', 'Opust -1,00', '9,99', 'Suma PLN 3,00'].join('\n'));
  assert.strictEqual(p.items.length, 1);
  assert.strictEqual(p.items[0].value, 3);                 // 4,00 − 1,00, a nie odczytane 9,99
});

t('Rabat bez pozycji wyżej nie wywraca odczytu i nie staje się towarem', () => {
  const p = parseReceipt(['Sklep', 'PARAGON FISKALNY', 'Opust -5,00', 'Suma PLN 0,00'].join('\n'));
  assert.strictEqual(p.items.length, 0);
});

t('Rabat w pozycji nie jest już niezgodnością (isInconsistent zna kolumnę discount)', () => {
  assert.strictEqual(isInconsistent({ quantity: '1.98', unit_price: '24.99', value: '22.75' }), true);
  assert.strictEqual(isInconsistent({ quantity: '1.98', unit_price: '24.99', value: '22.75', discount: '26.73' }), false);
});


if (failures) { console.error(`\n${failures} test(ów) NIE przeszło`); process.exit(1); }
console.log('\nWszystkie testy opustów przeszły.');
