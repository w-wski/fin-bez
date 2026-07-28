// Pozycje paragonu: zapis wyniku parsera i ręczna edycja (dodaj / popraw / usuń).
// Wydzielone z routes/receipts.js — tam została warstwa HTTP i autoryzacja, tu jest
// logika danych. Powód wydzielenia: limit 300 linii na plik (scripts/preflight.js).
//
// Reguły całego modułu:
// 1. Odczyt OCR jest PROPOZYCJĄ; ocr_name nigdy nie jest nadpisywany (ślad audytowy).
// 2. Kwoty czyta WYŁĄCZNIE parseKwota (../kwota), ilości parseIlosc (./pola). Napis, którego
//    nie da się odczytać jednoznacznie („l2,50"), to ODMOWA ZAPISU (400) — nigdy ciche NULL.
// 3. Każdy zapis zmieniający więcej niż jeden wiersz idzie w transakcji SQL.
const { q, pool } = require('../db');
const { parseKwota } = require('../kwota');
const { txt, normUnit, parseIlosc, czyData, isInconsistent } = require('./pola');
const { suggestFromDict, withSuggestions, learnItem, kategoriaWKsiedze,
  suggestCategoryByName, learnCategoryPattern } = require('./slownik');
const produkt = require('./produkt-baza');

const KOLUMNY = '(receipt_id, line_no, ocr_name, code, name, quantity, unit, unit_price, value, category_id, low_confidence, discount)';
const ZNAKI = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

async function loadItems(receiptId, ledgerId) {
  const items = await q('SELECT * FROM receipt_items WHERE receipt_id=:r ORDER BY line_no, id', { r: receiptId });
  return withSuggestions(items, ledgerId);   // K3: podpowiedź ze słownika dla każdej pozycji, jednym zapytaniem
}

// Pole liczbowe formularza → { value } albo { blad }. Puste pole jest dozwolone (null),
// napis nie do odczytania — NIE. Znikająca kwota jest gorsza niż komunikat o błędzie.
const puste = (v) => v === null || v === undefined || String(v).trim() === '';
function kwotaPola(v) {
  if (puste(v)) return { value: null };
  const n = parseKwota(v);
  return n === null ? { blad: true } : { value: n };
}
function iloscPola(v) {
  if (puste(v)) return { value: null };
  const n = parseIlosc(v);
  return n === null ? { blad: true } : { value: n };
}

// Zapis wyniku parsera (OCR albo AI) — CAŁY w jednej transakcji SQL wołającego: pad po DELETE
// nie może zostawić paragonu bez pozycji. Wolno tu kasować stare wiersze WYŁĄCZNIE dlatego, że
// wołający (ai-fix) wcześniej sprawdza sladyRecznejPracy() — pracy człowieka to nie dotyka.
// Opis/jednostka/kategoria startują ze słownika: to propozycja z wcześniejszych decyzji (K3).
async function saveParsed(conn, receiptId, parsed, ledgerId) {
  // Najpierw CZYTAMY słownik (jednym zapytaniem dla całego paragonu), dopiero potem PISZEMY.
  // Pula ma 5 połączeń (shared hosting) — odpytywanie słownika w środku otwartej transakcji
  // trzymałoby drugie połączenie na każdą pozycję.
  const wejscie = parsed.items.map((it) => ({ ...it, code: it.code || it.ocr_name }));
  const wiersze = [];
  let nr = 0;
  for (const it of await withSuggestions(wejscie, ledgerId)) {
    const d = it.suggestion;
    const catId = (d && d.category_id) || await suggestCategoryByName(it.ocr_name, ledgerId);
    wiersze.push([receiptId, ++nr, String(it.ocr_name || '').slice(0, 255), txt(it.code, 255), (d && d.name) || null,
      iloscPola(it.quantity).value, (d && d.unit) || null, kwotaPola(it.unit_price).value,
      kwotaPola(it.value).value, catId, isInconsistent(it) ? 1 : 0, kwotaPola(it.discount).value]);
  }
  await conn.execute('DELETE FROM receipt_items WHERE receipt_id = ?', [receiptId]);
  for (const w of wiersze) await conn.execute(`INSERT INTO receipt_items ${KOLUMNY} VALUES ${ZNAKI}`, w);
  await conn.execute('UPDATE receipts SET shop_name=?, receipt_date=?, total=? WHERE id=?',
    [txt(parsed.shop_name, 128), czyData(parsed.receipt_date), kwotaPola(parsed.total).value, receiptId]);
  // Pozycje wskazują na produkty, które JUŻ znamy z wcześniejszych decyzji człowieka.
  // Nierozpoznane zostają z product_id = NULL — to normalny stan, nie błąd. Nowych
  // produktów maszyna nie zakłada (powód w nagłówku produkt-baza.js).
  await produkt.przypiszPozycje(conn, receiptId, parsed.shop_name);
}

// K4: korekta człowieka wchodzi do słownika (kod → opis/jednostka/kategoria) oraz — dla
// kategorii — do mapping_cache po wzorcu nazwy OCR, jak samouczenie importu w imports.js.
//
// NAPRAWA (audyt Z4): uczymy WYŁĄCZNIE tym, co człowiek zatwierdził dla TEGO kodu. Zmiana samego
// kodu nie uczy niczego — opis „masło extra" należał do starego kodu; wpisanie go pod nowym
// skasowałoby kilkanaście wcześniejszych decyzji i wróciło jako fałszywa „podpowiedź ze słownika".
//
// PRODUKTY (2026-07-28): ta sama korekta zakłada albo dowiązuje produkt i alias
// (kod → produkt w TYM sklepie). Robi to wyłącznie ręczna poprawka, nigdy OCR — katalog
// rodziny ma zawierać towary, a nie literówki maszyny.
async function ucz(item, b, userName, sklep) {
  const dotkniete = ['name', 'unit', 'category_id', 'product_id'].filter((k) => b[k] !== undefined);
  if (!dotkniete.length) return false;
  // learnItem odmawia zapisu bez opisu (kolumna name jest NOT NULL) — wtedy nie mówimy
  // człowiekowi „zapamiętane w słowniku", bo nic nie zapamiętaliśmy.
  const zapisane = await learnItem({ code: item.code || item.ocr_name, name: item.name, unit: item.unit,
    categoryId: item.category_id, userName,
    uczJednostke: b.unit !== undefined, uczKategorie: b.category_id !== undefined });
  if (b.category_id !== undefined && item.category_id && item.ocr_name) {
    await learnCategoryPattern(item.ocr_name, item.category_id, userName);
  }
  // Produkt zakłada/dowiązuje TA korekta, ale tylko gdy jest już czym go nazwać. Sama
  // zmiana kategorii bez opisu nie tworzy produktu — powstałby katalog nazwany kodami OCR.
  const pid = await produkt.zapamietaj({
    sklep, kod: item.code || item.ocr_name, nazwa: item.name, unit: item.unit,
    categoryId: item.category_id, productId: b.product_id !== undefined ? item.product_id : null,
  });
  if (pid && Number(item.product_id) !== pid) {
    await q('UPDATE receipt_items SET product_id = :p WHERE id = :id', { p: pid, id: item.id });
    item.product_id = pid;
  }
  return zapisane;
}

/** Nazwa sklepu z paragonu — potrzebna, żeby alias trafił do właściwej sieci. */
const sklepParagonu = async (receiptId) =>
  ((await q('SELECT shop_name FROM receipts WHERE id = :r', { r: receiptId }))[0] || {}).shop_name || null;

// K6: znacznik spójności liczony z aktualnego stanu pozycji (nie zerowany „na wiarę"),
// ale NIGDY nie blokuje zapisu — rabaty i wagowe zaokrąglenia to normalne paragony.
async function odswiezSpojnosc(item) {
  const low = isInconsistent(item) ? 1 : 0;
  if (low !== Number(item.low_confidence)) {
    await q('UPDATE receipt_items SET low_confidence = :l WHERE id = :id', { l: low, id: item.id });
  }
  item.low_confidence = low;
}

const pobierz = async (id) => (await q('SELECT * FROM receipt_items WHERE id = :id', { id }))[0];

// Wspólna walidacja pól pozycji: zwraca { blad } albo mapę kolumna→wartość dla podanych pól.
async function pola(b, ledgerId, wszystkie) {
  const out = {};
  const chce = (k) => wszystkie || b[k] !== undefined;
  if (chce('code')) out.code = txt(b.code, 255);
  if (chce('name')) out.name = txt(b.name, 255);
  if (chce('unit')) out.unit = normUnit(b.unit);
  if (chce('quantity')) { const w = iloscPola(b.quantity); if (w.blad) return { blad: 'bad_quantity' }; out.quantity = w.value; }
  if (chce('unit_price')) { const w = kwotaPola(b.unit_price); if (w.blad) return { blad: 'bad_unit_price' }; out.unit_price = w.value; }
  if (chce('value')) { const w = kwotaPola(b.value); if (w.blad) return { blad: 'bad_value' }; out.value = w.value; }
  if (chce('category_id')) {
    const c = puste(b.category_id) ? null : Number(b.category_id);
    // kategoria z CUDZEJ księgi nie może trafić ani do pozycji, ani (przez ucz()) do mapping_cache
    if (c !== null && (!Number.isInteger(c) || c <= 0 || !(await kategoriaWKsiedze(c, ledgerId)))) return { blad: 'bad_category' };
    out.category_id = c;
  }
  if (chce('product_id')) {
    // Scalenie zatwierdzone ręcznie („to jest ten sam produkt co…”). Istnienie sprawdzamy
    // TU, bo nieistniejący klucz obcy wywróciłby zapis błędem MySQL-a, czyli pustym 500.
    const pr = puste(b.product_id) ? null : Number(b.product_id);
    if (pr !== null && (!Number.isInteger(pr) || pr <= 0
      || !(await q('SELECT id FROM products WHERE id = :p AND active = 1', { p: pr })).length)) {
      return { blad: 'bad_product' };
    }
    out.product_id = pr;
  }
  return { pola: out };
}

// K2: pozycja dopisana ręcznie — działa też na paragonie, z którego OCR nie odczytał niczego.
// ocr_name zostaje puste: maszyna tej pozycji nie widziała i nie wolno jej tego przypisać.
async function createItem(receiptId, b, userName, ledgerId) {
  const w = await pola(b, ledgerId, true);
  if (w.blad) return w;
  const d = w.pola;
  const [max] = await q('SELECT COALESCE(MAX(line_no),0)+1 AS n FROM receipt_items WHERE receipt_id = :r', { r: receiptId });
  const ins = await q(`INSERT INTO receipt_items ${KOLUMNY} VALUES ${ZNAKI}`, [
    receiptId, max.n, txt(b.ocr_name, 255) || '', d.code, d.name, d.quantity, d.unit,
    d.unit_price, d.value, d.category_id, isInconsistent(d) ? 1 : 0, null]);
  const item = await pobierz(ins.insertId);
  // K3: podpowiedź to stan słownika SPRZED tej korekty — dopiero potem uczymy (patrz updateItem).
  const suggestion = await suggestFromDict(item.code || item.ocr_name, ledgerId);
  const nauczone = await ucz(item, { name: b.name, unit: b.unit, category_id: b.category_id,
    product_id: b.product_id }, userName, await sklepParagonu(receiptId));
  return { item, suggestion, nauczone };
}

// K1: korekta DOWOLNEGO pola pozycji. null = wynik nie należy do tego paragonu (404 w routerze).
async function updateItem(receiptId, itemId, b, userName, ledgerId) {
  const [stara] = await q('SELECT id FROM receipt_items WHERE id = :id AND receipt_id = :r', { id: itemId, r: receiptId });
  if (!stara) return null;
  const w = await pola(b, ledgerId, false);
  if (w.blad) return w;
  const kolumny = Object.keys(w.pola);
  if (!kolumny.length) return { blad: 'nothing_to_update' };
  await q(`UPDATE receipt_items SET ${kolumny.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`,
    [...kolumny.map((k) => w.pola[k]), itemId]);
  const item = await pobierz(itemId);
  await odswiezSpojnosc(item);
  // KOLEJNOŚĆ MA ZNACZENIE (K3): najpierw podpowiedź (stan słownika sprzed tej korekty),
  // dopiero potem nauka. Odwrotnie serwer zwracał człowiekowi jego własny wpis jako
  // „podpowiedź ze słownika" i kasował wcześniejsze decyzje dla tego kodu.
  const suggestion = await suggestFromDict(item.code || item.ocr_name, ledgerId);
  const nauczone = await ucz(item, b, userName, await sklepParagonu(receiptId));
  return { item, suggestion, nauczone };
}

// K2: usunięcie błędnie rozpoznanej pozycji + przenumerowanie, żeby line_no nie miało dziur.
// Całość w transakcji: pad w połowie przenumerowania zostawiłby dziury albo duplikaty numerów.
async function deleteItem(receiptId, itemId, ledgerId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [del] = await conn.execute('DELETE FROM receipt_items WHERE id = ? AND receipt_id = ?', [itemId, receiptId]);
    if (!del.affectedRows) { await conn.rollback(); return null; }
    const [rows] = await conn.execute('SELECT id, line_no FROM receipt_items WHERE receipt_id = ? ORDER BY line_no, id', [receiptId]);
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].line_no !== i + 1) await conn.execute('UPDATE receipt_items SET line_no = ? WHERE id = ?', [i + 1, rows[i].id]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  return loadItems(receiptId, ledgerId);
}

module.exports = { loadItems, saveParsed, createItem, updateItem, deleteItem };
