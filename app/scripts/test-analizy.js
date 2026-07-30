#!/usr/bin/env node
// Testy Z12 (warstwa modelu 21c + analizy okresowe 21d) na PODSTAWIONEJ bazie i podstawionym
// `fetch` — wzorzec z test-ro-api.js / test-rejestry.js.
//
// Czego te testy NIE dowodzą: że SQL jest poprawny dla MySQL-a (bez serwera się nie da) ani
// że prawdziwy Anthropic API odpowiada tak, jak zakładamy. Czego dowodzą: że tryb offline
// (dostawca 'brak', wyłącznik OFF) NIGDY nie woła sieci, że prompt nie może wyciekać imion
// userów (whitelista pól, nie „staranność"), że walidacja okresu odrzuca nieistniejące daty,
// że UPSERT trafia w ten sam klucz i że liczby z atrapy sumują się co do grosza.
const fs = require('fs');
const path = require('path');
const Module = require('module');

let bledy = 0;
function ok(warunek, opis) {
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}
const rowne = (a, b, opis) => ok(JSON.stringify(a) === JSON.stringify(b), `${opis} → ${JSON.stringify(a)}`);

// --- podstawiona baza: kolejka gotowych odpowiedzi, w kolejności WYWOŁAŃ q() ---
const baza = { zapytania: [], odpowiedzi: [] };
const q = async (sql, par) => {
  baza.zapytania.push({ sql: sql.replace(/\s+/g, ' ').trim(), par });
  const gotowa = baza.odpowiedzi.shift();
  return gotowa === undefined ? [] : gotowa;
};
function podstawDb() {
  require.cache[require.resolve('../src/db')] = new Module(require.resolve('../src/db'));
  require.cache[require.resolve('../src/db')].exports = { q, pool: null };
  require.cache[require.resolve('../src/db')].loaded = true;
}
function resetModuly() {
  for (const m of ['../src/db', '../src/wylaczniki', '../src/rejestr', '../src/model/dostawca', '../src/analizy']) {
    delete require.cache[require.resolve(m)];
  }
  podstawDb();
}
const zeruj = (...odp) => { baza.zapytania = []; baza.odpowiedzi = odp; };

// --- podstawiony fetch: żeby dowieść trybu offline, MUSI zostać nietknięty ---
let fetchWolane = 0;
const fetchOryg = global.fetch;
function podstawFetch(odpowiedz) {
  fetchWolane = 0;
  global.fetch = async (...a) => {
    fetchWolane++;
    if (odpowiedz instanceof Error) throw odpowiedz;
    return odpowiedz;
  };
}

(async () => {
  // ---------- 1) dostawca 'brak' (domyślny) → null, ZERO wywołań fetch ----------
  resetModuly();
  delete process.env.MODEL_DOSTAWCA;
  delete process.env.ANTHROPIC_API_KEY;
  podstawFetch({ ok: true, json: async () => ({}) });
  const d1 = require('../src/model/dostawca');
  const w1 = await d1.narracja('cokolwiek', { maxTokens: 100 });
  ok(w1 === null, "dostawca 'brak' → null");
  ok(fetchWolane === 0, "dostawca 'brak' → fetch NIE wywołane");

  // ---------- 2) dostawca 'anthropic', ale wyłącznik model_zewnetrzny OFF → null, ZERO fetch ----------
  resetModuly();
  process.env.MODEL_DOSTAWCA = 'anthropic';
  process.env.ANTHROPIC_API_KEY = 'sk-testowy-atrapa';
  podstawFetch({ ok: true, json: async () => ({ content: [{ text: 'nie powinno się wywołać' }] }) });
  zeruj([{ wlaczona: 0 }]); // czyWlaczona('model_zewnetrzny') czyta z bazy
  const d2 = require('../src/model/dostawca');
  const w2 = await d2.narracja('prompt testowy');
  ok(w2 === null, 'wyłącznik model_zewnetrzny OFF → null');
  ok(fetchWolane === 0, 'wyłącznik OFF → fetch NIE wywołane (sprawdzony PRZED wywołaniem)');

  // ---------- 3) dostawca 'anthropic', wyłącznik ON, ale brak ANTHROPIC_API_KEY → null bez fetch ----------
  resetModuly();
  delete process.env.ANTHROPIC_API_KEY;
  podstawFetch({ ok: true, json: async () => ({}) });
  zeruj([{ wlaczona: 1 }]);
  const d3 = require('../src/model/dostawca');
  ok((await d3.narracja('x')) === null, 'brak klucza .env → null (tryb offline mimo dostawcy anthropic)');
  ok(fetchWolane === 0, 'brak klucza → fetch nadal NIE wywołane');
  delete process.env.MODEL_DOSTAWCA;

  global.fetch = fetchOryg; // koniec testów dostawcy — reszta nie dotyka sieci

  // ---------- 4) walidacja okresu: miesiąc spoza kalendarza ----------
  resetModuly();
  const an1 = require('../src/analizy');
  let rzucilo413 = false, kod413 = null;
  try { await an1.policzOkres('miesiac', '2026-13', 1); } catch (e) { rzucilo413 = true; kod413 = e.code; }
  ok(rzucilo413 && kod413 === 'bad_okres', "policzOkres('miesiac','2026-13') odrzucony (bad_okres)");

  // ---------- 5) walidacja okresu: kwartał spoza {1..4} ----------
  let rzuciloQ5 = false, kodQ5 = null;
  try { await an1.policzOkres('kwartal', '2026-Q5', 1); } catch (e) { rzuciloQ5 = true; kodQ5 = e.code; }
  ok(rzuciloQ5 && kodQ5 === 'bad_okres', "policzOkres('kwartal','2026-Q5') odrzucony (bad_okres)");

  // ---------- 6) zakresOkresu: kwartał liczy się poprawnie kalendarzowo ----------
  rowne(an1.zakresOkresu('kwartal', '2026-Q3'), { from: '2026-07-01', to: '2026-09-30' },
    'II→III kwartał 2026: lipiec–wrzesień');
  rowne(an1.zakresOkresu('rok', '2026'), { from: '2026-01-01', to: '2026-12-31' }, 'rok 2026: pełny zakres');
  rowne(an1.poprzedniOkres('miesiac', '2026-01'), '2025-12', 'poprzedni okres: styczeń → grudzień roku wcześniej');

  // ---------- 7) policzOkres: liczby z atrapy — suma wydatków co do grosza ----------
  resetModuly();
  podstawDb();
  const an2 = require('../src/analizy');
  zeruj(
    [{ type: 'WYDATEK', total: '250.55' }, { type: 'PRZYCHÓD', total: '500.00' }], // sumyPerKsiega (ledger 1)
    [],                                                                            // topKategorie: brak wydatków w top
    [{ suma: '300.00', rabaty: '10.00' }],                                          // danePragony: nagłówek
    [{ name: 'Chleb', wydano: '12.34' }],                                           // danePragony: koszyk
  );
  const dane = await an2.policzOkres('miesiac', '2026-07', 1);
  ok(dane.ksiegi[0].wydatki === 250.55, `wydatki co do grosza: ${dane.ksiegi[0].wydatki}`);
  ok(dane.ksiegi[0].przychody === 500, 'przychody z atrapy odczytane poprawnie');
  ok(dane.suma_paragonowa === 300 && dane.rabaty_lacznie === 10, 'suma paragonowa i rabaty z nagłówka receipts');
  ok(dane.koszyk_top5[0].name === 'Chleb' && dane.koszyk_top5[0].wydano === 12.34, 'koszyk top5 z atrapy');

  // ---------- 8) zbudujPrompt: ZERO imion userów, tylko whitelista pól (Z12, zakaz danych osobowych) ----------
  const daneZTruciznaa = {
    okres_typ: 'miesiac', okres: '2026-07', od: '2026-07-01', do: '2026-07-31',
    user_name: 'Bartuś', // pole spoza whitelisty — NIE ma prawa trafić do promptu
    ksiegi: [{ ledger_id: 1, przychody: 100, wydatki: 50, transfery: 0, user_name: 'Bartuś' }],
    top_kategorie: [{ kategoria: 'Jedzenie', total: 50, poprzednio: 40 }],
    suma_paragonowa: 50, rabaty_lacznie: 0, koszyk_top5: [],
  };
  const prompt = an2.zbudujPrompt(daneZTruciznaa);
  ok(!prompt.includes('Bartuś'), 'imię usera (poza whitelistą pól) NIEOBECNE w prompcie');
  ok(prompt.includes('Jedzenie') && prompt.includes('50'), 'kategorie i kwoty (dozwolone) SĄ w prompcie');
  ok(typeof prompt === 'string' && prompt.length > 0, 'zbudujPrompt zwraca niepusty tekst po polsku');

  // ---------- 9) wykonajAnalize: UPSERT trafia w INSERT ... ON DUPLICATE KEY UPDATE ----------
  resetModuly();
  podstawDb();
  delete process.env.MODEL_DOSTAWCA; // narracja → null bez dotykania sieci
  const an3 = require('../src/analizy');
  zeruj(
    [{ type: 'WYDATEK', total: '10.00' }],   // sumyPerKsiega — księga 1
    [{ type: 'WYDATEK', total: '5.00' }],    // sumyPerKsiega — księga 2 (ledgerId=null → obie księgi)
    [],                                       // topKategorie
    [{ suma: '10.00', rabaty: '0.00' }],      // danePragony nagłówek
    [],                                        // danePragony koszyk
    { affectedRows: 1 },                       // INSERT ... ON DUPLICATE KEY UPDATE
  );
  const wynik = await an3.wykonajAnalize('miesiac', '2026-07', null);
  const ostatnie = baza.zapytania[baza.zapytania.length - 1];
  ok(ostatnie.sql.includes('ON DUPLICATE KEY UPDATE'), 'wykonajAnalize zapisuje przez UPSERT (ON DUPLICATE KEY UPDATE)');
  rowne(ostatnie.par.l, 0, "ledgerId=null → sentinel 0 w kolumnie (kontrakt API: NULL = obie księgi)");
  rowne(ostatnie.par.t, 'miesiac', 'okres_typ przekazany do UPSERT-u');
  ok(wynik.narracja === null && wynik.model === null, 'brak dostawcy → narracja/model NULL, ale analiza i tak powstaje');

  // ---------- 10) migracja 020: unikalny klucz (okres_typ, okres, ledger_id) — podstawa UPSERT-u ----------
  const sqlMigracji = fs.readFileSync(path.join(__dirname, '../migrations/020_analizy.sql'), 'utf8');
  ok(/UNIQUE KEY uq_analiza_okres \(okres_typ, okres, ledger_id\)/.test(sqlMigracji),
    'migracja 020 deklaruje UNIQUE (okres_typ, okres, ledger_id) — bez tego UPSERT nie miałby w co trafić');
  ok(/ledger_id TINYINT UNSIGNED NOT NULL DEFAULT 0/.test(sqlMigracji),
    'ledger_id NOT NULL z sentinelem 0 (nie NULL) — MySQL dopuszcza wiele NULL-i w UNIQUE, popsułoby UPSERT (patrz komentarz w migracji, wzorzec z 012)');

  console.log(`\n${bledy === 0 ? 'OK' : 'BŁĄD'}: test-analizy — ${bledy} błędów`);
  process.exit(bledy === 0 ? 0 : 1);
})();
