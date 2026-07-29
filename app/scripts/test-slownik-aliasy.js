#!/usr/bin/env node
// Testy warstwy słownika podpowiedzi (src/ocr/slownik.js) + pętli uczenia (src/ocr/produkt-baza.js)
// na PODSTAWIONEJ bazie — wzorzec z test-produkt-baza.js.
//
// Czego te testy NIE dowodzą: że SQL jest poprawny dla MySQL-a (bez serwera się nie da).
// Czego dowodzą: że po spłacie długu (Z7, plan pkt 9) podpowiedź czyta się WYŁĄCZNIE z
// product_aliases/products (alias globalny wygrywa, w jego braku — najwyższy hits, przy
// remisie najnowszy), że kategoria/produkt nieaktywny są odcinane na poziomie zapytania, że
// PĘTLA UCZENIA się zamyka (korekta w sklepie dopisuje też alias globalny), że nauka NIE dotyka
// już item_dict ani żadnej innej tabeli poza product_aliases/products, i że kształt zwrotki
// jest identyczny jak przy starym item_dict.
const path = require('path');
const Module = require('module');

let bledy = 0;
let asercje = 0;
function ok(warunek, opis) {
  asercje++;
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}
const rowne = (a, b, opis) => ok(JSON.stringify(a) === JSON.stringify(b), `${opis} → ${JSON.stringify(a)}`);

// --- podstawiona baza: zapamiętuje zapytania, oddaje przygotowane odpowiedzi ---
// `wszystkie` NIGDY nie jest czyszczone — to jedyny uczciwy sposób sprawdzenia „w CAŁEJ sesji
// testowej ani jedno zapytanie nie dotknęło item_dict": asercja licząca tylko to, co zostało w
// `zapytania` PO ostatnim zeruj(), sprawdzałaby najczęściej pustą tablicę — czysta tautologia.
const baza = { zapytania: [], wszystkie: [], odpowiedzi: [] };
const q = async (sql, par) => {
  const wpis = { sql: sql.replace(/\s+/g, ' ').trim(), par };
  baza.zapytania.push(wpis);
  baza.wszystkie.push(wpis);
  const gotowa = baza.odpowiedzi.shift();
  if (gotowa !== undefined) return gotowa;
  return /^\s*INSERT/i.test(sql) ? { insertId: 100 } : [];
};
require.cache[require.resolve('../src/db')] = new Module(require.resolve('../src/db'));
require.cache[require.resolve('../src/db')].exports = { q, pool: null };
require.cache[require.resolve('../src/db')].loaded = true;

const s = require('../src/ocr/slownik');
const pb = require('../src/ocr/produkt-baza');
const zeruj = (...odp) => { baza.zapytania = []; baza.odpowiedzi = odp; };
const ostatnie = () => baza.zapytania[baza.zapytania.length - 1];

(async () => {
  // ---------- suggestFromDict ----------

  // alias globalny — jedyny wiersz, jak zwróciłby go `... LIMIT 1` z prawdziwej bazy
  zeruj([{ code_norm: 'CHL TOST 500G', hits: 12, name: 'chleb tostowy', unit: 'szt.',
    category_id: 3, category_name: 'Pieczywo' }]);
  const s1 = await s.suggestFromDict('Chl Tost 500g', 7);
  rowne(s1, { name: 'chleb tostowy', unit: 'szt.', category_id: 3, category_name: 'Pieczywo', hits: 12 },
    'podpowiedź z aliasu globalnego');
  rowne(Object.keys(s1).sort(), ['category_id', 'category_name', 'hits', 'name', 'unit'].sort(),
    'kształt zwrotki identyczny ze starym (te same klucze)');
  ok(/code_norm = :cn/.test(ostatnie().sql) && /LIMIT 1/.test(ostatnie().sql), 'zapytanie po code_norm, jeden wiersz');
  rowne(ostatnie().par.cn, 'CHL TOST 500G', 'kod znormalizowany przed zapytaniem');
  ok(/a\.shop = '\*' DESC/.test(ostatnie().sql) && /a\.hits DESC/.test(ostatnie().sql),
    'sortowanie: globalny przed sklepowym, potem najwyższy hits — fallback w jednym zapytaniu');
  ok(/a\.id DESC/.test(ostatnie().sql), 'przy remisie hits wygrywa najnowsza decyzja (a.id DESC, P5)');
  ok(/p\.active = 1/.test(ostatnie().sql), 'podpowiedź nie wskrzesza wyłączonego produktu (p.active = 1)');

  // fallback: brak aliasu globalnego — DB (symulowana) zwróciłaby sklepowy z najwyższym hits
  zeruj([{ code_norm: 'SER GOUDA', hits: 8, name: 'ser gouda plastry', unit: 'opak.',
    category_id: null, category_name: null }]);
  const s2 = await s.suggestFromDict('SER GOUDA', 7);
  rowne(s2.name, 'ser gouda plastry', 'fallback na alias sklepowy z najwyższym hits (brak globalnego)');

  // kategoria z obcej księgi / nieaktywna: zapytanie musi filtrować po księdze i aktywności —
  // to właśnie odcina kategorię, gdy c.id wychodzi z LEFT JOIN-a jako NULL (inna księga/nieaktywna).
  ok(/c\.active = 1/.test(ostatnie().sql), 'zapytanie odcina kategorie nieaktywne (c.active = 1)');
  ok(/c\.ledger_id = :l/.test(ostatnie().sql), 'zapytanie odcina kategorie z cudzej księgi (c.ledger_id = :l)');
  rowne(ostatnie().par.l, 7, 'księga paragonu przekazana do filtra kategorii');

  // kategoria odcięta faktycznie: DB (symulowana) zwraca category_id = NULL, gdy JOIN nie trafił
  zeruj([{ code_norm: 'MLEKO 1L', hits: 4, name: 'mleko 1l', unit: 'szt.',
    category_id: null, category_name: null }]);
  const s3 = await s.suggestFromDict('MLEKO 1L', 7);
  rowne(s3.category_id, null, 'kategoria z obcej/nieaktywnej księgi odcięta — null w zwrotce');

  // brak aliasu w ogóle → null
  zeruj([]);
  rowne(await s.suggestFromDict('NIEZNANY KOD', 7), null, 'zwrotka null przy braku dopasowania');

  // kod zbyt krótki/pusty → null, zero zapytań (nie ma czego szukać)
  zeruj();
  rowne(await s.suggestFromDict('a', 7), null, 'kod jednoznakowy odrzucony przed zapytaniem');
  rowne(baza.zapytania.length, 0, 'naprawdę zero zapytań');

  // ---------- withSuggestions (paragon jako całość) ----------

  zeruj([
    { code_norm: 'CHL TOST 500G', hits: 12, name: 'chleb tostowy', unit: 'szt.', category_id: 3, category_name: 'Pieczywo' },
    { code_norm: 'MLEKO 1L', hits: 5, name: 'mleko 1l', unit: 'szt.', category_id: null, category_name: null },
  ]);
  const wynik = await s.withSuggestions(
    [{ code: 'Chl Tost 500g' }, { code: 'Mleko 1l' }, { code: 'Nowy Towar Xyz' }], 7);
  rowne(wynik[0].suggestion && wynik[0].suggestion.name, 'chleb tostowy', 'podpowiedź trafiła do właściwej pozycji (1/3)');
  rowne(wynik[1].suggestion && wynik[1].suggestion.name, 'mleko 1l', 'podpowiedź trafiła do właściwej pozycji (2/3)');
  rowne(wynik[2].suggestion, null, 'brak dopasowania → suggestion null, nie wywala się');
  ok(/a\.id DESC/.test(ostatnie().sql), 'zapytanie zbiorcze też ma tie-breaker a.id DESC (P5)');

  zeruj();
  rowne((await s.withSuggestions([{ code: 'x' }, { code: '' }], 7)).map((it) => it.suggestion), [null, null],
    'kody zbyt krótkie/puste odpadają przed zapytaniem');
  rowne(baza.zapytania.length, 0, 'brak sensownych kluczy = zero zapytań do bazy');

  // ---------- learnItem: CZYSTA WALIDACJA (nie jest to samo, co pozycje.js#ucz — ucz() woła
  // learnItem jako jeden ze swoich kroków, ale zapis wykonuje WYŁĄCZNIE zapamietaj() poniżej) ----------

  zeruj();
  rowne(s.learnItem({ code: 'CHL TOST 500G', name: 'chleb tostowy' }), true,
    'learnItem: poprawne dane uznane za „jest z czego się uczyć"');
  rowne(baza.zapytania.length, 0, 'learnItem NIE wykonuje żadnego zapytania (czysta walidacja, zero zapisu)');

  rowne(s.learnItem({ code: 'a', name: 'coś' }), false, 'learnItem: kod jednoznakowy — odmowa');
  rowne(s.learnItem({ code: 'CHL TOST', name: '   ' }), false, 'learnItem: pusta nazwa — odmowa');
  rowne(baza.zapytania.length, 0, 'żadna z odmów learnItem nie dotknęła bazy');

  // ---------- pętla uczenia: zapamietaj() (produkt-baza.js) upsertuje TAKŻE alias globalny ----------

  // nowy produkt, korekta w konkretnym sklepie → oczekujemy DRUGIEGO insertu na alias '*',
  // inaczej suggestFromDict (globalny-first) wracałby ze starą podpowiedzią w nieskończoność (P0).
  zeruj([], { insertId: 200 });
  await pb.zapamietaj({ sklep: 'Biedronka', kod: 'NOWY KOD X', nazwa: 'Nowy produkt testowy' });
  const globalUpsert = baza.zapytania.find((z) => /VALUES \(:p, '\*', :cn/.test(z.sql));
  ok(!!globalUpsert, 'zapamietaj() upsertuje alias globalny przy korekcie w konkretnym sklepie (P0)');
  rowne(globalUpsert && globalUpsert.par.cn, 'NOWY KOD X', 'alias globalny niesie ten sam znormalizowany kod');

  // uczJednostke=true + unit:null → twardy zapis NULL (świadome oduczenie, regresja Z4)
  zeruj([{ id: 42 }]);
  await pb.zapamietaj({ sklep: 'Biedronka', kod: 'JOG NAT 400G', nazwa: 'Jogurt naturalny 400 g',
    unit: null, uczJednostke: true });
  const oduczenie = baza.zapytania.find((z) => /UPDATE products SET/.test(z.sql));
  ok(!!oduczenie && /unit = :u/.test(oduczenie.sql) && oduczenie.par.u === null,
    'uczJednostke=true zapisuje unit=NULL dosłownie — twarde oduczenie, nie COALESCE (regresja Z4)');

  // pole NIEDOTKNIĘTE (brak uczJednostke) — COALESCE chroni starą wartość
  zeruj([{ id: 42 }]);
  await pb.zapamietaj({ sklep: 'Biedronka', kod: 'JOG NAT 400G', nazwa: 'Jogurt naturalny 400 g', unit: null });
  const bezpiecznie = baza.zapytania.find((z) => /UPDATE products SET/.test(z.sql));
  ok(!!bezpiecznie && /COALESCE\(:u, unit\)/.test(bezpiecznie.sql),
    'pole niedotknięte trzyma COALESCE — korekta samej nazwy nie zeruje starej jednostki');

  // productId podany (scalenie ręczne) → żaden UPDATE products nie rusza name (P1)
  zeruj([{ id: 77 }]);
  await pb.zapamietaj({ sklep: 'Biedronka', kod: 'X INNY KOD', nazwa: 'Inna nazwa niż w katalogu', productId: 77 });
  ok(!baza.zapytania.some((z) => /UPDATE products SET.*name/.test(z.sql)),
    'scalenie ręczne (productId podany) nie zmienia products.name (P1)');

  // hits podbijane TYLKO dla faktycznie użytego aliasu, nie dla wszystkich kodów z paragonu naraz
  const wykonaneConn = [];
  const conn = {
    execute: async (sql, par) => {
      wykonaneConn.push({ sql: sql.replace(/\s+/g, ' ').trim(), par });
      if (/^SELECT/i.test(sql)) return [[{ id: 1, code: 'KOD A', ocr_name: 'KOD A' }]];
      return [{ affectedRows: 1 }];
    },
  };
  zeruj([{ code_norm: 'KOD A', product_id: 9, shop: 'BIEDRONKA' }]);
  await pb.przypiszPozycje(conn, 1, 'Biedronka');
  const hitsExec = wykonaneConn.find((x) => /UPDATE product_aliases SET hits/.test(x.sql));
  ok(!!hitsExec, 'przypisanie pozycji podbija hits');
  rowne(hitsExec && hitsExec.par, ['BIEDRONKA', 'KOD A'], 'hits podbite tylko dla FAKTYCZNIE użytego aliasu (P3)');

  // Cały dotychczasowy przebieg testu (WSZYSTKIE zapytania od startu sesji, nie tylko to, co
  // zostało w `zapytania` po ostatnim zeruj()) nie mógł ani razu odpytać item_dict.
  ok(!baza.wszystkie.some((z) => /item_dict/i.test(z.sql)),
    'ani jedno zapytanie w całej sesji testowej (od startu) nie dotyka item_dict');

  // ---------- kategoriaWKsiedze ----------

  zeruj([{ id: 3 }]);
  rowne(await s.kategoriaWKsiedze(3, 7), true, 'kategoria należy do księgi paragonu');
  zeruj([]);
  rowne(await s.kategoriaWKsiedze(3, 9), false, 'kategoria z innej księgi — odrzucona');

  console.log(bledy ? `\n${bledy}/${asercje} BŁĘDÓW` : `\nWszystkie ${asercje} testy słownika/aliasów przeszły.`);
  process.exit(bledy ? 1 : 0);
})().catch((e) => { console.error('WYWRÓCIŁO SIĘ:', e); process.exit(1); });
