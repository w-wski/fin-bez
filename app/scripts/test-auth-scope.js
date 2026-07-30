#!/usr/bin/env node
// Z23/K1: `ledgerScope()` z auth.js — tabela ról × oczekiwany zasięg. BEZ bazy: to czysta
// funkcja (przełącznik po roli), więc testujemy ją wprost, plus próby dostępu POZA zasięg
// przez middleware requireAuth (na podstawionej db.q, wzorzec test-rejestry.js).
const Module = require('module');

let bledy = 0;
function ok(warunek, opis) {
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}
const rowne = (a, b, opis) => ok(JSON.stringify(a) === JSON.stringify(b), `${opis} → ${JSON.stringify(a)}`);

// --- podstawiona baza ---
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
  for (const m of ['../src/db', '../src/auth']) delete require.cache[require.resolve(m)];
  podstawDb();
}
const zeruj = (...odp) => { baza.zapytania = []; baza.odpowiedzi = odp; baza.zepsuta = false; };

function fakeRes() {
  const res = { statusCode: 200, body: null,
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
    setHeader() {} };
  return res;
}

(async () => {
  resetModuly();
  const auth = require('../src/auth');

  // ---------- 1) tabela ról × zasięg (ledgerScope jest czystą funkcją — bez bazy) ----------
  // admin: obie księgi, ownOnly=false
  rowne(auth.ledgerScope({ role: 'admin' }), { ledgers: [1, 2], ownOnly: false }, 'admin: obie księgi, wszystko');
  // adult: obie księgi, ownOnly=false (decyzja 2026-07-24: Anna współprowadzi finanse)
  rowne(auth.ledgerScope({ role: 'adult' }), { ledgers: [1, 2], ownOnly: false }, 'adult: obie księgi, wszystko');
  // junior: tylko RODZINA, tylko własne
  rowne(auth.ledgerScope({ role: 'junior' }), { ledgers: [1], ownOnly: true }, 'junior: tylko RODZINA, tylko własne wpisy');
  // company: tylko PERSEVERA, wszystko
  rowne(auth.ledgerScope({ role: 'company' }), { ledgers: [2], ownOnly: false }, 'company: tylko PERSEVERA, wszystko');
  // widget: tylko RODZINA, read-only ale ownOnly=false (widget nie ma pojęcia o użytkowniku)
  rowne(auth.ledgerScope({ role: 'widget' }), { ledgers: [1], ownOnly: false }, 'widget: tylko RODZINA (read-only)');
  // rola nieznana/pusta: bezpieczny domyślny brak zasięgu, nie wyjątek
  rowne(auth.ledgerScope({ role: 'cokolwiek-nieistniejacego' }), { ledgers: [], ownOnly: true },
    'rola nieznana: brak ksiąg, ownOnly=true — bezpieczny fail-closed, nie wyjątek');
  rowne(auth.ledgerScope({}), { ledgers: [], ownOnly: true }, 'brak roli w ogóle: bezpieczny fail-closed');

  // Junior i company NIE widzą księgi drugiego — to jest właśnie "próba dostępu poza zasięg"
  // wyrażona jako asercja na strukturze zasięgu (routes/*.js budują IN(...) z tej listy).
  ok(!auth.ledgerScope({ role: 'junior' }).ledgers.includes(2), 'junior NIE ma w zasięgu księgi PERSEVERA (2)');
  ok(!auth.ledgerScope({ role: 'company' }).ledgers.includes(1), 'company NIE ma w zasięgu księgi RODZINA (1)');

  // ---------- 2) requireAuth: konto nieaktywne/nieznane = 401, nie przepuszcza dalej ----------
  resetModuly();
  podstawDb();
  const auth2 = require('../src/auth');
  const reqBezCiasteczka = { headers: {} };
  const res1 = fakeRes();
  let nextWolane1 = false;
  await auth2.requireAuth(reqBezCiasteczka, res1, () => { nextWolane1 = true; });
  rowne(res1.statusCode, 401, 'brak ciasteczka sesji → 401 auth_required');
  ok(!nextWolane1, 'requireAuth bez sesji NIE wywołuje next()');

  // ---------- 3) requireAuth: sesja z poprawnym podpisem, ale konto dezaktywowane → 401 ----------
  resetModuly();
  podstawDb();
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-sekret-tylko-do-testow';
  delete require.cache[require.resolve('../src/config')];
  const jwt = require('jsonwebtoken');
  const config = require('../src/config');
  const auth3 = require('../src/auth');
  const token = jwt.sign({ uid: 42, name: 'Test', role: 'junior' }, config.jwtSecret, { expiresIn: '1d' });
  zeruj([]); // SELECT ... WHERE id=:id AND active=1 → brak wierszy = konto nieaktywne/usunięte
  const req3 = { headers: { cookie: `f_auth=${token}` } };
  const res3 = fakeRes();
  let nextWolane3 = false;
  await auth3.requireAuth(req3, res3, () => { nextWolane3 = true; });
  rowne(res3.statusCode, 401, 'sesja ważna, ale konto active=0/usunięte → 401 account_inactive');
  ok(!nextWolane3, 'requireAuth NIE przepuszcza dezaktywowanego konta');

  console.log(`\n${bledy === 0 ? 'OK' : 'BŁĄD'}: test-auth-scope — ${bledy} błędów`);
  process.exit(bledy === 0 ? 0 : 1);
})();
