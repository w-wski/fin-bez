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

/** Kody z pozycji paragonu → mapa `code_norm` → `{ productId, shop }`, jednym zapytaniem.
 *
 *  REGUŁA PRECEDENCJI (odwrotna niż w slownik.js#suggestFromDict — i celowo, dwie różne role):
 *  tu chodzi o TOŻSAMOŚĆ towaru przy AUTO-przypisaniu, więc alias sklepowy WYGRYWA z globalnym:
 *  „SER” w Biedronce i „SER” w Lidlu bywają różnymi produktami, a alias sklepowy jest bardziej
 *  specyficzny niż globalny (`shop = '*'`, czyli „tak nazywa się to gdziekolwiek", tylko domysł).
 *  slownik.js#suggestFromDict odpytuje o PODPOWIEDŹ dla człowieka, więc bierze odwrotnie —
 *  globalny pierwszy, bo niesie jego OSTATNIĄ decyzję (patrz komentarz tamże). */
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
  for (const r of rows) if (!wg.has(r.code_norm)) wg.set(r.code_norm, { productId: r.product_id, shop: r.shop });
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
  // Podbijamy hits WYŁĄCZNIE alias faktycznie użytemu do przypisania (jeden konkretny wiersz
  // — sklepowy albo globalny, cokolwiek wygrało w mapaAliasow) — nie oba, i nie dla każdego
  // kodu z paragonu naraz, tylko dla tych, które naprawdę rozpoznały pozycję (korekta po
  // adwersaryjnej weryfikacji Z7: `shop IN (?, '*')` podbijało też alias, który nic nie zrobił).
  const uzyte = [];
  for (const w of wiersze) {
    const cn = normCode(w.code || w.ocr_name);
    const trafienie = wg.get(cn);
    if (!trafienie) continue;
    await conn.execute('UPDATE receipt_items SET product_id = ? WHERE id = ?', [trafienie.productId, w.id]);
    n++;
    uzyte.push([trafienie.shop, cn]);
  }
  if (uzyte.length) {
    const warunki = uzyte.map(() => '(shop = ? AND code_norm = ?)').join(' OR ');
    await conn.execute(`UPDATE product_aliases SET hits = hits + 1 WHERE ${warunki}`, uzyte.flat());
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
async function zapamietaj({ sklep, kod, nazwa, unit, categoryId, productId, source = 'reka',
  uczJednostke, uczKategorie }) {
  const code = normCode(kod);
  const name = nazwaCzytelna(nazwa);
  if (!code || code.length < 2 || !name) return null;
  const shop = normSklep(sklep);

  let pid = Number(productId) || null;
  let nowyProdukt = false;
  if (pid) {
    const [ist] = await q('SELECT id FROM products WHERE id = :id AND active = 1', { id: pid });
    if (!ist) return null;                       // produkt skasowany/wyłączony — nie wiążemy w próżnię
    // P1 (korekta po weryfikacji): scalenie ręczne NIE rusza `name` produktu, do którego się
    // dowiązujemy. Ta korekta mówi „to jest TEN SAM produkt", nie „ten produkt ma się teraz
    // nazywać inaczej" — nazwę koryguje się osobno, przez zmianę samego produktu, nie przy okazji.
  } else {
    // Ta sama nazwa = ten sam produkt. Bez tego dwie osoby wpisujące „masło extra 200 g”
    // w dwóch paragonach zakładałyby dwa katalogi obok siebie.
    const [stary] = await q('SELECT id FROM products WHERE name = :n AND active = 1 LIMIT 1', { n: name });
    if (stary) {
      pid = stary.id;
      // P1: dopasowanie po `name` idzie w kolacji `polish_ci` (niewrażliwej na wielkość liter
      // i diakrytyki) — skoro SQL uznał obie nazwy za tę samą, jedyna możliwa różnica to właśnie
      // wielkość liter/diakrytyki, NIE nowa decyzja człowieka. Dlatego `products.name` nigdy nie
      // jest tu nadpisywane — krzyk OCR-a („CHLEB TOSTOWY”) nie może zjeść kuratorowanej wersji
      // („chleb tostowy”). Stąd żadna gałąź tej funkcji nie robi już UPDATE products SET name.
    } else {
      const g = gramatura(name);
      const ins = await q(
        'INSERT INTO products (name, unit, category_id, pack_size, notes) VALUES (:n, :u, :c, :p, :o)',
        { n: name, u: unit || (g && g.jednostka) || null, c: categoryId || null,
          p: g ? g.wartosc : null, o: `z paragonu (${shop})` });
      pid = ins.insertId;
      nowyProdukt = true;
    }
  }
  // SPŁATA DŁUGU (Z7): to jedyne miejsce, gdzie korekta człowieka trafia do katalogu produktów
  // — item_dict już jej nie dostaje (patrz slownik.js). Jednostka/kategoria budżetowa: pole,
  // które CZŁOWIEK W TEJ korekcie dotknął (uczJednostke/uczKategorie z pozycje.js#ucz), zapisuje
  // się dosłownie — TAKŻE puste, czyli świadome „oduczenie" (NAPRAWA audytu Z4, wrócona po
  // weryfikacji). Pole niedotknięte trzyma COALESCE, żeby korekta samej nazwy nie wyzerowała
  // wcześniej ustalonej jednostki/kategorii. Nowo założony produkt ma te pola już poprawne
  // z INSERT-u powyżej — nie trzeba ich powtarzać.
  if (pid && !nowyProdukt) {
    await q(
      `UPDATE products SET
         unit = ${uczJednostke ? ':u' : 'COALESCE(:u, unit)'},
         category_id = ${uczKategorie ? ':c' : 'COALESCE(:c, category_id)'}
       WHERE id = :id`,
      { u: unit || null, c: categoryId || null, id: pid });
  }
  await q(
    `INSERT INTO product_aliases (product_id, shop, code_norm, code_raw, source, hits)
     VALUES (:p, :s, :cn, :cr, :src, 1)
     ON DUPLICATE KEY UPDATE product_id = VALUES(product_id), hits = hits + 1, source = VALUES(source)`,
    { p: pid, s: shop, cn: code, cr: String(kod).slice(0, 255), src: source });
  // P0 (KRYTYCZNE, znalezione przy weryfikacji): bez tego ręczna korekta w sklepie ≠ '*' tworzy
  // WYŁĄCZNIE alias sklepowy — a suggestFromDict bierze alias globalny jako pierwszeństwo (patrz
  // komentarz w slownik.js), więc podpowiedź nadal czytałaby STARY alias '*' i wracałaby w kółko
  // ta sama, dawno poprawiona pomyłka — pętla uczenia nigdy by się nie zamykała. Alias globalny
  // MUSI więc nieść tę samą, najświeższą decyzję co alias sklepowy. Pomijamy tylko, gdy sklep
  // JEST już '*' — to dokładnie ten sam wiersz, drugi INSERT tylko zdublowałby hits.
  if (shop !== '*') {
    await q(
      `INSERT INTO product_aliases (product_id, shop, code_norm, code_raw, source, hits)
       VALUES (:p, '*', :cn, :cr, :src, 1)
       ON DUPLICATE KEY UPDATE product_id = VALUES(product_id), hits = hits + 1, source = VALUES(source)`,
      { p: pid, cn: code, cr: String(kod).slice(0, 255), src: source });
  }
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
