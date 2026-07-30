#!/usr/bin/env node
// Testy czystej logiki formy płatności (Z6): walidacja wartości, domyślna przy ręcznym wpisie
// (z wyjątkiem TRANSFER), twarda ELEKTRONICZNA przy imporcie, mapowanie z paragonu, odmowa
// czyszczenia na NULL. Importuje PRAWDZIWE funkcje z src/platnosc.js i src/ocr/ksiega.js —
// żadnej lokalnej kopii logiki (K8 recenzji: sabotaż w źródle MUSI wywalić ten test).
const realAssert = require('assert');
const { platnosc, PLATNOSCI, domyslnaPlatnosc, platnoscDoPatcha } = require('../src/platnosc');
const { platnoscZParagonu } = require('../src/ocr/ksiega');

let failures = 0;
let liczbaAsercji = 0;
// Owijka liczy KAŻDE wywołanie strictEqual/deepStrictEqual/ok — bez tego podsumowanie
// „N asercji" byłoby zgadywane ręcznie i rozjeżdżało się przy każdej zmianie testu.
const assert = {
  strictEqual: (...a) => { liczbaAsercji++; realAssert.strictEqual(...a); },
  deepStrictEqual: (...a) => { liczbaAsercji++; realAssert.deepStrictEqual(...a); },
  ok: (...a) => { liczbaAsercji++; realAssert.ok(...a); },
};
function t(name, fn) {
  try { fn(); console.log('OK  ', name); } catch (e) { failures++; console.error('FAIL', name, '—', e.message); }
}

// ---------- walidacja wartości (tylko dwie wartości albo brak pola) ----------

t('platnosc: dwie znane wartości przechodzą bez zmian', () => {
  for (const v of PLATNOSCI) assert.strictEqual(platnosc(v), v);
});

t('platnosc: brak pola to undefined — wywołujący decyduje o domyślnej, nie błąd', () => {
  assert.strictEqual(platnosc(undefined), undefined);
});

t('platnosc: śmieć (literówka, pusty napis, liczba, null) daje null = 400', () => {
  for (const zle of ['gotowka', 'GOTOWKA', 'Elektronicznie', '', 0, 1, null, [], {}, 'KARTA'])
    assert.strictEqual(platnosc(zle), null, String(zle));
});

// ---------- domyślna przy POST (WYDATEK/PRZYCHÓD -> ELEKTRONICZNA, TRANSFER -> NULL) ----------

t('WYDATEK/PRZYCHÓD bez pola -> domyślna ELEKTRONICZNA, jawna wartość zostaje', () => {
  assert.deepStrictEqual(domyslnaPlatnosc({ type: 'WYDATEK' }), { value: 'ELEKTRONICZNA' });
  assert.deepStrictEqual(domyslnaPlatnosc({ type: 'PRZYCHÓD', payment_method: 'GOTÓWKA' }), { value: 'GOTÓWKA' });
});

t('śmieć w payment_method -> bad_payment_method, niezależnie od typu', () => {
  assert.deepStrictEqual(domyslnaPlatnosc({ type: 'WYDATEK', payment_method: 'x' }), { error: 'bad_payment_method' });
});

t('TRANSFER bez pola -> NULL (nie ELEKTRONICZNA), jawna wartość -> odmowa', () => {
  assert.deepStrictEqual(domyslnaPlatnosc({ type: 'TRANSFER' }), { value: null });
  assert.deepStrictEqual(domyslnaPlatnosc({ type: 'TRANSFER', payment_method: 'GOTÓWKA' }),
    { error: 'payment_method_not_applicable' });
});

// ---------- PATCH: przełączenie dozwolone, czyszczenie i TRANSFER odrzucone ----------

t('PATCH: pole nieobecne -> nietknięte', () => {
  assert.deepStrictEqual(platnoscDoPatcha({}, 'WYDATEK'), { touched: false });
});

t('PATCH: przełączenie między dwiema wartościami jest dozwolone', () => {
  assert.deepStrictEqual(platnoscDoPatcha({ payment_method: 'GOTÓWKA' }, 'WYDATEK'), { touched: true, value: 'GOTÓWKA' });
});

t('PATCH: payment_method=null (próba czyszczenia) i śmieć -> bad_payment_method', () => {
  for (const zle of [null, '', 'x'])
    assert.deepStrictEqual(platnoscDoPatcha({ payment_method: zle }, 'WYDATEK'), { error: 'bad_payment_method' }, String(zle));
});

t('PATCH: wpis typu TRANSFER odrzuca payment_method, także przy zmianie typu NA TRANSFER', () => {
  assert.deepStrictEqual(platnoscDoPatcha({ payment_method: 'GOTÓWKA' }, 'TRANSFER'),
    { error: 'payment_method_not_applicable' });
  // typWpisu przekazywany przez wywołującego to typ PO zmianie (nowy z body, jeśli podany)
  assert.deepStrictEqual(platnoscDoPatcha({ type: 'TRANSFER', payment_method: 'GOTÓWKA' }, 'TRANSFER'),
    { error: 'payment_method_not_applicable' });
});

// ---------- płatność przy imporcie bankowym ----------
// imports.js /book nie bierze payment_method z żądania: wyciąg bankowy z definicji nie jest
// gotówką, więc wpis zwykły dostaje 'ELEKTRONICZNA'. WYJĄTEK silniejszy od tej reguły: gdy
// dominujący typ kategorii to TRANSFER (spłaty/cele z CSV), wpis MUSI dostać NULL — inaczej
// wypuszczamy na zewnątrz płatność transferu, której API potem nie da się skorygować.
// Sprawdzamy oba na źródle (brak bazy w tym środowisku): jest zmienna `platnosc` zależna od typu.

t('import bankowy: płatność zależy od typu — TRANSFER → NULL, reszta → ELEKTRONICZNA', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'routes', 'imports.js'), 'utf8');
  assert.ok(/typ === 'TRANSFER'\s*\?\s*null\s*:\s*'ELEKTRONICZNA'/.test(src),
    'w /book płatność musi być: TRANSFER → null, inaczej ELEKTRONICZNA');
  assert.ok(!/VALUES\s*\([^)]*'ELEKTRONICZNA'[^)]*\)/.test(src),
    'INSERT nie może już mieć literału ELEKTRONICZNA w VALUES — wartość idzie parametrem');
});

// ---------- mapowanie payment z paragonu ----------

t('paragon: GOTÓWKA/gotowka/CASH (jako słowo) mapuje się na GOTÓWKA', () => {
  for (const v of ['GOTÓWKA', 'gotowka', 'Zapłacono CASH', 'GOTÓWKA/KARTA'])
    assert.strictEqual(platnoscZParagonu(v), 'GOTÓWKA', v);
});

t('paragon: CASHLESS/CASHBACK to ELEKTRONICZNA mimo słowa CASH w środku', () => {
  assert.strictEqual(platnoscZParagonu('CASHLESS'), 'ELEKTRONICZNA');
  assert.strictEqual(platnoscZParagonu('CASHBACK'), 'ELEKTRONICZNA');
});

t('paragon: inny znany napis (karta, blik, przelew) mapuje się na ELEKTRONICZNA', () => {
  for (const v of ['KARTA PŁATNICZA', 'VISA', 'BLIK', 'przelew'])
    assert.strictEqual(platnoscZParagonu(v), 'ELEKTRONICZNA', v);
});

t('paragon: NULL/undefined/pusty/whitespace i sam kod słownikowy ("1") zostają NULL', () => {
  for (const v of [null, undefined, '', '   ', '1'])
    assert.strictEqual(platnoscZParagonu(v), null, String(v));
});

if (failures) {
  console.error(`\n${failures} test(ów) NIE przeszło`);
  process.exit(1);
}
console.log(`\nWszystkie testy płatności przeszły (${liczbaAsercji} asercji).`);
