// OCR paragonów: upload obrobionego zdjęcia (telefon robi kadr/B&W) → tesseract.js (pol)
// → parser pozycji → tabele receipts/receipt_items → plik w RECEIPTS_DIR (poza docrootem).
// Hybryda (decyzja Szymona): POST /:id/ai-fix — ponowny odczyt modelem wizyjnym wg CENNIK,
// tylko na żądanie, wymaga ANTHROPIC_API_KEY w .env; bez klucza endpoint zwraca 501.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { q, pool } = require('../db');
const { ledgerScope } = require('../auth');
const { parseReceipt } = require('../ocr/parse-receipt');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

const RECEIPTS_DIR = process.env.RECEIPTS_DIR || path.join(__dirname, '..', '..', '..', 'receipts');
const OCR_LANG_DIR = process.env.OCR_LANG_DIR || path.join(__dirname, '..', '..', 'ocr-data');

let workerPromise = null; // jeden worker tesseracta na proces (start ~2-4 s, potem szybciej)
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      return createWorker('pol', 1, {
        langPath: OCR_LANG_DIR, gzip: true, cachePath: OCR_LANG_DIR,
        logger: () => {},
      });
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

function normProductPattern(name) {
  return String(name || '').toUpperCase()
    .replace(/[0-9]/g, '').replace(/[^\p{L} ]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 64) || null;
}

async function suggestItemCategory(name) {
  const p = normProductPattern(name);
  if (!p || p.length < 3) return null;
  const rows = await q(
    `SELECT m.category_id FROM mapping_cache m JOIN categories c ON c.id=m.category_id AND c.active=1
     WHERE m.pattern = :p LIMIT 1`, { p });
  return rows[0]?.category_id || null;
}

async function saveParsed(receiptId, parsed) {
  await q('DELETE FROM receipt_items WHERE receipt_id = :r', { r: receiptId });
  for (const it of parsed.items) {
    const catId = await suggestItemCategory(it.ocr_name);
    await q(
      `INSERT INTO receipt_items (receipt_id, line_no, ocr_name, quantity, unit_price, value, category_id, low_confidence)
       VALUES (:r, :n, :o, :qy, :up, :v, :c, :lc)`,
      { r: receiptId, n: it.line_no, o: it.ocr_name, qy: it.quantity, up: it.unit_price,
        v: it.value, c: catId, lc: it.low_confidence ? 1 : 0 });
  }
  await q('UPDATE receipts SET shop_name=:s, receipt_date=:d, total=:t WHERE id=:id',
    { s: parsed.shop_name, d: parsed.receipt_date, t: parsed.total, id: receiptId });
}

// POST /api/v1/receipts — multipart: image (JPEG po obróbce na telefonie), ledger_id?
router.post('/', upload.single('image'), async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    const ledgerId = parseInt(req.body.ledger_id || 1, 10);
    if (!scope.ledgers.includes(ledgerId)) return res.status(403).json({ error: 'ledger_forbidden' });
    if (!req.file) return res.status(400).json({ error: 'no_image' });

    // OCR (tesseract.js — lokalnie, zero chmury)
    const worker = await getWorker();
    const { data } = await worker.recognize(req.file.buffer);
    const parsed = parseReceipt(data.text);

    // anty-duplikacja: hash treści merytorycznej paragonu
    const hash = crypto.createHash('sha256').update([
      parsed.shop_name || '', parsed.receipt_date || '', parsed.total ?? '',
      parsed.items.map((i) => `${i.ocr_name}|${i.value}`).join(';'),
    ].join('#'), 'utf8').digest('hex');
    const dupe = await q('SELECT id, created_at FROM receipts WHERE receipt_hash = :h', { h: hash });
    if (dupe.length) return res.status(409).json({ error: 'duplicate_receipt', existing_id: dupe[0].id, imported_at: dupe[0].created_at });

    // plik: receipts/RRRR/MM/<hash>.jpg (poza docrootem)
    const now = new Date();
    const rel = path.join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), hash.slice(0, 24) + '.jpg');
    const abs = path.join(RECEIPTS_DIR, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, req.file.buffer);

    const r = await q(
      `INSERT INTO receipts (ledger_id, user_id, shop_name, receipt_date, total, ocr_confidence, ocr_text, image_path, receipt_hash)
       VALUES (:l, :u, :s, :d, :t, :cf, :txt, :img, :h)`,
      { l: ledgerId, u: req.user.uid, s: parsed.shop_name, d: parsed.receipt_date, t: parsed.total,
        cf: data.confidence ?? null, txt: (data.text || '').slice(0, 60000), img: rel, h: hash });
    await saveParsed(r.insertId, parsed);
    const items = await q('SELECT * FROM receipt_items WHERE receipt_id=:r ORDER BY line_no', { r: r.insertId });
    res.status(201).json({ id: r.insertId, ...parsed, items, ocr_confidence: data.confidence,
      ai_available: !!process.env.ANTHROPIC_API_KEY });
  } catch (e) { next(e); }
});

// GET /api/v1/receipts — lista (własne dla ownOnly)
router.get('/', async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    const own = scope.ownOnly ? 'AND user_id = :u' : '';
    const rows = await q(
      `SELECT id, ledger_id, shop_name, receipt_date, total, status, ocr_confidence, created_at
       FROM receipts WHERE ledger_id IN (${scope.ledgers.join(',') || 0}) ${own}
       ORDER BY id DESC LIMIT 50`, { u: req.user.uid });
    res.json({ receipts: rows });
  } catch (e) { next(e); }
});

async function loadOwnedReceipt(req, res) {
  const scope = ledgerScope(req.user);
  const rows = await q('SELECT * FROM receipts WHERE id = :id', { id: parseInt(req.params.id, 10) });
  if (!rows.length || !scope.ledgers.includes(rows[0].ledger_id) ||
      (scope.ownOnly && rows[0].user_id !== req.user.uid)) {
    res.status(404).json({ error: 'not_found' }); return null;
  }
  return rows[0];
}

router.get('/:id', async (req, res, next) => {
  try {
    const rc = await loadOwnedReceipt(req, res); if (!rc) return;
    const items = await q('SELECT * FROM receipt_items WHERE receipt_id=:r ORDER BY line_no', { r: rc.id });
    delete rc.ocr_text;
    res.json({ ...rc, items, ai_available: !!process.env.ANTHROPIC_API_KEY });
  } catch (e) { next(e); }
});

router.get('/:id/image', async (req, res, next) => {
  try {
    const rc = await loadOwnedReceipt(req, res); if (!rc) return;
    const abs = path.join(RECEIPTS_DIR, rc.image_path);
    if (!abs.startsWith(RECEIPTS_DIR) || !fs.existsSync(abs)) return res.status(404).json({ error: 'file_missing' });
    res.setHeader('Content-Type', 'image/jpeg');
    fs.createReadStream(abs).pipe(res);
  } catch (e) { next(e); }
});

// PATCH /api/v1/receipts/:id/items/:itemId {name?, category_id?, value?} — korekta + SAMOUCZENIE
router.patch('/:id/items/:itemId', async (req, res, next) => {
  try {
    const rc = await loadOwnedReceipt(req, res); if (!rc) return;
    const b = req.body || {};
    const sets = [], p = { id: parseInt(req.params.itemId, 10), r: rc.id };
    if (b.name !== undefined) { sets.push('name = :n'); p.n = String(b.name).slice(0, 255) || null; }
    if (b.category_id !== undefined) { sets.push('category_id = :c'); p.c = b.category_id || null; }
    if (b.value !== undefined) { const v = parseFloat(String(b.value).replace(',', '.')); if (Number.isFinite(v)) { sets.push('value = :v'); p.v = v; } }
    if (!sets.length) return res.status(400).json({ error: 'nothing_to_update' });
    sets.push('low_confidence = 0');
    await q(`UPDATE receipt_items SET ${sets.join(', ')} WHERE id = :id AND receipt_id = :r`, p);
    // samouczenie: korekta kategorii produktu zapamiętana pod wzorcem nazwy OCR
    if (b.category_id) {
      const [[it]] = [await q('SELECT ocr_name FROM receipt_items WHERE id=:id', { id: p.id })];
      const pattern = normProductPattern(it?.ocr_name);
      if (pattern) await q(
        `INSERT INTO mapping_cache (pattern, category_id, hits, confidence, updated_by)
         VALUES (:p, :c, 1, 0.60, :u)
         ON DUPLICATE KEY UPDATE
           hits = IF(category_id = VALUES(category_id), hits + 1, 1),
           confidence = IF(category_id = VALUES(category_id), LEAST(confidence + 0.10, 0.99), 0.60),
           category_id = VALUES(category_id), updated_by = VALUES(updated_by)`,
        { p: pattern, c: b.category_id, u: req.user.name });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/v1/receipts/:id/confirm {category_id?} — tworzy WYDATEK w księdze
router.post('/:id/confirm', async (req, res, next) => {
  try {
    const rc = await loadOwnedReceipt(req, res); if (!rc) return;
    if (rc.status === 'POTWIERDZONY') return res.status(409).json({ error: 'already_confirmed' });
    if (rc.total === null) return res.status(400).json({ error: 'no_total', hint: 'uzupełnij SUMĘ przed potwierdzeniem' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.execute(
        `INSERT INTO transactions (ledger_id, user_id, tx_date, type, amount, category_id, description, source, legacy_id)
         VALUES (?, ?, ?, 'WYDATEK', ?, ?, ?, 'RECEIPT', ?)`,
        [rc.ledger_id, req.user.uid, rc.receipt_date || new Date().toISOString().slice(0, 10),
         Math.abs(rc.total), req.body?.category_id || null,
         ('Paragon: ' + (rc.shop_name || '')).slice(0, 512), 'rcpt:' + rc.receipt_hash.slice(0, 24)]);
      await conn.execute("UPDATE receipts SET status='POTWIERDZONY', transaction_id=? WHERE id=?", [r.insertId, rc.id]);
      await conn.commit();
      res.status(201).json({ transaction_id: r.insertId });
    } catch (e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (e) { next(e); }
});

// POST /api/v1/receipts/:id/ai-fix — HYBRYDA: ponowny odczyt modelem wizyjnym (na żądanie)
router.post('/:id/ai-fix', async (req, res, next) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(501).json({ error: 'ai_not_configured', hint: 'ustaw ANTHROPIC_API_KEY w .env' });
    const rc = await loadOwnedReceipt(req, res); if (!rc) return;
    const abs = path.join(RECEIPTS_DIR, rc.image_path);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'file_missing' });
    const b64 = fs.readFileSync(abs).toString('base64');
    const model = process.env.AI_OCR_MODEL || 'claude-haiku-4-5-20251001'; // tani model wizyjny wg CENNIK
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 2000,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: 'Odczytaj ten polski paragon. Zwróć WYŁĄCZNIE JSON: {"shop_name":str|null,"receipt_date":"YYYY-MM-DD"|null,"total":number|null,"items":[{"ocr_name":str,"quantity":number,"unit_price":number,"value":number}]}. Kwoty jako liczby z kropką. Pomiń rabaty jako osobne pozycje — odejmij je od wartości pozycji.' },
        ] }],
      }),
    });
    if (!resp.ok) return res.status(502).json({ error: 'ai_failed', status: resp.status });
    const out = await resp.json();
    const txt = (out.content?.[0]?.text || '').replace(/^```json?\s*|\s*```$/g, '');
    let parsed;
    try { parsed = JSON.parse(txt); } catch { return res.status(502).json({ error: 'ai_bad_json' }); }
    parsed.items = (parsed.items || []).map((it, i) => ({
      line_no: i + 1, ocr_name: String(it.ocr_name || '').slice(0, 255),
      quantity: it.quantity ?? 1, unit_price: it.unit_price ?? it.value ?? null,
      value: it.value ?? null, low_confidence: false,
    })).filter((it) => it.ocr_name && it.value !== null);
    parsed.warnings = [];
    await saveParsed(rc.id, parsed);
    await q("UPDATE receipts SET ocr_engine='ai' WHERE id=:id", { id: rc.id });
    const items = await q('SELECT * FROM receipt_items WHERE receipt_id=:r ORDER BY line_no', { r: rc.id });
    res.json({ id: rc.id, ...parsed, items });
  } catch (e) { next(e); }
});

module.exports = router;
