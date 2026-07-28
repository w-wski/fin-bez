#!/usr/bin/env node
// Testy czystych reguł tożsamości produktu (src/produkty.js). Nazwy pochodzą z PRAWDZIWEGO
// paragonu (Biedronka, Brenna, 27.07.2026) — bo to one, a nie wymyślone przykłady, pokazują,
// jak kasa fiskalna kaleczy nazwy: „Jog Naturalny 400g”, „BorówkaAmeryk 300g”, „WinogrJasneBezp Luz”.
const p = require('../src/produkty');

let bledy = 0;
function ok(warunek, opis) {
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}
const rowne = (a, b, opis) => ok(JSON.stringify(a) === JSON.stringify(b), `${opis} → ${JSON.stringify(a)}`);

// ---------- sklep: numer placówki nie może rozbijać sieci ----------
rowne(p.normSklep('BIEDRONKA "CODZIENNIE NISKIE CENY" 3135'), 'BIEDRONKA', 'nagłówek z numerem placówki → sieć');
rowne(p.normSklep('Biedronka'), 'BIEDRONKA', 'sama nazwa też');
rowne(p.normSklep('JERONIMO MARTINS POLSKA S.A.'), 'JERONIMO MARTINS', 'nieznana nazwa → dwa pierwsze słowa');
rowne(p.normSklep('Żabka Polska sp. z o.o.'), 'ZABKA', 'diakrytyki nie przeszkadzają');
rowne(p.normSklep(''), '*', 'brak nazwy → alias globalny, nie pusty klucz');
ok(p.normSklep('x'.repeat(200)).length <= 64, 'klucz mieści się w kolumnie VARCHAR(64)');

// ---------- gramatura: warunek porównywalności cen ----------
rowne(p.gramatura('Jog Naturalny 400g'), { wartosc: 0.4, jednostka: 'kg' }, '400 g → kilogramy');
rowne(p.gramatura('KarmaPuffi1250g'), { wartosc: 1.25, jednostka: 'kg' }, 'gramatura przyklejona do nazwy');
rowne(p.gramatura('Woda niegaz. 1,5L'), { wartosc: 1.5, jednostka: 'l' }, 'przecinek dziesiętny i litry');
rowne(p.gramatura('Mleko 500 ML'), { wartosc: 0.5, jednostka: 'l' }, 'mililitry → litry');
rowne(p.gramatura('Serek 2x150g'), { wartosc: 0.3, jednostka: 'kg' }, 'wielopak liczy się razem');
rowne(p.gramatura('Czereśnie Luz'), null, 'towar na wagę nie ma gramatury — i to nie jest błąd');
rowne(p.gramatura('Schiacciata 80g'), { wartosc: 0.08, jednostka: 'kg' }, 'nazwa obca, gramatura swoja');
// Pułapka z prawdziwej linii: „KarmaPuff1250g B 2x 6,49” — „B” to stawka VAT, „2x” to ILOŚĆ
// sztuk, nie gramatura. Gdyby parser to złapał, karma ważyłaby 2 kg zamiast 1,25 kg.
rowne(p.gramatura('KarmaPuff1250g B 2x'), { wartosc: 1.25, jednostka: 'kg' }, 'ilość sztuk to nie gramatura');

// ---------- rdzeń nazwy ----------
ok(p.rdzen('Jog Naturalny 400g').join(' ') === 'JOGURT NATURALNY', 'skróty rozwinięte, gramatura usunięta');
ok(!p.rdzen('Czereśnie Luz').includes('LUZ'), '„Luz” to szum, nie cecha towaru');
rowne(p.rdzen(''), [], 'pusta nazwa → pusty rdzeń, bez wyjątku');

// ---------- podobieństwo ----------
const bliskie = (a, b, opis) => ok(p.podobienstwo(a, b) >= p.PROG, `${opis}: ${a} ≈ ${b} (${p.podobienstwo(a, b)})`);
const dalekie = (a, b, opis) => ok(p.podobienstwo(a, b) < p.PROG, `${opis}: ${a} ≠ ${b} (${p.podobienstwo(a, b)})`);

bliskie('Jog Naturalny 400g', 'JOGURT NAT. 400G', 'ten sam jogurt w dwóch sieciach');
bliskie('BorówkaAmeryk 300g', 'Borówka amerykańska 300 g', 'sklejone słowa i pełna nazwa');
bliskie('Masło extra 200g', 'MASLO EXTRA 200G', 'różnica tylko w diakrytykach i wielkości liter');
dalekie('Mleko 3,2% 1L', 'Mleko 3,2% 0,5L', 'ta sama nazwa, inna pojemność = INNY produkt');
dalekie('Jog Naturalny 400g', 'Czereśnie Luz', 'towary bez nic wspólnego');
dalekie('Sok pomarańczowy 1L', 'Sos pomidorowy 1L', 'dwie litery różnicy, dwa różne działy');
rowne(p.podobienstwo('', 'cokolwiek'), 0, 'pusta nazwa nie jest podobna do niczego');
ok(p.podobienstwo('Chleb', 'Chleb') === 1, 'identyczne = 1');

// ---------- kandydaci do scalenia ----------
const baza = [
  { id: 1, name: 'Jogurt naturalny 400 g' },
  { id: 2, name: 'Jogurt naturalny 150 g' },
  { id: 3, name: 'Czereśnie' },
  { id: 4, name: 'Masło extra 200 g' },
];
const k = p.kandydaci('Jog Naturalny 400g', baza);
ok(k.length >= 1, `znaleziono kandydata (${k.length})`);
rowne(k[0].id, 1, 'najlepszy kandydat ma ZGODNĄ gramaturę, nie samą nazwę');
ok(!k.some((x) => x.id === 3), 'czereśnie nie trafiają do kandydatów na jogurt');
ok(p.kandydaci('Jog Naturalny 400g', baza, { ile: 1 }).length === 1, 'limit liczby propozycji działa');
rowne(p.kandydaci('Zupełnie nowy towar XYZ', baza), [], 'nowy towar: brak propozycji to poprawna odpowiedź');
rowne(p.kandydaci('cokolwiek', null), [], 'brak listy nie wywraca wywołania');
ok(k.every((x) => x.wynik >= p.PROG), 'każdy kandydat przechodzi wspólny próg');

// ---------- klucz aliasu ----------
rowne(p.kluczAliasu('BIEDRONKA "CNC" 3135', 'Jog Naturalny 400g'),
  { shop: 'BIEDRONKA', code_norm: 'JOG NATURALNY 400G' }, 'klucz = (sieć, kod znormalizowany)');
rowne(p.kluczAliasu('Biedronka', 'A'), null, 'kod jednoznakowy nie jest kluczem — pasowałby do wszystkiego');
rowne(p.kluczAliasu('Biedronka', ''), null, 'pusty kod nie jest kluczem');
rowne(p.kluczAliasu(null, 'Mleko 1L').shop, '*', 'paragon bez nazwy sklepu → alias globalny');

// ---------- czytelna nazwa ----------
rowne(p.nazwaCzytelna('  Jog   Naturalny 400g '), 'Jog Naturalny 400g', 'przycięte odstępy, pisownia NIETKNIĘTA');
ok(p.nazwaCzytelna('x'.repeat(300)).length === 160, 'przycięcie do kolumny VARCHAR(160)');

console.log(bledy ? `\n${bledy} BŁĘDÓW` : '\nWszystkie testy tożsamości produktu przeszły.');
process.exit(bledy ? 1 : 0);
