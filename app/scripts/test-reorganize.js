// Testy czystych funkcji mapowania taksonomii (scripts/reorganize-plan.js).
// Bez bazy danych — sprawdzają normalizację nazw, dopasowanie starej nazwy do reguły,
// rozdział przychód/wydatek, księgi, granicę „automat vs decyzja człowieka" oraz
// idempotencję (kategoria docelowa nigdy nie jest przemapowywana gdzie indziej — to
// gwarancja „drugie uruchomienie = 0 zmian").
// Uruchomienie: npm test
const assert = require('assert');
const { TREE, RULES, zwin, norm, monthTag, hits, ruleFor, kandydat, ruleForCat, pathOf, RECZNA,
  grosze, kubel, przesun } = require('./reorganize-plan');

let failures = 0;
function t(name, fn) {
  try { fn(); console.log('OK  ', name); }
  catch (e) { failures++; console.error('FAIL', name, '—', e.message); }
}

// --- syntetyczne drzewo kategorii zbudowane z TREE (id nadawane po kolei) ---
let seq = 0;
const cats = [], byKey = new Map();
for (const led of [1, 2]) {
  for (const [root, kids] of Object.entries(TREE[led])) {
    const r = { id: ++seq, ledger_id: led, parent_id: null, name: root, path: root };
    cats.push(r); byKey.set(`${led}|${root}`, r);
    for (const k of kids) {
      const c = { id: ++seq, ledger_id: led, parent_id: r.id, name: k, path: `${root} > ${k}` };
      cats.push(c); byKey.set(`${led}|${root}>${k}`, c);
    }
  }
}
const target = (r) => byKey.get(`${r.l}|${r.to}`);
// stara kategoria „na niby": {name, path, ledger_id}
const old = (path, led = 1) => ({ id: 9000 + path.length, ledger_id: led, name: path.split('>').pop().trim(), path });
const tx = (type, cat, desc = '', led = null) =>
  ({ id: 1, type, ledger_id: led || (cat ? cat.ledger_id : 1), category_id: cat ? cat.id : null, description: desc, tx_date: '2026-06-14', tag: null });
const gotTo = (r) => (r ? r.to : null);

// ---------- normalizacja ----------
t('norm: spacja na końcu nie tworzy osobnej kategorii (P2)', () => {
  assert.strictEqual(norm('Zakupy spożywcze '), norm('Zakupy spożywcze'));
  assert.strictEqual(norm('  Zakupy   spożywcze  '), 'zakupy spożywcze');
});
t('norm: ścieżka „A>B" i „A > B" to to samo', () => {
  assert.strictEqual(norm('Wakacje>Nocleg'), norm('Wakacje  >  Nocleg'));
  assert.strictEqual(norm('Wakacje>Nocleg'), 'wakacje > nocleg');
});
t('zwin: klucz category_map bez podwójnych spacji (P2/K4)', () => {
  assert.strictEqual(zwin('Zakupy spożywcze  > Pieczywo'), 'Zakupy spożywcze > Pieczywo');
  assert.strictEqual(zwin(' 1000  Czynsz '), '1000 Czynsz');
  assert.strictEqual(zwin('Wakacje>Nocleg'), 'Wakacje > Nocleg');   // zachowuje wielkość liter
});
t('pathOf: dziecko dostaje ścieżkę z rodzicem', () => {
  const byId = new Map([[1, { id: 1, name: 'Wakacje', parent_id: null }]]);
  assert.strictEqual(pathOf({ id: 2, name: 'Nocleg', parent_id: 1 }, byId), 'Wakacje > Nocleg');
  assert.strictEqual(pathOf({ id: 1, name: 'Wakacje', parent_id: null }, byId), 'Wakacje');
});
t('monthTag: tag wyjazdu z miesiąca transakcji (A30, §7.1)', () => {
  assert.strictEqual(monthTag('2026-06-14'), 'wyjazd-2026-06');
  assert.strictEqual(monthTag('2026-07-01'), 'wyjazd-2026-07');   // pierwszy dzień miesiąca
});
t('monthTag: obiekt Date = błąd, nie cichy tag o miesiąc wstecz', () => {
  // Date lokalnej północy + toISOString() przy Europe/Warsaw dawał „wyjazd-2026-06"
  // dla wpisu z 1 lipca. Połączenie ma dateStrings, więc Date tu nie ma prawa być.
  assert.throws(() => monthTag(new Date(2026, 6, 1)), /RRRR-MM-DD/);
  assert.throws(() => monthTag(null), /RRRR-MM-DD/);
});

// ---------- dopasowanie nazw ----------
t('hits: liść, pełna ścieżka, poddrzewo i „*"', () => {
  const c = old('Wakacje > Nocleg');
  assert.ok(hits('Nocleg', c));                     // sama nazwa liścia
  assert.ok(hits('Wakacje > Nocleg', c));           // pełna ścieżka
  assert.ok(hits('Wakacje > *', c));                // poddrzewo
  assert.ok(hits('*', c));
  assert.ok(!hits('Wakacje > Atrakcje', c));
  assert.ok(hits('Wakacje > *', old('Wakacje')));   // korzeń też należy do poddrzewa
});

// ---------- wiersze tabeli akceptacyjnej ----------
const WIERSZE = [
  // [opis, stara kategoria, typ wpisu, opis wpisu, oczekiwany cel, oczekiwany wiersz]
  ['A1 spacja/warianty spożywczych', 'Zakupy spożywcze ', 'WYDATEK', '', 'Spożywcze', 'A1'],
  ['A1 „i drogeryjne"', 'Zakupy spożywcze i drogeryjne', 'WYDATEK', '', 'Spożywcze', 'A1'],
  ['A1 ścieżka Jedzenie > Zakupy spożywcze', 'Jedzenie > Zakupy spożywcze', 'WYDATEK', '', 'Spożywcze', 'A1'],
  ['A2 Gastronomia = Jedzenie na mieście', 'Gastronomia', 'WYDATEK', '', 'Jedzenie na mieście', 'A2'],
  ['A2 Beskid to kontrahent, nie kategoria (P4)', 'Jedzenie na mieście > Beskid', 'WYDATEK', '', 'Jedzenie na mieście>Restauracja', 'A2'],
  ['A3 prefiks „1000" znika', '1000 Czynsz', 'WYDATEK', '', 'Dom i media>Czynsz', 'A3'],
  ['A5 rachunek za telefon', 'Rachunek za telefon', 'WYDATEK', '', 'Dom i media>Telefony', 'A5'],
  ['A6 Dom > Lekarstwa idzie do Zdrowia', 'Dom > Lekarstwa', 'WYDATEK', '', 'Zdrowie>Leki', 'A6'],
  ['A9 Paliwo pod Transport', 'Paliwo', 'WYDATEK', '', 'Transport>Paliwo', 'A9'],
  ['A11 mandat UFG-Lexus (§7.2)', 'Lexus', 'WYDATEK', 'Mandat UFG', 'Transport>Parkingi/Mandaty', 'A11'],
  ['A13 Lexus = koszty auta rodziny', 'Lexus', 'WYDATEK', 'wymiana oleju', 'Transport>Serwis/Naprawy', 'A13'],
  ['A16 literówka „bioet autobusowy"', 'Bartuś > bioet autobusowy', 'WYDATEK', '', 'Bartuś>Bilety', 'A16'],
  ['A19 Inne 1 = impreza (§7.4)', 'Inne 1', 'WYDATEK', '', 'Kultura i rozrywka>Uroczystości/Imprezy', 'A19'],
  ['A20 Prezenty zostają Prezentami (Misja Centrum = decyzja ręczna)', 'Prezenty', 'WYDATEK', 'Misja Centrum', 'Prezenty i wsparcie>Prezenty', 'A20'],
  ['A22 Podatek rodzinny', 'Podatek', 'WYDATEK', 'podatek od nieruchomości', 'Opłaty i urzędy>Podatki', 'A22'],
  ['A23 literówka „Ursędowe"', 'Ursędowe', 'WYDATEK', '', 'Opłaty i urzędy>Opłaty urzędowe', 'A23'],
  ['A28 Darek Toczek = najem pass-through (§7.3)', 'Darek Toczek', 'WYDATEK', '', 'Najem (pass-through)>Czynsz do Darka', 'A28'],
  ['A29 Dodatkowe → Inne', 'Dodatkowe', 'WYDATEK', '', 'Inne', 'A29'],
  ['A30 całe Wakacje > * do Wyjazdów', 'Wakacje > Atrakcje', 'WYDATEK', '', 'Kultura i rozrywka>Wyjazdy', 'A30'],
  ['B1 Bank Handlowy = spłata', 'Bank Handlowy', 'WYDATEK', '', 'Spłaty>Kredyt Bank Handlowy', 'B1'],
  ['B7 Oszczędności 3 = cel', 'Oszczędności 3', 'WYDATEK', '', 'Cele>Oszczędności', 'B7'],
  ['C1 przychód Film', 'Film', 'PRZYCHÓD', '', 'Film', 'C1'],
  ['C1 przychód „Film" z opisem ZASP zostaje w Film (C2 tylko proponuje)', 'Film', 'PRZYCHÓD', 'wypłata ZASP', 'Film', 'C1'],
  ['C2 kategoria „Tantiemy" (nazwa, nie opis)', 'Tantiemy', 'PRZYCHÓD', '', 'Tantiemy', 'C2'],
  ['C3 Zwrot → Zwroty', 'Zwrot', 'PRZYCHÓD', 'EPP', 'Zwroty', 'C3'],
  ['C6 Dodatkowe (przychód) = wypłata z PERSEVERY', 'Dodatkowe', 'PRZYCHÓD', '', 'PERSEVERA (wypłaty)', 'C6'],
  ['C8 sierota przychodowa → Inne przychody (K1)', 'Dom', 'PRZYCHÓD', 'jakiś wpływ', 'Inne przychody', 'C8'],
  ['D2 PERSEVERA Paliwo → księga spółki', 'PERSEVERA Paliwo', 'WYDATEK', '', 'Samochód>Paliwo', 'D2'],
  ['D3 PERSEVERA Hotele → Delegacje', 'PERSEVERA Hotele', 'WYDATEK', '', 'Działalność>Hotele/Delegacje', 'D3'],
  ['D4 CIT 8 Anny → księga PERSEVERA', 'Podatek', 'WYDATEK', 'CIT 8 za 2025', 'Podatki i opłaty>CIT', 'D4'],
];
for (const [nazwa, stara, typ, opis, cel, wiersz] of WIERSZE) {
  t(nazwa, () => {
    const c = old(stara);
    const r = ruleFor(tx(typ, c, opis), c);
    assert.ok(r, 'żadna reguła nie złapała „' + stara + '"');
    assert.strictEqual(gotTo(r), cel);
    assert.strictEqual(r.id, wiersz);
  });
}

// ---------- opis a PRZYCHODY: automat nie przenosi cudzych pieniędzy ----------
t('C7: „przelew od Kamila Nowak za bilety" NIE ląduje w Najmie automatem', () => {
  const c = old('Film'), t1 = tx('PRZYCHÓD', c, 'przelew od Kamila Nowak za bilety');
  assert.strictEqual(ruleFor(t1, c).id, 'C1');            // przychód zostaje tam, gdzie był
  assert.strictEqual(kandydat(t1, c).id, 'C7');           // idzie tylko na listę do decyzji
  assert.strictEqual(kandydat(t1, c).to, 'Najem (od Kamila)');
});
t('Żadna reguła po opisie nie przeklasyfikuje PRZYCHODU automatem', () => {
  assert.deepStrictEqual(RULES.filter((r) => r.d && r.flow !== 'out' && !RECZNA(r)).map((r) => r.id), []);
  for (const [opis, cel] of [['wypłata ZASP', 'Tantiemy'], ['Alimenty za maj', 'Alimenty'], ['od Kamila', 'Najem (od Kamila)']]) {
    const c = old('Zwrot'), t1 = tx('PRZYCHÓD', c, opis);
    assert.notStrictEqual(ruleFor(t1, c).to, cel, opis);
    assert.strictEqual(kandydat(t1, c).to, cel, opis);
  }
});
t('A20 „Misja Centrum" to kandydat, nie automat', () => {
  const c = old('Prezenty'), t1 = tx('WYDATEK', c, 'Misja Centrum — darowizna');
  assert.strictEqual(ruleFor(t1, c).to, 'Prezenty i wsparcie>Prezenty');
  assert.strictEqual(kandydat(t1, c).to, 'Prezenty i wsparcie>Darowizny');
});
t('Granice słów: „zaspokojenie" ≠ ZASP, „komandant" ≠ mandat, „Citibank" ≠ CIT', () => {
  const z = old('Zwrot'), lex = old('Lexus'), pod = old('Podatek');
  assert.strictEqual(kandydat(tx('PRZYCHÓD', z, 'zaspokojenie roszczenia'), z), null);
  assert.strictEqual(ruleFor(tx('WYDATEK', lex, 'obiad u komandanta'), lex).id, 'A13');
  assert.strictEqual(ruleFor(tx('WYDATEK', lex, 'mandat za parkowanie'), lex).id, 'A11');
  assert.strictEqual(ruleFor(tx('WYDATEK', pod, 'przelew Citibank'), pod).id, 'A22');
});
t('D4 zawężone do RODZINY — „Podatek" w księdze spółki nie idzie w CIT automatem', () => {
  const p = old('Podatek', 2);
  assert.strictEqual(ruleFor(tx('WYDATEK', p, 'CIT 8 za 2025'), p), null);
});
t('D1 bez sl: „PERSEVERA Czynsz" działa w obu księgach (wpisy usera PERSEVERA są już w P)', () => {
  for (const led of [1, 2]) {
    const c = old('PERSEVERA Czynsz', led), r = ruleFor(tx('WYDATEK', c, '', led), c);
    assert.strictEqual(r.to, 'Lokal>Czynsz', 'księga ' + led);
    assert.strictEqual(r.l, 2);
  }
});
t('C3a/CP1: PZU trafia do księgi PERSEVERA (P), nie RODZINA', () => {
  const c = old('PZU', 1);
  const r = ruleFor(tx('PRZYCHÓD', c), c);
  assert.strictEqual(r.to, 'PZU');
  assert.strictEqual(r.l, 2);
});
t('D: wpis PERSEVERA z księgi RODZINA przenosi się do P wraz z kategorią (K5)', () => {
  const c = old('PERSEVERA Czynsz', 1);
  const r = ruleFor(tx('WYDATEK', c, '', 1), c);
  assert.strictEqual(r.to, 'Lokal>Czynsz');
  assert.strictEqual(r.l, 2);
});
t('B: kategorie sekcji B dostają typ TRANSFER (K6)', () => {
  for (const nm of ['Bank Handlowy', 'Santander', 'SM Piast', 'Poduszka', 'Konto inwestycyjne', 'Działka', 'Oszczędności 1']) {
    const c = old(nm);
    assert.strictEqual(ruleFor(tx('WYDATEK', c), c).t, 'TRANSFER', nm);
  }
});
t('B: wpływ w kategorii B to decyzja człowieka, nie automatyczny TRANSFER', () => {
  // Tabela B wymienia kategorie WYDATKOWE. Wpływ w „Poduszka" może być wypłatą z celu, ale
  // w „Działka"/„Bank Handlowy" bywa realnym dochodem (sprzedaż, uruchomienie kredytu) —
  // automat zamieniał go na TRANSFER i dochód znikał z income, balance oraz trend[].
  const c = old('Poduszka');
  assert.strictEqual(ruleFor(tx('PRZYCHÓD', c), c), null);
  const k = kandydat(tx('PRZYCHÓD', c), c);
  assert.strictEqual(k.id, 'B4');
  assert.strictEqual(k.to, 'Cele>Poduszka');
});
t('B8: Inne 2/Inne 3 tylko do archiwum (bez celu)', () => {
  const c = old('Inne 2');
  const r = ruleForCat(c, 'out');
  assert.strictEqual(r.id, 'B8');
  assert.strictEqual(r.to, null);
});
t('A30: wyjazd dostaje tag kontekstu zamiast osobnej gałęzi', () => {
  const c = old('Wakacje > Nocleg');
  assert.strictEqual(ruleFor(tx('WYDATEK', c), c).tag, 'wyjazd');
});
t('Rozdział przepływów: „Dom" jako wydatek ≠ „Dom" jako przychód', () => {
  const c = old('Dom');
  assert.strictEqual(ruleFor(tx('WYDATEK', c), c).to, 'Dom i media');
  assert.strictEqual(ruleFor(tx('PRZYCHÓD', c), c).to, 'Inne przychody');
});
t('Księga źródłowa: „Szkolenia" w RODZINIE to wydatek, w PERSEVERZE przychód spółki', () => {
  const f = old('Szkolenia', 1), p = old('Szkolenia', 2);
  assert.strictEqual(ruleFor(tx('WYDATEK', f), f).id, 'A26');
  assert.strictEqual(ruleFor(tx('PRZYCHÓD', p), p).id, 'CP3');
});
t('Księga źródłowa: reguła RODZINY nie rusza kategorii spółki (sl)', () => {
  const p = byKey.get('2|Samochód>Paliwo');           // ledger 2, nazwa „Paliwo"
  const r = ruleFor(tx('WYDATEK', p), p);
  assert.ok(!r || target(r).id === p.id, 'A9 (sl=RODZINA) nie może złapać kategorii spółki');
});
t('Wpis bez kategorii: wydatek nie jest ruszany, przychód łapie C8', () => {
  assert.strictEqual(ruleFor(tx('WYDATEK', null), null), null);
  assert.strictEqual(ruleFor(tx('PRZYCHÓD', null), null).to, 'Inne przychody');
});

// ---------- bramka księgowa ----------
t('Bramka liczy kubełki księga×typ×kosz, nie sumę globalną', () => {
  const d = new Map();
  przesun(d, kubel(1, 'WYDATEK', null), -1, -grosze('5700.00'));      // wyjście z RODZINY
  przesun(d, kubel(2, 'WYDATEK', null), 1, grosze('5700.00'));        // wejście do PERSEVERY
  assert.deepStrictEqual(d.get('1|WYDATEK|1'), { n: -1, gr: -570000 });
  assert.deepStrictEqual(d.get('2|WYDATEK|1'), { n: 1, gr: 570000 });
  assert.strictEqual([...d.values()].reduce((s, v) => s + v.gr, 0), 0); // suma globalna: 0 — dlatego nie wystarcza
  assert.strictEqual(kubel(1, 'WYDATEK', '2026-07-01 10:00:00'), '1|WYDATEK|0'); // kosz w osobnym kubełku
});

// ---------- spójność tabeli reguł ----------
t('Każdy wiersz tabeli akceptacyjnej ma regułę (A1–A30, B1–B8, C1–C8, CP1–CP4, D1–D4)', () => {
  const maja = new Set(RULES.map((r) => r.id));
  const oczekiwane = [...Array(30)].map((_, i) => 'A' + (i + 1))
    .concat([...Array(8)].map((_, i) => 'B' + (i + 1)))
    .concat([...Array(8)].map((_, i) => 'C' + (i + 1)), ['C3a'])
    .concat([...Array(4)].map((_, i) => 'CP' + (i + 1)))
    .concat([...Array(4)].map((_, i) => 'D' + (i + 1)));
  const brak = oczekiwane.filter((id) => !maja.has(id));
  assert.deepStrictEqual(brak, [], 'brak reguł dla: ' + brak.join(', '));
});
t('Każdy cel reguły istnieje w docelowym drzewie (TREE) właściwej księgi', () => {
  const zle = RULES.filter((r) => r.to && !target(r)).map((r) => `${r.id}→${r.to}(L${r.l})`);
  assert.deepStrictEqual(zle, [], 'cele spoza drzewa: ' + zle.join(', '));
});
t('Regexy opisów są poprawne i nie łapią przypadkiem („Citibank" ≠ CIT 8)', () => {
  for (const r of RULES.filter((x) => x.d)) new RegExp(r.d, 'i');
  const c = old('Podatek');
  assert.strictEqual(ruleFor(tx('WYDATEK', c, 'przelew Citibank'), c).id, 'A22');
  assert.strictEqual(ruleFor(tx('WYDATEK', c, 'CIT 8'), c).id, 'D4');
});

// Scenariusze z odrzuconych przebiegów, rozdzielone „Inne" (Z5/K1), brak UPDATE na
// transakcjach (K2), propozycje i ich idempotencja (K4), przyjęcie z bramką kwotową (K7),
// walidacja celu w retarget (K8) i arytmetyka „Konta Bartusia" siedzą w pliku obok — ten
// dobił do limitu 300 linii z preflighta. Wołane tutaj, tym samym licznikiem błędów, więc
// `npm test` zostaje bez zmian w package.json. Część testów jest asynchroniczna (atrapa puli
// połączeń), dlatego podsumowanie czeka na obietnicę zwróconą przez tamten plik.
require('./test-reorganize-scen')({ t, old, tx, target, cats }).then(() => {
  if (failures) { console.error(`\n${failures} test(ów) NIE przeszło`); process.exit(1); }
  console.log('\nWszystkie testy taksonomii przeszły.');
}).catch((e) => { console.error('FAIL harness testów scenariuszowych —', e.message); process.exit(1); });
