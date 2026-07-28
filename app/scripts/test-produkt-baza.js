#!/usr/bin/env node
// Testy warstwy bazodanowej produktów (src/ocr/produkt-baza.js) na PODSTAWIONEJ bazie.
//
// Czego te testy NIE dowodzą: że zapytania SQL są poprawne dla MySQL-a. Tego bez serwera
// bazy nie sprawdzę i nie udaję, że sprawdziłem (weryfikacja: pierwszy paragon po wdrożeniu).
// Czego dowodzą: że przepływ decyzji jest właściwy — kiedy zakładamy produkt, a kiedy nie;
// co wygrywa przy dwóch aliasach; czy maszyna nie tworzy katalogu za człowieka.
const path = require('path');
const Module = require('module');

let bledy = 0;
function ok(warunek, opis) {
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}
const rowne = (a, b, opis) => ok(JSON.stringify(a) === JSON.stringify(b), `${opis} → ${JSON.stringify(a)}`);

// --- podstawiona baza: zapamiętuje zapytania, oddaje przygotowane odpowiedzi ---
const baza = { zapytania: [], odpowiedzi: [], nastepneId: 100 };
const q = async (sql, par) => {
  baza.zapytania.push({ sql: sql.replace(/\s+/g, ' ').trim(), par });
  const gotowa = baza.odpowiedzi.shift();
  if (gotowa !== undefined) return gotowa;
  return /^\s*INSERT/i.test(sql) ? { insertId: baza.nastepneId++ } : [];
};
require.cache[require.resolve('../src/db')] = new Module(require.resolve('../src/db'));
require.cache[require.resolve('../src/db')].exports = { q, pool: null };
require.cache[require.resolve('../src/db')].loaded = true;

const pb = require('../src/ocr/produkt-baza');
const zeruj = (...odp) => { baza.zapytania = []; baza.odpowiedzi = odp; };
const ostatnie = () => baza.zapytania[baza.zapytania.length - 1];

(async () => {
  // ---------- mapa aliasów ----------
  zeruj([
    { code_norm: 'SER', product_id: 7, shop: 'BIEDRONKA' },   // sklepowy przychodzi pierwszy
    { code_norm: 'SER', product_id: 9, shop: '*' },
    { code_norm: 'MLEKO 1L', product_id: 3, shop: '*' },
  ]);
  const mapa = await pb.mapaAliasow(['Ser', 'SER', 'Mleko 1L', 'A', ''], 'BIEDRONKA "CNC" 3135');
  rowne(mapa.get('SER'), 7, 'alias sklepowy wygrywa z globalnym');
  rowne(mapa.get('MLEKO 1L'), 3, 'alias globalny działa, gdy sklepowego nie ma');
  rowne(ostatnie().par.s, 'BIEDRONKA', 'nagłówek paragonu sprowadzony do sieci');
  rowne(Object.keys(ostatnie().par).filter((k) => k.startsWith('k')).length, 2,
    'jednoznakowy kod i pusty odpadają przed zapytaniem, duplikaty scalone');

  zeruj();
  rowne([...(await pb.mapaAliasow([], 'Biedronka'))], [], 'brak kodów = brak zapytania do bazy');
  rowne(baza.zapytania.length, 0, 'naprawdę zero zapytań');

  // ---------- zapamiętanie decyzji człowieka ----------
  zeruj();
  rowne(await pb.zapamietaj({ sklep: 'Biedronka', kod: 'A', nazwa: 'Cokolwiek' }), null,
    'kod jednoznakowy: brak klucza, brak produktu');
  rowne(await pb.zapamietaj({ sklep: 'Biedronka', kod: 'JOG NAT 400G', nazwa: '  ' }), null,
    'pusta nazwa: nie zakładamy produktu nazwanego kodem OCR');
  rowne(baza.zapytania.length, 0, 'odmowa następuje PRZED dotknięciem bazy');

  // nowy produkt: (1) szukanie po nazwie → pusto, (2) INSERT products, (3) upsert aliasu
  zeruj([], { insertId: 42 });
  const pid = await pb.zapamietaj({ sklep: 'BIEDRONKA "CNC" 3135', kod: 'Jog Naturalny 400g',
    nazwa: 'Jogurt naturalny 400 g', categoryId: 5 });
  rowne(pid, 42, 'nowy produkt założony');
  rowne(baza.zapytania.length, 3, 'trzy zapytania: sprawdzenie nazwy, INSERT, alias');
  ok(/INSERT INTO products/.test(baza.zapytania[1].sql), 'drugie zapytanie zakłada produkt');
  rowne(baza.zapytania[1].par.p, 0.4, 'gramatura z nazwy trafia do pack_size (400 g → 0,4 kg)');
  rowne(baza.zapytania[1].par.c, 5, 'kategoria z korekty człowieka zapisana przy produkcie');
  rowne(ostatnie().par.s, 'BIEDRONKA', 'alias przypisany do SIECI, nie do numeru placówki');
  rowne(ostatnie().par.cn, 'JOG NATURALNY 400G', 'kod w aliasie znormalizowany');
  rowne(ostatnie().par.cr, 'Jog Naturalny 400g', 'oryginalna pisownia zachowana jako ślad');

  // ta sama nazwa drugi raz: żadnego nowego produktu
  zeruj([{ id: 42 }]);
  rowne(await pb.zapamietaj({ sklep: 'Lidl', kod: 'JOGURT NAT 400G', nazwa: 'Jogurt naturalny 400 g' }), 42,
    'ta sama nazwa = ten sam produkt, nowy alias dla innej sieci');
  ok(!baza.zapytania.some((x) => /INSERT INTO products/.test(x.sql)), 'drugi katalog NIE powstał');
  rowne(ostatnie().par.s, 'LIDL', 'drugi alias wskazuje Lidla');

  // scalenie ręczne: wskazany produkt musi istnieć
  zeruj([]);
  rowne(await pb.zapamietaj({ sklep: 'Lidl', kod: 'JOGURT X', nazwa: 'Jogurt', productId: 999 }), null,
    'wskazany produkt nie istnieje → nie wiążemy w próżnię');
  ok(!baza.zapytania.some((x) => /INSERT INTO product_aliases/.test(x.sql)), 'alias-sierota nie powstał');

  // ---------- przypisanie pozycji zapisanego paragonu ----------
  const wykonane = [];
  const conn = {
    execute: async (sql, par) => {
      wykonane.push({ sql: sql.replace(/\s+/g, ' ').trim(), par });
      if (/^SELECT/i.test(sql)) {
        return [[{ id: 1, code: 'Jog Naturalny 400g', ocr_name: 'Jog Naturalny 400g' },
          { id: 2, code: 'Nowy towar', ocr_name: 'Nowy towar' }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
  zeruj([{ code_norm: 'JOG NATURALNY 400G', product_id: 42, shop: 'BIEDRONKA' }]);
  const n = await pb.przypiszPozycje(conn, 77, 'Biedronka');
  rowne(n, 1, 'rozpoznana jedna pozycja z dwóch');
  const update = wykonane.filter((x) => /UPDATE receipt_items/.test(x.sql));
  rowne(update.length, 1, 'nierozpoznana pozycja NIE dostaje przypadkowego produktu');
  rowne(update[0].par, [42, 1], 'przypisanie trafiło we właściwy wiersz');
  ok(/product_id IS NULL/.test(wykonane[0].sql),
    'ruszamy tylko pozycje bez produktu — ręcznego przypisania nie nadpisujemy');
  ok(wykonane.some((x) => /UPDATE product_aliases SET hits/.test(x.sql)), 'licznik trafień aliasu rośnie');

  // ---------- propozycje scalenia ----------
  zeruj([{ id: 42, name: 'Jogurt naturalny 400 g' }, { id: 43, name: 'Czereśnie' }]);
  const k = await pb.propozycje('Jog Naturalny 400g');
  rowne(k.map((x) => x.id), [42], 'propozycja jedna, trafiona; czereśnie odsiane');
  ok(k[0].wynik >= 0.62, `wynik podobieństwa dołączony (${k[0].wynik})`);
  zeruj();
  rowne(await pb.propozycje('   '), [], 'pusta nazwa nie odpytuje bazy');
  rowne(baza.zapytania.length, 0, 'naprawdę zero zapytań');

  console.log(bledy ? `\n${bledy} BŁĘDÓW` : '\nWszystkie testy warstwy bazodanowej produktów przeszły.');
  process.exit(bledy ? 1 : 0);
})().catch((e) => { console.error('WYWRÓCIŁO SIĘ:', e); process.exit(1); });
