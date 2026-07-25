// Taksonomia kategorii — CZYSTA część reorganizacji: docelowe drzewa, tabela reguł
// (A1–A30, B1–B8, C1–C8, CP1–CP4, D1–D4 wg docs/KATEGORIE-ZMIANY-DO-AKCEPTACJI.md)
// oraz dopasowanie starej kategorii/wpisu do reguły. Zero SQL: całość testuje się bez
// bazy (scripts/test-reorganize.js), a wykonawca (scripts/reorganize-categories.js)
// mieści się dzięki temu w limicie 300 linii z preflighta.
const F = 1, P = 2; // księgi: RODZINA, PERSEVERA

// Docelowe drzewa. Korzeń o nazwie już istniejącej w bazie jest PONOWNIE UŻYWANY, nie
// duplikowany — unikat uq_cat2 (ledger, parent_key, name) z 002 jest null-safe.
const TREE = {
  [F]: {
    'Spożywcze': [], // dzieci (Pieczywo, Owoce…) wędrują 1:1 ze starych korzeni — A1
    'Jedzenie na mieście': ['Restauracja', 'Fastfood', 'Kawa', 'Cukiernia/Lody', 'Bar mleczny'],
    'Dom i media': ['Czynsz', 'Prąd', 'Gaz', 'Woda', 'Internet', 'Telefony', 'Pranie/Chemia', 'Wyposażenie/Remonty'],
    'Zakupy osobiste': ['Odzież nowa', 'Odzież używana', 'Odzież elegancka', 'Obuwie', 'Bielizna', 'Akcesoria', 'Książki', 'Opakowania', 'Kosmetyki'],
    'Transport': ['Paliwo', 'Bilety', 'Serwis/Naprawy', 'Ubezpieczenie auta', 'Parkingi/Mandaty'],
    'Zdrowie': ['Lekarz/Badania', 'Leki', 'Basen/Sport'],
    'Bartuś': ['Kieszonkowe', 'Zajęcia/Szkoła', 'Bilety', 'Inne'],
    'Kultura i rozrywka': ['Kino', 'Wydarzenia', 'Uroczystości/Imprezy', 'Subskrypcje', 'Wyjazdy'],
    'Prezenty i wsparcie': ['Prezenty', 'Darowizny'],
    'Zwierzęta': ['Karma', 'Weterynarz'],
    'Opłaty i urzędy': ['Podatki', 'Opłaty urzędowe', 'Poczta/Dostawa', 'Ubezpieczenie na życie', 'Szkolenia'],
    'Najem (pass-through)': ['Czynsz do Darka'],
    'Spłaty': ['Kredyt Bank Handlowy', 'Raty Santander', 'SM Piast'],   // TRANSFER
    'Cele': ['Poduszka', 'Konto inwestycyjne', 'Działka', 'Oszczędności'], // TRANSFER
    'Film': [], 'Tantiemy': [], 'Zwroty': [], 'Alimenty': [], '800+': [], // przychody (C1–C8);
    'PERSEVERA (wypłaty)': [], 'Najem (od Kamila)': [],
    // K1: „Inne" ROZDZIELONE na wydatkowe i przychodowe. Kategoria w schemacie nie ma typu,
    // a unikat nie dopuszcza dwóch korzeni o tej samej nazwie w jednej księdze — rozróżnienie
    // idzie więc przez nazwę: A29 (wydatki) → „Inne", C8/CP4 (przychody) → „Inne przychody".
    'Inne': [], 'Inne przychody': [],
  },
  [P]: {
    'Lokal': ['Czynsz', 'Woda', 'Ogrzewanie', 'Prąd'],
    'Samochód': ['Paliwo', 'Serwis/Naprawy', 'Ubezpieczenie'],
    'Działalność': ['Telefony', 'Hotele/Delegacje', 'Remonty', 'Usługi obce'],
    'Podatki i opłaty': ['CIT', 'ZUS', 'Księgowość'],
    // przychody spółki (CP1–CP4) + „Inne" wydatkowe: rozdział jak w księdze rodziny (K1)
    'PZU': [], 'Agencja': [], 'Szkolenia': [], 'Inne': [], 'Inne przychody': [],
  },
};

// Reguła: id wiersza tabeli · flow (in=PRZYCHÓD, out=WYDATEK/TRANSFER, any=oba) · stare nazwy
// (nazwa liścia LUB ścieżka „Rodzic > Dziecko"; „X > *" = poddrzewo; „*" = dowolna) · cel
// „Korzeń>Dziecko" · opcje {l:księga celu, sl:księga źródła, t:typ, d:regex opisu, tag,
// m:ręczna, pr:pierwszeństwo}. Kolejność w tabeli = kolejność raportu, pierwszeństwo
// dopasowania liczy PRIO. `d` (po OPISIE) na PRZYCHODACH jest ZAWSZE ręczne — patrz RECZNA.
const R = (id, flow, from, to, o = {}) => ({ id, flow, from: [].concat(from), to, l: o.l || F, ...o });
// Reguła D: kategoria spółki, w obu kształtach nazwy, z pierwszeństwem przed regułami rodziny.
const D = (id, nazwy, to) => R(id, 'out', [].concat(nazwy).flatMap((n) => ['PERSEVERA ' + n, 'PERSEVERA > ' + n]),
  to, { l: P, pr: 0.5 });
const RULES = [
  R('A1', 'out', ['Zakupy spożywcze', 'Zakupy spożywcze i domowe', 'Zakupy spożywcze i drogeryjne', 'Jedzenie > Zakupy spożywcze', 'Produkty spożywcze', 'Warzywa i owoce'], 'Spożywcze', { sl: F }),
  R('A2', 'out', ['Jedzenie na mieście > Beskid', 'Gastronomia > Beskid', 'Beskid'], 'Jedzenie na mieście>Restauracja', { sl: F }),
  R('A2', 'out', ['Jedzenie na mieście', 'Gastronomia', 'Jedzenie'], 'Jedzenie na mieście', { sl: F }),
  ...['Czynsz', 'Prąd', 'Gaz'].map((n) => R('A3', 'out', '1000 ' + n, 'Dom i media>' + n, { sl: F })),
  R('A4', 'out', 'Internet', 'Dom i media>Internet', { sl: F }),
  R('A5', 'out', ['Rachunek za telefon', 'Telefony'], 'Dom i media>Telefony', { sl: F }),
  R('A6', 'out', ['Dom > Pranie', 'Pranie'], 'Dom i media>Pranie/Chemia', { sl: F }),
  R('A6', 'out', ['Dom > Lekarstwa', 'Lekarstwa'], 'Zdrowie>Leki', { sl: F }),
  R('A6', 'out', 'Dom', 'Dom i media', { sl: F }),
  R('A7', 'out', ['Zakupy', 'Odzież i obuwie'], 'Zakupy osobiste', { sl: F }),
  R('A8', 'out', ['Kosmetyki > Włosy', 'Kosmetyki', 'Włosy'], 'Zakupy osobiste>Kosmetyki', { sl: F }),
  R('A9', 'out', 'Paliwo', 'Transport>Paliwo', { sl: F }),
  R('A10', 'out', 'Komunikacja', 'Transport>Bilety', { sl: F }),
  R('A11', 'out', ['Lexus', 'Mandaty'], 'Transport>Parkingi/Mandaty', { sl: F, d: '\\bufg\\b|\\bmandat' }), // §7.2
  R('A11', 'out', 'Mandaty', 'Transport>Parkingi/Mandaty', { sl: F }),
  R('A12', 'out', 'Ubezpieczenie samochodu', 'Transport>Ubezpieczenie auta', { sl: F }),
  R('A13', 'out', 'Lexus', 'Transport>Serwis/Naprawy', { sl: F }),
  R('A14', 'out', ['Zdrowie', 'Opieka medyczna', 'Zdrowie/Opieka medyczna'], 'Zdrowie', { sl: F }),
  R('A15', 'out', ['Karnety na siłownię', 'Siłownia'], 'Zdrowie>Basen/Sport', { sl: F }),
  R('A16', 'out', ['Bartuś > bilet autobusowy', 'Bartuś > bioet autobusowy', 'bilet autobusowy', 'bioet autobusowy'], 'Bartuś>Bilety', { sl: F }),
  R('A16', 'out', ['Bartuś zajęcia/szkoła', 'Bartuś > zajęcia/szkoła', 'Bartuś > Zajęcia'], 'Bartuś>Zajęcia/Szkoła', { sl: F }),
  R('A16', 'out', ['Bartuś > Kieszonkowe', 'Kieszonkowe'], 'Bartuś>Kieszonkowe', { sl: F }),
  R('A16', 'out', 'Bartuś', 'Bartuś', { sl: F }),
  R('A17', 'out', ['Kultura > Kino', 'Kino'], 'Kultura i rozrywka>Kino', { sl: F }),
  R('A17', 'out', 'Kultura', 'Kultura i rozrywka', { sl: F }),
  R('A18', 'out', 'Subskrypcje', 'Kultura i rozrywka>Subskrypcje', { sl: F }),
  R('A19', 'out', 'Inne 1', 'Kultura i rozrywka>Uroczystości/Imprezy', { sl: F }), // §7.4
  // A20: „Misja Centrum" to JEDEN wpis i decyzja człowieka (tabela: „1 wpis, ręcznie") —
  // skrypt tylko wypisuje kandydata, nie przepina.
  R('A20', 'out', ['Prezenty', 'Darowizny'], 'Prezenty i wsparcie>Darowizny', { sl: F, d: 'misja centrum', m: 1 }),
  R('A20', 'out', 'Prezenty', 'Prezenty i wsparcie>Prezenty', { sl: F }),
  R('A21', 'out', ['Zwierzęta > Karma', 'Karma', 'Artykuły dla zwierząt > Karma dla psa', 'Karma dla psa'], 'Zwierzęta>Karma', { sl: F }),
  R('A21', 'out', ['Zwierzęta', 'Artykuły dla zwierząt'], 'Zwierzęta', { sl: F }),
  R('A22', 'out', ['Podatek', 'Podatki'], 'Opłaty i urzędy>Podatki', { sl: F }),
  R('A23', 'out', ['Urzędowe', 'Ursędowe'], 'Opłaty i urzędy>Opłaty urzędowe', { sl: F }),
  R('A24', 'out', 'Poczta/Dostawa', 'Opłaty i urzędy>Poczta/Dostawa', { sl: F }),
  R('A25', 'out', ['Ubezpieczenie na życie > Podróż'], 'Opłaty i urzędy>Ubezpieczenie na życie', { sl: F, tag: 'wyjazd' }),
  R('A25', 'out', 'Ubezpieczenie na życie', 'Opłaty i urzędy>Ubezpieczenie na życie', { sl: F }),
  R('A26', 'out', 'Szkolenia', 'Opłaty i urzędy>Szkolenia', { sl: F }),
  R('A27', 'out', ['Remonty/Naprawy', 'Remonty i naprawy', 'Remonty'], 'Dom i media>Wyposażenie/Remonty', { sl: F }),
  R('A28', 'out', 'Darek Toczek', 'Najem (pass-through)>Czynsz do Darka', { sl: F }), // §7.3
  R('A29', 'out', 'Dodatkowe', 'Inne', { sl: F }),
  R('A30', 'out', ['Wakacje > *', 'Wakacje'], 'Kultura i rozrywka>Wyjazdy', { sl: F, tag: 'wyjazd' }), // §7.1
  // B: automatem WYŁĄCZNIE wypływy. Tabela B wymienia kategorie WYDATKOWE, a wpływ w takiej
  // kategorii to nie musi być wypłata z celu — może być sprzedaż działki albo uruchomienie
  // kredytu w „Bank Handlowy", czyli realny dochód. Zamiana takiego wpisu na TRANSFER
  // wycinała go z income, balance i trend[], zostawiając jedną zbiorczą linię ruchu.
  // Dlatego wpływy w tych kategoriach mają bliźniaczą regułę RĘCZNĄ (`m`): na listę, nie automatem.
  ...[['B1', 'Bank Handlowy', 'Spłaty>Kredyt Bank Handlowy'],
    ['B2', 'Santander', 'Spłaty>Raty Santander'],
    ['B3', 'SM Piast', 'Spłaty>SM Piast'],
    ['B4', 'Poduszka', 'Cele>Poduszka'],
    ['B5', 'Konto inwestycyjne', 'Cele>Konto inwestycyjne'],
    ['B6', 'Działka', 'Cele>Działka'],
    ['B7', ['Oszczędności 1', 'Oszczędności 2', 'Oszczędności 3', 'Oszczędności'], 'Cele>Oszczędności'],
  ].flatMap(([id, from, to]) => [R(id, 'out', from, to, { sl: F, t: 'TRANSFER' }),
    R(id, 'in', from, to, { sl: F, t: 'TRANSFER', m: 1 })]),
  R('B8', 'any', ['Inne 2', 'Inne 3'], null, { sl: F }), // tylko archiwizacja (active=0), o ile puste
  R('C1', 'in', 'Film', 'Film', { sl: F }),
  R('C2', 'in', '*', 'Tantiemy', { sl: F, d: '\\bzasp\\b|\\btantiem' }),   // po opisie = ręcznie
  R('C2', 'in', ['Tantiemy', 'ZASP'], 'Tantiemy', { sl: F }),
  R('C3', 'in', ['Zwrot', 'Zwroty'], 'Zwroty', { sl: F }),
  R('C3a', 'in', 'PZU', 'PZU', { sl: F, l: P }),                    // → księga PERSEVERA (CP1)
  R('C4', 'in', '*', 'Alimenty', { sl: F, d: '\\baliment' }),       // po opisie = ręcznie
  R('C4', 'in', 'Alimenty', 'Alimenty', { sl: F }),
  R('C5', 'in', ['800+', '800 +'], '800+', { sl: F }),
  R('C6', 'in', ['Dodatkowe > PERSEVERA', 'Dodatkowe', 'PERSEVERA', 'PERSEVERA (wypłaty)'], 'PERSEVERA (wypłaty)', { sl: F }),
  R('C7', 'in', '*', 'Najem (od Kamila)', { sl: F, d: '\\bkamil' }), // §7.3 — po opisie = ręcznie
  R('C7', 'in', 'Najem (od Kamila)', 'Najem (od Kamila)', { sl: F }),
  R('C8', 'in', '*', 'Inne przychody', { sl: F }),                  // sieroty przychodowe (K1)
  R('CP1', 'in', 'PZU', 'PZU', { sl: P, l: P }),
  R('CP2', 'in', 'Agencja', 'Agencja', { sl: P, l: P }),
  R('CP3', 'in', 'Szkolenia', 'Szkolenia', { sl: P, l: P }),
  R('CP4', 'in', '*', 'Inne przychody', { sl: P, l: P }),           // K1
  // D1–D3 celowo BEZ `sl`: nazwa „PERSEVERA *" jest jednoznaczna i te same kategorie mogą
  // wisieć zarówno w RODZINIE (wpisy Szymona), jak i w księdze spółki (wpisy usera PERSEVERA).
  // Każda występuje w dwóch kształtach: korzeń „PERSEVERA Telefony" i gałąź „PERSEVERA > Telefony"
  // (prefiks robił za drzewo, P5). `pr: 0.5` daje im pierwszeństwo przed regułami nazwowymi
  // rodziny — przy równym PRIO wygrywała kolejność w tabeli, czyli A5 („Telefony"), i koszt
  // spółki zostawał w księdze 1, a raport pokazywał „D3 … BRAK".
  ...['Czynsz', 'Woda', 'Ogrzewanie', 'Prąd'].map((n) => D('D1', n, 'Lokal>' + n)),
  D('D2', 'Paliwo', 'Samochód>Paliwo'),
  D('D2', ['Samochód', 'Auto'], 'Samochód>Serwis/Naprawy'),
  D('D3', ['Telefony', 'Telefon'], 'Działalność>Telefony'),
  D('D3', ['Hotele', 'Delegacje'], 'Działalność>Hotele/Delegacje'),
  D('D3', ['Remonty-Naprawy', 'Remonty/Naprawy', 'Remonty'], 'Działalność>Remonty'),
  // D4: „Podatek" z opisem „CIT 8" — wpis Anny w księdze RODZINA (sl: F). Bez zawężenia
  // księgi reguła sięgałaby też po kategorie spółki, których dotyczy zupełnie co innego.
  R('D4', 'out', ['Podatek', 'Podatki'], 'Podatki i opłaty>CIT', { sl: F, l: P, d: '\\bcit\\b' }),
];

// --- czyste funkcje (testowane w scripts/test-reorganize.js) ---
// zwin: jedna spacja wokół „>", bez podwójnych spacji i spacji brzegowych. Tego napisu
// (a nie surowego z bazy) używamy jako klucza w category_map — przy odczycie nikt nie
// wyprodukuje „Zakupy spożywcze  > Pieczywo" z dwiema spacjami.
const zwin = (s) => String(s == null ? '' : s).replace(/\s*>\s*/g, ' > ').replace(/\s+/g, ' ').trim();
const norm = (s) => zwin(s).toLowerCase();
const pathOf = (c, byId) => (c.parent_id && byId.get(c.parent_id) ? byId.get(c.parent_id).name + ' > ' + c.name : c.name);
// Data MUSI być napisem 'RRRR-MM-DD' (db.js ma dateStrings: true). Obiekt Date z lokalnej
// północy po toISOString() cofa się o dobę przy Europe/Warsaw i wpis z 1 lipca dostałby
// tag „wyjazd-2026-06" — na stałe, w bazie. Zamiast zgadywać: przerywamy (rollback).
const monthTag = (d) => {
  const s = String(d == null ? '' : d);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) throw new Error(`tag wyjazdu: data „${s}" nie jest napisem RRRR-MM-DD (połączenie bez dateStrings?)`);
  return 'wyjazd-' + s.slice(0, 7);
};

// Czy stara nazwa `f` opisuje kategorię `cat` ({name, path})?
function hits(f, cat) {
  const nf = norm(f);
  if (nf === '*') return true;
  if (nf.endsWith(' > *')) { const pre = nf.slice(0, -4); return norm(cat.path).startsWith(pre + ' > ') || norm(cat.name) === pre; }
  return nf === norm(cat.path) || nf === norm(cat.name);
}
// Pierwszeństwo: reguły z warunkiem opisu > jawne `pr` (reguły D) > konkretne nazwy >
// poddrzewa > łapacz „*". Bez `pr` decydowała kolejność w tabeli i A5 wygrywała z D3.
const PRIO = (r) => (r.d ? 0 : r.pr != null ? r.pr : r.from[0] === '*' ? 3 : r.from.some((f) => norm(f).endsWith(' > *')) ? 2 : 1);
const ORDERED = RULES.map((r, i) => [r, i]).sort((a, b) => PRIO(a[0]) - PRIO(b[0]) || a[1] - b[1]).map((x) => x[0]);

// Reguła RĘCZNA = kandydat do raportu, nigdy automatyczny UPDATE. Taka jest każda reguła
// dopasowująca po OPISIE na PRZYCHODZIE: „przelew od Kamila Nowak za bilety" to nie jest
// czynsz od najemcy, a opis bije reguły nazwowe (PRIO 0). Cudzych pieniędzy nie przenosi
// się automatem po jednym słowie — człowiek rozstrzyga w UI. Plus jawne `m` (A20).
const RECZNA = (r) => !!r.m || (!!r.d && r.flow !== 'out');

// Przepływ wpisu. TRANSFER idzie ścieżką wypływu (spłata to nie dochód), ale reguł po
// OPISIE nie dotyczy — patrz dopasuj().
const flowOf = (tx) => (tx.type === 'PRZYCHÓD' ? 'in' : 'out');
// Czy kategoria leży JUŻ w docelowym drzewie: korzeń z TREE albo cokolwiek pod nim (także
// dziecko przeniesione 1:1, którego TREE nie wymienia, np. „Spożywcze > Pieczywo")?
function wDrzewie(cat) {
  if (!cat) return false;
  const korzen = norm(zwin(cat.path || cat.name).split(' > ')[0]);
  return Object.keys(TREE[cat.ledger_id] || {}).some((k) => norm(k) === korzen);
}
// Sierota (dla łapaczy C8/CP4) = wpis, którego kategoria nie ma własnej reguły dla JEGO
// przepływu i nie leży już w docelowym drzewie. Bez tego warunku C8 przy KAŻDYM przebiegu
// wymiatał przychody z „Bartuś > *" i innych kategorii docelowych do korzenia „Inne".
// Reguła wydatkowa nie czyni sierotą przychodu (tabela C8 wprost wymienia „PRZYCHÓD|Dom"
// i „PRZYCHÓD|Wakacje > Podróż" — kategorie z regułami A6/A30): liczy się przepływ.
const sierota = (cat, flow) => !cat || (!wDrzewie(cat) && !ruleForCat(cat, flow, true));

// Wspólne dopasowanie wpisu do reguły; `reczne` wybiera warstwę (automat vs kandydaci).
function dopasuj(tx, cat, reczne) {
  const flow = flowOf(tx);
  for (const r of ORDERED) {
    if (RECZNA(r) !== reczne) continue;
    if (r.flow !== 'any' && r.flow !== flow) continue;
    // Reguła po opisie nie ma prawa dotknąć TRANSFERU: słowo „mandat" w tytule spłaty nie
    // robi z niej wydatku na parkingi. Dziś nieosiągalne (typ TRANSFER nadaje dopiero ten
    // skrypt), ale kolejny przebieg pracuje już na bazie z transferami.
    if (r.d && (tx.type === 'TRANSFER' || !new RegExp(r.d, 'i').test(tx.description || ''))) continue;
    const wild = r.from[0] === '*';
    if (r.sl && r.sl !== (wild || !cat ? tx.ledger_id : cat.ledger_id)) continue;
    if (wild) { if (!r.d && !sierota(cat, flow)) continue; return r; }
    if (cat && r.from.some((f) => hits(f, cat))) return r;
  }
  return null;
}
const ruleFor = (tx, cat) => dopasuj(tx, cat, false);      // co skrypt zrobi sam
const kandydat = (tx, cat) => dopasuj(tx, cat, true);      // co tylko zaproponuje
// Reguła dla samej kategorii (bez opisu) — do archiwizacji, category_map i dziedziczenia
// dzieci. `zReczna` włącza reguły ręczne: do PLANU nie wchodzą (decyduje człowiek), ale
// kategoria z regułą ręczną nie jest sierotą, więc do sierota() już tak.
const ruleForCat = (cat, flow, zReczna) => ORDERED.find((r) => (r.flow === flow || r.flow === 'any')
  && (zReczna || !RECZNA(r)) && !r.d && r.from[0] !== '*'
  && (!r.sl || r.sl === cat.ledger_id) && r.from.some((f) => hits(f, cat))) || null;
// Warianty planu dla samej kategorii — OSOBNO dla wypływów i wpływów. Wpis dziedziczy
// przenosiny kategorii wyłącznie wariantem swojego przepływu: „PZU" ma tylko wariant
// przychodowy (C3a, księga P), więc WYDATEK w tej kategorii nie ma czego dziedziczyć —
// inaczej składka OC wędrowała do księgi spółki, na kategorię ŹRÓDŁA PRZYCHODU.
const planKategorii = (cat) => ['out', 'in'].map((flow) => { const r = ruleForCat(cat, flow); return r ? { flow, r } : null; }).filter(Boolean);
// Czy reguła wskazuje kategorię, w której wpis już leży (nie ma czego rozstrzygać)?
const celem = (r, cat) => !!cat && !!r.to && r.l === cat.ledger_id && norm(r.to) === norm(cat.path || cat.name);

// JEDNO miejsce decyzji o wpisie — wspólne dla wykonawcy i testów. Po decyzji Szymona
// (2026-07-24) ŻADEN tryb nie przepina transakcji: oba kończą się propozycją w
// `category_proposals`, a przydział wybiera człowiek w karcie „Przydział".
//  • 'reczna' — podstawą jest OPIS wpisu (albo jawne `m`), więc propozycja jest słabiej
//    umocowana i raport wypisuje ją osobno (dawniej: „lista do rozstrzygnięcia");
//  • 'automat' — reguła nazwowa (dziedziczona = plan kategorii, nie własna reguła wpisu);
//  • null — żadna reguła nie dotyczy tego przepływu: wpis nie dostaje propozycji (K5).
function decyzja(tx, cat, warianty) {
  const k = kandydat(tx, cat);
  if (k && k.to && !celem(k, cat)) return { tryb: 'reczna', r: k };
  const r = ruleFor(tx, cat);
  if (r) return { tryb: 'automat', r };
  const v = (warianty || []).find((x) => x.flow === flowOf(tx));
  return v ? { tryb: 'automat', r: v.r, dst: v.dst, dziedziczony: true } : null;
}

// Wiersz propozycji dla wpisu — CZYSTA zamiana decyzji na rekord `category_proposals`.
// `cel(to, ledger)` podaje kategorię docelową ({id, ledger_id}): w skrypcie z bazy, w testach
// z syntetycznego drzewa. `istniejace` to zbiór kluczy „txId|catId" propozycji, które już są
// w tabeli — także ODRZUCONYCH, bo decyzja „nie" jest trwała (K4).
// Zwraca: null (brak reguły dla przepływu) · {nic:true} (nie ma czego proponować — wpis leży
// już w celu albo reguła nie ma celu, np. B8) · {jest:true, …} (taka propozycja już istnieje)
// · wiersz do zapisu. Kwoty i daty nie występują — propozycja ich nie dotyka.
function propozycja(tx, cat, warianty, cel, istniejace) {
  const d = decyzja(tx, cat, warianty);
  if (!d) return null;
  const dst = d.dst || (d.r.to ? cel(d.r.to, d.r.l) : null);
  if (!dst) return { nic: true, r: d.r };
  const led = dst.ledger_id !== tx.ledger_id ? dst.ledger_id : null;   // null = bez zmiany księgi
  const typ = d.r.t && d.r.t !== tx.type ? d.r.t : null;               // null = bez zmiany typu
  const tg = d.r.tag ? monthTag(tx.tx_date) : null;
  const tag = tg != null && tg !== tx.tag ? tg : null;
  if (dst.id === tx.category_id && led == null && typ == null && tag == null) return { nic: true, r: d.r };
  const row = { transaction_id: tx.id, from_category_id: tx.category_id || null, to_category_id: dst.id,
    to_ledger_id: led, to_type: typ, tag, rule_id: d.r.id, tryb: d.tryb, r: d.r };
  return istniejace && istniejace.has(`${tx.id}|${dst.id}`) ? { ...row, jest: true } : row;
}

// --- bramka księgowa: kubełki księga × typ × (żywe/kosz) ---
// Globalna suma `deleted_at IS NULL` niczego nie pilnuje: przeniesienie 5 700 zł z RODZINY
// do PERSEVERY ani zmiana typu na TRANSFER jej nie ruszają. Dopiero rozbicie na kubełki
// pokazuje ruch — a oczekiwany ruch liczymy z planu i porównujemy z faktem.
const grosze = (a) => Math.round(Number(a) * 100);
const zlot = (gr) => (gr / 100).toFixed(2);
const kubel = (led, typ, usuniety) => `${led}|${typ}|${usuniety ? 0 : 1}`;
const przesun = (m, k, n, gr) => { const v = m.get(k) || { n: 0, gr: 0 }; m.set(k, { n: v.n + n, gr: v.gr + gr }); };

module.exports = { F, P, TREE, RULES, ORDERED, zwin, norm, pathOf, monthTag, hits, ruleFor, kandydat, ruleForCat,
  RECZNA, PRIO, flowOf, wDrzewie, sierota, planKategorii, celem, decyzja, propozycja,
  grosze, zlot, kubel, przesun };
