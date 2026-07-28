/* produkt-baza.js — styk czystych reguł z src/produkty.js z tabelami `products`
 * i `product_aliases` (migracja 012). Tu, i tylko tu, tożsamość produktu dotyka bazy.
 *
 * Podział pracy:
 *   src/produkty.js       — CO jest czym (normalizacja, gramatura, podobieństwo). Bez bazy.
 *   src/ocr/produkt-baza.js — KTO to już wie (aliasy) i KTO SIĘ TEGO UCZY (korekty człowieka).
 *
 * Dwie zasady, obie przepisane ze słownika OCR, bo sprawdziły się przy `item_dict`:
 *
 *  1. ROZPOZNAWANIE JEST DARMOWE, TWORZENIE — NIE. Wgranie paragonu przypisuje pozycje
 *     do produktów, które JUŻ istnieją, i nigdy nie zakłada nowych. Inaczej pierwszy
 *     paragon z literówką OCR („MASL0 EXTRA”) zakładałby produkt-widmo, a katalog rodziny
 *     zapełniłby się śmieciem, którego nikt nie zamawiał.
 *  2. PRODUKT ZAKŁADA CZŁOWIEK. Dopiero ręczna poprawka pozycji („to jest masło extra”)
 *     tworzy produkt i alias — bo wtedy ktoś wziął odpowiedzialność za nazwę.
 */

const { q } = require('../db');
const { normCode } = require('./pola');
const { normSklep, nazwaCzytelna, kandydaci, gramatura } = require('../produkty');

/** Kody z pozycji paragonu → mapa `code_norm` → `product_id`, jednym zapytaniem.
 *  Alias sklepowy WYGRYWA z globalnym: „SER” w Biedronce i „SER” w Lidlu to różne towary,
 *  a alias globalny (`shop = '*'`, m.in. cały dorobek `item_dict`) jest tylko domysłem. */
async function mapaAliasow(kody, sklep) {
  const klucze = [...new Set(kody.map(normCode).filter((k) => k && k.length >= 2))];
  if (!klucze.length) return new Map();
  const par = Object.fromEntries(klucze.map((k, i) => [`k${i}`, k]));
  par.s = normSklep(sklep);
  const rows = await q(
    `SELECT code_norm, product_id, shop FROM product_aliases
      WHERE code_norm IN (${klucze.map((_, i) => `:k${i}`).join(',')})
        AND shop IN (:s, '*')
      ORDER BY shop = '*'`,                 // sklepowy pierwszy, globalny po nim
    par);
  const wg = new Map();
  for (const r of rows) if (!wg.has(r.code_norm)) wg.set(r.code_norm, r.product_id);
  return wg;
}

/** Przypisanie pozycji zapisanego paragonu do znanych produktów.
 *  Woła się WEWNĄTRZ transakcji zapisu paragonu (dostaje `conn`), po wstawieniu wierszy.
 *  Zwraca liczbę rozpoznanych pozycji — reszta zostaje z `product_id = NULL`, co jest
 *  normalnym stanem „czeka na pierwsze przypisanie przez człowieka”, nie błędem. */
async function przypiszPozycje(conn, receiptId, sklep) {
  const [wiersze] = await conn.execute(
    'SELECT id, code, ocr_name FROM receipt_items WHERE receipt_id = ? AND product_id IS NULL', [receiptId]);
  if (!wiersze.length) return 0;
  const wg = await mapaAliasow(wiersze.map((w) => w.code || w.ocr_name), sklep);
  let n = 0;
  for (const w of wiersze) {
    const pid = wg.get(normCode(w.code || w.ocr_name));
    if (!pid) continue;
    await conn.execute('UPDATE receipt_items SET product_id = ? WHERE id = ?', [pid, w.id]);
    n++;
  }
  // Licznik trafień aliasu — mówi, które nazwy kasowe są w tym domu naprawdę używane.
  if (n) {
    await conn.execute(
      `UPDATE product_aliases SET hits = hits + 1
        WHERE shop IN (?, '*') AND code_norm IN (${wg.size ? [...wg.keys()].map(() => '?').join(',') : "''"})`,
      [normSklep(sklep), ...wg.keys()]);
  }
  return n;
}

/** Korekta człowieka („ta pozycja to jogurt naturalny 400 g”) → produkt + alias.
 *
 *  `productId` podany  → wiążemy z ISTNIEJĄCYM produktem (scalenie zatwierdzone ręcznie).
 *  `productId` pusty   → zakładamy nowy produkt z nazwy, którą człowiek zatwierdził.
 *
 *  Zwraca `product_id` albo null, gdy nie ma z czego zrobić klucza (kod krótszy niż dwa
 *  znaki albo pusta nazwa) — cisza jest wtedy poprawną odpowiedzią, nie awarią.
 */
async function zapamietaj({ sklep, kod, nazwa, unit, categoryId, productId, source = 'reka' }) {
  const code = normCode(kod);
  const name = nazwaCzytelna(nazwa);
  if (!code || code.length < 2 || !name) return null;
  const shop = normSklep(sklep);

  let pid = Number(productId) || null;
  if (pid) {
    const [ist] = await q('SELECT id FROM products WHERE id = :id AND active = 1', { id: pid });
    if (!ist) return null;                       // produkt skasowany/wyłączony — nie wiążemy w próżnię
  } else {
    // Ta sama nazwa = ten sam produkt. Bez tego dwie osoby wpisujące „masło extra 200 g”
    // w dwóch paragonach zakładałyby dwa katalogi obok siebie.
    const [stary] = await q('SELECT id FROM products WHERE name = :n AND active = 1 LIMIT 1', { n: name });
    if (stary) {
      pid = stary.id;
    } else {
      const g = gramatura(name);
      const ins = await q(
        'INSERT INTO products (name, unit, category_id, pack_size, notes) VALUES (:n, :u, :c, :p, :o)',
        { n: name, u: unit || (g && g.jednostka) || null, c: categoryId || null,
          p: g ? g.wartosc : null, o: `z paragonu (${shop})` });
      pid = ins.insertId;
    }
  }
  await q(
    `INSERT INTO product_aliases (product_id, shop, code_norm, code_raw, source, hits)
     VALUES (:p, :s, :cn, :cr, :src, 1)
     ON DUPLICATE KEY UPDATE product_id = VALUES(product_id), hits = hits + 1, source = VALUES(source)`,
    { p: pid, s: shop, cn: code, cr: String(kod).slice(0, 255), src: source });
  return pid;
}

/** Propozycje scalenia dla nierozpoznanej nazwy: „czy to przypadkiem nie jest ten sam
 *  produkt co…”. NIGDY nie scala sama — zwraca listę do zatwierdzenia przez człowieka.
 *
 *  Kandydatów liczymy w JS, bo SQL nie zna ani gramatury, ani skrótów kasowych. Wstępne
 *  sito w bazie: wyłącznie produkty aktywne, najwyżej 2000 — przy większym katalogu
 *  trzeba będzie zawęzić zapytanie po pierwszym słowie rdzenia (dziś dom ma ich setki).
 */
async function propozycje(nazwa, ile = 5) {
  if (!nazwaCzytelna(nazwa)) return [];
  const lista = await q('SELECT id, name, unit, category_id FROM products WHERE active = 1 LIMIT 2000');
  return kandydaci(nazwa, lista, { ile });
}

module.exports = { mapaAliasow, przypiszPozycje, zapamietaj, propozycje };
