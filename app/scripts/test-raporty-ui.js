#!/usr/bin/env node
// Testy Z15: ustawienia UI per użytkownik (routes/ui.js), parzystość kafli KPI i filtry
// przekazywane do Historii (public/js/raporty-uklad.js), lista wpisów bez kategorii
// (routes/reports-bez-kategorii.js). Wzorzec podstawionej bazy z test-uklad.js/test-rejestry.js.
const assert = require('assert');
const path = require('path');
const Module = require('module');
const { pathToFileURL } = require('url');

let bledy = 0;
function t(opis, fn) {
  try { fn(); console.log('OK  ', opis); }
  catch (e) { bledy++; console.error('BŁĄD', opis, '—', e.message); }
}

// ---------- podstawiona baza: zapamiętuje zapytania, oddaje przygotowane odpowiedzi ----------
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
  for (const m of ['../src/db', '../src/routes/ui']) delete require.cache[require.resolve(m)];
  podstawDb();
}
function fakeRes() {
  const res = { statusCode: 200, body: null, status(c) { res.statusCode = c; return res; }, json(b) { res.body = b; return res; } };
  return res;
}
function wywolajTrase(router, req, res) {
  return new Promise((resolve) => {
    res.json = (b) => { res.body = b; resolve(); return res; };
    router(req, res, resolve);
  });
}

(async () => {
  // ---------- K4: PUT /api/v1/ui/:klucz — UPSERT nadpisuje ----------
  await (async () => {
    resetModuly();
    const router = require('../src/routes/ui');
    const req = { method: 'PUT', url: '/raporty.zwiniete', params: { klucz: 'raporty.zwiniete' },
      body: { wartosc: ['kpi', 'trend'] }, user: { uid: 7 } };
    baza.zapytania = []; baza.odpowiedzi = [[]];
    const res = fakeRes();
    await wywolajTrase(router, req, res);
    t('PUT: dobry klucz i wartość → 200 ok, zapytanie to INSERT ... ON DUPLICATE KEY UPDATE (upsert)', () => {
      assert.strictEqual(res.body && res.body.ok, true);
      assert.ok(/ON DUPLICATE KEY UPDATE/.test(baza.zapytania[0].sql), 'zapytanie: ' + baza.zapytania[0].sql);
    });
  })();

  // ---------- K4: zły klucz = odmowa ----------
  await (async () => {
    resetModuly();
    const router = require('../src/routes/ui');
    const req = { method: 'PUT', url: '/Zle Klucz!', params: { klucz: 'Zle Klucz!' },
      body: { wartosc: [] }, user: { uid: 7 } };
    const res = fakeRes();
    await wywolajTrase(router, req, res);
    t('PUT: klucz spoza /^[a-z0-9.-]{1,64}$/ → 400, bez dotknięcia bazy', () => {
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body && res.body.error, 'bad_key');
    });
  })();

  // ---------- K4: user zawsze z sesji (req.user.uid), NIGDY z body ----------
  await (async () => {
    resetModuly();
    const router = require('../src/routes/ui');
    const req = { method: 'PUT', url: '/raporty.zwiniete', params: { klucz: 'raporty.zwiniete' },
      body: { wartosc: ['x'], user_id: 999, uid: 999 }, user: { uid: 3 } };
    baza.zapytania = []; baza.odpowiedzi = [[]];
    const res = fakeRes();
    await wywolajTrase(router, req, res);
    t('PUT: parametr `u` w zapytaniu to req.user.uid (3), nie wartość z body (999)', () => {
      assert.strictEqual(baza.zapytania[0].par.u, 3);
    });
  })();

  // ---------- K4: GET oddaje {wartosc:null}, gdy nikt nic nie zapisał ----------
  await (async () => {
    resetModuly();
    const router = require('../src/routes/ui');
    const req = { method: 'GET', url: '/raporty.zwiniete', params: { klucz: 'raporty.zwiniete' }, user: { uid: 3 } };
    baza.zapytania = []; baza.odpowiedzi = [[]];
    const res = fakeRes();
    await wywolajTrase(router, req, res);
    t('GET: brak wiersza → {wartosc: null}', () => {
      assert.deepStrictEqual(res.body, { wartosc: null });
    });
  })();

  // ---------- K1: parzystość kafli KPI (czysta funkcja, public/js/raporty-uklad.js) ----------
  const { potrzebnyKafelSumy, filtryHistoriiZKategorii } = await import(
    pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'raporty-uklad.js')).href);

  t('potrzebnyKafelSumy: 4 kafle (parzyste) → bez dopełnienia', () => {
    assert.strictEqual(potrzebnyKafelSumy(4), false);
  });
  t('potrzebnyKafelSumy: 5 kafli (nieparzyste, np. z „Bankowe do uzgodnienia") → dopełnienie', () => {
    assert.strictEqual(potrzebnyKafelSumy(5), true);
  });

  // ---------- K2: zakres okresu przekazywany do filtra Historii (czysta funkcja) ----------
  t('filtryHistoriiZKategorii: kategoria z podkategoriami niesie okres i wszystkie id', () => {
    const idx = { dzieci: new Map([[5, [12, 13]]]) };
    const okres = { from: '2026-07-01', to: '2026-07-31', opis: '01.07.2026–31.07.2026' };
    assert.deepStrictEqual(filtryHistoriiZKategorii(1, okres, 5, 'Transport', idx),
      { ledger: 1, from: '2026-07-01', to: '2026-07-31', categoryIds: [5, 12, 13], categoryLabel: 'Transport' });
  });
  t('filtryHistoriiZKategorii: kafel KPI (id null) → tylko okres, bez categoryIds', () => {
    const okres = { from: '2026-07-01', to: '2026-07-31', opis: 'x' };
    const f = filtryHistoriiZKategorii(2, okres, null, 'Wydatki okresu', null);
    assert.strictEqual(f.categoryIds, null);
    assert.deepStrictEqual([f.ledger, f.from, f.to], [2, '2026-07-01', '2026-07-31']);
  });

  // ---------- K5: lista bez kategorii filtruje category_id IS NULL + zakres dat ----------
  const { filtrujBezKategorii } = require('../src/routes/reports-bez-kategorii');
  const wpisy = [
    { id: 1, category_id: null, tx_date: '2026-07-15' },
    { id: 2, category_id: 9, tx_date: '2026-07-15' },      // ma kategorię — odsiane
    { id: 3, category_id: null, tx_date: '2026-06-30' },   // poza zakresem — odsiane
    { id: 4, category_id: null, tx_date: '2026-07-01' },
  ];
  t('filtrujBezKategorii: category_id IS NULL i wewnątrz zakresu dat', () => {
    const wynik = filtrujBezKategorii(wpisy, '2026-07-01', '2026-07-31').map((r) => r.id);
    assert.deepStrictEqual(wynik, [1, 4]);
  });

  if (bledy) { console.error(`\n${bledy} BŁĘD(Y)`); process.exit(1); }
  console.log('\nWSZYSTKIE TESTY OK (test-raporty-ui.js)');
})();
