#!/usr/bin/env node
// Z23/K3: routes/receipts.js POST /:id/confirm na PODSTAWIONEJ bazie (wzorzec test-rejestry.js).
// Happy path tworzy wpis w księdze; odrzucenie niekompletnych pozycji (brak sumy/daty);
// ponowny confirm NIE dubluje wpisów (idempotencja przez status POTWIERDZONY).
//
// /confirm i ksieguj() (src/ocr/ksiega.js) korzystają z pool.getConnection() do transakcji SQL
// — bez serwera podstawiamy `pool` atrapą connection (wzorzec test-kategorie.js: atrapaPuli).
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

// Atrapa connection: obsługuje execute()/query() jak prawdziwy mysql2 (zwraca [wynik]).
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
// `planConn` = kolejka odpowiedzi WYŁĄCZNIE dla connection.execute()/query() (transakcja
// ksieguj()); odpowiedzi dla zwykłego q() (np. wlasnyParagon: SELECT * FROM receipts) idą
// osobno przez zeruj(), tak jak w test-rejestry.js — to DWIE różne drogi do bazy.
function podstawModuly(planConn) {
  const log = [];
  const conn = atrapaConn(log, planConn || []);
  require.cache[require.resolve('../src/db')] = new Module(require.resolve('../src/db'));
  require.cache[require.resolve('../src/db')].exports = { q, pool: { getConnection: async () => conn } };
  require.cache[require.resolve('../src/db')].loaded = true;
  return log;
}
function resetModuly() {
  for (const m of ['../src/db', '../src/ocr/dostep', '../src/ocr/ksiega', '../src/ocr/slownik', '../src/routes/receipts']) {
    delete require.cache[require.resolve(m)];
  }
}
const zeruj = (...odp) => { baza.zapytania = []; baza.odpowiedzi = odp; baza.zepsuta = false; };

function fakeRes() {
  const res = { statusCode: 200, body: null,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; } };
  return res;
}
async function wolajConfirm(router, req) {
  const res = fakeRes();
  await new Promise((resolve) => {
    res.json = (b) => { res.body = b; resolve(); return res; };
    res.status = (c) => { res.statusCode = c; return res; };
    router.handle(req, res, resolve);
  });
  return res;
}
const PARAGON = { id: 7, ledger_id: 1, user_id: 1, status: 'NOWY', total: '99.90',
  receipt_date: '2026-07-15', transaction_id: null, receipt_hash: 'abcdef0123456789abcdef01' };
const reqConfirm = (over) => ({ method: 'POST', url: '/7/confirm',
  user: { role: 'admin', uid: 1 }, params: { id: '7' }, body: {}, ...over });

(async () => {
  // ---------- 1) happy path: confirm tworzy wpis w księdze (INSERT + status POTWIERDZONY) ----------
  resetModuly();
  const plan1 = podstawModuly([
    { affectedRows: 1 },                         // UPDATE receipts SET status='POTWIERDZONY' (lock)
    { insertId: 501 },                           // INSERT INTO transactions
    { affectedRows: 1 },                         // UPDATE receipts SET transaction_id=?
  ]);
  zeruj([PARAGON]);                              // wlasnyParagon: SELECT * FROM receipts (przez q())
  const router1 = require('../src/routes/receipts');
  const res1 = await wolajConfirm(router1, reqConfirm());
  rowne(res1.statusCode, 201, 'confirm happy path → 201');
  rowne(res1.body, { transaction_id: 501 }, 'confirm zwraca id nowego wpisu w księdze');
  ok(plan1.includes('BEGIN') && plan1.includes('COMMIT'), 'confirm idzie w transakcji SQL (BEGIN...COMMIT)');
  ok(plan1.some((s) => /INSERT INTO transactions/.test(s)), 'confirm robi INSERT INTO transactions');

  // ---------- 2) odrzucenie niekompletnego paragonu: brak SUMY (total=null) → 400 bad_total ----------
  resetModuly();
  podstawModuly([]);
  zeruj([{ ...PARAGON, total: null }]);
  const router2 = require('../src/routes/receipts');
  const res2 = await wolajConfirm(router2, reqConfirm());
  rowne(res2.statusCode, 400, 'confirm bez sumy → 400');
  rowne(res2.body.error, 'bad_total', 'confirm bez sumy → error bad_total');

  // ---------- 3) odrzucenie niekompletnego paragonu: brak DATY → 400 no_date ----------
  resetModuly();
  podstawModuly([]);
  zeruj([{ ...PARAGON, receipt_date: null }]);
  const router3 = require('../src/routes/receipts');
  const res3 = await wolajConfirm(router3, reqConfirm());
  rowne(res3.statusCode, 400, 'confirm bez daty → 400');
  rowne(res3.body.error, 'no_date', 'confirm bez daty → error no_date');

  // ---------- 4) suma <= 0 też odrzucona (nie tylko brak) ----------
  resetModuly();
  podstawModuly([]);
  zeruj([{ ...PARAGON, total: '0' }]);
  const router4 = require('../src/routes/receipts');
  const res4 = await wolajConfirm(router4, reqConfirm());
  rowne(res4.statusCode, 400, 'confirm z sumą 0 → 400');
  rowne(res4.body.error, 'bad_total', 'confirm z sumą 0 → error bad_total');

  // ---------- 5) ponowny confirm NIE dubluje wpisu: status już POTWIERDZONY → krótka odpowiedź ----------
  resetModuly();
  podstawModuly([]);
  zeruj([{ ...PARAGON, status: 'POTWIERDZONY', transaction_id: 501 }]);
  const router5 = require('../src/routes/receipts');
  const res5 = await wolajConfirm(router5, reqConfirm());
  rowne(res5.statusCode, 200, 'ponowny confirm (już POTWIERDZONY) → 200, nie 201');
  rowne(res5.body, { transaction_id: 501, already_confirmed: true }, 'ponowny confirm zwraca already_confirmed:true, ten sam transaction_id');
  ok(baza.zapytania.length === 1, 'ponowny confirm na już potwierdzonym paragonie w ogóle nie próbuje INSERT-ować (żaden pool.getConnection() nie jest wołany)');

  // ---------- 6) wyścig: dwa równoległe confirm — drugi trafia na lock i NIE dubluje wpisu ----------
  // ksieguj(): UPDATE ... WHERE status<>'POTWIERDZONY' zwraca affectedRows=0, gdy pierwsze
  // żądanie już wygrało wyścig — to jest realny zamek idempotencji, nie tylko sprawdzenie statusu.
  resetModuly();
  podstawModuly([
    { affectedRows: 0 },                         // UPDATE ... WHERE status<>'POTWIERDZONY' — przegrywa wyścig
    [{ transaction_id: 501 }],                   // conn.query: SELECT transaction_id FROM receipts (po przegranym locku)
  ]);
  zeruj([{ ...PARAGON, status: 'NOWY' }]);       // wlasnyParagon widzi jeszcze NOWY (wyścig)
  const router6 = require('../src/routes/receipts');
  const res6 = await wolajConfirm(router6, reqConfirm());
  rowne(res6.statusCode, 200, 'przegrany wyścig o lock → 200, nie 201');
  rowne(res6.body, { transaction_id: 501, already_confirmed: true }, 'przegrany wyścig zwraca ten sam transaction_id co zwycięzca, nie tworzy drugiego wpisu');

  console.log(`\n${bledy === 0 ? 'OK' : 'BŁĄD'}: test-paragon-confirm — ${bledy} błędów`);
  process.exit(bledy === 0 ? 0 : 1);
})();
