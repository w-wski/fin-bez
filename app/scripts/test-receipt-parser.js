// Testy parsera paragonów na syntetycznym tekście OCR (typowe zniekształcenia).
const assert = require('assert');
const { parseReceipt } = require('../src/ocr/parse-receipt');

let failures = 0;
function t(name, fn) {
  try { fn(); console.log('OK  ', name); }
  catch (e) { failures++; console.error('FAIL', name, '—', e.message); }
}

const biedronka = `JERONIMO MARTINS POLSKA S.A.
BIEDRONKA "CODZIENNIE NISKIE CENY" 6421
ul. Wyzwolenia 12, 43-438 Brenna
NIP: 779-10-11-327
PARAGON FISKALNY
CHLEB WIEJSKI 500G 1 x 4,99 4,99A
MLEKO ŁACIATE 2% 2 x 3,79 7,58A
JOGURT NATURALNY 150G 3 x 1,89 5,67A
SER GOUDA PLASTRY 1 x 8,49 8,49A
SPRZED. OPODATK. A 26,73
PTU A 5,00% 1,27
SUMA PLN 26,73
GOTÓWKA 30,00 RESZTA 3,27
2026-07-20 14:32`;

t('Biedronka: sklep, data, suma, 4 pozycje', () => {
  const r = parseReceipt(biedronka);
  assert.ok(r.shop_name.includes('JERONIMO'));
  assert.strictEqual(r.receipt_date, '2026-07-20');
  assert.strictEqual(r.total, 26.73);
  assert.strictEqual(r.items.length, 4);
  assert.strictEqual(r.items[1].quantity, 2);
  assert.strictEqual(r.items[1].value, 7.58);
  assert.strictEqual(r.warnings.length, 0); // suma pozycji = SUMA
  assert.strictEqual(r.nip, '7791011327');
});

t('Pozycja łamana na 2 linie (nazwa wyżej)', () => {
  const r = parseReceipt(`SKLEP ABC
JOGURT PROTEINOWY WANILIOWY 200G
1 x 6,50 6,50
SUMA 6,50`);
  assert.strictEqual(r.items.length, 1);
  assert.ok(r.items[0].ocr_name.includes('JOGURT'));
});

t('Niezgodność ilość×cena vs wartość -> low_confidence', () => {
  const r = parseReceipt(`SKLEP\nCOŚ TAM 2 x 3,00 9,00\nSUMA 9,00`);
  assert.strictEqual(r.items[0].low_confidence, true);
});

t('Rozjazd sum -> warning', () => {
  const r = parseReceipt(`SKLEP\nMASŁO 1 x 7,99 7,99\nSUMA 10,00`);
  assert.ok(r.warnings[0].includes('≠'));
});

t('Data w formacie DD.MM.YYYY', () => {
  const r = parseReceipt(`SKLEP\n20.07.2026\nCHLEB 1 x 5,00 5,00\nRAZEM 5,00`);
  assert.strictEqual(r.receipt_date, '2026-07-20');
});

t('Pusty/nieczytelny tekst -> warning, zero pozycji', () => {
  const r = parseReceipt('###\n---\n');
  assert.strictEqual(r.items.length, 0);
  assert.ok(r.warnings.length >= 1);
});

t('Fallback: pozycja bez ilości (NAZWA ... 12,99)', () => {
  const r = parseReceipt(`KIOSK\nGAZETA WYBORCZA 4,50\nSUMA 4,50`);
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].value, 4.5);
});

if (failures) { console.error(`\n${failures} test(ów) NIE przeszło`); process.exit(1); }
console.log('\nWszystkie testy parsera paragonów przeszły.');
