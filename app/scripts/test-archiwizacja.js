#!/usr/bin/env node
// Test archiwizacji paragonów/importów (Z19). Wzorzec module-swap z test-raport-wpisy.js:
// podstawiamy src/db (fake q + fake pool.getConnection) i wywołujemy trasy bezpośrednio,
// bez prawdziwej bazy MySQL (której tu nie ma — patrz artefakt oddania, sekcja "czego nie
// sprawdziłem").
const path = require('path');
const fs = require('fs');
const Module = require('module');

let bledy = 0;
function ok(warunek, opis) {
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}

// ---------- fake baza: q() z kolejką odpowiedzi, pool z transakcyjnym conn ----------
function fakeConn(zapytania) {
  const conn = {
    async beginTransaction() { zapytania.push({ op: 'begin' }); },
    async commit() { zapytania.push({ op: 'commit' }); },
    async rollback() { zapytania.push({ op: 'rollback' }); },
    async execute(sql, params) { zapytania.push({ op: 'execute', sql: sql.replace(/\s+/g, ' ').trim(), params }); return [{ affectedRows: 1 }]; },
    async query(sql, params) {
      zapytania.push({ op: 'query', sql: sql.replace(/\s+/g, ' ').trim(), params });
      const gotowa = conn._odpowiedzi.shift();
      return [gotowa === undefined ? [] : gotowa];
    },
    release() {},
    _odpowiedzi: [],
  };
  return conn;
}

function podstawModul(sciezka, tresc) {
  const abs = require.resolve(sciezka);
  require.cache[abs] = new Module(abs);
  require.cache[abs].exports = tresc;
  require.cache[abs].loaded = true;
}

function fakeRes() {
  const res = { statusCode: 200, body: null, status(c) { res.statusCode = c; return res; }, json(b) { res.body = b; return res; } };
  return res;
}
function wywolajTrase(router, req, res) {
  return new Promise((resolve, reject) => {
    res.json = (b) => { res.body = b; resolve(); return res; };
    router(req, res, (e) => (e ? reject(e) : resolve()));
  });
}

function resetModuly(dodatkowe = []) {
  for (const m of ['../src/db', '../src/auth', '../src/ocr/dostep',
    '../src/routes/receipts-archiwum', '../src/routes/imports-archiwum', ...dodatkowe]) {
    try { delete require.cache[require.resolve(m)]; } catch { /* moduł jeszcze nie ładowany — nic do czyszczenia */ }
  }
}

(async () => {
  // ---------- 1-2: DELETE paragonu ARCHIWIZUJE (UPDATE), nie kasuje wiersza; jedna transakcja ----------
  {
    resetModuly();
    const zapytania = [];
    const conn = fakeConn(zapytania);
    podstawModul('../src/db', { q: async () => [{ id: 7, ledger_id: 1, user_id: 1, deleted_at: null, transaction_id: 99 }], pool: { getConnection: async () => conn } });
    podstawModul('../src/auth', { ledgerScope: () => ({ ledgers: [1], ownOnly: false }) });
    const router = require('../src/routes/receipts-archiwum');
    const req = { method: 'DELETE', url: '/7', params: { id: '7' }, user: { uid: 1, role: 'adult' } };
    const res = fakeRes();
    await wywolajTrase(router, req, res);
    ok(res.body && res.body.ok === true, 'DELETE /receipts/:id odpowiada ok:true');
    const upd = zapytania.filter((z) => z.op === 'execute');
    ok(upd.every((z) => /^UPDATE/.test(z.sql)) && !upd.some((z) => /^DELETE/.test(z.sql)),
      'archiwizacja paragonu to same UPDATE-y, ŻADEN DELETE (K1: nic nie znika twardo)');
    ok(upd.some((z) => /UPDATE transactions SET deleted_at/.test(z.sql)),
      'wpis księgi (transaction_id) dostaje deleted_at TĄ SAMĄ operacją co paragon');
    ok(zapytania[0].op === 'begin' && zapytania[zapytania.length - 1].op === 'commit',
      'archiwizacja paragonu idzie w JEDNEJ transakcji SQL (begin...commit)');
  }

  // ---------- 3: restore paragonu symetryczny (deleted_at -> NULL, oba wiersze) ----------
  {
    resetModuly();
    const zapytania = [];
    const conn = fakeConn(zapytania);
    podstawModul('../src/db', { q: async () => [{ id: 7, ledger_id: 1, user_id: 1, deleted_at: '2026-07-30 10:00:00', transaction_id: 99 }], pool: { getConnection: async () => conn } });
    podstawModul('../src/auth', { ledgerScope: () => ({ ledgers: [1], ownOnly: false }) });
    const router = require('../src/routes/receipts-archiwum');
    const req = { method: 'POST', url: '/7/restore', params: { id: '7' }, user: { uid: 1, role: 'adult' } };
    const res = fakeRes();
    await wywolajTrase(router, req, res);
    const upd = zapytania.filter((z) => z.op === 'execute');
    ok(res.body?.ok === true && upd.some((z) => /deleted_at = NULL/.test(z.sql) && /receipts/.test(z.sql))
      && upd.some((z) => /deleted_at = NULL/.test(z.sql) && /transactions/.test(z.sql)),
      'restore przywraca RÓWNOCZEŚNIE paragon i jego wpis w księdze (symetria z DELETE)');
  }

  // ---------- 4: autoryzacja — cudzy paragon = 404, nie ma UPDATE-u ----------
  {
    resetModuly();
    const zapytania = [];
    const conn = fakeConn(zapytania);
    // wlasnyParagon (ocr/dostep.js) czyta receipts przez src/db.q — user_id 999 != req.user.uid
    podstawModul('../src/db', { q: async () => [{ id: 7, ledger_id: 1, user_id: 999, deleted_at: null }], pool: { getConnection: async () => conn } });
    podstawModul('../src/auth', { ledgerScope: () => ({ ledgers: [1], ownOnly: false }) });
    const router = require('../src/routes/receipts-archiwum');
    const req = { method: 'DELETE', url: '/7', params: { id: '7' }, user: { uid: 1, role: 'adult' } };
    const res = fakeRes();
    await wywolajTrase(router, req, res);
    ok(res.statusCode === 404 && zapytania.length === 0,
      'cudzy paragon (inny user_id, rola adult) → 404, ZERO zapytań zmieniających dane');
  }

  // ---------- 5-6: wycofanie importu obejmuje WYŁĄCZNIE wpisy z TEGO importu, jedna transakcja ----------
  {
    resetModuly();
    const zapytania = [];
    const conn = fakeConn(zapytania);
    conn._odpowiedzi = [
      [{ id: 501, tx_date: '2026-07-10', ledger_id: 1 }, { id: 502, tx_date: '2026-07-15', ledger_id: 1 }], // wpisy do wycofania
      { affectedRows: 2 },                              // UPDATE transactions (query)
      { affectedRows: 1 },                              // UPDATE analizy (query)
    ];
    podstawModul('../src/db', {
      q: async (sql) => {
        if (/FROM bank_imports WHERE id/.test(sql)) return [{ id: 3, deleted_at: null }];
        return [];
      },
      pool: { getConnection: async () => conn },
    });
    podstawModul('../src/auth', { ledgerScope: () => ({ ledgers: [1], ownOnly: false }) });
    const router = require('../src/routes/imports-archiwum');
    const req = { method: 'DELETE', url: '/3', params: { id: '3' }, user: { uid: 1, role: 'adult' } };
    const res = fakeRes();
    await wywolajTrase(router, req, res);
    const selectTx = zapytania.find((z) => z.op === 'query' && /JOIN bank_transactions bt ON bt\.id = t\.bank_tx_id/.test(z.sql));
    ok(!!selectTx && /bt\.import_id = \?/.test(selectTx.sql),
      'zapytanie o wpisy do wycofania filtruje PO import_id — nie "wszystkie wpisy CSV"');
    ok(res.body?.ok === true && res.body.wycofane_wpisy === 2, 'wycofanie zgłasza dokładnie tyle wpisów, ile znaleziono dla TEGO importu');
    ok(zapytania[0].op === 'begin' && zapytania[zapytania.length - 1].op === 'commit',
      'wycofanie importu (K4) idzie w JEDNEJ transakcji SQL');
    ok(!zapytania.some((z) => /^DELETE/.test(z.sql || '')), 'wycofanie importu nie zawiera ŻADNEGO twardego DELETE');
  }

  // ---------- 8: 409 na duplikat file_hash (drugi upload TEGO SAMEGO pliku CSV) ----------
  {
    resetModuly(['multer', '../src/routes/imports']);
    podstawModul('../src/db', { q: async (sql) => (/FROM bank_imports WHERE file_hash/.test(sql) ? [{ id: 55, imported_at: '2026-07-01' }] : []), pool: { getConnection: async () => fakeConn([]) } });
    podstawModul('../src/auth', { ledgerScope: () => ({ ledgers: [1], ownOnly: false }) });
    podstawModul('multer', Object.assign(function multerStub() { return { single: () => (req, res, next) => next() }; }, { memoryStorage: () => ({}) }));
    const router = require('../src/routes/imports');
    const req = { method: 'POST', url: '/csv', body: { ledger_id: '1' },
      file: { buffer: Buffer.from('a,b,c\n1,2,3'), originalname: 'wyciag.csv' }, user: { uid: 1, role: 'adult' } };
    const res = fakeRes();
    await wywolajTrase(router, req, res);
    ok(res.statusCode === 409 && res.body?.error === 'duplicate_import', 'drugi upload tego samego pliku CSV → 409 z czytelnym powodem');
  }

  // ---------- 9: pętla importu PRZEŻYWA błąd wiersza (nie przerywa się w połowie pliku) ----------
  {
    resetModuly(['multer', '../src/routes/imports', '../src/banks']);
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'z19-imports-'));
    process.env.IMPORTS_DIR = tmpDir;
    let callN = 0, zapisPodsumowania = null;
    podstawModul('../src/db', {
      q: async (sql, params) => {
        if (/FROM bank_imports WHERE file_hash/.test(sql)) return [];              // brak duplikatu
        if (/^INSERT INTO bank_imports/.test(sql)) return { insertId: 42 };
        if (/^INSERT INTO bank_transactions/.test(sql)) {
          callN++;
          if (callN === 2) { const e = new Error('kolumna spoza domeny'); e.code = 'ER_TRUNCATED_WRONG_VALUE'; throw e; }
          return {};
        }
        if (/^UPDATE bank_imports SET rows_ok/.test(sql)) { zapisPodsumowania = params; return {}; }
        return [];
      },
      pool: { getConnection: async () => fakeConn([]) },
    });
    podstawModul('../src/auth', { ledgerScope: () => ({ ledgers: [1], ownOnly: false }) });
    podstawModul('multer', Object.assign(function multerStub() { return { single: () => (req, res, next) => next() }; }, { memoryStorage: () => ({}) }));
    podstawModul('../src/banks', {
      parseBankFile: () => ({ bank: 'TESTBANK', errors: [], rows: [
        { transaction_date: '2026-07-01', booking_date: null, amount: -10, currency: 'PLN', counterparty: 'A', title: 'a', balance: 0, tx_hash: 'h1' },
        { transaction_date: '2026-07-02', booking_date: null, amount: -20, currency: 'PLN', counterparty: 'B', title: 'b', balance: 0, tx_hash: 'h2' },
        { transaction_date: '2026-07-03', booking_date: null, amount: -30, currency: 'PLN', counterparty: 'C', title: 'c', balance: 0, tx_hash: 'h3' },
      ] }),
    });
    const router = require('../src/routes/imports');
    const req = { method: 'POST', url: '/csv', body: { ledger_id: '1' },
      file: { buffer: Buffer.from('a,b,c\n1,2,3'), originalname: 'wyciag.csv' }, user: { uid: 1, role: 'adult' } };
    const res = fakeRes();
    let wyjatek = null;
    try { await wywolajTrase(router, req, res); } catch (e) { wyjatek = e; }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.IMPORTS_DIR;
    ok(!wyjatek, 'błąd INSERT-a inny niż duplikat NIE przerywa pętli (nie rzuca do next())');
    ok(res.statusCode === 201 && zapisPodsumowania && zapisPodsumowania.o === 2 && zapisPodsumowania.e === 1,
      `podsumowanie zapisane mimo błędu wiersza: 2 ok + 1 err (dostał: ${JSON.stringify(zapisPodsumowania)})`);
  }

  // ---------- 7: zywyParagon()/zywyImport() są UŻYTE w zapytaniach listy (grep, nie tylko zdefiniowane) ----------
  {
    const receipts = fs.readFileSync(path.join(__dirname, '../src/routes/receipts.js'), 'utf8');
    const imports = fs.readFileSync(path.join(__dirname, '../src/routes/imports.js'), 'utf8');
    ok(/zywyParagon\(/.test(receipts), 'routes/receipts.js UŻYWA zywyParagon() (nie własny warunek deleted_at)');
    ok(/zywyImport\(/.test(imports), 'routes/imports.js UŻYWA zywyImport() w liście importów');
  }

  console.log(`\n${bledy === 0 ? 'OK' : 'BŁĄD'}: test-archiwizacja — ${bledy} błędów`);
  process.exit(bledy === 0 ? 0 : 1);
})().catch((e) => { console.error('WYJĄTEK w teście:', e); process.exit(1); });
