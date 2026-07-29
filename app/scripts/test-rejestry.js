#!/usr/bin/env node
// Testy Z11 (rejestry #17/#26, wyłączniki 21a, eksport CSV 21b) na PODSTAWIONEJ bazie —
// wzorzec z test-produkt-baza.js / test-slownik-aliasy.js.
//
// Czego te testy NIE dowodzą: że SQL jest poprawny dla MySQL-a (bez serwera się nie da).
// Czego dowodzą: że domyślnie WSZYSTKO jest wyłączone, że middleware 503/przepuszcza
// zgodnie ze stanem, że cache wyłącznika naprawdę oszczędza zapytania, że rejestr nigdy
// nie wywraca ścieżki głównej, i że CSV eksportu ma poprawne polskie formatowanie.
const path = require('path');
const Module = require('module');

let bledy = 0;
function ok(warunek, opis) {
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}
const rowne = (a, b, opis) => ok(JSON.stringify(a) === JSON.stringify(b), `${opis} → ${JSON.stringify(a)}`);

// --- podstawiona baza: zapamiętuje zapytania, oddaje przygotowane odpowiedzi po kolei ---
const baza = { zapytania: [], odpowiedzi: [] };
const q = async (sql, par) => {
  baza.zapytania.push({ sql: sql.replace(/\s+/g, ' ').trim(), par });
  if (baza.zepsuta) throw new Error('baza padła (atrapa)');
  const gotowa = baza.odpowiedzi.shift();
  return gotowa === undefined ? [] : gotowa;
};
function podstawDb() {
  require.cache[require.resolve('../src/db')] = new Module(require.resolve('../src/db'));
  require.cache[require.resolve('../src/db')].exports = { q, pool: null };
  require.cache[require.resolve('../src/db')].loaded = true;
}
// Usuwa z cache moduły zbudowane na `../src/db`, żeby świeżo załadowany moduł zobaczył
// AKTUALNĄ atrapę (wylaczniki.js trzyma prywatny cache 30 s — bez tego resetu jeden test
// zatruwałby drugi).
function resetModuly() {
  for (const m of ['../src/db', '../src/wylaczniki', '../src/rejestr', '../src/routes/eksport']) {
    delete require.cache[require.resolve(m)];
  }
  podstawDb();
}
const zeruj = (...odp) => { baza.zapytania = []; baza.odpowiedzi = odp; baza.zepsuta = false; };

// --- fake req/res do wywołania middleware/handlerów bez serwera HTTP ---
function fakeRes() {
  const res = {
    statusCode: 200, body: null, headers: {}, wyslano: null,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
    setHeader(k, v) { res.headers[k] = v; },
    send(t) { res.wyslano = t; return res; },
  };
  return res;
}

// Trasa może ODPOWIEDZIEĆ (json/send) zamiast wywołać next() — czekamy na jedno z dwojga,
// nie tylko na next(), inaczej test wisi na każdej odpowiedzi błędu (400/503).
function wywolajTrase(router, req, res) {
  return new Promise((resolve) => {
    res.json = (b) => { res.body = b; resolve(); return res; };
    res.send = (t) => { res.wyslano = t; resolve(); return res; };
    router(req, res, resolve);
  });
}

(async () => {
  // ---------- 1) domyślny stan wyłączników: WSZYSTKO OFF ----------
  resetModuly();
  const w1 = require('../src/wylaczniki');
  zeruj([{ wlaczona: 0 }]);
  ok((await w1.czyWlaczona('ro_api')) === false, 'ro_api domyślnie WYŁĄCZONE');
  zeruj([{ wlaczona: 0 }]);
  ok((await w1.czyWlaczona('eksport_csv')) === false, 'eksport_csv domyślnie WYŁĄCZONE');
  zeruj([{ wlaczona: 0 }]);
  ok((await w1.czyWlaczona('model_zewnetrzny')) === false, 'model_zewnetrzny domyślnie WYŁĄCZONE');
  // brak wiersza w tabeli (literówka klucza) też ma dać bezpieczny domyślny OFF, nie 500
  zeruj([]);
  ok((await w1.czyWlaczona('nieznany')) === false, 'nieistniejący klucz = bezpieczny OFF, nie wyjątek');

  // ---------- 2) cache wyłącznika: druga odpowiedź BEZ zapytania do bazy ----------
  // Świeży moduł (i świeży cache w Mapie) — 'eksport_csv' był już odpytany w kroku 1,
  // więc bez resetu drugie wywołanie tu dostałoby stary wynik z cache, nie ten z kroku 1 test.
  resetModuly();
  const w1b = require('../src/wylaczniki');
  zeruj([{ wlaczona: 1 }]);
  await w1b.czyWlaczona('eksport_csv'); // pierwsze odpytanie — cache pusty po resetModuly()
  const zapytaniaPrzed = baza.zapytania.length;
  const stan = await w1b.czyWlaczona('eksport_csv'); // drugie w oknie 30 s — z cache
  rowne(baza.zapytania.length, zapytaniaPrzed, 'drugie odpytanie w oknie 30 s NIE dotyka bazy');
  ok(stan === true, 'wartość z cache jest tą samą, którą baza zwróciła przy pierwszym odpytaniu');

  // ---------- 3) middleware wymagajModalnosci: 503 gdy off, przepuszcza gdy on ----------
  resetModuly();
  const w2 = require('../src/wylaczniki');
  zeruj([{ wlaczona: 0 }]);
  const mw = w2.wymagajModalnosci('eksport_csv');
  const resOff = fakeRes();
  let nextWolane = false;
  await mw({}, resOff, () => { nextWolane = true; });
  rowne(resOff.statusCode, 503, 'wyłącznik OFF → 503');
  rowne(resOff.body, { error: 'modalnosc_wylaczona', klucz: 'eksport_csv' }, 'treść błędu 503 zgodna ze zleceniem');
  ok(!nextWolane, 'next() NIE wywołane, gdy modalność wyłączona');

  resetModuly();
  const w3 = require('../src/wylaczniki');
  zeruj([{ wlaczona: 1 }]);
  const mw2 = w3.wymagajModalnosci('eksport_csv');
  const resOn = fakeRes();
  let przepuszczono = false;
  await mw2({}, resOn, () => { przepuszczono = true; });
  ok(przepuszczono, 'wyłącznik ON → next() wywołane, żądanie przepuszczone');
  ok(resOn.body === null, 'przy przepuszczeniu middleware nic nie odpowiada samo z siebie');

  // ---------- 4) zapiszDostep nie rzuca przy padniętej bazie ----------
  resetModuly();
  const rej = require('../src/rejestr');
  zeruj();
  baza.zepsuta = true;
  let rzucilo = false;
  try { rej.zapiszDostep('eksport_csv', 'csv', '2026-07-01..2026-07-31', 3, null); }
  catch { rzucilo = true; }
  ok(!rzucilo, 'zapiszDostep nie rzuca synchronicznie, mimo że baza padła');
  await new Promise((r) => setTimeout(r, 10)); // pozwól .catch() dogonić odrzuconą obietnicę
  ok(true, 'odrzucenie promisa złapane przez .catch (brak unhandledRejection = test przechodzi)');

  // ---------- 5) CSV: średniki, BOM, przecinek w kwocie, escaping cudzysłowem ----------
  resetModuly();
  const eksport = require('../src/routes/eksport');
  rowne(eksport.pole('Biedronka; Lidl'), '"Biedronka; Lidl"', 'pole ze średnikiem trafia w cudzysłów');
  rowne(eksport.pole('rata "grudniowa"'), '"rata ""grudniowa"""', 'cudzysłów w polu podwojony (escaping RFC4180)');
  rowne(eksport.pole('zwykły opis'), 'zwykły opis', 'pole bez separatora zostaje bez cudzysłowu');
  rowne(eksport.kwotaPL('1234.5'), '1234,50', 'kwota z kropki na przecinek, dwa miejsca po przecinku');
  const tresc = eksport.csv(['Data', 'Opis'], [['2026-07-01', 'rata; grudniowa']]);
  ok(tresc.startsWith(eksport.BOM), 'plik CSV zaczyna się od BOM UTF-8 (Excel PL rozpozna kodowanie)');
  ok(tresc.includes('Data;Opis'), 'nagłówek separowany średnikiem');
  ok(tresc.includes('"rata; grudniowa"'), 'wartość ze średnikiem w danych też w cudzysłowie');

  // ---------- 6) trasa /csv: zbiór spoza listy = 400, brak okresu = 400 ----------
  resetModuly();
  podstawDb();
  const router = require('../src/routes/eksport');
  zeruj([{ wlaczona: 1 }]); // modalność ON, żeby dojść do walidacji zbioru/okresu
  const req1 = { method: 'GET', url: '/csv?zbior=nieznany', query: { zbior: 'nieznany' }, user: { role: 'admin', uid: 1 } };
  const res1 = fakeRes();
  await wywolajTrase(router, req1, res1);
  rowne(res1.statusCode, 400, 'zbior spoza {ksiega,konto,produkty,telemetria} → 400');
  rowne(res1.body.error, 'bad_zbior', 'kod błędu bad_zbior');

  resetModuly();
  podstawDb();
  const router2 = require('../src/routes/eksport');
  zeruj([{ wlaczona: 1 }]);
  const req2 = { method: 'GET', url: '/csv?zbior=ksiega', query: { zbior: 'ksiega' }, user: { role: 'admin', uid: 1 } };
  const res2 = fakeRes();
  await wywolajTrase(router2, req2, res2);
  rowne(res2.statusCode, 400, 'brak od/do → 400 (okres obowiązkowy dla każdego zbioru)');
  rowne(res2.body.error, 'bad_period', 'kod błędu bad_period');

  console.log(`\n${bledy === 0 ? 'OK' : 'BŁĄD'}: test-rejestry — ${bledy} błędów`);
  process.exit(bledy === 0 ? 0 : 1);
})();
