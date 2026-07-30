#!/usr/bin/env node
// Z22/K5: GET /transactions/skroty (baza podstawiona, wzorzec test-transakcje.js) + wyścig
// dedupe kolejki offline (POST łapiący ER_DUP_ENTRY na uq_tx_user_offref z migracji 021).
const Module = require('module');

let bledy = 0;
function ok(warunek, opis) {
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}
const rowne = (a, b, opis) => ok(JSON.stringify(a) === JSON.stringify(b), `${opis} → ${JSON.stringify(a)}`);

const baza = { zapytania: [] };
const q = async (sql, par) => {
  baza.zapytania.push({ sql: sql.replace(/\s+/g, ' ').trim(), par });
  if (baza.blad) { const e = baza.blad; baza.blad = null; throw e; }
  const gotowa = baza.odpowiedzi.shift();
  return gotowa === undefined ? [] : gotowa;
};
// routes/transactions.js robi `const { q } = require('../db')` RAZ, przy pierwszym require —
// więc podstawiona atrapa musi być gotowa (i podmienialna) ZANIM router się zaimportuje.
function podstawDb(qFn) {
  require.cache[require.resolve('../src/db')] = new Module(require.resolve('../src/db'));
  require.cache[require.resolve('../src/db')].exports = { q: qFn, pool: null };
  require.cache[require.resolve('../src/db')].loaded = true;
}
function resetModuly(qFn) {
  for (const m of ['../src/db', '../src/routes/transactions']) delete require.cache[require.resolve(m)];
  podstawDb(qFn || q);
}
const zeruj = (...odp) => { baza.zapytania = []; baza.odpowiedzi = odp; baza.blad = null; };

function fakeRes() {
  const res = { statusCode: 200, body: null };
  return res;
}
function wywolaj(router, req) {
  const res = fakeRes();
  return new Promise((resolve) => {
    res.json = (b) => { res.body = b; resolve(res); };
    res.status = (c) => { res.statusCode = c; return res; };
    router.handle(req, res, (err) => { if (err) baza.dalej = err; resolve(res); });
  });
}
const req = (over) => ({ user: { role: 'admin', uid: 1 }, body: {}, params: {}, query: {}, ...over });

(async () => {
  // ---------- 1) skróty: żywe wydatki z ostatnich 90 dni, filtr scopeWhere widoczny w SQL ----------
  resetModuly();
  const r1 = require('../src/routes/transactions');
  zeruj([
    { category_id: 3, category_name: 'Jedzenie', kwota: 45, n: 8 },
    { category_id: 5, category_name: 'Paliwo', kwota: 200, n: 3 },
  ]);
  const res1 = await wywolaj(r1, req({ method: 'GET', url: '/skroty' }));
  rowne(res1.body.rows.length, 2, 'skróty: zwraca wiersze z bazy');
  ok(/t\.type\s*=\s*'WYDATEK'/.test(baza.zapytania[0].sql), 'skróty: SQL filtruje TYLKO WYDATEK');
  ok(/deleted_at IS NULL/.test(baza.zapytania[0].sql), 'skróty: SQL pomija wpisy z Kosza (żywe)');
  ok(/INTERVAL 90 DAY/.test(baza.zapytania[0].sql), 'skróty: SQL ogranicza do ostatnich 90 dni');
  ok(/LIMIT 5/.test(baza.zapytania[0].sql), 'skróty: SQL ma LIMIT 5');

  // ---------- 2) skróty: autoryzacja zasięgu (junior ownOnly → filtr user_id w SQL) ----------
  resetModuly();
  const r2 = require('../src/routes/transactions');
  zeruj([]);
  await wywolaj(r2, req({ method: 'GET', url: '/skroty', user: { role: 'junior', uid: 9 } }));
  ok(/user_id\s*=\s*:uid/.test(baza.zapytania[0].sql), 'skróty: junior dostaje filtr własności (scopeWhere/ownOnly)');

  // ---------- 3) skróty: brak historii (nowy user) → pusta lista, nie błąd ----------
  resetModuly();
  const r3 = require('../src/routes/transactions');
  zeruj([]);
  const res3 = await wywolaj(r3, req({ method: 'GET', url: '/skroty' }));
  rowne(res3.body, { rows: [] }, 'skróty: brak historii → { rows: [] }');

  // ---------- 4) POST: wyścig dedupe — ER_DUP_ENTRY na INSERT → 200 deduped:true z istniejącym id ----------
  // atrapa: SELECT-dedupe (szybka ścieżka) widzi pustkę — rywal jeszcze nie zdążył commitować,
  // ale wygrywa wyścig chwilę później, więc nasz INSERT rzuca ER_DUP_ENTRY (migracja 021)
  let liczbaZapytan = 0;
  const qDupe = async (sql, par) => {
    liczbaZapytan++;
    baza.zapytania.push({ sql: sql.replace(/\s+/g, ' ').trim(), par });
    if (/^SELECT id FROM transactions WHERE legacy_id/.test(sql.trim()) && liczbaZapytan === 1) return []; // dedupe szybka ścieżka: pusto
    if (/^INSERT INTO transactions/.test(sql.trim())) { const e = new Error('Duplicate entry'); e.code = 'ER_DUP_ENTRY'; throw e; }
    if (/^SELECT id FROM transactions WHERE legacy_id/.test(sql.trim())) return [{ id: 77 }]; // po INSERT: dociągamy zwycięzcę wyścigu
    return [];
  };
  resetModuly(qDupe);
  const r4 = require('../src/routes/transactions');
  const req4 = req({ method: 'POST', url: '/', body: {
    ledger_id: 1, tx_date: '2026-07-01', type: 'WYDATEK', amount: '10', client_ref: 'off:zawodyabc123' } });
  const res4 = await wywolaj(r4, req4);
  rowne(res4.statusCode, 200, 'POST wyścig ER_DUP_ENTRY → 200 (nie 500)');
  rowne(res4.body, { id: 77, deduped: true }, 'POST wyścig ER_DUP_ENTRY → deduped:true z id zwycięzcy');

  // ---------- 5) POST: inny błąd SQL (nie ER_DUP_ENTRY) nadal leci jako błąd, nie tłumiony ----------
  const qInny = async (sql, par) => {
    if (/^SELECT id FROM transactions WHERE legacy_id/.test(sql.trim())) return [];
    if (/^INSERT INTO transactions/.test(sql.trim())) { const e = new Error('baza padła'); e.code = 'ER_LOCK_WAIT_TIMEOUT'; throw e; }
    return [];
  };
  resetModuly(qInny);
  const r5 = require('../src/routes/transactions');
  let zlapano = null;
  const req5 = req({ method: 'POST', url: '/', body: {
    ledger_id: 1, tx_date: '2026-07-01', type: 'WYDATEK', amount: '10', client_ref: 'off:innybladxyz1' } });
  const res5 = fakeRes();
  await new Promise((resolve) => {
    res5.json = (b) => { res5.body = b; resolve(); };
    res5.status = (c) => { res5.statusCode = c; return res5; };
    r5.handle(req5, res5, (err) => { zlapano = err; resolve(); });
  });
  ok(zlapano && zlapano.code === 'ER_LOCK_WAIT_TIMEOUT', 'POST: błąd SQL inny niż ER_DUP_ENTRY leci dalej do next(e), nie jest tłumiony');

  console.log(`\n${bledy === 0 ? 'OK' : 'BŁĄD'}: test-wpis-skroty — ${bledy} błędów`);
  process.exit(bledy === 0 ? 0 : 1);
})();
