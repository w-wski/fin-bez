// Słownik podpowiedzi pozycji paragonu — jedyna część OCR (poza produkt-baza.js), która dotyka
// bazy słownikowej. Czyste reguły pól siedzą w ./pola, logika pozycji w ./pozycje.
//
// SPŁATA DŁUGU (Z7, plan pkt 9): do tej pory podpowiedź czytała się z `item_dict` (migracja 007),
// a korekta człowieka zapisywała się DWA razy — raz do item_dict, raz do product_aliases/products
// (migracja 012) przez produkt-baza.js. Dwie prawdy potrafiły się rozjechać (np. poprawiona
// jednostka w jednym miejscu, a nie w drugim). Od teraz PRAWDA jest jedna: product_aliases →
// products. `item_dict` zostaje w bazie jako archiwum (patrz migracje/016), ale kod jej już
// nie czyta ani nie pisze.
//
// Wzorzec samouczenia przepisany z routes/imports.js (learnMapping): ręczna korekta człowieka
// jest zapamiętywana pod znormalizowanym kodem z paragonu, a przy następnym paragonie wraca
// jako PROPOZYCJA (nigdy jako fakt — potwierdza ją człowiek).
//
// ZASIĘG: product_aliases/products są wspólne dla całego domu, ale KATEGORIA jest własnością
// księgi — podpowiadamy ją wyłącznie wtedy, gdy należy do księgi tego paragonu. Bez tego junior
// z RODZINY dostawał kategorie PERSEVERY, a te wchodziły mu do wpisu i do wspólnego
// mapping_cache. Wyszukiwarki po dowolnym kodzie nie wystawiamy (endpoint GET /:id/suggest
// usunięty) — podpowiedź wraca tylko dla pozycji własnego paragonu.
const { q } = require('../db');
const { normCode } = require('./pola');

// REGUŁA PRECEDENCJI (jedna, ale DWIE różne role — nie mylić z mapaAliasow w produkt-baza.js):
// tu chodzi o PODPOWIEDŹ (co zaproponować człowiekowi), więc wygrywa alias GLOBALNY — bo
// zapamietaj() od Z7 upsertuje globalny alias przy KAŻDEJ ręcznej korekcie i to on niesie
// OSTATNIĄ decyzję człowieka, niezależnie w którym sklepie ją podjęto. mapaAliasow przy
// AUTO-przypisaniu pozycji paragonu robi odwrotnie (sklepowy pierwszy), bo tam chodzi o
// TOŻSAMOŚĆ towaru, a „SER” w Biedronce i „SER” w Lidlu bywają różnymi produktami — alias
// sklepowy jest bardziej specyficzny. Gdy globalnego nie ma (jeszcze nikt nie poprawił tego
// kodu), podpowiedź bierze dowolny alias z najwyższym `hits`, a przy remisie — najnowszy
// (a.id DESC): ostatnia decyzja człowieka wygrywa z przypadkową kolejnością wierszy.
// `p.active = 1`: podpowiedź nie może wskrzeszać wyłączonego/scalonego produktu.
const ALIAS_SELECT =
  `SELECT a.code_norm, a.hits, p.name, p.unit,
          IF(c.id IS NULL, NULL, p.category_id) AS category_id, c.name AS category_name
     FROM product_aliases a
     JOIN products p ON p.id = a.product_id AND p.active = 1
     LEFT JOIN categories c ON c.id = p.category_id AND c.active = 1 AND c.ledger_id = :l`;

// Kształt zwrotki musi zostać identyczny jak przy item_dict — pozycje.js nie może odczuć różnicy.
const ksztaltZwrotki = (r) => ({ name: r.name, unit: r.unit, category_id: r.category_id,
  category_name: r.category_name, hits: r.hits });

// Kategoria musi należeć do TEJ SAMEJ księgi co paragon (wzorzec z routes/transactions.js).
async function kategoriaWKsiedze(catId, ledgerId) {
  const rows = await q('SELECT id FROM categories WHERE id = :c AND ledger_id = :l', { c: catId, l: ledgerId });
  return rows.length > 0;
}

// K3: podpowiedź = ostatnia decyzja człowieka dla tego samego kodu (alias globalny, a w jego
// braku najczęściej potwierdzany alias sklepowy).
async function suggestFromDict(code, ledgerId) {
  const cn = normCode(code);
  if (!cn || cn.length < 2) return null;
  const rows = await q(
    `${ALIAS_SELECT} WHERE a.code_norm = :cn ORDER BY a.shop = '*' DESC, a.hits DESC, a.id DESC LIMIT 1`,
    { cn, l: ledgerId });
  return rows[0] ? ksztaltZwrotki(rows[0]) : null;
}

// Podpowiedzi dla całego paragonu jednym zapytaniem (telefon + shared hosting = mniej rund do bazy).
async function withSuggestions(items, ledgerId) {
  const klucze = [...new Set(items.map((it) => normCode(it.code || it.ocr_name)).filter((k) => k && k.length >= 2))];
  if (!klucze.length) return items.map((it) => ({ ...it, suggestion: null }));
  const p = Object.fromEntries(klucze.map((k, i) => [`k${i}`, k]));
  p.l = ledgerId;
  const rows = await q(
    `${ALIAS_SELECT} WHERE a.code_norm IN (${klucze.map((_, i) => `:k${i}`).join(',')})
      ORDER BY a.code_norm, a.shop = '*' DESC, a.hits DESC, a.id DESC`, p);
  // Pierwszy wiersz dla danego code_norm wygrywa (SQL już posortował: globalny, potem hits) —
  // ten sam wzorzec „pierwszy wygrywa" co w produkt-baza.js/mapaAliasow.
  const wg = new Map();
  for (const r of rows) if (!wg.has(r.code_norm)) wg.set(r.code_norm, ksztaltZwrotki(r));
  return items.map((it) => ({ ...it, suggestion: wg.get(normCode(it.code || it.ocr_name)) || null }));
}

// K4: ręczna korekta uczy katalog produktów — ale PISZE go wyłącznie produkt-baza.js#zapamietaj
// (wołane osobno przez pozycje.js#ucz zaraz po tej funkcji). Ta funkcja NIE dotyka już bazy:
// item_dict, do którego kiedyś pisała, jest archiwum (patrz migracje/016). Zostaje jako WALIDACJA
// „czy w ogóle jest z czego uczyć" — dokładnie ta sama reguła co dawniej (kod ≥2 znaki po
// normalizacji, niepusty opis) — pozycje.js#ucz używa jej wyniku, żeby wiedzieć, czy pokazać
// człowiekowi „zapamiętane".
//
// Historia (audyt Z4, żeby nie zgubić): raz nauczonej jednostki/kategorii NIE dało się oduczyć,
// gdy korekta jej nie dotyczyła — `COALESCE` w item_dict psuł to, nadpisując puste pole starą
// wartością. NAPRAWA żyje dalej w produkt-baza.js#zapamietaj — TA funkcja jej już nie pilnuje
// (nie pisze do bazy), ale flagi `uczJednostke`/`uczKategorie` nie zniknęły: pozycje.js#ucz
// przekazuje je DALEJ, do zapamietaj() (patrz tamten plik) — pole dotknięte tą korektą zapisuje
// się dosłownie, nawet puste (świadome „oduczenie"), niedotknięte trzyma COALESCE.
function learnItem({ code, name }) {
  const cn = normCode(code);
  const nm = String(name === null || name === undefined ? '' : name).trim().slice(0, 255);
  return Boolean(cn && cn.length >= 2 && nm);
}

// ---------- WZORZEC NAZWY OCR → KATEGORIA (mapping_cache, jak przy imporcie CSV) ----------

function normProductPattern(name) {
  return String(name || '').toUpperCase()
    .replace(/[0-9]/gu, '').replace(/[^\p{L} ]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 64) || null;
}

async function suggestCategoryByName(name, ledgerId) {
  const p = normProductPattern(name);
  if (!p || p.length < 3) return null;
  const rows = await q(
    `SELECT m.category_id FROM mapping_cache m
       JOIN categories c ON c.id = m.category_id AND c.active = 1 AND c.ledger_id = :l
     WHERE m.pattern = :p LIMIT 1`, { p, l: ledgerId });
  return (rows[0] && rows[0].category_id) || null;
}

// mapping_cache jest wspólny dla obu ksiąg i uczy też autokategoryzacji importu bankowego —
// dlatego wołający MUSI wcześniej sprawdzić kategorię przez kategoriaWKsiedze().
async function learnCategoryPattern(ocrName, categoryId, userName) {
  const pattern = normProductPattern(ocrName);
  if (!pattern || !categoryId) return false;
  await q(
    `INSERT INTO mapping_cache (pattern, category_id, hits, confidence, updated_by)
     VALUES (:p, :c, 1, 0.60, :u)
     ON DUPLICATE KEY UPDATE
       hits = IF(category_id = VALUES(category_id), hits + 1, 1),
       confidence = IF(category_id = VALUES(category_id), LEAST(confidence + 0.10, 0.99), 0.60),
       category_id = VALUES(category_id), updated_by = VALUES(updated_by)`,
    { p: pattern, c: categoryId, u: userName });
  return true;
}

module.exports = {
  kategoriaWKsiedze, suggestFromDict, withSuggestions, learnItem,
  normProductPattern, suggestCategoryByName, learnCategoryPattern,
};
