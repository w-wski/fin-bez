// Parser wyciągów bankowych: PKO BP, mBank, ING, Santander, Revolut.
// Wzorce z prototypu Vibe Check Finance (§I architektury): heurystyka wykrywania
// banku po nagłówkach + anty-duplikacja SHA-256.
// Wynik znormalizowany: { transaction_date, booking_date, amount (ze znakiem),
// currency, counterparty, title, balance, iban }.
const crypto = require('crypto');
const iconv = require('iconv-lite');
const { parseCsv, guessDelimiter, parseAmount, parseDate } = require('./csv');

function decode(buf) {
  // Polskie banki eksportują zwykle w cp1250; Revolut/ING nowe — UTF-8.
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('�')) return utf8;
  return iconv.decode(buf, 'win1250');
}

function detectBank(text) {
  const head = text.slice(0, 4000).toLowerCase();
  if (head.includes('type,product,started date')) return 'Revolut';
  if (head.includes('#data operacji') || (head.includes('mbank') && head.includes('data operacji'))) return 'mBank';
  if (head.includes('data transakcji') && head.includes('dane kontrahenta')) return 'ING';
  if (head.includes('"data operacji"') && head.includes('"opis transakcji"')) return 'PKO BP';
  if (head.includes('data operacji') && head.includes('data waluty') && head.includes('saldo')) {
    return head.includes(';') ? 'Santander' : 'PKO BP';
  }
  if (head.includes('santander')) return 'Santander';
  return null;
}

function findHeaderRow(rows, mustInclude) {
  return rows.findIndex((r) => {
    const joined = r.join('|').toLowerCase();
    return mustInclude.every((k) => joined.includes(k));
  });
}

function byHeader(rows, headerIdx) {
  const header = rows[headerIdx].map((h) => h.toLowerCase().replace(/^#/, '').trim());
  const col = (names) => header.findIndex((h) => names.some((n) => h.startsWith(n)));
  return { header, data: rows.slice(headerIdx + 1), col };
}

function parsePkoBp(rows) {
  const hi = findHeaderRow(rows, ['data operacji']);
  if (hi < 0) return [];
  const { data, col } = byHeader(rows, hi);
  const cDate = col(['data operacji']), cVal = col(['data waluty']);
  const cAmt = col(['kwota']), cCur = col(['waluta']);
  const cBal = col(['saldo']), cDesc = col(['opis transakcji', 'opis']);
  const cType = col(['typ transakcji']);
  return data.map((r) => ({
    transaction_date: parseDate(r[cDate]),
    booking_date: cVal >= 0 ? parseDate(r[cVal]) : null,
    amount: parseAmount(r[cAmt]),
    currency: (r[cCur] || 'PLN').trim() || 'PLN',
    counterparty: null,
    title: [cType >= 0 ? r[cType] : '', cDesc >= 0 ? r[cDesc] : ''].filter(Boolean).join(' — ').trim() || null,
    balance: cBal >= 0 ? parseAmount(r[cBal]) : null,
    iban: null,
  }));
}

function parseMbank(rows) {
  const hi = findHeaderRow(rows, ['data operacji', 'kwota']);
  if (hi < 0) return [];
  const { data, col } = byHeader(rows, hi);
  const cDate = col(['data operacji']), cDesc = col(['opis operacji']);
  const cAmt = col(['kwota']), cCat = col(['kategoria']), cAcct = col(['rachunek']);
  const cBal = col(['saldo po operacji', 'saldo']); // saldo rozróżnia identyczne operacje (dedup)
  return data
    .filter((r) => parseDate(r[cDate]))
    .map((r) => ({
      transaction_date: parseDate(r[cDate]),
      booking_date: null,
      amount: parseAmount(r[cAmt]),
      currency: 'PLN',
      counterparty: cAcct >= 0 ? (r[cAcct] || '').trim() || null : null,
      title: [cCat >= 0 ? r[cCat] : '', cDesc >= 0 ? r[cDesc] : ''].filter(Boolean).join(' — ').trim() || null,
      balance: cBal >= 0 ? parseAmount(r[cBal]) : null,
      iban: null,
    }));
}

function parseIng(rows) {
  const hi = findHeaderRow(rows, ['data transakcji', 'dane kontrahenta']);
  if (hi < 0) return [];
  const { data, col } = byHeader(rows, hi);
  const cDate = col(['data transakcji']), cBook = col(['data księgowania', 'data ksiegowania']);
  const cCp = col(['dane kontrahenta']), cTitle = col(['tytuł', 'tytul']);
  const cAmt = col(['kwota transakcji']), cCur = col(['waluta']);
  const cBal = col(['saldo po transakcji']);
  return data
    .filter((r) => parseDate(r[cDate]))
    .map((r) => ({
      transaction_date: parseDate(r[cDate]),
      booking_date: cBook >= 0 ? parseDate(r[cBook]) : null,
      amount: parseAmount(r[cAmt]),
      currency: cCur >= 0 ? ((r[cCur] || 'PLN').trim() || 'PLN') : 'PLN',
      counterparty: (r[cCp] || '').trim() || null,
      title: cTitle >= 0 ? (r[cTitle] || '').trim() || null : null,
      balance: cBal >= 0 ? parseAmount(r[cBal]) : null,
      iban: null,
    }));
}

function parseSantander(rows) {
  // Santander PL: częsty format bez nagłówka — kolumny:
  // data księgowania; data operacji; tytuł; kontrahent; nr rachunku; kwota; saldo
  // Jeśli jest nagłówek — spróbuj po nazwach.
  const hi = findHeaderRow(rows, ['data operacji']);
  if (hi >= 0) {
    const { data, col } = byHeader(rows, hi);
    const cDate = col(['data operacji']), cBook = col(['data księgowania', 'data ksiegowania']);
    const cTitle = col(['tytuł', 'tytul', 'opis']), cCp = col(['kontrahent', 'nadawca', 'odbiorca']);
    const cAmt = col(['kwota']), cBal = col(['saldo']);
    return data.filter((r) => parseDate(r[cDate])).map((r) => ({
      transaction_date: parseDate(r[cDate]),
      booking_date: cBook >= 0 ? parseDate(r[cBook]) : null,
      amount: parseAmount(r[cAmt]),
      currency: 'PLN',
      counterparty: cCp >= 0 ? (r[cCp] || '').trim() || null : null,
      title: cTitle >= 0 ? (r[cTitle] || '').trim() || null : null,
      balance: cBal >= 0 ? parseAmount(r[cBal]) : null,
      iban: null,
    }));
  }
  return rows
    .filter((r) => r.length >= 6 && parseDate(r[1] || r[0]))
    .map((r) => ({
      transaction_date: parseDate(r[1]) || parseDate(r[0]),
      booking_date: parseDate(r[0]),
      amount: parseAmount(r[5]),
      currency: 'PLN',
      counterparty: (r[3] || '').trim() || null,
      title: (r[2] || '').trim() || null,
      balance: r.length > 6 ? parseAmount(r[6]) : null,
      iban: (r[4] || '').trim() || null,
    }));
}

function parseRevolut(rows) {
  const hi = findHeaderRow(rows, ['type', 'started date', 'amount']);
  if (hi < 0) return [];
  const { data, col } = byHeader(rows, hi);
  const cStart = col(['started date']), cDone = col(['completed date']);
  const cDesc = col(['description']), cAmt = col(['amount']), cFee = col(['fee']);
  const cCur = col(['currency']), cBal = col(['balance']), cState = col(['state']);
  return data
    .filter((r) => cState < 0 || (r[cState] || '').toUpperCase() === 'COMPLETED')
    .map((r) => {
      const amount = parseAmount(r[cAmt]);
      const fee = cFee >= 0 ? (parseAmount(r[cFee]) || 0) : 0;
      return {
        transaction_date: parseDate(r[cDone]) || parseDate(r[cStart]),
        booking_date: parseDate(r[cStart]),
        amount: amount === null ? null : Math.round((amount - fee) * 100) / 100,
        currency: (r[cCur] || 'PLN').trim() || 'PLN',
        counterparty: null,
        title: (r[cDesc] || '').trim() || null,
        balance: cBal >= 0 ? parseAmount(r[cBal]) : null,
        iban: null,
      };
    });
}

const PARSERS = {
  'PKO BP': parsePkoBp,
  'mBank': parseMbank,
  'ING': parseIng,
  'Santander': parseSantander,
  'Revolut': parseRevolut,
};

// Hash anty-duplikacyjny: IBAN | data | kwota | waluta | kontrahent | tytuł | SALDO.
// Saldo bieżące jest RÓŻNE po każdej kolejnej operacji, więc rozróżnia dwie identyczne
// co do kwoty/tytułu transakcje tego samego dnia (np. dwie kawy 12,30 zł) — bez tego
// druga ginęłaby jako fałszywy „duplikat" (utrata wydatku z ksiąg). Dla wyciągów bez
// salda dokładany jest booking_date jako słabszy, ale deterministyczny rozróżnik
// (zachowuje idempotencję ponownego importu tego samego pliku).
function txHash(t, iban) {
  const key = [
    iban || t.iban || '',
    t.transaction_date || '',
    t.amount === null ? '' : t.amount.toFixed(2),
    t.currency || 'PLN',
    (t.counterparty || '').trim().toLowerCase(),
    (t.title || '').trim().toLowerCase(),
    (t.balance === null || t.balance === undefined) ? '' : Number(t.balance).toFixed(2),
    t.booking_date || '',
  ].join('|');
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

// Główne wejście: buffer pliku → { bank, rows: [...z hashami], errors }
function parseBankFile(buf, opts = {}) {
  const text = decode(buf);
  const bank = opts.bank || detectBank(text);
  if (!bank || !PARSERS[bank]) {
    return { bank: null, rows: [], errors: ['Nie rozpoznano banku — obsługiwane: PKO BP, mBank, ING, Santander, Revolut'] };
  }
  const rows = parseCsv(text, guessDelimiter(text));
  const parsed = PARSERS[bank](rows);
  const ok = [], errors = [];
  for (const t of parsed) {
    if (!t.transaction_date || t.amount === null) { errors.push(t); continue; }
    // spójność czasowa jak w prototypie: odrzucaj daty sprzed 2026
    if (t.transaction_date < '2026-01-01') { errors.push(t); continue; }
    t.tx_hash = txHash(t, opts.iban);
    ok.push(t);
  }
  return { bank, rows: ok, errors };
}

module.exports = { parseBankFile, detectBank, txHash, PARSERS };
