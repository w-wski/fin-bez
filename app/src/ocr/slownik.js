// Słownik pozycji paragonu (tabela item_dict, migracja 007) — jedyna część OCR, która dotyka bazy
// słownikowej. Czyste reguły pól siedzą w ./pola, logika pozycji w ./pozycje.
//
// Wzorzec samouczenia przepisany z routes/imports.js (learnMapping): ręczna korekta człowieka
// jest zapamiętywana pod znormalizowanym kodem z paragonu, a przy następnym paragonie wraca
// jako PROPOZYCJA (nigdy jako fakt — potwierdza ją człowiek).
//
// ZASIĘG: item_dict jest wspólny dla całego domu (jedna tabela, klucz po code_norm), ale
// KATEGORIA jest własnością księgi — podpowiadamy ją wyłącznie wtedy, gdy należy do księgi
// tego paragonu. Bez tego junior z RODZINY dostawał kategorie PERSEVERY, a te wchodziły mu
// do wpisu i do wspólnego mapping_cache. Wyszukiwarki po dowolnym kodzie nie wystawiamy
// (endpoint GET /:id/suggest usunięty) — podpowiedź wraca tylko dla pozycji własnego paragonu.
const { q } = require('../db');
const { normCode, normUnit } = require('./pola');

const DICT_SELECT =
  `SELECT d.code_norm, d.name, d.unit, d.hits,
          IF(c.id IS NULL, NULL, d.category_id) AS category_id, c.name AS category_name
     FROM item_dict d
     LEFT JOIN categories c ON c.id = d.category_id AND c.active = 1 AND c.ledger_id = :l`;

// Kategoria musi należeć do TEJ SAMEJ księgi co paragon (wzorzec z routes/transactions.js).
async function kategoriaWKsiedze(catId, ledgerId) {
  const rows = await q('SELECT id FROM categories WHERE id = :c AND ledger_id = :l', { c: catId, l: ledgerId });
  return rows.length > 0;
}

// K3: podpowiedź = ostatnia decyzja człowieka dla tego samego kodu.
async function suggestFromDict(code, ledgerId) {
  const cn = normCode(code);
  if (!cn || cn.length < 2) return null;
  const rows = await q(`${DICT_SELECT} WHERE d.code_norm = :cn LIMIT 1`, { cn, l: ledgerId });
  return rows[0] || null;
}

// Podpowiedzi dla całego paragonu jednym zapytaniem (telefon + shared hosting = mniej rund do bazy).
async function withSuggestions(items, ledgerId) {
  const klucze = [...new Set(items.map((it) => normCode(it.code || it.ocr_name)).filter((k) => k && k.length >= 2))];
  if (!klucze.length) return items.map((it) => ({ ...it, suggestion: null }));
  const p = Object.fromEntries(klucze.map((k, i) => [`k${i}`, k]));
  p.l = ledgerId;
  const rows = await q(`${DICT_SELECT} WHERE d.code_norm IN (${klucze.map((_, i) => `:k${i}`).join(',')})`, p);
  const wg = new Map(rows.map((r) => [r.code_norm, r]));
  return items.map((it) => ({ ...it, suggestion: wg.get(normCode(it.code || it.ocr_name)) || null }));
}

// K4: ręczna korekta uczy słownik. hits+1, a opis/jednostka/kategoria to ostatnia decyzja człowieka.
//
// NAPRAWA (audyt Z4): `COALESCE(VALUES(unit), unit)` sprawiał, że raz nauczonej jednostki NIE DAŁO
// SIĘ oduczyć — wyczyszczenie pola zostawiało błędne „kg" przy chlebie na zawsze. Teraz: pole,
// które brało udział w korekcie (człowiek je dotknął), zapisuje się dosłownie — także puste.
// COALESCE zostaje wyłącznie dla pól, których ta korekta w ogóle nie dotyczyła.
async function learnItem({ code, name, unit, categoryId, userName, uczJednostke, uczKategorie }) {
  const cn = normCode(code);
  const nm = String(name === null || name === undefined ? '' : name).trim().slice(0, 255);
  if (!cn || cn.length < 2 || !nm) return false;
  const zmiany = [
    'hits = hits + 1',
    'name = VALUES(name)',
    uczJednostke ? 'unit = VALUES(unit)' : 'unit = COALESCE(VALUES(unit), unit)',
    uczKategorie ? 'category_id = VALUES(category_id)' : 'category_id = COALESCE(VALUES(category_id), category_id)',
    'updated_by = VALUES(updated_by)',
  ];
  await q(
    `INSERT INTO item_dict (code_norm, name, unit, category_id, hits, updated_by)
     VALUES (:cn, :n, :u, :c, 1, :by)
     ON DUPLICATE KEY UPDATE ${zmiany.join(', ')}`,
    { cn, n: nm, u: normUnit(unit), c: categoryId || null,
      by: String(userName || '').slice(0, 64) || null });
  return true;
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
