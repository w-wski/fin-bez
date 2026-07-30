#!/usr/bin/env node
// Testy Z20 (czat analiz) na PODSTAWIONEJ bazie i podstawionym `fetch` — wzorzec z
// test-analizy.js/test-auth-scope.js. Czego te testy dowodzą: limit $5/mies. odcina PRZED
// wywołaniem modelu, wyłącznik OFF blokuje CAŁĄ trasę bez fetch, junior nie dostaje w
// kontekście transakcji spoza własnych, „szeroki” nigdy nie dociąga surowych transakcji,
// prompt nie niesie imion, zapis rozmowy przechodzi z koszt=NULL, popularne grupuje po
// userze, heurystyka szczegółów łapie właściwe słowa, kształt odpowiedzi API zgadza się
// z kontraktem frontu (analizy-chat.js).
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
  for (const m of ['../src/db', '../src/auth', '../src/wylaczniki', '../src/rejestr',
    '../src/model/dostawca', '../src/analizy', '../src/chat', '../src/routes/chat']) {
    delete require.cache[require.resolve(m)];
  }
  podstawDb();
}
const zeruj = (...odp) => { baza.zapytania = []; baza.odpowiedzi = odp; };

function fakeRes() {
  const res = { statusCode: 200, body: null,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; } };
  return res;
}
function wywolajTrase(router, req, res) {
  return new Promise((resolve) => {
    res.json = (b) => { res.body = b; resolve(); return res; };
    router(req, res, resolve);
  });
}
const reqBazowy = (body, user) => ({
  method: 'POST', url: '/', query: {}, body, params: {},
  baseUrl: '/api/v1/chat', path: '/', user,
});

let fetchWolane = 0;
const fetchOryg = global.fetch;
function podstawFetch(odpowiedz) {
  fetchWolane = 0;
  global.fetch = async () => {
    fetchWolane++;
    if (odpowiedz instanceof Error) throw odpowiedz;
    return odpowiedz;
  };
}

const JUNIOR = { role: 'junior', uid: 9 };
const ADMIN = { role: 'admin', uid: 1 };

(async () => {
  // ---------- 1) limit $5/mies. ŁĄCZNIE odcina PRZED wywołaniem modelu (K4) ----------
  resetModuly();
  process.env.MODEL_DOSTAWCA = 'openrouter'; // nieużywane przez czat() (zawsze OpenRouter), zostawiamy jak w .env realnym
  process.env.OPENROUTER_API_KEY = 'sk-or-testowy';
  podstawFetch({ ok: true, json: async () => ({ choices: [{ message: { content: 'nie powinno się wywołać' } }] }) });
  zeruj([{ wlaczona: 1 }], [{ suma: '5.000000' }]); // modalnosci ON, wydano już = limit
  const routerChat1 = require('../src/routes/chat');
  const res1 = fakeRes();
  await wywolajTrase(routerChat1, reqBazowy({ okres_typ: 'miesiac', okres: '2026-07', pytanie: 'Ile wydaliśmy?' }, ADMIN), res1);
  rowne(res1.statusCode, 429, 'limit osiągnięty → 429');
  ok(res1.body && res1.body.error === 'limit_miesieczny', 'kod błędu limit_miesieczny');
  ok(fetchWolane === 0, 'limit odcina PRZED fetch — model NIE wywołany');

  // ---------- 2) wyłącznik model_zewnetrzny OFF → 403 bez fetch (K5) ----------
  resetModuly();
  podstawFetch({ ok: true, json: async () => ({}) });
  zeruj([{ wlaczona: 0 }]); // modalnosci OFF
  const routerChat2 = require('../src/routes/chat');
  const res2 = fakeRes();
  await wywolajTrase(routerChat2, reqBazowy({ okres_typ: 'miesiac', okres: '2026-07', pytanie: 'x' }, ADMIN), res2);
  rowne(res2.statusCode, 403, 'wyłącznik OFF → 403');
  ok(res2.body && res2.body.error === 'model_wylaczony', 'kod błędu model_wylaczony');
  ok(fetchWolane === 0, 'wyłącznik OFF → fetch NIE wywołane');
  global.fetch = fetchOryg;

  // ---------- 3) junior: transakcjeOkresu NIE dociąga wpisów innych osób (ownOnly) ----------
  resetModuly();
  podstawDb();
  const chat3 = require('../src/chat');
  zeruj([]); // treść odpowiedzi bez znaczenia — sprawdzamy WYWOŁANIE
  await chat3.transakcjeOkresu(JUNIOR, { ledgers: [1], ownOnly: true }, 'miesiac', '2026-07');
  const zapytanieTx = baza.zapytania[baza.zapytania.length - 1];
  ok(zapytanieTx.sql.includes('t.user_id = :uid'), 'junior ownOnly: SQL zawiera filtr t.user_id = :uid');
  rowne(zapytanieTx.par.uid, JUNIOR.uid, 'junior ownOnly: parametr uid = UID juniora (nie innych)');

  // ---------- 4) „szeroki” NIGDY nie dociąga surowych transakcji spoza okresu (K3) ----------
  resetModuly();
  podstawDb();
  const chat4 = require('../src/chat');
  zeruj(
    [],               // zapisanaAnaliza podstawowego okresu → brak (fallback policzOkres)
    [{ type: 'WYDATEK', total: '10.00' }], [], [{ suma: '10.00', rabaty: '0.00' }], [], // policzOkres (ledgerId=1)
    [],               // podsumowaniaSzerokie: zapisanaAnaliza('rok', bieżący, ...) → brak
  );
  const kontekstSzeroki = await chat4.budujKontekst({
    user: ADMIN, okresTyp: 'miesiac', okres: '2026-07', pytanie: 'Pokaż mi transakcje ze szczegółami', szeroki: true,
  });
  // policzOkres (fallback bez migawki) SAM czyta transactions (agregaty SUM) — to legalne,
  // dozwolone jest tylko wykluczenie zapytania po SUROWE wiersze (LIMIT 300, patrz transakcjeOkresu).
  ok(!baza.zapytania.some((z) => z.sql.includes('LIMIT 300')), 'szeroki=1: BRAK zapytania po surowe transakcje (LIMIT 300)');
  ok(kontekstSzeroki.uzytoSzczegolow === false, 'szeroki=1: uzytoSzczegolow=false mimo słów-kluczy w pytaniu');

  // ---------- 5) zbudujPrompt/opisPodsumowania: ZERO imion userów (Z12 zakaz danych osobowych) ----------
  const daneZTruciznaa = {
    okres_typ: 'miesiac', okres: '2026-07',
    user_name: 'Bartuś',
    ksiegi: [{ ledger_id: 1, przychody: 100, wydatki: 50, transfery: 0, user_name: 'Bartuś' }],
    top_kategorie: [{ kategoria: 'Jedzenie', total: 50, poprzednio: 40 }],
    suma_paragonowa: 50, rabaty_lacznie: 0,
  };
  const chat5 = require('../src/chat');
  const opisTruty = chat5.opisPodsumowania('miesiac', '2026-07', { dane: daneZTruciznaa, narracja: null });
  ok(!opisTruty.includes('Bartuś'), 'opisPodsumowania: imię usera NIEOBECNE');
  ok(opisTruty.includes('Jedzenie') && opisTruty.includes('50'), 'opisPodsumowania: kategorie/kwoty (dozwolone) SĄ obecne');
  const wiadomosci = chat5.zbudujWiadomosci(opisTruty, 'Co się zmieniło?');
  ok(!wiadomosci.some((m) => m.content.includes('Bartuś')), 'zbudujWiadomosci: żadna wiadomość nie niesie imienia usera');
  ok(wiadomosci[0].role === 'system' && wiadomosci[1].role === 'user', 'zbudujWiadomosci: kolejność system→user');

  // ---------- 6) zapiszRozmowe: INSERT do chat_rozmowy, koszt NULL NIE wywala zapisu (K9) ----------
  resetModuly();
  podstawDb();
  const chat6 = require('../src/chat');
  zeruj({ affectedRows: 1 });
  let rzucilo = false;
  try {
    await chat6.zapiszRozmowe({ userId: 9, okresTyp: 'miesiac', okres: '2026-07', szeroki: false, pytanie: 'x', wynik: null });
  } catch { rzucilo = true; }
  ok(!rzucilo, 'zapiszRozmowe z wynik=null (koszt/model/tokeny NULL) nie rzuca');
  const zapytanieIns = baza.zapytania[baza.zapytania.length - 1];
  ok(zapytanieIns.sql.includes('INSERT INTO chat_rozmowy'), 'zapiszRozmowe: INSERT INTO chat_rozmowy');
  ok(zapytanieIns.par.koszt === null && zapytanieIns.par.m === null, 'zapiszRozmowe: koszt/model NULL, nie wyjątek');

  // ---------- 7) popularnePytania: GROUP BY pytanie TEGO usera ----------
  zeruj([{ pytanie: 'Ile wydaliśmy na jedzenie?', n: 4 }]);
  const popularne = await chat6.popularnePytania(9, 3);
  const zapytaniePop = baza.zapytania[baza.zapytania.length - 1];
  ok(zapytaniePop.sql.includes('GROUP BY pytanie') && zapytaniePop.sql.includes('WHERE user_id=:u'), 'popularnePytania: GROUP BY pytanie WHERE user_id=:u');
  rowne(zapytaniePop.par.u, 9, 'popularnePytania: parametr usera przekazany');
  rowne(popularne, ['Ile wydaliśmy na jedzenie?'], 'popularnePytania: zwraca listę tekstów pytań');

  // ---------- 8) heurystyka „pytanie o szczegóły” (K3) ----------
  ok(chat6.pytanieOSzczegoly('Kiedy kupiliśmy pralkę?') === true, 'heurystyka: „kiedy” → szczegóły');
  ok(chat6.pytanieOSzczegoly('Pokaż konkretne transakcje z paragonu') === true, 'heurystyka: „transakcje/paragon” → szczegóły');
  ok(chat6.pytanieOSzczegoly('Ile ogólnie wydaliśmy w tym miesiącu?') === false, 'heurystyka: pytanie ogólne → BEZ szczegółów');

  // ---------- 9) ledgerColDlaScope: junior/company (1 księga) vs admin/adult (2 księgi) ----------
  rowne(chat6.ledgerColDlaScope({ ledgers: [1, 2] }), 0, 'ledgerColDlaScope: dwie księgi → sentinel 0 (obie)');
  rowne(chat6.ledgerColDlaScope({ ledgers: [1] }), 1, 'ledgerColDlaScope: jedna księga (RODZINA) → 1');
  rowne(chat6.ledgerColDlaScope({ ledgers: [2] }), 2, 'ledgerColDlaScope: jedna księga (PERSEVERA) → 2');

  // ---------- 10) lataDoPoszerzenia: rok poprzedni TYLKO w I kwartale (styczeń–marzec) ----------
  rowne(chat6.lataDoPoszerzenia('miesiac', '2026-02'), [2026, 2025], 'luty → dołącza rok poprzedni');
  rowne(chat6.lataDoPoszerzenia('miesiac', '2026-07'), [2026], 'lipiec → BEZ roku poprzedniego');
  rowne(chat6.lataDoPoszerzenia('rok', '2026'), [2026], 'okres roczny → tylko bieżący rok');

  // ---------- 11) kształt odpowiedzi API: happy path (model odpowiada) ----------
  resetModuly();
  process.env.MODEL_DOSTAWCA = 'brak'; // narracja Analiz offline — nieistotne, czat() zawsze OpenRouter
  process.env.OPENROUTER_API_KEY = 'sk-or-testowy';
  process.env.OPENROUTER_MODEL = 'openrouter/auto';
  podstawFetch({
    ok: true,
    json: async () => ({
      model: 'meta/llama-3.1-405b', choices: [{ message: { content: 'Wydatki spadły o 5%.' } }],
      usage: { prompt_tokens: 120, completion_tokens: 40 },
    }),
  });
  zeruj(
    [{ wlaczona: 1 }],                                                     // router.use: modalnosci ON
    [{ suma: '0.000000' }],                                                // wydanoWTymMiesiacu (limit)
    [{ dane: JSON.stringify({ ksiegi: [{ ledger_id: 0, przychody: 100, wydatki: 50, transfery: 0 }], top_kategorie: [], suma_paragonowa: 0, rabaty_lacznie: 0 }), narracja: null }], // zapisanaAnaliza
    { affectedRows: 1 }, { affectedRows: 1 },                              // zapiszWyjscie + zapiszKosztApi (wewnątrz czat())
    { affectedRows: 1 },                                                   // zapiszRozmowe (INSERT chat_rozmowy)
  );
  const routerChat11 = require('../src/routes/chat');
  const res11 = fakeRes();
  await wywolajTrase(routerChat11, reqBazowy({ okres_typ: 'miesiac', okres: '2026-07', pytanie: 'Jak wygląda budżet?' }, ADMIN), res11);
  rowne(res11.statusCode, 200, 'happy path: 200');
  ok(res11.body?.ok === true && res11.body?.odpowiedz === 'Wydatki spadły o 5%.', 'happy path: {ok, odpowiedz} zgodne z kontraktem frontu');
  ok(res11.body?.model === 'meta/llama-3.1-405b', 'happy path: model realnie użyty (openrouter/auto → konkretny)');
  ok(fetchWolane === 1, 'happy path: fetch wywołany DOKŁADNIE raz');
  global.fetch = fetchOryg;

  // ---------- 12) kształt odpowiedzi API: model niedostępny (błąd/saldo) → komunikat, nie cisza ----------
  resetModuly();
  process.env.OPENROUTER_API_KEY = 'sk-or-testowy';
  podstawFetch({ ok: false, status: 402, json: async () => ({}) });
  zeruj(
    [{ wlaczona: 1 }],
    [{ suma: '0.000000' }],
    [{ dane: JSON.stringify({ ksiegi: [], top_kategorie: [], suma_paragonowa: 0, rabaty_lacznie: 0 }), narracja: null }],
    { affectedRows: 1 }, // zapiszRozmowe (koszt/model NULL — wynik null)
  );
  const routerChat12 = require('../src/routes/chat');
  const res12 = fakeRes();
  await wywolajTrase(routerChat12, reqBazowy({ okres_typ: 'miesiac', okres: '2026-07', pytanie: 'Co się stało?' }, ADMIN), res12);
  rowne(res12.statusCode, 200, 'model niedostępny: nadal 200 (nie cichy błąd 5xx)');
  ok(res12.body?.odpowiedz === null, 'model niedostępny: odpowiedz=null');
  ok(typeof res12.body?.komunikat === 'string' && res12.body.komunikat.includes('OpenRouter'), 'model niedostępny: czytelny komunikat, nie cicha pustka');
  global.fetch = fetchOryg;

  delete process.env.MODEL_DOSTAWCA;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;

  console.log(`\n${bledy === 0 ? 'OK' : 'BŁĄD'}: test-chat — ${bledy} błędów`);
  process.exit(bledy === 0 ? 0 : 1);
})();
