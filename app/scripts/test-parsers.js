// Testy parserów bankowych na syntetycznych fixture'ach (bez prawdziwych danych).
// Uruchomienie: npm test
const assert = require('assert');
const { parseBankFile, detectBank, txHash } = require('../src/banks');

let failures = 0;
function t(name, fn) {
  try { fn(); console.log('OK  ', name); }
  catch (e) { failures++; console.error('FAIL', name, '—', e.message); }
}

const pko = Buffer.from(
  '"Data operacji","Data waluty","Typ transakcji","Kwota","Waluta","Saldo po transakcji","Opis transakcji"\n' +
  '"2026-07-01","2026-07-01","Płatność kartą","-45,50","PLN","1234,56","BIEDRONKA 123 WARSZAWA"\n' +
  '"2026-07-02","2026-07-02","Przelew przychodzący","+1000,00","PLN","2234,56","WYNAGRODZENIE"\n', 'utf8');

t('PKO BP: detekcja i parsowanie', () => {
  const r = parseBankFile(pko);
  assert.strictEqual(r.bank, 'PKO BP');
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.rows[0].amount, -45.5);
  assert.strictEqual(r.rows[0].transaction_date, '2026-07-01');
  assert.ok(r.rows[0].title.includes('BIEDRONKA'));
});

const mbank = Buffer.from(
  'mBank S.A. — lista operacji\n\n' +
  '#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;\n' +
  '2026-07-03;"ZAKUP KARTĄ ŻABKA";"eKonto 1111...";"Jedzenie";-12,30;\n', 'utf8');

t('mBank: detekcja, preambuła pomijana', () => {
  const r = parseBankFile(mbank);
  assert.strictEqual(r.bank, 'mBank');
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].amount, -12.3);
});

const ing = Buffer.from(
  '"Data transakcji";"Data księgowania";"Dane kontrahenta";"Tytuł";"Kwota transakcji (waluta rachunku)";"Waluta";"Saldo po transakcji"\n' +
  '2026-06-30;2026-07-01;"ORLEN SA";"Paliwo";-250,00;PLN;5000,00\n', 'utf8');

t('ING: kontrahent i saldo', () => {
  const r = parseBankFile(ing);
  assert.strictEqual(r.bank, 'ING');
  assert.strictEqual(r.rows[0].counterparty, 'ORLEN SA');
  assert.strictEqual(r.rows[0].balance, 5000);
});

const revolut = Buffer.from(
  'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance\n' +
  'CARD_PAYMENT,Current,2026-07-05 10:00:00,2026-07-06 08:00:00,Spotify,-23.99,0.00,PLN,COMPLETED,500.00\n' +
  'CARD_PAYMENT,Current,2026-07-05 11:00:00,,Pending thing,-9.99,0.00,PLN,PENDING,490.01\n', 'utf8');

t('Revolut: tylko COMPLETED, data z Completed', () => {
  const r = parseBankFile(revolut);
  assert.strictEqual(r.bank, 'Revolut');
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].transaction_date, '2026-07-06');
});

t('Odrzucanie dat sprzed 2026 (spójność czasowa z prototypu)', () => {
  const old = Buffer.from(
    '"Data operacji","Data waluty","Typ transakcji","Kwota","Waluta","Saldo po transakcji","Opis transakcji"\n' +
    '"2025-12-31","2025-12-31","Płatność","-1,00","PLN","1,00","STARE"\n', 'utf8');
  const r = parseBankFile(old);
  assert.strictEqual(r.rows.length, 0);
  assert.strictEqual(r.errors.length, 1);
});

t('Hash: deterministyczny i czuły na kwotę', () => {
  const a = { transaction_date: '2026-07-01', amount: -45.5, currency: 'PLN', counterparty: 'X', title: 'Y', balance: 100 };
  const b = { ...a };
  assert.strictEqual(txHash(a), txHash(b));
  assert.notStrictEqual(txHash(a), txHash({ ...a, amount: -45.51 }));
});

t('Hash: dwie identyczne płatności tego samego dnia (różne saldo) -> różne hasze', () => {
  // dwie kawy 12,30 w Żabce tego samego dnia — saldo po każdej jest inne, nie mogą się skleić
  const a = { transaction_date: '2026-07-01', amount: -12.30, currency: 'PLN', counterparty: null, title: 'ZABKA', balance: 100.00 };
  const b = { ...a, balance: 87.70 };
  assert.notStrictEqual(txHash(a), txHash(b));
});

t('Hash: PKO z saldem daje różne hasze dla powtórzonej kwoty (test integracyjny parsera)', () => {
  const csv = Buffer.from(
    '"Data operacji","Data waluty","Typ transakcji","Kwota","Waluta","Saldo po transakcji","Opis transakcji"\n' +
    '"2026-07-01","2026-07-01","Płatność kartą","-12,30","PLN","100,00","ZABKA"\n' +
    '"2026-07-01","2026-07-01","Płatność kartą","-12,30","PLN","87,70","ZABKA"\n', 'utf8');
  const r = parseBankFile(csv);
  assert.strictEqual(r.rows.length, 2);
  assert.notStrictEqual(r.rows[0].tx_hash, r.rows[1].tx_hash); // obie transakcje zachowane, nie sklejone
});

t('Nieznany format -> czytelny błąd', () => {
  const r = parseBankFile(Buffer.from('foo,bar\n1,2\n', 'utf8'));
  assert.strictEqual(r.bank, null);
  assert.ok(r.errors[0].includes('Nie rozpoznano'));
});

if (failures) { console.error(`\n${failures} test(ów) NIE przeszło`); process.exit(1); }
console.log('\nWszystkie testy parserów przeszły.');
