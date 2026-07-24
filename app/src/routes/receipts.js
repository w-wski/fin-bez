// OCR paragonów: upload obrobionego zdjęcia (telefon robi kadr/B&W) → tesseract.js (pol)
// → parser pozycji → tabele receipts/receipt_items → plik w RECEIPTS_DIR (poza docrootem).
//
// ZASADA (zlecenie Z4): odczyt OCR to PROPOZYCJA, nie fakt. Poprawić da się WSZYSTKO —
// nagłówek (PATCH /:id, także po zaksięgowaniu) i każde pole pozycji (PATCH /:id/items/:itemId),
// pozycję można dopisać (POST /:id/items) i usunąć (DELETE /:id/items/:itemId).
// Tu zostaje HTTP, autoryzacja i WALIDACJA WEJŚCIA; logika pozycji w ../ocr/pozycje,
// słownik w ../ocr/slownik, styk z księgą w ../ocr/ksiega, hybryda AI w ../ocr/ai.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { q, pool } = require('../db');
const { ledgerScope } = require('../auth');
const { parseKwota } = require('../kwota');            // jedyne miejsce, gdzie napis staje się kwotą
const { parseReceipt, sladyRecznejPracy } = require('../ocr/parse-receipt');
const { txt, czyData } = require('../ocr/pola');
const { kategoriaWKsiedze } = require('../ocr/slownik');
const { zapiszNaglowek, ksieguj } = require('../ocr/ksiega');
const { odczytajAI } = require('../ocr/ai');
const poz = require('../ocr/pozycje');

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

// DATE z MySQL wraca jako napis (db.js: dateStrings) albo obiekt Date — do przeglądarki musi
// trafić czysta doba lokalna, inaczej strefa czasowa cofa paragon o jeden dzień.
const dataISO = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
};

// K9: paragon i jego zdjęcie widzi WYŁĄCZNIE właściciel albo admin. Cudzy = 404 (nie 403 —
// 403 zdradzałoby, że taki paragon istnieje). Sama rola „adult" nie wystarcza: zakres księgi
// jest tu za szeroki, a paragon bywa prywatny.
async function loadOwnedReceipt(req, res) {
  const scope = ledgerScope(req.user);
  const rows = await q('SELECT * FROM receipts WHERE id = :id', { id: parseInt(req.params.id, 10) || 0 });
  const rc = rows[0];
  const moj = rc && rc.user_id === req.user.uid;
  if (!rc || !scope.ledgers.includes(rc.ledger_id) || (!moj && req.user.role !== 'admin')) {
    res.status(404).json({ error: 'not_found' }); return null;
  }
  return rc;
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

    // anty-duplikacja: hash treści merytorycznej paragonu. existing_id pozwala frontowi
    // OTWORZYĆ zapisany paragon zamiast pokazać ślepy komunikat „duplikat".
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

    // paragon + pozycje w JEDNEJ transakcji: pad w połowie nie zostawia paragonu bez pozycji
    const conn = await pool.getConnection();
    let id;
    try {
      await conn.beginTransaction();
      const [r] = await conn.execute(
        `INSERT INTO receipts (ledger_id, user_id, shop_name, receipt_date, total, ocr_confidence, ocr_text, image_path, receipt_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ledgerId, req.user.uid, txt(parsed.shop_name, 128), czyData(parsed.receipt_date), parseKwota(parsed.total),
          data.confidence ?? null, (data.text || '').slice(0, 60000), rel, hash]);
      id = r.insertId;
      await poz.saveParsed(conn, id, parsed, ledgerId);
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    res.status(201).json({ id, ...parsed, status: 'NOWY', items: await poz.loadItems(id, ledgerId),
      ocr_confidence: data.confidence, ai_available: !!process.env.ANTHROPIC_API_KEY });
  } catch (e) { next(e); }
});

// GET /api/v1/receipts — lista (K9: swoje; admin widzi wszystkie w swoich księgach).
// To jest DROGA POWROTU do paragonu, którego nie dokończono (zgaszony ekran, przeładowana karta).
router.get('/', async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    const own = req.user.role === 'admin' ? '' : 'AND r.user_id = :u';
    const rows = await q(
      `SELECT r.id, r.ledger_id, r.shop_name, r.receipt_date, r.total, r.status, r.ocr_confidence, r.created_at,
              (SELECT COUNT(*) FROM receipt_items i WHERE i.receipt_id = r.id) AS items_count
       FROM receipts r WHERE r.ledger_id IN (${scope.ledgers.join(',') || 0}) ${own}
       ORDER BY r.id DESC LIMIT 50`, { u: req.user.uid });
    res.json({ receipts: rows.map((r) => ({ ...r, receipt_date: dataISO(r.receipt_date) })) });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const rc = await loadOwnedReceipt(req, res); if (!rc) return;
    const items = await poz.loadItems(rc.id, rc.ledger_id);
    delete rc.ocr_text;
    res.json({ ...rc, receipt_date: dataISO(rc.receipt_date), items,
      ai_available: !!process.env.ANTHROPIC_API_KEY });
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

// PATCH /api/v1/receipts/:id {shop_name?, receipt_date?, total?} — nagłówek paragonu (K1).
// Po zaksięgowaniu SUMA i data NADAL są edytowalne — inaczej błędna kwota zostawałaby
// w księdze na zawsze. Warunek: zmiana idzie w tej samej transakcji SQL co poprawka wpisu
// w księdze, żeby paragon i księga nie rozjechały się w ŻADNĄ stronę.
router.patch('/:id', async (req, res, next) => {
  try {
    const rc = await loadOwnedReceipt(req, res); if (!rc) return;
    const b = req.body || {};
    const zaksiegowany = rc.status === 'POTWIERDZONY' && !!rc.transaction_id;
    const sets = [], params = [], ksiegaSet = {}, zapisane = {};
    if (b.shop_name !== undefined) {
      zapisane.shop_name = txt(b.shop_name, 128);
      sets.push('shop_name = ?'); params.push(zapisane.shop_name);
    }
    if (b.receipt_date !== undefined) {
      const pusta = b.receipt_date === null || String(b.receipt_date).trim() === '';
      const d = pusta ? null : czyData(b.receipt_date);
      if (!pusta && !d) return res.status(400).json({ error: 'bad_date', hint: 'To nie jest istniejąca data — podaj dzień w formacie RRRR-MM-DD. Nic nie zapisałem.' });
      if (!d && zaksiegowany) return res.status(400).json({ error: 'date_required', hint: 'Ten paragon jest już w księdze — wpis nie może zostać bez daty.' });
      zapisane.receipt_date = d;
      sets.push('receipt_date = ?'); params.push(d);
      if (zaksiegowany && d) ksiegaSet.tx_date = d;
    }
    if (b.total !== undefined) {
      const pusta = b.total === null || String(b.total).trim() === '';
      const t = pusta ? null : parseKwota(b.total);
      if (!pusta && (t === null || t <= 0)) {
        return res.status(400).json({ error: 'bad_total', hint: 'Nie rozumiem tej kwoty — wpisz np. 1234,56 (musi być większa od zera). Nic nie zapisałem.' });
      }
      if (t === null && zaksiegowany) return res.status(400).json({ error: 'total_required', hint: 'Ten paragon jest już w księdze — wpis nie może zostać bez kwoty.' });
      zapisane.total = t;
      sets.push('total = ?'); params.push(t);
      if (zaksiegowany && t !== null) ksiegaSet.amount = t;
    }
    if (!sets.length) return res.status(400).json({ error: 'nothing_to_update' });
    const ksiega = await zapiszNaglowek(rc, sets, params, ksiegaSet);
    res.json({ ok: true, zapisane, transaction_id: rc.transaction_id, ksiega });
  } catch (e) { next(e); }
});

// 400 zamiast cichego „ok": wartość, której serwer nie przyjął, NIE MOŻE wyglądać na zapisaną.
const bledyPola = {
  bad_quantity: 'Nie rozumiem tej ilości — wpisz np. 2 albo 0,345. Nic nie zapisałem.',
  bad_unit_price: 'Nie rozumiem tej ceny — wpisz np. 12,50. Nic nie zapisałem.',
  bad_value: 'Nie rozumiem tej wartości — wpisz np. 12,50. Nic nie zapisałem.',
  bad_category: 'Ta kategoria nie należy do księgi tego paragonu.',
  nothing_to_update: 'Nie było czego zapisać.',
};
const odpowiedzPozycji = (res, out, status) => (out.blad
  ? res.status(400).json({ error: out.blad, hint: bledyPola[out.blad] })
  : res.status(status).json({ ok: true, ...out }));

// POST /api/v1/receipts/:id/items — pozycja dopisana ręcznie (K2)
router.post('/:id/items', async (req, res, next) => {
  try {
    const rc = await loadOwnedReceipt(req, res); if (!rc) return;
    return odpowiedzPozycji(res, await poz.createItem(rc.id, req.body || {}, req.user.name, rc.ledger_id), 201);
  } catch (e) { next(e); }
});

// PATCH /api/v1/receipts/:id/items/:itemId — korekta DOWOLNEGO pola pozycji + samouczenie
router.patch('/:id/items/:itemId', async (req, res, next) => {
  try {
    const rc = await loadOwnedReceipt(req, res); if (!rc) return;
    const out = await poz.updateItem(rc.id, parseInt(req.params.itemId, 10) || 0, req.body || {}, req.user.name, rc.ledger_id);
    if (!out) return res.status(404).json({ error: 'item_not_found' });
    return odpowiedzPozycji(res, out, 200);
  } catch (e) { next(e); }
});

// DELETE /api/v1/receipts/:id/items/:itemId — usunięcie błędnie rozpoznanej pozycji (K2)
router.delete('/:id/items/:itemId', async (req, res, next) => {
  try {
    const rc = await loadOwnedReceipt(req, res); if (!rc) return;
    const items = await poz.deleteItem(rc.id, parseInt(req.params.itemId, 10) || 0, rc.ledger_id);
    if (!items) return res.status(404).json({ error: 'item_not_found' });
    res.json({ ok: true, items });
  } catch (e) { next(e); }
});

// POST /api/v1/receipts/:id/confirm {category_id?} — tworzy JEDEN WYDATEK w księdze.
// Kwota MUSI być dodatnia, a data MUSI być podana: księgowanie „dzisiejszą datą", bo paragon
// jej nie miał, po cichu przesuwało wydatek na inny miesiąc.
router.post('/:id/confirm', async (req, res, next) => {
  try {
    const rc = await loadOwnedReceipt(req, res); if (!rc) return;
    if (rc.status === 'POTWIERDZONY') return res.json({ transaction_id: rc.transaction_id, already_confirmed: true });
    const kwota = rc.total === null ? null : Number(rc.total);
    if (kwota === null || !Number.isFinite(kwota) || kwota <= 0) {
      return res.status(400).json({ error: 'bad_total', hint: 'Uzupełnij SUMĘ paragonu — kwota musi być większa od zera.' });
    }
    const data = czyData(dataISO(rc.receipt_date));
    if (!data) return res.status(400).json({ error: 'no_date', hint: 'Uzupełnij datę paragonu — nie zaksięguję go dzisiejszą datą bez Twojej wiedzy.' });
    const b = req.body || {};
    const catId = (b.category_id === undefined || b.category_id === null || b.category_id === '') ? null : Number(b.category_id);
    if (catId !== null && (!Number.isInteger(catId) || catId <= 0 || !(await kategoriaWKsiedze(catId, rc.ledger_id)))) {
      return res.status(400).json({ error: 'bad_category', hint: bledyPola.bad_category });
    }
    const out = await ksieguj(rc, req.user, kwota, data, catId);
    res.status(out.already_confirmed ? 200 : 201).json(out);
  } catch (e) { next(e); }
});

// POST /api/v1/receipts/:id/ai-fix — HYBRYDA: ponowny odczyt modelem wizyjnym (na żądanie).
// Ponowny odczyt KASUJE pozycje, więc wolno mu ruszyć wyłącznie surowy odczyt maszyny:
// paragon zaksięgowany albo poprawiany ręcznie dostaje 409 i wyjaśnienie, zamiast po cichu
// zmienić sumę pod zaksięgowanym wpisem i skasować ślad audytowy (ocr_name) razem z poprawkami.
router.post('/:id/ai-fix', async (req, res, next) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(501).json({ error: 'ai_not_configured', hint: 'ustaw ANTHROPIC_API_KEY w .env' });
    const rc = await loadOwnedReceipt(req, res); if (!rc) return;
    if (rc.status === 'POTWIERDZONY') {
      return res.status(409).json({ error: 'already_confirmed', hint: 'Ten paragon jest już w księdze — ponowny odczyt zmieniłby kwotę pod zaksięgowanym wpisem. Popraw pola ręcznie.' });
    }
    if (rc.ocr_engine === 'ai') {
      return res.status(409).json({ error: 'already_ai', hint: 'To zdjęcie czytało już AI — drugi odczyt nic nie zmieni. Popraw pola ręcznie.' });
    }
    const items = await poz.loadItems(rc.id, rc.ledger_id);
    if (sladyRecznejPracy(rc, items)) {
      return res.status(409).json({ error: 'receipt_edited', hint: 'W tym paragonie są już poprawki (opisy, kwoty, kategorie) — ponowny odczyt AI by je skasował. Popraw pola ręcznie.' });
    }
    const abs = path.join(RECEIPTS_DIR, rc.image_path);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'file_missing' });
    const parsed = await odczytajAI(fs.readFileSync(abs).toString('base64'));
    if (parsed.error) return res.status(502).json(parsed);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await poz.saveParsed(conn, rc.id, parsed, rc.ledger_id);
      await conn.execute("UPDATE receipts SET ocr_engine='ai' WHERE id=?", [rc.id]);
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    res.json({ id: rc.id, ...parsed, status: rc.status, ledger_id: rc.ledger_id,
      items: await poz.loadItems(rc.id, rc.ledger_id), ai_available: true });
  } catch (e) { next(e); }
});

module.exports = router;
