#!/usr/bin/env node
// Testy arytmetyki okresów (src/okresy.js): okres bieżący, poprzedni (baza m/m),
// koniec okresu (saldo narastające) i zmiana procentowa. Same daty — zero bazy.
const { dataOK, okres, poprzedniOkres, koniecOkresu, delta } = require('../src/okresy');

let bledy = 0;
function ok(warunek, opis) {
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}
const rowne = (a, b, opis) => ok(JSON.stringify(a) === JSON.stringify(b), `${opis} → ${JSON.stringify(a)}`);

// --- daty, które tylko WYGLĄDAJĄ jak daty ---
ok(dataOK('2026-07-24'), 'realna data przechodzi');
ok(!dataOK('2026-02-31'), '31 lutego ODRZUCONE (regex by je przepuścił)');
ok(!dataOK('2026-13-01'), 'miesiąc 13 odrzucony');
ok(dataOK('2024-02-29'), 'rok przestępny: 29 lutego przechodzi');
ok(!dataOK('2026-02-29'), 'rok nieprzestępny: 29 lutego odrzucone');

// --- poprzedni miesiąc, w tym przeskok roku ---
rowne(poprzedniOkres(okres({ month: '2026-07' })).month, '2026-06', 'poprzedni miesiąc');
rowne(poprzedniOkres(okres({ month: '2026-01' })).month, '2025-12', 'styczeń → grudzień poprzedniego roku');
rowne(poprzedniOkres(okres({ month: '2026-03' })).month, '2026-02', 'marzec → luty');

// --- poprzedni ZAKRES: tyle samo dni, bezpośrednio przed ---
const kw = okres({ from: '2026-04-01', to: '2026-06-30' });     // 91 dni
const pkw = poprzedniOkres(kw);
rowne([pkw.from, pkw.to], ['2026-01-01', '2026-03-31'], 'kwartał II 2026 porównuje się z kwartałem I (91 dni)');
const tyg = poprzedniOkres(okres({ from: '2026-07-20', to: '2026-07-26' }));
rowne([tyg.from, tyg.to], ['2026-07-13', '2026-07-19'], 'tydzień → poprzedni tydzień');
const rok = poprzedniOkres(okres({ from: '2026-01-01', to: '2026-12-31' }));
rowne([rok.from, rok.to], ['2025-01-01', '2025-12-31'], 'cały rok → cały rok poprzedni');
const luty = poprzedniOkres(okres({ from: '2026-03-01', to: '2026-03-31' }));
rowne([luty.from, luty.to], ['2026-02-01', '2026-02-28'], 'marzec jako zakres → CAŁY luty (28 dni, nie 31)');
const przelom = poprzedniOkres(okres({ from: '2026-01-01', to: '2026-03-31' }));
rowne([przelom.from, przelom.to], ['2025-10-01', '2025-12-31'], 'I kwartał → IV kwartał poprzedniego roku');
const przezRok = poprzedniOkres(okres({ from: '2026-01-05', to: '2026-01-20' }));
rowne([przezRok.from, przezRok.to], ['2025-12-20', '2026-01-04'], 'zakres przy granicy roku cofa się w poprzedni rok');

// --- koniec okresu (granica salda narastającego) ---
rowne(koniecOkresu(okres({ month: '2026-07' })), '2026-07-31', 'koniec lipca');
rowne(koniecOkresu(okres({ month: '2026-02' })), '2026-02-28', 'koniec lutego (nieprzestępny)');
rowne(koniecOkresu(okres({ month: '2024-02' })), '2024-02-29', 'koniec lutego (przestępny)');
rowne(koniecOkresu(okres({ month: '2026-12' })), '2026-12-31', 'koniec grudnia (przeskok roku)');
rowne(koniecOkresu(okres({ from: '2026-04-01', to: '2026-06-30' })), '2026-06-30', 'koniec zakresu = jego „to"');

// --- zmiana procentowa ---
rowne(delta(12148.91, 12681.20), -4.2, 'spadek wydatków o 4,2 %');
rowne(delta(18420, 16594.6), 11, 'wzrost przychodów o 11 %');
rowne(delta(100, 0), null, 'baza 0 → BRAK porównania (nie +∞ %)');
rowne(delta(0, 500), -100, 'zero w tym okresie to spadek o 100 %, nie brak danych');
rowne(delta(0, 0), null, 'zero do zera → brak porównania');

// --- parametry SQL są ROZŁĄCZNE między okresami ---
const b = okres({ month: '2026-07' });
const pb = poprzedniOkres(b);
ok(!Object.keys(b.p).some((k) => k in pb.p),
   'nazwy parametrów bieżącego i poprzedniego okresu się nie nadpisują');
const b2 = okres({ from: '2026-04-01', to: '2026-06-30' });
ok(!Object.keys(b2.p).some((k) => k in poprzedniOkres(b2).p),
   'to samo w trybie zakresu (inaczej jedno zapytanie zjadłoby parametry drugiego)');

console.log(bledy ? `\n${bledy} BŁĘDÓW` : '\nWszystkie testy okresów przeszły.');
process.exit(bledy ? 1 : 0);
