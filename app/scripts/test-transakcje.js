#!/usr/bin/env node
// Z23/K2: routes/transactions.js na PODSTAWIONEJ bazie (wzorzec test-rejestry.js).
// POST (zapis poprawny; odrzucenie złej kwoty/typu/daty; dedupe client_ref), PATCH (cudzy
// wpis = odmowa), DELETE+restore (soft delete).
const Module = require('module');

let bledy = 0;
function ok(warunek, opis) {
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}
const rowne = (a, b, opis) => ok(JSON.stringify(a) === JSON.stringify(b), `${opis} → ${JSON.stringify(a)}`);

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
function resetModuly() {
  for (const m of ['../src/db', '../src/routes/transactions']) delete require.cache[require.resolve(m)];
  podstawDb();
}
const zeruj = (...odp) => { baza.zapytania = []; baza.odpowiedzi = odp; baza.zepsuta = false; };

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
const adminReq = (over) => ({ user: { role: 'admin', uid: 1 }, body: {}, params: {}, query: {}, ...over });

(async () => {
  // ---------- 1) POST: zapis poprawny ----------
  resetModuly();
  const r1 = require('../src/routes/transactions');
  zeruj({ insertId: 55 });
  const req1 = { method: 'POST', url: '/', user: { role: 'admin', uid: 1 },
    body: { ledger_id: 1, tx_date: '2026-07-01', type: 'WYDATEK', amount: '123,45' } };
  const res1 = fakeRes();
  await new Promise((resolve) => { res1.json = (b) => { res1.body = b; resolve(); }; res1.status = (c) => { res1.statusCode = c; return res1; }; r1.handle(req1, res1, resolve); });
  rowne(res1.statusCode, 201, 'POST poprawny wpis → 201');
  rowne(res1.body, { id: 55 }, 'POST zwraca insertId nowego wpisu');

  // ---------- 2) POST: zła kwota (zero, śmieć nieparsowalny, pusta) → 400 bad_input ----------
  // Uwaga: "-5" NIE jest złą kwotą — parseKwota() celowo ucina wiodący znak (kwota.js:
  // „znak wynika z type, nie z kwoty"), więc trafia tu WYŁĄCZNIE to, co parseKwota() zwraca
  // jako null albo <= 0.
  for (const zla of ['0', 'abc', '', '12x']) {
    resetModuly();
    const rx = require('../src/routes/transactions');
    zeruj();
    const req = { method: 'POST', url: '/', user: { role: 'admin', uid: 1 },
      body: { ledger_id: 1, tx_date: '2026-07-01', type: 'WYDATEK', amount: zla } };
    const res = fakeRes();
    await new Promise((resolve) => { res.json = (b) => { res.body = b; resolve(); }; res.status = (c) => { res.statusCode = c; return res; }; rx.handle(req, res, resolve); });
    rowne(res.statusCode, 400, `POST kwota "${zla}" → 400`);
    rowne(res.body.error, 'bad_input', `POST kwota "${zla}" → error bad_input`);
  }

  // ---------- 3) POST: zły typ (spoza WYDATEK/PRZYCHÓD/TRANSFER) → 400 ----------
  resetModuly();
  const r3 = require('../src/routes/transactions');
  zeruj();
  const req3 = { method: 'POST', url: '/', user: { role: 'admin', uid: 1 },
    body: { ledger_id: 1, tx_date: '2026-07-01', type: 'SKRADZIONE', amount: '10' } };
  const res3 = fakeRes();
  await new Promise((resolve) => { res3.json = (b) => { res3.body = b; resolve(); }; res3.status = (c) => { res3.statusCode = c; return res3; }; r3.handle(req3, res3, resolve); });
  rowne(res3.statusCode, 400, 'POST typ spoza listy → 400');
  rowne(res3.body.error, 'bad_input', 'POST typ spoza listy → error bad_input');

  // ---------- 4) POST: brak daty → 400 ----------
  resetModuly();
  const r4 = require('../src/routes/transactions');
  zeruj();
  const req4 = { method: 'POST', url: '/', user: { role: 'admin', uid: 1 },
    body: { ledger_id: 1, type: 'WYDATEK', amount: '10' } };
  const res4 = fakeRes();
  await new Promise((resolve) => { res4.json = (b) => { res4.body = b; resolve(); }; res4.status = (c) => { res4.statusCode = c; return res4; }; r4.handle(req4, res4, resolve); });
  rowne(res4.statusCode, 400, 'POST bez tx_date → 400');
  rowne(res4.body.error, 'bad_input', 'POST bez tx_date → error bad_input');

  // ---------- 5) POST: dedupe client_ref zwraca istniejący id, nie tworzy nowego ----------
  resetModuly();
  const r5 = require('../src/routes/transactions');
  zeruj([{ id: 99 }]); // SELECT ... WHERE legacy_id = client_ref → wpis już istnieje
  const req5 = { method: 'POST', url: '/', user: { role: 'admin', uid: 1 },
    body: { ledger_id: 1, tx_date: '2026-07-01', type: 'WYDATEK', amount: '10', client_ref: 'off:abcdef123456' } };
  const res5 = fakeRes();
  await new Promise((resolve) => { res5.json = (b) => { res5.body = b; resolve(); }; res5.status = (c) => { res5.statusCode = c; return res5; }; r5.handle(req5, res5, resolve); });
  rowne(res5.statusCode, 200, 'POST z client_ref duplikatu → 200 (nie 201, nic nowego nie powstało)');
  rowne(res5.body, { id: 99, deduped: true }, 'POST z client_ref duplikatu → zwraca istniejący id, deduped:true');
  ok(baza.zapytania.length === 1, 'dedupe: TYLKO SELECT sprawdzający — żaden INSERT nie poszedł do bazy');

  // ---------- 6) POST: księga poza zasięgiem (junior próbuje PERSEVERA=2) → 403 ----------
  resetModuly();
  const r6 = require('../src/routes/transactions');
  zeruj();
  const req6 = { method: 'POST', url: '/', user: { role: 'junior', uid: 9 },
    body: { ledger_id: 2, tx_date: '2026-07-01', type: 'WYDATEK', amount: '10' } };
  const res6 = fakeRes();
  await new Promise((resolve) => { res6.json = (b) => { res6.body = b; resolve(); }; res6.status = (c) => { res6.statusCode = c; return res6; }; r6.handle(req6, res6, resolve); });
  rowne(res6.statusCode, 403, 'NEGATYWNY: junior próbuje zapisać do księgi 2 (poza zasięgiem) → 403');
  rowne(res6.body.error, 'ledger_forbidden', 'kod błędu ledger_forbidden');

  // ---------- 7) PATCH: cudzy wpis (SELECT nic nie zwraca, bo scopeWhere+user_id nie trafia) = 404 ----------
  resetModuly();
  const r7 = require('../src/routes/transactions');
  zeruj([]); // SELECT t.id... WHERE t.id=:id AND ... → pusto: wpis cudzy albo poza zasięgiem
  const req7 = { method: 'PATCH', url: '/123', user: { role: 'junior', uid: 9 },
    params: { id: '123' }, body: { amount: '20' } };
  const res7 = fakeRes();
  await new Promise((resolve) => { res7.json = (b) => { res7.body = b; resolve(); }; res7.status = (c) => { res7.statusCode = c; return res7; }; r7.handle(req7, res7, resolve); });
  rowne(res7.statusCode, 404, 'PATCH cudzego/nieistniejącego wpisu → 404 (nie zdradza istnienia)');
  rowne(res7.body.error, 'not_found', 'kod błędu not_found');
  // Weryfikacja Z23: sam „pusty SELECT → 404" byłby atrapą — dowód autoryzacji leży w SQL.
  // Junior (ownOnly) MUSI dostać filtr własności w zapytaniu; bez tej asercji usunięcie
  // `AND t.user_id = :uid` ze scopeWhere przechodziłoby test bezszelestnie (IDOR).
  ok(baza.zapytania.length >= 1 && /user_id\s*=\s*:uid/.test(baza.zapytania[0].sql),
    'PATCH juniora: SELECT zawiera filtr własności user_id = :uid (scopeWhere/ownOnly)');
  ok(/deleted_at IS NULL/.test(baza.zapytania[0].sql),
    'PATCH juniora: SELECT pomija wpisy z Kosza (deleted_at IS NULL)');

  // ---------- 8) PATCH: poprawna zmiana kwoty → 200 ok:true ----------
  resetModuly();
  const r8 = require('../src/routes/transactions');
  zeruj([{ id: 5, ledger_id: 1, type: 'WYDATEK' }], { affectedRows: 1 });
  const req8 = { method: 'PATCH', url: '/5', user: { role: 'admin', uid: 1 },
    params: { id: '5' }, body: { amount: '55,00' } };
  const res8 = fakeRes();
  await new Promise((resolve) => { res8.json = (b) => { res8.body = b; resolve(); }; res8.status = (c) => { res8.statusCode = c; return res8; }; r8.handle(req8, res8, resolve); });
  rowne(res8.statusCode, 200, 'PATCH poprawna kwota → 200');
  rowne(res8.body, { ok: true }, 'PATCH zwraca ok:true');

  // ---------- 9) DELETE: soft delete → deleted_at ustawiony (affectedRows=0 przy braku = 404) ----------
  resetModuly();
  const r9 = require('../src/routes/transactions');
  zeruj({ affectedRows: 1 });
  const req9 = { method: 'DELETE', url: '/5', user: { role: 'admin', uid: 1 }, params: { id: '5' }, body: {} };
  const res9 = fakeRes();
  await new Promise((resolve) => { res9.json = (b) => { res9.body = b; resolve(); }; res9.status = (c) => { res9.statusCode = c; return res9; }; r9.handle(req9, res9, resolve); });
  rowne(res9.statusCode, 200, 'DELETE poprawny → 200 ok:true');
  ok(/deleted_at\s*=\s*NOW\(\)/.test(baza.zapytania[0].sql), 'DELETE to UPDATE ... deleted_at = NOW() — soft delete, nie DELETE FROM');

  resetModuly();
  const r9b = require('../src/routes/transactions');
  zeruj({ affectedRows: 0 });
  const req9b = { method: 'DELETE', url: '/999', user: { role: 'admin', uid: 1 }, params: { id: '999' }, body: {} };
  const res9b = fakeRes();
  await new Promise((resolve) => { res9b.json = (b) => { res9b.body = b; resolve(); }; res9b.status = (c) => { res9b.statusCode = c; return res9b; }; r9b.handle(req9b, res9b, resolve); });
  rowne(res9b.statusCode, 404, 'DELETE nieistniejącego/cudzego wpisu → 404');

  // ---------- 10) restore: przywraca wpis z kosza ----------
  resetModuly();
  const r10 = require('../src/routes/transactions');
  zeruj({ affectedRows: 1 });
  const req10 = { method: 'POST', url: '/5/restore', user: { role: 'admin', uid: 1 }, params: { id: '5' }, body: {} };
  const res10 = fakeRes();
  await new Promise((resolve) => { res10.json = (b) => { res10.body = b; resolve(); }; res10.status = (c) => { res10.statusCode = c; return res10; }; r10.handle(req10, res10, resolve); });
  rowne(res10.statusCode, 200, 'restore poprawny → 200 ok:true');
  ok(/deleted_at\s*=\s*NULL/.test(baza.zapytania[0].sql), 'restore czyści deleted_at na NULL');

  console.log(`\n${bledy === 0 ? 'OK' : 'BŁĄD'}: test-transakcje — ${bledy} błędów`);
  process.exit(bledy === 0 ? 0 : 1);
})();
