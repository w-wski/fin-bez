#!/usr/bin/env node
// Testy Z10 (API tylko-do-odczytu + tokeny, pkt 16+18) na PODSTAWIONEJ bazie —
// wzorzec z test-produkt-baza.js / test-rejestry.js.
//
// Czego te testy NIE dowodzą: że SQL jest poprawny dla MySQL-a (bez serwera się nie da).
// Czego dowodzą: że sekret NIGDY nie trafia do bazy (tylko hash), że 401 nie zdradza,
// czy token istniał, że router jest ślepy na wszystko poza GET, że zasięg z tokenu
// WYŁĄCZNIE zawęża (nigdy nie rozszerza) i że żaden GET nie zwraca pól osobowych.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const crypto = require('crypto');

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
// wylaczniki.js ma prywatny cache 30 s — bez resetu jeden test zatruwałby drugi.
function resetModuly() {
  for (const m of ['../src/db', '../src/wylaczniki', '../src/rejestr', '../src/ro/auth', '../src/ro/api']) {
    delete require.cache[require.resolve(m)];
  }
  podstawDb();
}
const zeruj = (...odp) => { baza.zapytania = []; baza.odpowiedzi = odp; };

function fakeRes() {
  const res = {
    statusCode: 200, body: null,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
  };
  return res;
}
// Trasa może odpowiedzieć (json) zamiast next() — czekamy na jedno z dwojga.
function wywolajTrase(router, req, res) {
  return new Promise((resolve) => {
    res.json = ((oryg) => (b) => { res.body = b; resolve(); return res; })(res.json);
    router(req, res, resolve);
  });
}
const reqGet = (url, query, bearer) => ({
  method: 'GET', url, query, path: url.split('?')[0],
  headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
});

// Token ważny + hash spójny z tym, co "leży w bazie" — jeden na cały plik.
const SEKRET = 'fin_ro_' + 'a'.repeat(64);
const HASH = crypto.createHash('sha256').update(SEKRET, 'utf8').digest('hex');
const WIERSZ_TOKENU = (nadpisz = {}) => ({
  id: 1, token_hash: HASH, scope_ledgers: null, revoked_at: null,
  uid: 5, name: 'Anna', role: 'adult', ...nadpisz,
});
const MODALNOSC_ON = [{ wlaczona: 1 }];

// Kolejka: modalność → wiersz tokenu → (fire-and-forget UPDATE last_used_at) → zapytanie trasy.
const zerujDlaTrasy = (wiersz, ...reszta) => zeruj(MODALNOSC_ON, [wiersz], { affectedRows: 1 }, ...reszta);

(async () => {
  // ---------- 1) sekret NIGDY nie trafia do bazy — wydajToken zapisuje wyłącznie hash ----------
  resetModuly();
  const auth1 = require('../src/ro/auth');
  zeruj({ insertId: 42 });
  const wydany = await auth1.wydajToken(5, 'claude', null);
  ok(wydany.token.startsWith('fin_ro_'), 'wydajToken zwraca sekret z prefiksem fin_ro_');
  const zapisany = baza.zapytania[0];
  ok(!zapisany.sql.includes('INSERT') || zapisany.par.h !== wydany.token,
    'parametr zapisu (h) to HASH, nie surowy sekret');
  rowne(zapisany.par.h, auth1.haszuj(wydany.token), 'hash zapisany w bazie = sha256(sekret) zwróconego RAZ');
  ok(!JSON.stringify(zapisany.par).includes(wydany.token), 'sekret nigdzie w parametrach zapytania INSERT');

  // ---------- 2) format tokenu ----------
  ok(/^fin_ro_[0-9a-f]{64}$/.test(auth1.generujSekret()), 'generujSekret: fin_ro_ + 64 hexy (32 bajty)');

  // ---------- 3) crypto.timingSafeEqual naprawdę użyty przy porównaniu hasha ----------
  const zrodloAuth = fs.readFileSync(path.join(__dirname, '../src/ro/auth.js'), 'utf8');
  ok(zrodloAuth.includes('crypto.timingSafeEqual'), 'auth.js porównuje hash przez crypto.timingSafeEqual');

  // ---------- 4) 401 dla NIEZNANEGO tokenu i dla UNIEWAŻNIONEGO — identyczna treść ----------
  resetModuly();
  const r1 = require('../src/ro/api');
  zeruj(MODALNOSC_ON, []); // brak wiersza = nieznany token
  const resNieznany = fakeRes();
  await wywolajTrase(r1, reqGet('/podsumowanie', {}, SEKRET), resNieznany);
  rowne(resNieznany.statusCode, 401, 'nieznany token → 401');

  resetModuly();
  const r2 = require('../src/ro/api');
  zeruj(MODALNOSC_ON, [WIERSZ_TOKENU({ revoked_at: '2026-07-01 00:00:00' })]);
  const resRevoked = fakeRes();
  await wywolajTrase(r2, reqGet('/podsumowanie', {}, SEKRET), resRevoked);
  rowne(resRevoked.statusCode, 401, 'token unieważniony → 401');
  rowne(resRevoked.body, resNieznany.body, 'treść 401 IDENTYCZNA — nie zdradza, czy token istniał');

  // ---------- 5) brak nagłówka i zły format tokenu → ta sama treść 401 ----------
  resetModuly();
  const r3 = require('../src/ro/api');
  zeruj(MODALNOSC_ON);
  const resBrak = fakeRes();
  await wywolajTrase(r3, reqGet('/podsumowanie', {}, null), resBrak);
  rowne(resBrak.statusCode, 401, 'brak nagłówka Authorization → 401');
  rowne(resBrak.body, resNieznany.body, 'treść identyczna jak przy nieznanym tokenie');

  resetModuly();
  const r4 = require('../src/ro/api');
  zeruj(MODALNOSC_ON);
  const resZlyFormat = fakeRes();
  await wywolajTrase(r4, reqGet('/podsumowanie', {}, 'cokolwiek-nie-fin-ro'), resZlyFormat);
  rowne(resZlyFormat.body, resNieznany.body, 'token bez prefiksu fin_ro_ → ta sama treść 401');

  // ---------- 6) 405 dla dowolnego method != GET, NIEZALEŻNIE od tokenu ----------
  resetModuly();
  const r5 = require('../src/ro/api');
  zeruj(); // metoda odrzucona ZANIM router dotknie bazy (nawet modalności)
  const resPost = fakeRes();
  await wywolajTrase(r5, { method: 'POST', url: '/wpisy', query: {}, path: '/wpisy', headers: {} }, resPost);
  rowne(resPost.statusCode, 405, 'POST na routerze RO → 405');
  rowne(baza.zapytania.length, 0, '405 następuje PRZED jakimkolwiek zapytaniem do bazy');

  // ---------- 7) modalność WYŁĄCZONA → 503 przed sprawdzeniem tokenu ----------
  resetModuly();
  const r6 = require('../src/ro/api');
  zeruj([{ wlaczona: 0 }]);
  const resOff = fakeRes();
  await wywolajTrase(r6, reqGet('/podsumowanie', {}, SEKRET), resOff);
  rowne(resOff.statusCode, 503, 'ro_api wyłączone w Adminie → 503');
  rowne(baza.zapytania.length, 1, '503 następuje PRZED zapytaniem o token (tylko 1 zapytanie: modalność)');

  // ---------- 8) zasięg z tokenu WYŁĄCZNIE zawęża, nigdy nie rozszerza ----------
  const { zasiegTokenu } = require('../src/ro/auth');
  rowne(zasiegTokenu({ role: 'admin' }, '1'), [1], 'scope_ledgers="1" zawęża admina (widzi 1,2) do [1]');
  rowne(zasiegTokenu({ role: 'admin' }, '1,2,3,999'), [1, 2], 'śmieci/nadmiar w scope_ledgers NIE rozszerzają zasięgu właściciela');
  rowne(zasiegTokenu({ role: 'junior' }, '1,2'), [1], 'junior (widzi tylko 1) zostaje przy [1], mimo scope="1,2"');
  rowne(zasiegTokenu({ role: 'admin' }, null), [1, 2], 'scope_ledgers NULL = pełen zasięg właściciela');

  // ---------- 9) okres obowiązkowy dla /wpisy (lista może być długa) ----------
  resetModuly();
  const r7 = require('../src/ro/api');
  zerujDlaTrasy(WIERSZ_TOKENU());
  const resBrakOkresu = fakeRes();
  await wywolajTrase(r7, reqGet('/wpisy', {}, SEKRET), resBrakOkresu);
  rowne(resBrakOkresu.statusCode, 400, '/wpisy bez od/do → 400 (okres obowiązkowy)');
  rowne(resBrakOkresu.body, { error: 'bad_period' }, 'kod błędu bad_period');

  // ---------- 10) ?ledger= poza zasięgiem tokenu → 403, nie ciche obcięcie ----------
  resetModuly();
  const r8 = require('../src/ro/api');
  zerujDlaTrasy(WIERSZ_TOKENU({ scope_ledgers: '1' }));
  const resZakres = fakeRes();
  await wywolajTrase(r8, reqGet('/wpisy', { ledger: '2', od: '2026-07-01', do: '2026-07-31' }, SEKRET), resZakres);
  rowne(resZakres.statusCode, 403, '?ledger=2 przy tokenie zawężonym do [1] → 403');
  rowne(resZakres.body, { error: 'ledger_forbidden' }, 'kod błędu ledger_forbidden');

  // ---------- 11) happy path: /podsumowanie zwraca LICZBY, poprawny kształt (whitelist kluczy) ----------
  resetModuly();
  const r9 = require('../src/ro/api');
  zerujDlaTrasy(WIERSZ_TOKENU(), [{ ledger_id: 1, type: 'WYDATEK', suma: '123.45', n: 4 }]);
  const resPodsum = fakeRes();
  await wywolajTrase(r9, reqGet('/podsumowanie', { od: '2026-07-01', do: '2026-07-31' }, SEKRET), resPodsum);
  rowne(resPodsum.statusCode, 200, 'podsumowanie w zasięgu → 200');
  ok(typeof resPodsum.body.pozycje[0].suma === 'number', 'suma jest liczbą, nie napisem z SQL');
  const kluczePodsum = Object.keys(resPodsum.body.pozycje[0]).sort();
  rowne(kluczePodsum, ['ledger_id', 'n', 'suma', 'type'].sort(), 'klucze pozycji podsumowania to WYŁĄCZNIE dozwolona whitelista');

  // ---------- 12) happy path: /wpisy — brak jakiegokolwiek pola osobowego ----------
  resetModuly();
  const r10 = require('../src/ro/api');
  zerujDlaTrasy(WIERSZ_TOKENU(), [{
    data: '2026-07-15', kwota: '99.90', typ: 'WYDATEK', opis: 'zakupy',
    forma_platnosci: 'GOTÓWKA', kategoria: 'Dom > Jedzenie',
  }]);
  const resWpisy = fakeRes();
  await wywolajTrase(r10, reqGet('/wpisy', { od: '2026-07-01', do: '2026-07-31' }, SEKRET), resWpisy);
  const DOZWOLONE_WPISY = ['data', 'kwota', 'typ', 'kategoria', 'opis', 'payment_method'];
  const klucze = Object.keys(resWpisy.body.items[0]);
  rowne(klucze.sort(), [...DOZWOLONE_WPISY].sort(), 'klucze wpisu — dokładnie whitelista, nic więcej');
  ['user_id', 'uid', 'email', 'nazwisko', 'user_name', 'id'].forEach((pole) => {
    ok(!(pole in resWpisy.body.items[0]), `pole osobowe/id "${pole}" NIEOBECNE w odpowiedzi /wpisy`);
  });

  // ---------- 13) /kategorie — tablica napisów (ścieżek), bez id/userów ----------
  resetModuly();
  const r11 = require('../src/ro/api');
  zeruj(MODALNOSC_ON, [WIERSZ_TOKENU()], { affectedRows: 1 },
    [{ prefiks: 'Dom > ', nazwa: 'Czynsz' }, { prefiks: '', nazwa: 'Jedzenie' }]);
  const resKat = fakeRes();
  await wywolajTrase(r11, reqGet('/kategorie', {}, SEKRET), resKat);
  rowne(resKat.body.items, ['Dom > Czynsz', 'Jedzenie'], 'kategorie jako gotowe ścieżki-napisy');
  ok(resKat.body.items.every((x) => typeof x === 'string'), 'każda pozycja to czysty napis, nie obiekt z id');

  // ---------- 14) grep: router (ro/api.js) nie zawiera ŻADNEGO zapisu ----------
  const zrodloApi = fs.readFileSync(path.join(__dirname, '../src/ro/api.js'), 'utf8');
  const trafieniaRouter = (zrodloApi.match(/\b(INSERT|UPDATE|DELETE)\b|pool\.execute/g) || []);
  rowne(trafieniaRouter, [], 'ro/api.js (router odpowiadający na GET) — zero słów INSERT/UPDATE/DELETE/pool.execute');

  // ---------- 15) auth.js: zapisy istnieją, ale WYŁĄCZNIE na tabeli api_tokens ----------
  const liniePiszace = zrodloAuth.split('\n').filter((l) => /\b(INSERT|UPDATE|DELETE)\b/.test(l));
  ok(liniePiszace.length > 0, 'auth.js rzeczywiście pisze (housekeeping tokenów — wydanie/unieważnienie/last_used_at)');
  ok(liniePiszace.every((l) => l.includes('api_tokens')), 'KAŻDY zapis w auth.js dotyczy wyłącznie tabeli api_tokens (nigdy księgi)');
  ok(!zrodloAuth.includes('pool.execute'), 'auth.js nie woła pool.execute bezpośrednio — tylko q() z ../db');

  // ---------- 16) uniewaznij działa tylko dla WŁAŚCICIELA tokenu ----------
  resetModuly();
  const auth2 = require('../src/ro/auth');
  zeruj({ affectedRows: 1 });
  const wynikOk = await auth2.uniewaznij(7, 5);
  rowne(baza.zapytania[0].par, { id: 7, u: 5 }, 'uniewaznij przekazuje id tokenu I id właściciela do WHERE');
  ok(baza.zapytania[0].sql.includes('user_id = :u'), 'zapytanie unieważnienia filtruje po user_id (cudzy token nietykalny)');
  ok(wynikOk === true, 'affectedRows=1 → uniewaznij zwraca true');
  zeruj({ affectedRows: 0 });
  ok((await auth2.uniewaznij(7, 999)) === false, 'obcy właściciel (999) → affectedRows=0 → false');

  console.log(`\n${bledy === 0 ? 'OK' : 'BŁĄD'}: test-ro-api — ${bledy} błędów`);
  process.exit(bledy === 0 ? 0 : 1);
})();
