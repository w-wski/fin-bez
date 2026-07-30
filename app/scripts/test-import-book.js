#!/usr/bin/env node
// Z23/K4: routes/imports.js POST /book na PODSTAWIONEJ bazie (wzorzec test-rejestry.js).
// Zaksięgowanie tworzy wpis powiązany bank_tx_id; podwójne /book tego samego bank_tx = odmowa
// (SELECT WHERE matched_transaction_id IS NULL już nic nie zwraca po pierwszym księgowaniu);
// autoryzacja księgi (ownOnly=true / poza zasięgiem = odmowa).
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

// Atrapa connection dla pool.getConnection() (/book księguje w transakcji SQL).
function atrapaConn(log, plan) {
  const next = (typ) => {
    const krok = plan.shift();
    if (krok === undefined) throw new Error(`atrapa: brak zaplanowanej odpowiedzi na ${typ}`);
    return krok;
  };
  return {
    beginTransaction: async () => log.push('BEGIN'),
    commit: async () => log.push('COMMIT'),
    rollback: async () => log.push('ROLLBACK'),
    release: () => log.push('RELEASE'),
    execute: async (sql) => { log.push(sql.replace(/\s+/g, ' ').trim()); return [next('execute')]; },
    query: async (sql) => { log.push(sql.replace(/\s+/g, ' ').trim()); return [next('query')]; },
  };
}
function podstawModuly(planConn) {
  const log = [];
  const conn = atrapaConn(log, planConn || []);
  require.cache[require.resolve('../src/db')] = new Module(require.resolve('../src/db'));
  require.cache[require.resolve('../src/db')].exports = { q, pool: { getConnection: async () => conn } };
  require.cache[require.resolve('../src/db')].loaded = true;
  return log;
}
function resetModuly() {
  for (const m of ['../src/db', '../src/routes/imports']) delete require.cache[require.resolve(m)];
}
const zeruj = (...odp) => { baza.zapytania = []; baza.odpowiedzi = odp; baza.zepsuta = false; };

function fakeRes() {
  const res = { statusCode: 200, body: null,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; } };
  return res;
}
async function wolaj(router, req) {
  const res = fakeRes();
  await new Promise((resolve) => {
    res.json = (b) => { res.body = b; resolve(); return res; };
    res.status = (c) => { res.statusCode = c; return res; };
    router.handle(req, res, resolve);
  });
  return res;
}
const BT = { id: 33, ledger_id: 1, amount: -49.99, currency: 'PLN',
  counterparty: 'BIEDRONKA 123', title: 'ZAKUP', transaction_date: '2026-07-10', balance: 100 };
const reqBook = (over) => ({ method: 'POST', url: '/book',
  user: { role: 'admin', uid: 1 }, body: { bank_tx_id: 33 }, ...over });

(async () => {
  // ---------- 1) happy path: /book tworzy wpis powiązany bank_tx_id ----------
  resetModuly();
  const plan1 = podstawModuly([
    { insertId: 701 },        // INSERT INTO transactions (...,bank_tx_id)
    { affectedRows: 1 },      // UPDATE bank_transactions SET matched_transaction_id=?
  ]);
  zeruj([BT]); // SELECT * FROM bank_transactions WHERE id=:id AND matched_transaction_id IS NULL
  const router1 = require('../src/routes/imports');
  const res1 = await wolaj(router1, reqBook());
  rowne(res1.statusCode, 201, '/book happy path → 201');
  rowne(res1.body.id, 701, '/book zwraca id nowego wpisu księgi');
  ok(plan1.some((s) => /INSERT INTO transactions/.test(s) && /bank_tx_id/.test(s)),
    '/book zapisuje wpis Z KOLUMNĄ bank_tx_id (powiązanie z wierszem bankowym)');
  ok(plan1.includes('BEGIN') && plan1.includes('COMMIT'), '/book idzie w transakcji SQL');

  // ---------- 2) podwójne /book tego samego bank_tx: już matched → SELECT nic nie zwraca → 404 ----------
  // WHERE matched_transaction_id IS NULL w SELECT-cie sam z siebie wyklucza wiersz zaksięgowany
  // wcześniej — drugie żądanie nie tworzy drugiego wpisu, dostaje odmowę.
  resetModuly();
  podstawModuly([]);
  zeruj([]); // bank_tx już ma matched_transaction_id ustawiony → warunek WHERE go nie łapie
  const router2 = require('../src/routes/imports');
  const res2 = await wolaj(router2, reqBook());
  rowne(res2.statusCode, 404, 'podwójne /book tego samego bank_tx_id → 404, nie duplikuje wpisu');
  rowne(res2.body.error, 'not_found', 'kod błędu not_found przy powtórnym /book');
  ok(baza.zapytania.length === 1, 'powtórne /book kończy się na SELECT-cie — żaden pool.getConnection() nie jest wołany, brak drugiego INSERT-u');

  // ---------- 3) autoryzacja księgi: junior (ownOnly=true) nie może księgować w ogóle ----------
  resetModuly();
  podstawModuly([]);
  zeruj();
  const router3 = require('../src/routes/imports');
  const res3 = await wolaj(router3, reqBook({ user: { role: 'junior', uid: 9 } }));
  rowne(res3.statusCode, 403, 'NEGATYWNY: junior (ownOnly) → 403 na /book, przed dotknięciem bazy');
  rowne(res3.body.error, 'forbidden', 'kod błędu forbidden');
  ok(baza.zapytania.length === 0, 'junior odrzucony PRZED jakimkolwiek zapytaniem do bazy');

  // ---------- 4) autoryzacja księgi: bank_tx z księgi POZA zasięgiem użytkownika (IDOR) → 404 ----------
  // company ma zasięg [2] (PERSEVERA); BT.ledger_id=1 (RODZINA) — SELECT go znajdzie, ale scope
  // sprawdza się PO zapytaniu (wzorzec imports.js): scope.ledgers.includes(rows[0].ledger_id).
  resetModuly();
  podstawModuly([]);
  zeruj([BT]);
  const router4 = require('../src/routes/imports');
  const res4 = await wolaj(router4, reqBook({ user: { role: 'company', uid: 5 } }));
  rowne(res4.statusCode, 404, 'NEGATYWNY: bank_tx_id z cudzej księgi (poza zasięgiem) → 404, nie zdradza istnienia');
  rowne(res4.body.error, 'not_found', 'kod błędu not_found przy IDOR');

  // ---------- 5) samouczenie: jawnie podana kategoria WCHODZI do wpisu i nie jest auto_categorized ----------
  // Kolejność zapytań w handlerze /book przy jawnej category_id: SELECT bank_transactions (q) →
  // learnMapping() odpala INSERT ... ON DUPLICATE KEY (q, „fire and forget", ale JEJ CIAŁO
  // startuje synchronicznie przed pierwszym await) → SELECT dominującego typu kategorii (q) →
  // dopiero potem transakcja SQL (conn) z INSERT-em wpisu i UPDATE-em bank_transactions.
  resetModuly();
  const plan5 = podstawModuly([
    { insertId: 702 },        // conn.execute: INSERT INTO transactions
    { affectedRows: 1 },      // conn.execute: UPDATE bank_transactions SET matched_transaction_id=?
  ]);
  zeruj([BT], { affectedRows: 1 }, [{ type: 'WYDATEK' }]);
  const router5 = require('../src/routes/imports');
  const res5 = await wolaj(router5, reqBook({ body: { bank_tx_id: 33, category_id: 7 } }));
  rowne(res5.statusCode, 201, '/book z jawną kategorią → 201');
  rowne(res5.body.category_id, 7, '/book zapisuje PODANĄ kategorię');
  rowne(res5.body.auto_categorized, false, 'kategoria podana jawnie → auto_categorized:false');
  ok(plan5.some((s) => /INSERT INTO transactions/.test(s) && /bank_tx_id/.test(s)),
    '/book z kategorią też zapisuje bank_tx_id');

  console.log(`\n${bledy === 0 ? 'OK' : 'BŁĄD'}: test-import-book — ${bledy} błędów`);
  process.exit(bledy === 0 ? 0 : 1);
})();
