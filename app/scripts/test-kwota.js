// Parser kwot to jedyne miejsce, przez które liczby wchodzą do księgi — ma własne testy
// i strażnika rozjazdu między wersją serwerową a przeglądarkową.
const fs = require('fs');
const path = require('path');
const { parseKwota } = require('../src/kwota');

let bledy = 0;
const test = (opis, ok) => { console.log(`${ok ? 'OK  ' : 'BŁĄD'} ${opis}`); if (!ok) bledy++; };

// [wejście, oczekiwany wynik] — null znaczy „odmów zapisu, nie zgaduj"
const PRZYPADKI = [
  ['1234,56', 1234.56], ['1234.56', 1234.56], ['1234', 1234],
  ['1 234,56', 1234.56], ['1 234,56', 1234.56], ['1.234,56', 1234.56],
  ['1.234', 1234], ['12.345.678,90', 12345678.9], ['0,05', 0.05],
  ['1234 zł', 1234], ['1 234,56 PLN', 1234.56], ['-99,99', 99.99],
  [1234.56, 1234.56], [-1234.56, 1234.56],
  ['12,,50', null], ['abc', null], ['', null], [null, null], [undefined, null],
  ['12,345', null],          // trzy cyfry po przecinku = niejednoznaczne (tysiące czy grosze?)
  ['1.23.456', null],        // grupowanie nie trzyma się reguły tysięcy
  [NaN, null], [Infinity, null],
];
for (const [we, oczekiwane] of PRZYPADKI) {
  const wynik = parseKwota(we);
  test(`parseKwota(${JSON.stringify(we)}) = ${oczekiwane}`, wynik === oczekiwane);
}

// Najgroźniejszy przypadek z audytu: naiwny parseFloat czyta „1 234,56" jako 1.
test('„1 234,56" NIE daje 1 (cicha pomyłka o trzy rzędy wielkości)', parseKwota('1 234,56') !== 1);

// Strażnik rozjazdu: obie wersje muszą mieć identyczne ciało funkcji.
const cialo = (plik, wzorzec) => {
  const src = fs.readFileSync(path.join(__dirname, '..', plik), 'utf8');
  const m = src.match(wzorzec);
  if (!m) throw new Error(`nie znalazłem funkcji parseKwota w ${plik}`);
  return m[1].replace(/\s+/g, ' ').trim();
};
test('src/kwota.js i public/js/kwota.js liczą tak samo (identyczne ciało funkcji)',
  cialo('src/kwota.js', /function parseKwota\(v\) \{([\s\S]*?)\n\}/)
  === cialo('public/js/kwota.js', /export function parseKwota\(v\) \{([\s\S]*?)\n\}/));

console.log(bledy ? `\n${bledy} testów kwoty NIE przeszło.` : '\nWszystkie testy parsera kwot przeszły.');
process.exit(bledy ? 1 : 0);
