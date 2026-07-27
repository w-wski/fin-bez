/* przyjmij.js — trzy drogi wejścia paragonu do bazy, w jednym miejscu.
 *
 *   zdjęcie   (aparat)          → OCR → parser tekstu
 *   pdf       (plik ze sklepu)  → wyłuskanie obrazu → TA SAMA droga co zdjęcie
 *   e-paragon (plik .json)      → bez OCR: dane wprost z podpisanego dokumentu
 *
 * Dlaczego osobny moduł, a nie w routes/receipts.js: droga „zdjęcie" i droga „pdf" różnią się
 * WYŁĄCZNIE tym, skąd bierze się bitmapa, więc trzymanie ich obok siebie jako dwóch kopii
 * tego samego kodu skończyłoby się rozjechaniem po pierwszej poprawce. Trasa HTTP ma zostać
 * cienka: autoryzacja, walidacja wejścia, kod odpowiedzi.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { q, pool } = require('../db');
const { parseKwota } = require('../kwota');
const { parseReceipt } = require('./parse-receipt');
const { txt, czyData } = require('./pola');
const poz = require('./pozycje');
const { obrazZPdf } = require('../pdf-obraz');

const RECEIPTS_DIR = process.env.RECEIPTS_DIR || path.join(__dirname, '..', '..', '..', 'receipts');
const gr = (v) => (v === null || v === undefined ? null : (v / 100).toFixed(2));

/** Ścieżka pliku paragonu: receipts/RRRR/MM/<skrót>.<rozsz>, poza docrootem. */
function zapiszPlik(buf, skrot, rozsz) {
  const now = new Date();
  const rel = path.join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'),
    `${skrot.slice(0, 24)}.${rozsz}`);
  const abs = path.join(RECEIPTS_DIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return rel;
}

/** Wspólna droga dla ZDJĘCIA i PDF-a: rozpoznanie tekstu → parser → zapis.
 *  Zwraca `{ duplikat: {id, imported_at} }` albo gotową odpowiedź dla przeglądarki. */
async function zObrazu({ buffer, rozsz, ledgerId, uid, worker, source }) {
  const { data } = await worker.recognize(buffer);
  const parsed = parseReceipt(data.text);

  // Anty-duplikacja po TREŚCI (przy obrazie nie ma lepszego klucza — inaczej niż
  // w e-paragonie, który ma własny identyfikator dokumentu).
  const hash = crypto.createHash('sha256').update([
    parsed.shop_name || '', parsed.receipt_date || '', parsed.total ?? '',
    parsed.items.map((i) => `${i.ocr_name}|${i.value}`).join(';'),
  ].join('#'), 'utf8').digest('hex');
  const dupe = await q('SELECT id, created_at FROM receipts WHERE receipt_hash = :h', { h: hash });
  if (dupe.length) return { duplikat: { id: dupe[0].id, imported_at: dupe[0].created_at } };

  const rel = zapiszPlik(buffer, hash, rozsz);
  const conn = await pool.getConnection();
  let id;
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute(
      `INSERT INTO receipts (ledger_id, source, user_id, shop_name, receipt_date, total, ocr_confidence, ocr_text, image_path, receipt_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ledgerId, source, uid, txt(parsed.shop_name, 128), czyData(parsed.receipt_date), parseKwota(parsed.total),
        data.confidence ?? null, (data.text || '').slice(0, 60000), rel, hash]);
    id = r.insertId;
    await poz.saveParsed(conn, id, parsed, ledgerId);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  return {
    odpowiedz: {
      id, ...parsed, status: 'NOWY', items: await poz.loadItems(id, ledgerId),
      ocr_confidence: data.confidence, ai_available: !!process.env.ANTHROPIC_API_KEY,
    },
  };
}

/** PDF → bitmapa → droga obrazu. Zapisujemy WYŁUSKANY PNG, nie sam PDF: to on jest tym,
 *  co widział OCR, więc przy sporze „czemu odczytało tak" patrzy się na niego. */
async function zPdf({ buffer, ledgerId, uid, worker }) {
  const { png } = obrazZPdf(buffer);      // rzuca czytelnym błędem, gdy PDF ma tekst albo obcy filtr
  return zObrazu({ buffer: png, rozsz: 'png', ledgerId, uid, worker, source: 'pdf' });
}

/** E-paragon: dane są pewne, więc nie ma OCR, nie ma pewności odczytu i nie ma zgadywania
 *  duplikatu — dokument niesie własny, globalnie jednoznaczny klucz. */
async function zEparagonu({ dok, ledgerId, uid }) {
  const dupe = await q('SELECT id, created_at FROM receipts WHERE doc_key = :k', { k: dok.klucz });
  if (dupe.length) return { duplikat: { id: dupe[0].id, imported_at: dupe[0].created_at } };

  // Kształt zgodny z parserem OCR, żeby zapis pozycji (i podpowiedzi ze słownika) był
  // JEDNĄ funkcją dla obu dróg. `unit_price` to cena KATALOGOWA, `value` — zapłacone.
  const parsed = {
    shop_name: dok.sklep, receipt_date: dok.data, total: gr(dok.total),
    items: dok.pozycje.map((p) => ({
      ocr_name: p.nazwaSurowa, code: p.kod, quantity: p.ilosc,
      unit_price: gr(p.cenaJedn), value: gr(p.wartosc),
    })),
  };
  const zaplata = (dok.zaplata[0] && dok.zaplata[0].nazwa) || null;
  const conn = await pool.getConnection();
  let id;
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute(
      `INSERT INTO receipts (ledger_id, source, user_id, shop_name, nip, receipt_date, total, discount_total, payment, receipt_hash, doc_key, ocr_engine)
       VALUES (?, 'eparagon', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tesseract')`,
      [ledgerId, uid, txt(dok.sklep, 128), txt(dok.nip, 16), czyData(dok.data), gr(dok.total),
        gr(Math.abs(dok.opusty || 0)), txt(zaplata, 32),
        crypto.createHash('sha256').update('eparagon:' + dok.klucz).digest('hex'), dok.klucz]);
    id = r.insertId;
    await poz.saveParsed(conn, id, parsed, ledgerId);
    // Rabat, stawkę VAT i jednostkę ZNAMY z dokumentu — dopisujemy po zapisie pozycji,
    // dopasowując po `line_no`, bo saveParsed numeruje wiersze w kolejności wejścia.
    // (Osobny UPDATE, a nie szersze saveParsed: tamta funkcja obsługuje też OCR, gdzie
    // tych trzech rzeczy po prostu nie ma i nie wolno ich udawać.)
    for (let i = 0; i < dok.pozycje.length; i++) {
      const p = dok.pozycje[i];
      await conn.execute('UPDATE receipt_items SET discount=?, vat_id=?, unit=COALESCE(unit,?) WHERE receipt_id=? AND line_no=?',
        [gr(p.rabat || 0), p.vat || null, p.jednostka || null, id, i + 1]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  return {
    odpowiedz: {
      id, shop_name: dok.sklep, receipt_date: dok.data, total: gr(dok.total),
      status: 'NOWY', source: 'eparagon', payment: zaplata,
      discount_total: gr(Math.abs(dok.opusty || 0)), vat: dok.vat,
      items: await poz.loadItems(id, ledgerId),
      ocr_confidence: null, ai_available: false,
    },
  };
}

module.exports = { zObrazu, zPdf, zEparagonu };
