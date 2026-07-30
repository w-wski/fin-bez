#!/usr/bin/env node
// Test Z18: licznik pozycji czekających na przypisanie produktu (GET /products/nieprzypisane-
// licznik) + spójność filtra zywyParagon w routes/products.js. Wzorzec module-swap
// z test-archiwizacja.js — bez prawdziwej bazy MySQL (patrz artefakt oddania).
const fs = require('fs');
const path = require('path');
const Module = require('module');

let bledy = 0;
function ok(warunek, opis) {
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}

function podstawModul(sciezka, tresc) {
  const abs = require.resolve(sciezka);
  require.cache[abs] = new Module(abs);
  require.cache[abs].exports = tresc;
  require.cache[abs].loaded = true;
}

function resetModuly() {
  for (const m of ['../src/db', '../src/auth', '../src/routes/products']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* jeszcze nie ładowany */ }
  }
}

function fakeRes() {
  const res = { statusCode: 200, body: null, status(c) { res.statusCode = c; return res; } };
  return res;
}
function wywolajTrase(router, req, res) {
  return new Promise((resolve, reject) => {
    res.json = (b) => { res.body = b; resolve(); return res; };
    router(req, res, (e) => (e ? reject(e) : resolve()));
  });
}

(async () => {
  // ---------- 1: brak ksiąg w zasięgu → n:0, ŻADNEGO zapytania do bazy ----------
  {
    resetModuly();
    let wolano = false;
    podstawModul('../src/db', { q: async () => { wolano = true; return []; }, pool: {} });
    podstawModul('../src/auth', { ledgerScope: () => ({ ledgers: [], ownOnly: false }) });
    const router = require('../src/routes/products');
    const req = { method: 'GET', url: '/nieprzypisane-licznik', query: {}, user: { uid: 1 } };
    const res = fakeRes();
    await wywolajTrase(router, req, res);
    ok(res.body && res.body.n === 0, 'brak ksiąg w zasięgu → licznik 0');
    ok(!wolano, 'bez ksiąg w zasięgu zapytanie do bazy w ogóle nie leci');
  }

  // ---------- 2: licznik liczy TYLKO NULL-e z ŻYWYCH paragonów, zasięg ksiąg respektowany ----------
  {
    resetModuly();
    let widzianeSql = null, widzianeParams = null;
    podstawModul('../src/db', {
      q: async (sql, params) => { widzianeSql = sql; widzianeParams = params; return [{ n: 3 }]; },
      pool: {},
    });
    podstawModul('../src/auth', { ledgerScope: () => ({ ledgers: [5, 9], ownOnly: true }) });
    const router = require('../src/routes/products');
    const req = { method: 'GET', url: '/nieprzypisane-licznik', query: {}, user: { uid: 42 } };
    const res = fakeRes();
    await wywolajTrase(router, req, res);
    ok(res.body && res.body.n === 3, 'kształt odpowiedzi: { n: <liczba> } — tu 3');
    ok(/product_id IS NULL/.test(widzianeSql), 'zapytanie filtruje WYŁĄCZNIE pozycje bez product_id');
    ok(/deleted_at IS NULL/.test(widzianeSql), 'zapytanie dokleja zywyParagon — żywy paragon (K1/K4)');
    ok(/r\.ledger_id IN/.test(widzianeSql) && widzianeParams.l0 === 5 && widzianeParams.l1 === 9,
      'zasięg ksiąg pytającego trafia do zapytania (ledger_id IN)');
    ok(/r\.user_id = :uid/.test(widzianeSql) && widzianeParams.uid === 42,
      'ownOnly (np. junior) zawęża licznik do WŁASNYCH paragonów');
  }

  // ---------- 3: zapytania dotykające paragonów w products.js filtrują zywyParagon (K4) ----------
  {
    const tresc = fs.readFileSync(path.join(__dirname, '../src/routes/products.js'), 'utf8');
    ok(/require\(['"]\.\.\/zywe['"]\)/.test(tresc), 'products.js importuje helper zywe.js, nie duplikuje warunku');
    const wystapienia = (tresc.match(/zywyParagon\(/g) || []).length;
    ok(wystapienia >= 1, `zywyParagon użyty w products.js (${wystapienia}×)`);
    // zasieg() to jedyne miejsce budujące warunek WHERE dla paragonów — koszyk/drozeje/ceny/
    // licznik korzystają z niego, więc jeden dowód w helperze pokrywa wszystkie trasy naraz.
    ok(/function zasieg\(user\)[\s\S]*zywyParagon\('r'\)/.test(tresc),
      'zasieg() (wspólny dla koszyka, drożeje, licznika i historii cen) dokleja zywyParagon');
  }

  console.log(bledy ? `\n${bledy} BŁĘDÓW` : '\nWszystkie testy licznika produktów przeszły.');
  process.exit(bledy ? 1 : 0);
})();
