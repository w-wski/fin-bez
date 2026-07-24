// Testy parsera paragonów na syntetycznym tekście OCR (typowe zniekształcenia)
// oraz czystej logiki pól paragonu (bez bazy i bez DOM).
const assert = require('assert');
const { parseReceipt, sladyRecznejPracy } = require('../src/ocr/parse-receipt');
const { normCode, normUnit, txt, parseIlosc, czyData, isInconsistent, sumDiff } = require('../src/ocr/pola');
const { parseKwota } = require('../src/kwota');

let failures = 0;
function t(name, fn) {
  try { fn(); console.log('OK  ', name); }
  catch (e) { failures++; console.error('FAIL', name, '—', e.message); }
}

// ---------- CZYSTOŚĆ MODUŁU (audyt Z4) ----------
// parse-receipt.js deklaruje „czysta funkcja". Gdy ciągnął ../db przez ./slownik, samo
// uruchomienie testów otwierało pulę MySQL. Ten test pilnuje, żeby to nie wróciło.
t('Parser i reguły pól nie ciągną bazy danych', () => {
  const zaladowane = Object.keys(require.cache);
  assert.ok(!zaladowane.some((p) => p.endsWith(`${require('path').sep}src${require('path').sep}db.js`)),
    'require(parse-receipt) załadował src/db.js');
});

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

// ---------- KWOTY POWYŻEJ TYSIĄCA (audyt Z4: pomyłka o TRZY RZĘDY WIELKOŚCI) ----------
// Stary parser pól czytał „1.234,56" jako 1,23, a „1.234" jako 1,234 — ta sama funkcja
// obsługiwała total, unit_price i value, więc „Potwierdź" księgowało 1,23 zł zamiast 1234,56 zł.
t('Kwota z separatorem tysięcy: 1.234,56 = 1234,56 (NIE 1,23)', () => {
  assert.strictEqual(parseKwota('1.234,56'), 1234.56);
  assert.strictEqual(parseKwota('1 234,56'), 1234.56);
  assert.strictEqual(parseKwota('1.234'), 1234);
  assert.strictEqual(parseKwota('12.345.678,90'), 12345678.9);
  assert.strictEqual(parseKwota('l2,50'), null);      // mała litera L zamiast jedynki = odmowa zapisu
  assert.strictEqual(parseKwota(''), null);
});

t('SUMA paragonu powyżej tysiąca trafia do księgi w całości', () => {
  const r = parseReceipt(`MEBLE SP. Z O.O.
SZAFA DĄB 1 x 1.234,56 1.234,56
SUMA PLN 1.234,56`);
  assert.strictEqual(r.total, 1234.56);
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].unit_price, 1234.56);
  assert.strictEqual(r.items[0].value, 1234.56);
  assert.strictEqual(r.warnings.length, 0);
});

t('SUMA z tysiącami po spacji („1 234,56") też czytana w całości', () => {
  const r = parseReceipt(`SKLEP\nTELEWIZOR 1 x 1 234,56 1 234,56\nSUMA 1 234,56`);
  assert.strictEqual(r.total, 1234.56);
  assert.strictEqual(r.items[0].value, 1234.56);
});

// ---------- POZYCJA BEZ ILOŚCI (K10) ----------
// Paragon nie podał ilości ani ceny jednostkowej — parser NIE zmyśla „1 szt.".
// Puste pola czekają na człowieka, a walidacja spójności nie ma czego sprawdzać.
t('Pozycja bez ilości: quantity/unit_price puste, ale wartość pewna', () => {
  const r = parseReceipt(`KIOSK\nGAZETA WYBORCZA 4,50\nSUMA 4,50`);
  const it = r.items[0];
  assert.strictEqual(it.quantity, null);
  assert.strictEqual(it.unit_price, null);
  assert.strictEqual(it.value, 4.5);
  assert.strictEqual(it.low_confidence, false);
  assert.strictEqual(isInconsistent(it), false);      // brak danych ≠ błąd
  assert.strictEqual(r.warnings.length, 0);
});

t('Parser proponuje code = odczyt OCR, a ocr_name zostaje śladem audytowym', () => {
  const r = parseReceipt(`SKLEP\nCHLEB WIEJSKI 500G 1 x 4,99 4,99\nSUMA 4,99`);
  assert.strictEqual(r.items[0].code, r.items[0].ocr_name);
  assert.ok(r.items[0].ocr_name.includes('CHLEB'));
});

// ---------- NORMALIZACJA code_norm (K3, K10) ----------
t('code_norm: polskie znaki znikają, wielokrotne spacje sklejają się, wielkie litery', () => {
  assert.strictEqual(normCode('  Mąka   TORTOWA   1kg '), 'MAKA TORTOWA 1KG');
  assert.strictEqual(normCode('Żółć ćma ęsi ńmy óra śle źle'), 'ZOLC CMA ESI NMY ORA SLE ZLE');
  assert.strictEqual(normCode('Chleb\tŁÓDZKI\n500g'), 'CHLEB LODZKI 500G');
});

t('code_norm: ten sam produkt zapisany różnie daje ten sam klucz słownika', () => {
  assert.strictEqual(normCode('mleko łaciate 2%'), normCode('MLEKO  LACIATE   2%'));
  assert.strictEqual(normCode('Jogurt Naturalny'), normCode('jogurt naturalny'));
});

t('code_norm: puste/śmieciowe wejście = null (nie uczymy słownika niczego)', () => {
  assert.strictEqual(normCode(''), null);
  assert.strictEqual(normCode('   '), null);
  assert.strictEqual(normCode(null), null);
  assert.strictEqual(normCode(undefined), null);
});

t('code_norm: bardzo długi kod przycięty do kolumny VARCHAR(160)', () => {
  assert.strictEqual(normCode('A'.repeat(400)).length, 160);
});

// ---------- JEDNOSTKA (K5) ----------
t('Jednostka: przycięta do 8 znaków, puste dozwolone', () => {
  assert.strictEqual(normUnit('szt.'), 'szt.');
  assert.strictEqual(normUnit('  kg '), 'kg');
  assert.strictEqual(normUnit('opakowanie zbiorcze'), 'opakowan');   // VARCHAR(8)
  assert.strictEqual(normUnit(''), null);
  assert.strictEqual(normUnit(null), null);
});

// ---------- ILOŚĆ TO NIE KWOTA ----------
// Waga 0,345 kg jest normalna, a parseKwota('0.345') dałoby 345 (trzycyfrowa grupa = tysiące).
t('Ilość: waga i liczby z bazy (DECIMAL(8,3)) czytane bez pomyłki o rząd wielkości', () => {
  assert.strictEqual(parseIlosc('0,345'), 0.345);
  assert.strictEqual(parseIlosc('0.345'), 0.345);
  assert.strictEqual(parseIlosc('2.000'), 2);          // tak MySQL zwraca DECIMAL
  assert.strictEqual(parseIlosc(3), 3);
  assert.strictEqual(parseIlosc(''), null);
  assert.strictEqual(parseIlosc('dwie'), null);
  assert.strictEqual(parseIlosc('1 000'), null);       // niejednoznaczne — odmowa, nie zgadywanie
  assert.strictEqual(txt('  chleb tostowy  ', 255), 'chleb tostowy');
  assert.strictEqual(txt('   ', 255), null);
});

// Strażnik rozjazdu (jak dla parseKwota w test-kwota.js): ilość ma wersję serwerową
// i przeglądarkową. Rozjazd znaczyłby, że pole pokazuje inną wagę, niż zapisała baza.
t('parseIlosc: wersja serwerowa i przeglądarkowa mają identyczne ciało', () => {
  const fs = require('fs');
  const path = require('path');
  const cialo = (plik, wzorzec) => {
    const src = fs.readFileSync(path.join(__dirname, '..', plik), 'utf8');
    const m = src.match(wzorzec);
    assert.ok(m, `nie znalazłem parseIlosc w ${plik}`);
    return m[1].replace(/\s+/g, ' ').trim();
  };
  assert.strictEqual(
    cialo('src/ocr/pola.js', /function parseIlosc\(v\) \{([\s\S]*?)\n\}/),
    cialo('public/js/paragon-poz.js', /export function parseIlosc\(v\) \{([\s\S]*?)\n\}/));
});

// ---------- DATA PARAGONU ----------
// „2026-02-31" przechodziło do MySQL i wywracało zapis (500), a data spoza formatu cicho
// stawała się NULL-em przy odpowiedzi {ok:true}.
t('Data: tylko istniejący dzień w formacie ISO', () => {
  assert.strictEqual(czyData('2026-07-20'), '2026-07-20');
  assert.strictEqual(czyData('2024-02-29'), '2024-02-29');   // rok przestępny
  assert.strictEqual(czyData('2026-02-31'), null);
  assert.strictEqual(czyData('2026-02-29'), null);           // 2026 nie jest przestępny
  assert.strictEqual(czyData('2026-13-01'), null);
  assert.strictEqual(czyData('20.07.2026'), null);
  assert.strictEqual(czyData(''), null);
  assert.strictEqual(czyData(null), null);
});

// ---------- SPÓJNOŚĆ ilość × cena vs wartość (K6, K10) ----------
t('Rozbieżność ilość×cena vs wartość: próg 2 gr', () => {
  assert.strictEqual(isInconsistent({ quantity: 2, unit_price: 3.79, value: 7.58 }), false);
  assert.strictEqual(isInconsistent({ quantity: 3, unit_price: 1.89, value: 5.67 }), false);
  assert.strictEqual(isInconsistent({ quantity: 1, unit_price: 10, value: 10.02 }), false); // równo 2 gr = jeszcze OK
  assert.strictEqual(isInconsistent({ quantity: 1, unit_price: 10, value: 10.03 }), true);  // 3 gr = do sprawdzenia
  assert.strictEqual(isInconsistent({ quantity: 2, unit_price: 3.00, value: 9.00 }), true);
});

t('Rozbieżność: dane z MySQL przychodzą jako napisy DECIMAL', () => {
  assert.strictEqual(isInconsistent({ quantity: '2.000', unit_price: '3.79', value: '7.58' }), false);
  assert.strictEqual(isInconsistent({ quantity: '2.000', unit_price: '3.79', value: '9.99' }), true);
  assert.strictEqual(isInconsistent({ quantity: '1.000', unit_price: '1234.56', value: '1234.56' }), false);
});

t('Rozbieżność: waga (0,345 kg × 29,90) mieści się w tolerancji zaokrągleń', () => {
  assert.strictEqual(isInconsistent({ quantity: 0.345, unit_price: 29.90, value: 10.32 }), false);
  assert.strictEqual(isInconsistent({ quantity: '0.345', unit_price: '29.90', value: '10.32' }), false);
});

t('Rozbieżność: brak którejkolwiek liczby = nie oceniamy pozycji', () => {
  assert.strictEqual(isInconsistent({ quantity: null, unit_price: 3.5, value: 3.5 }), false);
  assert.strictEqual(isInconsistent({ quantity: 2, unit_price: null, value: 7 }), false);
  assert.strictEqual(isInconsistent({ quantity: 2, unit_price: 3.5, value: null }), false);
  assert.strictEqual(isInconsistent({}), false);
  assert.strictEqual(isInconsistent(null), false);
});

// ---------- BRAMA „POPRAW AI": czy w paragonie jest już praca człowieka? ----------
// Ponowny odczyt AI kasuje pozycje i przestawia SUMĘ, więc wolno mu ruszyć WYŁĄCZNIE surowy
// odczyt maszyny. Scenariusz z audytu: paragon potwierdzony na 120,00 → AI robi z niego 87,40,
// a w księdze zostaje 120,00 (plus znikają ręczne poprawki i ślad audytowy ocr_name).
const OCR_TEKST = 'SKLEP ABC\nCHLEB 1 x 4,99 4,99\nSUMA 4,99';
const surowy = { shop_name: 'SKLEP ABC', receipt_date: null, total: '4.99', ocr_text: OCR_TEKST };
const surowePozycje = [{ ocr_name: 'CHLEB', code: 'CHLEB', name: null, unit: null, category_id: null,
  quantity: '1.000', unit_price: '4.99', value: '4.99' }];

t('Surowy odczyt maszyny: brak śladów ręcznej pracy (AI wolno czytać ponownie)', () => {
  assert.strictEqual(sladyRecznejPracy(surowy, surowePozycje), false);
});

t('Każdy ślad ręcznej pracy zamyka bramę ponownego odczytu', () => {
  const z = (zmiana) => sladyRecznejPracy(surowy, [{ ...surowePozycje[0], ...zmiana }]);
  assert.strictEqual(z({ name: 'chleb tostowy' }), true);        // opis od człowieka
  assert.strictEqual(z({ unit: 'szt.' }), true);                 // jednostka
  assert.strictEqual(z({ category_id: 3 }), true);               // kategoria
  assert.strictEqual(z({ code: 'CHL TOST 500G' }), true);        // poprawiony kod
  assert.strictEqual(z({ value: '9.99' }), true);                // poprawiona kwota
  assert.strictEqual(z({ quantity: '2.000' }), true);            // poprawiona ilość
  assert.strictEqual(sladyRecznejPracy({ ...surowy, total: '120.00' }, surowePozycje), true);  // SUMA
  assert.strictEqual(sladyRecznejPracy({ ...surowy, shop_name: 'Biedronka' }, surowePozycje), true);
  assert.strictEqual(sladyRecznejPracy({ ...surowy, receipt_date: '2026-07-20' }, surowePozycje), true);
  assert.strictEqual(sladyRecznejPracy(surowy, [...surowePozycje, { ocr_name: '', code: 'DOPISANE' }]), true);
  assert.strictEqual(sladyRecznejPracy(surowy, []), true);       // usunięta pozycja
});

// ---------- SUMA POZYCJI vs SUMA PARAGONU (K7) ----------
t('Suma pozycji: różnica do 5 gr jest w normie, powyżej wraca liczbowo', () => {
  assert.strictEqual(sumDiff([{ value: 4.99 }, { value: 5.00 }], 10.02), null);   // 3 gr
  assert.strictEqual(sumDiff([{ value: 4.99 }, { value: 5.00 }], 9.5), 0.49);
  assert.strictEqual(sumDiff([{ value: '7.99' }], 10), -2.01);
  assert.strictEqual(sumDiff([], 10), null);
  assert.strictEqual(sumDiff([{ value: 5 }], null), null);
  assert.strictEqual(sumDiff([{ value: '1234.56' }], 1234.56), null);             // tysiące bez pomyłki
});

if (failures) { console.error(`\n${failures} test(ów) NIE przeszło`); process.exit(1); }
console.log('\nWszystkie testy parsera paragonów przeszły.');
