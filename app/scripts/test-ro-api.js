// Testy Z10 (API tylko-do-odczytu + tokeny, pkt 16+18) na PODSTAWIONEJ bazie —
// wzorzec z test-produkt-baza.js / test-rejestry.js.
// NIE dowodzą poprawności SQL dla MySQL-a (bez serwera się nie da). Dowodzą: sekret nigdy
// w bazie (tylko hash); 401 nie zdradza czy token istniał (token PRZED modalnością); router
// ślepy poza GET; zasięg tokenu tylko zawęża (pusty scope_ledgers = fail-closed); zero pól
// osobowych w odpowiedziach; przycięta lista /wpisy się do tego przyznaje.
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
// Krótka pauza, żeby fire-and-forget (last_used_at, INSERT access_log) zdążyło dopisać
// swój wpis do `baza.zapytania` przed odczytem — bez tego test zależałby od przypadkowej
// kolejności mikrotasków.
const puls = () => new Promise((r) => setImmediate(r));

// Token ważny — jeden na cały plik. Baza atrapy nie sprawdza treści hasha (to robi prawdziwe
// MySQL przez WHERE token_hash=:h) — tu liczy się tylko, że q() dostaje odpowiedni wiersz.
const SEKRET = 'fin_ro_' + 'a'.repeat(64);
// Kształt wiersza ZGODNY z zapytaniem w ro/auth.js: api_tokens.name AS token_name (NIE
// users.name — to imię CZŁOWIEKA, nie nazwa tokenu, i nie powinno w ogóle opuszczać zapytania).
const WIERSZ_TOKENU = (nadpisz = {}) => ({
  id: 1, token_name: 'claude', scope_ledgers: null, revoked_at: null, uid: 5, role: 'adult', ...nadpisz,
});
const MODALNOSC_ON = [{ wlaczona: 1 }];
const AKTUALIZACJA = { affectedRows: 1 };

// Kolejka DLA UDANEGO logowania: SELECT tokenu → UPDATE last_used_at (fire-and-forget) →
// SELECT modalności (dopiero PO tokenie — patrz test kolejności niżej) → zapytanie trasy.
const zerujDlaTrasy = (wiersz, ...reszta) => zeruj([wiersz], AKTUALIZACJA, MODALNOSC_ON, ...reszta);

(async () => {
  // ---------- 1) sekret NIGDY nie trafia do bazy — wydajToken zapisuje wyłącznie hash ----------
  resetModuly();
  const auth1 = require('../src/ro/auth');
  zeruj({ insertId: 42 });
  const wydany = await auth1.wydajToken(5, 'claude', null);
  ok(wydany.token.startsWith('fin_ro_'), 'wydajToken zwraca sekret z prefiksem fin_ro_');
  const zapisany = baza.zapytania[0];
  rowne(zapisany.par.h, auth1.haszuj(wydany.token), 'hash zapisany w bazie = sha256(sekret) zwróconego RAZ');
  ok(!JSON.stringify(zapisany.par).includes(wydany.token), 'sekret nigdzie w parametrach zapytania INSERT');

  // ---------- 2) format tokenu ----------
  ok(/^fin_ro_[0-9a-f]{64}$/.test(auth1.generujSekret()), 'generujSekret: fin_ro_ + 64 hexy (32 bajty)');

  // ---------- 3) lookup po hashu: zachowanie, nie grep — zły sekret NIE przechodzi ----------
  // (bez dodatkowego crypto.timingSafeEqual w JS — WHERE po UNIQUE(token_hash) to lookup po
  // nieodwracalnym skrócie, nie porównanie sekretu znak-po-znaku; patrz komentarz w auth.js)
  resetModuly();
  const rZly = require('../src/ro/api');
  zeruj([]); // baza atrapy: żaden wiersz nie pasuje do hasza INNEGO sekretu
  const resZlySekret = fakeRes();
  await wywolajTrase(rZly, reqGet('/podsumowanie', {}, 'fin_ro_' + 'b'.repeat(64)), resZlySekret);
  rowne(resZlySekret.statusCode, 401, 'sekret o poprawnym formacie, ale innej treści → 401 (hash inny → brak wiersza)');

  // ---------- 4) 401 dla NIEZNANEGO tokenu i dla UNIEWAŻNIONEGO — identyczna treść ----------
  resetModuly();
  const r1 = require('../src/ro/api');
  zeruj([]); // brak wiersza = nieznany token — modalność NIGDY nie jest odpytana (patrz 6)
  const resNieznany = fakeRes();
  await wywolajTrase(r1, reqGet('/podsumowanie', {}, SEKRET), resNieznany);
  rowne(resNieznany.statusCode, 401, 'nieznany token → 401');

  resetModuly();
  const r2 = require('../src/ro/api');
  zeruj([WIERSZ_TOKENU({ revoked_at: '2026-07-01 00:00:00' })]);
  const resRevoked = fakeRes();
  await wywolajTrase(r2, reqGet('/podsumowanie', {}, SEKRET), resRevoked);
  rowne(resRevoked.statusCode, 401, 'token unieważniony → 401');
  rowne(resRevoked.body, resNieznany.body, 'treść 401 IDENTYCZNA — nie zdradza, czy token istniał');

  // ---------- 5) brak nagłówka i zły format tokenu → ta sama treść 401, ZERO zapytań ----------
  resetModuly();
  const r3 = require('../src/ro/api');
  zeruj();
  const resBrak = fakeRes();
  await wywolajTrase(r3, reqGet('/podsumowanie', {}, null), resBrak);
  rowne(resBrak.statusCode, 401, 'brak nagłówka Authorization → 401');
  rowne(resBrak.body, resNieznany.body, 'treść identyczna jak przy nieznanym tokenie');
  rowne(baza.zapytania.length, 0, 'zły format/brak nagłówka odrzucony PRZED jakimkolwiek zapytaniem');

  resetModuly();
  const r4 = require('../src/ro/api');
  zeruj();
  const resZlyFormat = fakeRes();
  await wywolajTrase(r4, reqGet('/podsumowanie', {}, 'cokolwiek-nie-fin-ro'), resZlyFormat);
  rowne(resZlyFormat.body, resNieznany.body, 'token bez prefiksu fin_ro_ → ta sama treść 401');

  // ---------- 6) KOLEJNOŚĆ: token PRZED modalnością — anonim nie odróżnia 401 od 503 ----------
  resetModuly();
  const r5 = require('../src/ro/api');
  zeruj([]); // token nieznany — modalność w ogóle nie jest sprawdzana
  const resAnonim = fakeRes();
  await wywolajTrase(r5, reqGet('/podsumowanie', {}, SEKRET), resAnonim);
  rowne(resAnonim.statusCode, 401, 'nieprawidłowy token → 401 (nie 503, choćby modalność była wyłączona)');
  rowne(baza.zapytania.length, 1, 'tylko JEDNO zapytanie (o token) — modalność nieodpytana dla anonima');

  resetModuly();
  const r6 = require('../src/ro/api');
  zeruj([WIERSZ_TOKENU()], AKTUALIZACJA, [{ wlaczona: 0 }]);
  const resWylaczone = fakeRes();
  await wywolajTrase(r6, reqGet('/podsumowanie', {}, SEKRET), resWylaczone);
  rowne(resWylaczone.statusCode, 503, 'WAŻNY token + modalność OFF → 503 (dopiero po weryfikacji tokenu)');
  rowne(baza.zapytania.length, 3, '3 zapytania: token, last_used_at, modalność — bez zapytania trasy');

  // ---------- 7) 405 dla dowolnego method != GET, PRZED tokenem i PRZED bazą ----------
  resetModuly();
  const r7 = require('../src/ro/api');
  zeruj();
  const resPost = fakeRes();
  await wywolajTrase(r7, { method: 'POST', url: '/wpisy', query: {}, path: '/wpisy', headers: {} }, resPost);
  rowne(resPost.statusCode, 405, 'POST na routerze RO → 405');
  rowne(baza.zapytania.length, 0, '405 następuje PRZED jakimkolwiek zapytaniem do bazy');

  // ---------- 8) zasięg z tokenu WYŁĄCZNIE zawęża, nigdy nie rozszerza; pusty = fail-closed ----------
  const { zasiegTokenu } = require('../src/ro/auth');
  rowne(zasiegTokenu({ role: 'admin' }, '1'), [1], 'scope_ledgers="1" zawęża admina (widzi 1,2) do [1]');
  rowne(zasiegTokenu({ role: 'admin' }, '1,2,3,999'), [1, 2], 'śmieci/nadmiar w scope_ledgers NIE rozszerzają zasięgu właściciela');
  rowne(zasiegTokenu({ role: 'junior' }, '1,2'), [1], 'junior (widzi tylko 1) zostaje przy [1], mimo scope="1,2"');
  rowne(zasiegTokenu({ role: 'admin' }, null), [1, 2], 'scope_ledgers NULL = pełen zasięg właściciela');
  rowne(zasiegTokenu({ role: 'admin' }, ''), [], 'scope_ledgers="" (pusty napis) = FAIL-CLOSED, zero ksiąg — NIE pełny zasięg');
  rowne(zasiegTokenu({ role: 'admin' }, '   '), [], 'scope_ledgers z samych spacji też fail-closed');
  rowne(zasiegTokenu({ role: 'admin' }, 'x,y'), [], 'scope_ledgers bez ani jednej liczby → fail-closed, nie wyjątek');

  // ---------- 9) okres obowiązkowy dla /wpisy (lista może być długa) ----------
  resetModuly();
  const r8 = require('../src/ro/api');
  zerujDlaTrasy(WIERSZ_TOKENU());
  const resBrakOkresu = fakeRes();
  await wywolajTrase(r8, reqGet('/wpisy', {}, SEKRET), resBrakOkresu);
  rowne(resBrakOkresu.statusCode, 400, '/wpisy bez od/do → 400 (okres obowiązkowy)');
  rowne(resBrakOkresu.body, { error: 'bad_period' }, 'kod błędu bad_period');

  // ---------- 10) ?ledger= poza zasięgiem tokenu → 403, nie ciche obcięcie ----------
  resetModuly();
  const r9 = require('../src/ro/api');
  zerujDlaTrasy(WIERSZ_TOKENU({ scope_ledgers: '1' }));
  const resZakres = fakeRes();
  await wywolajTrase(r9, reqGet('/wpisy', { ledger: '2', od: '2026-07-01', do: '2026-07-31' }, SEKRET), resZakres);
  rowne(resZakres.statusCode, 403, '?ledger=2 przy tokenie zawężonym do [1] → 403');
  rowne(resZakres.body, { error: 'ledger_forbidden' }, 'kod błędu ledger_forbidden');

  // ---------- 11) /wpisy: PRZYCIĘCIE listy jest SYGNALIZOWANE, nie ukryte ----------
  resetModuly();
  const r10a = require('../src/ro/api');
  const tysiacWierszy = Array.from({ length: 1000 }, () => ({
    data: '2026-07-01', kwota: '1.00', typ: 'WYDATEK', opis: null, forma_platnosci: null, kategoria: '(bez kategorii)',
  }));
  zerujDlaTrasy(WIERSZ_TOKENU(), tysiacWierszy);
  const resPelnyLimit = fakeRes();
  await wywolajTrase(r10a, reqGet('/wpisy', { od: '2026-07-01', do: '2026-07-31' }, SEKRET), resPelnyLimit);
  ok(resPelnyLimit.body.ucieto === true, 'dokładnie LIMIT wierszy z bazy → ucieto:true (konsument NIE ma prawa uznać tego za komplet)');

  resetModuly();
  const r10b = require('../src/ro/api');
  zerujDlaTrasy(WIERSZ_TOKENU(), [{
    data: '2026-07-15', kwota: '99.90', typ: 'WYDATEK', opis: 'zakupy',
    forma_platnosci: 'GOTÓWKA', kategoria: 'Dom > Jedzenie',
  }]);
  const resNiepelny = fakeRes();
  await wywolajTrase(r10b, reqGet('/wpisy', { od: '2026-07-01', do: '2026-07-31' }, SEKRET), resNiepelny);
  ok(resNiepelny.body.ucieto === false, 'mniej niż LIMIT wierszy → ucieto:false');

  // ---------- 12) happy path: /podsumowanie zwraca LICZBY, poprawny kształt (whitelist kluczy) ----------
  resetModuly();
  const r11 = require('../src/ro/api');
  zerujDlaTrasy(WIERSZ_TOKENU(), [{ ledger_id: 1, type: 'WYDATEK', suma: '123.45', n: 4 }]);
  const resPodsum = fakeRes();
  await wywolajTrase(r11, reqGet('/podsumowanie', { od: '2026-07-01', do: '2026-07-31' }, SEKRET), resPodsum);
  rowne(resPodsum.statusCode, 200, 'podsumowanie w zasięgu → 200');
  ok(typeof resPodsum.body.pozycje[0].suma === 'number', 'suma jest liczbą, nie napisem z SQL');
  const kluczePodsum = Object.keys(resPodsum.body.pozycje[0]).sort();
  rowne(kluczePodsum, ['ledger_id', 'n', 'suma', 'type'].sort(), 'klucze pozycji podsumowania to WYŁĄCZNIE dozwolona whitelista');

  // ---------- 13) happy path: /wpisy — brak jakiegokolwiek pola osobowego ----------
  const DOZWOLONE_WPISY = ['data', 'kwota', 'typ', 'kategoria', 'opis', 'payment_method'];
  const klucze = Object.keys(resNiepelny.body.items[0]);
  rowne(klucze.sort(), [...DOZWOLONE_WPISY].sort(), 'klucze wpisu — dokładnie whitelista, nic więcej');
  ['user_id', 'uid', 'email', 'nazwisko', 'user_name', 'id'].forEach((pole) => {
    ok(!(pole in resNiepelny.body.items[0]), `pole osobowe/id "${pole}" NIEOBECNE w odpowiedzi /wpisy`);
  });

  // ---------- 14) req.roToken.name = NAZWA TOKENU (api_tokens.name), NIGDY imię człowieka ----------
  const zapytanieTokenu = baza.zapytania.find((z) => z.sql.includes('FROM api_tokens'));
  ok(zapytanieTokenu.sql.includes('api_tokens.name AS token_name'), 'zapytanie pobiera api_tokens.name AS token_name');
  ok(!zapytanieTokenu.sql.includes('users.name'), 'zapytanie NIE pobiera users.name (imienia człowieka) w ogóle');

  // ---------- 15) /kategorie — tablica napisów (ścieżek), bez id/userów ----------
  resetModuly();
  const r12 = require('../src/ro/api');
  zerujDlaTrasy(WIERSZ_TOKENU(), [{ prefiks: 'Dom > ', nazwa: 'Czynsz' }, { prefiks: '', nazwa: 'Jedzenie' }]);
  const resKat = fakeRes();
  await wywolajTrase(r12, reqGet('/kategorie', {}, SEKRET), resKat);
  rowne(resKat.body.items, ['Dom > Czynsz', 'Jedzenie'], 'kategorie jako gotowe ścieżki-napisy');
  ok(resKat.body.items.every((x) => typeof x === 'string'), 'każda pozycja to czysty napis, nie obiekt z id');

  // ---------- 16) /produkty/koszyk — pozycje BEZ produktu wracają osobną liczbą, nie znikają ----------
  resetModuly();
  const r13 = require('../src/ro/api');
  zerujDlaTrasy(WIERSZ_TOKENU(),
    [{ name: 'Mleko', unit: 'l', kategoria: 'Nabiał', zakupow: 3, ilosc: '3.000', wydano: '12.00' }],
    [{ n: 2, wydano: '7.50' }]);
  const resKoszyk = fakeRes();
  await wywolajTrase(r13, reqGet('/produkty/koszyk', { od: '2026-07-01', do: '2026-07-31' }, SEKRET), resKoszyk);
  rowne(resKoszyk.body.bez_produktu, { pozycji: 2, wydano: 7.5 },
    'pozycje BEZ product_id wracają jako bez_produktu, suma koszyka nie jest zaniżona bez śladu');

  // ---------- 17) grep: router (ro/api.js) nie zawiera ŻADNEGO zapisu ----------
  const zrodloApi = fs.readFileSync(path.join(__dirname, '../src/ro/api.js'), 'utf8');
  const trafieniaRouter = (zrodloApi.match(/\b(INSERT|UPDATE|DELETE)\b|pool\.execute/g) || []);
  rowne(trafieniaRouter, [], 'ro/api.js (router odpowiadający na GET) — zero słów INSERT/UPDATE/DELETE/pool.execute');

  // ---------- 18) auth.js: zapisy istnieją, ale WYŁĄCZNIE na tabeli api_tokens ----------
  const zrodloAuth = fs.readFileSync(path.join(__dirname, '../src/ro/auth.js'), 'utf8');
  const liniePiszace = zrodloAuth.split('\n').filter((l) => /\b(INSERT|UPDATE|DELETE)\b/.test(l));
  ok(liniePiszace.length > 0, 'auth.js rzeczywiście pisze (housekeeping tokenów — wydanie/unieważnienie/last_used_at)');
  ok(liniePiszace.every((l) => l.includes('api_tokens')), 'KAŻDY zapis w auth.js dotyczy wyłącznie tabeli api_tokens (nigdy księgi)');
  ok(!zrodloAuth.includes('pool.execute'), 'auth.js nie woła pool.execute bezpośrednio — tylko q() z ../db');
  ok(!zrodloAuth.includes('timingSafeEqual('),
    'auth.js NIE WOŁA zbędnego crypto.timingSafeEqual (dozwolona wzmianka w komentarzu z uzasadnieniem) — lookup po sha256 w WHERE jest wystarczający');

  // ---------- 19) uniewaznij działa tylko dla WŁAŚCICIELA tokenu ----------
  resetModuly();
  const auth2 = require('../src/ro/auth');
  zeruj({ affectedRows: 1 });
  const wynikOk = await auth2.uniewaznij(7, 5);
  rowne(baza.zapytania[0].par, { id: 7, u: 5 }, 'uniewaznij przekazuje id tokenu I id właściciela do WHERE');
  ok(baza.zapytania[0].sql.includes('user_id = :u'), 'zapytanie unieważnienia filtruje po user_id (cudzy token nietykalny)');
  ok(wynikOk === true, 'affectedRows=1 → uniewaznij zwraca true');
  zeruj({ affectedRows: 0 });
  ok((await auth2.uniewaznij(7, 999)) === false, 'obcy właściciel (999) → affectedRows=0 → false');

  // ---------- 20) zapiszDostep loguje endpoint w konwencji "ro:/ścieżka" (spójnie z eksportem) ----------
  resetModuly();
  const r14 = require('../src/ro/api');
  zerujDlaTrasy(WIERSZ_TOKENU(), [{ ledger_id: 1, type: 'WYDATEK', suma: '1.00', n: 1 }]);
  const resDlaLogu = fakeRes();
  await wywolajTrase(r14, reqGet('/podsumowanie', { od: '2026-07-01', do: '2026-07-31' }, SEKRET), resDlaLogu);
  await puls();
  const wpisDoLogu = baza.zapytania.find((z) => z.sql.includes('INSERT INTO access_log'));
  ok(!!wpisDoLogu, 'zapiszDostep faktycznie wywołuje INSERT do access_log (Z11)');
  rowne(wpisDoLogu.par.endpoint, 'ro:/podsumowanie', 'endpoint w rejestrze to "ro:/podsumowanie", konwencja spójna z eksportem');

  // ---------- 21) inspekcja 2026-07-30: RO-API pomija zarchiwizowane paragony (Z19) ----------
  const zrodloRo = fs.readFileSync(path.join(__dirname, '../src/ro/api.js'), 'utf8');
  ok(/const zasieg = [^;]*zywyParagon\('r'\)/.test(zrodloRo), 'koszyk RO-API: żywość we wspólnym `zasieg`');
  ok(/zywyParagon\('r'\)[^;]*AND i\.quantity > 0/.test(zrodloRo), 'drozeje RO-API: żywość w WHERE');

  console.log(`\n${bledy === 0 ? 'OK' : 'BŁĄD'}: test-ro-api — ${bledy} błędów`);
  process.exit(bledy === 0 ? 0 : 1);
})();
