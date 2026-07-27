#!/usr/bin/env node
// Testy czytania e-paragonu (src/eparagon.js) na WZORCU o strukturze prawdziwego pliku
// JPK_KASA_PARAGON_v2-0 (scripts/wzorce/eparagon-jpk.json — bez danych osobowych).
// Same funkcje czyste, zero bazy.
const { czyEParagon, czytaj, ilosc, grosze, nazwaIJednostka } = require('../src/eparagon');
const wzorzec = require('./wzorce/eparagon-jpk.json');

let bledy = 0;
function ok(warunek, opis) {
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}
const rowne = (a, b, opis) => ok(JSON.stringify(a) === JSON.stringify(b), `${opis} → ${JSON.stringify(a)}`);
function rzuca(fn, fragment, opis) {
  try { fn(); } catch (e) {
    return ok(e.message.includes(fragment), `${opis} (${e.message})`);
  }
  bledy++;
  console.error('BŁĄD', `${opis} — NIE rzucił`);
}

// --- ilość: napis z PRZECINKIEM dziesiętnym ---
rowne(ilosc('1,980'), 1.98, 'ilość „1,980" to 1,98 (Number() dałoby NaN)');
rowne(ilosc('4'), 4, 'ilość całkowita');
rowne(ilosc('0,975'), 0.975, 'ilość poniżej jednostki');
rowne(ilosc(''), null, 'puste = brak ilości, nie zero');
rowne(ilosc('1.5kg'), null, 'śmieci odrzucone, nie „1,5"');

// --- grosze: liczby CAŁKOWITE, nigdy parseFloat ---
rowne(grosze(2275), 2275, 'grosze jako liczba');
rowne(grosze('-2673'), -2673, 'grosze jako napis ujemny (rabat)');
rowne(grosze(22.75), null, 'liczba z częścią dziesiętną ODRZUCONA — grosze są całkowite');
rowne(grosze('22,75'), null, 'kwota z przecinkiem odrzucona (to nie ten format)');

// --- nazwa z kasy: dopełnienie spacjami + litera stawki VAT na końcu ---
rowne(nazwaIJednostka('Czereśnie Luz            C', 'C', 1.98),
  { kod: 'Czereśnie Luz', jednostka: 'kg' }, 'litera stawki zdjęta, „Luz" → kg');
rowne(nazwaIJednostka('Schiacciata 80g          C', 'C', 4),
  { kod: 'Schiacciata 80g', jednostka: 'szt.' }, 'ilość całkowita → sztuki');
rowne(nazwaIJednostka('BorówkaAmeryk 300g       C', 'C', 4).kod,
  'BorówkaAmeryk 300g', 'gramatura w nazwie NIE czyni z tego wagi');
rowne(nazwaIJednostka('Arbuz luz                C', 'C', 3.595).jednostka, 'kg', '„luz" małą literą też');
rowne(nazwaIJednostka('Cukier 1kg C', 'B', 2).kod, 'Cukier 1kg C',
  'litera stawki zdejmowana TYLKO gdy zgadza się z polem VAT pozycji');

// --- rozpoznanie koperty ---
ok(czyEParagon(wzorzec), 'wzorzec rozpoznany jako e-paragon');
ok(!czyEParagon({ foo: 1 }), 'zwykły JSON odrzucony');
ok(!czyEParagon(null), 'null odrzucony');
rzuca(() => czytaj({ foo: 1 }), 'to nie jest e-paragon', 'obcy JSON → czytelny powód');

// --- cały dokument ---
const r = czytaj(wzorzec);
rowne(r.format, 'jpk', 'format');
rowne(r.wersja, 'JPK_KASA_PARAGON_v2-0', 'wersja standardu');
rowne(r.data, '2026-07-27', 'data sprzedaży');
rowne(r.total, 10724, 'suma brutto w groszach (107,24 zł)');
rowne(r.opusty, -11222, 'suma opustów (−112,22 zł)');
rowne(r.nip, '7791011327', 'NIP sprzedawcy');
ok(r.sklep.startsWith('BIEDRONKA'), `sklep z nagłówka wydruku, nie nazwa spółki (${r.sklep})`);
rowne(r.pozycje.length, 8, 'osiem pozycji towarowych');
rowne(r.rabatyGlobalne.length, 2, 'dwa rabaty globalne (vouchery) poza pozycjami');
rowne(r.zaplata, [{ nazwa: 'BLIK', wartosc: 10724 }], 'forma zapłaty');

// --- pozycja po pozycji: rabat liniowy i cena EFEKTYWNA ---
const czer = r.pozycje[0];
rowne([czer.kod, czer.ilosc, czer.jednostka], ['Czereśnie Luz', 1.98, 'kg'], 'czereśnie na wagę');
rowne(czer.cenaJedn, 2499, 'cena katalogowa 24,99 zł/kg');
rowne(czer.wartosc, 2275, 'zapłacono 22,75 zł (PO rabacie)');
rowne(czer.rabat, -2673, 'rabat liniowy −26,73 zł');
rowne(Math.round(czer.wartosc / czer.ilosc), 1149, 'cena EFEKTYWNA 11,49 zł/kg — to ona interesuje analizę');
rowne(Math.round(r.pozycje[5].wartosc / r.pozycje[5].ilosc), 299, 'arbuz: 5,99 → 2,99 zł/kg');
rowne(r.pozycje[3].wartosc / 4, 749, 'borówka: 14,98 → 7,49 zł/szt (drugie dwa gratis)');

// --- BRAMKA sumowania: paragon, który się nie zgadza, NIE MOŻE wejść do księgi ---
const kopia = JSON.parse(JSON.stringify(wzorzec));
const seg = kopia.data.split('.');
const dek = JSON.parse(Buffer.from(seg[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
dek.dokument.paragon.podsum.sumaBrutto = 9999;
seg[1] = Buffer.from(JSON.stringify(dek), 'utf8').toString('base64url');
kopia.data = seg.join('.');
rzuca(() => czytaj(kopia), 'nie sumuje', 'podmieniona suma brutto → odmowa, nie cicha zgoda');

// Suma pozycji minus rabaty globalne MUSI dać sumę z paragonu — sprawdzamy też wprost,
// bo to jedyne miejsce, w którym rozumienie rabatów w tym formacie jest weryfikowalne.
const sumaPoz = r.pozycje.reduce((a, x) => a + x.wartosc, 0);
const sumaRab = r.rabatyGlobalne.reduce((a, x) => a + x.wartosc, 0);
rowne(sumaPoz + sumaRab, r.total, `${sumaPoz} + (${sumaRab}) = suma paragonu`);

// --- klucz przeciw duplikatom ---
ok(r.klucz.split('|').length === 3 && !r.klucz.includes('?'),
  `klucz z numeru unikatowego kasy i identyfikatorów dokumentu (${r.klucz})`);
rowne(czytaj(wzorzec).klucz, r.klucz, 'ten sam plik → ten sam klucz (wgranie dwa razy nie zrobi dwóch paragonów)');

console.log(bledy ? `\n${bledy} BŁĘDÓW` : '\nWszystkie testy e-paragonu przeszły.');
process.exit(bledy ? 1 : 0);
