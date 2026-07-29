/* products.js — katalog produktów i HISTORIA CEN.
 *
 * To jest ta część, dla której Szymon prosił o osobną tabelę produktów: „jak zmieniała się
 * cena przez miesiące i lata” oraz „co i ile naprawdę kupujemy”. Paragony same z siebie
 * tego nie powiedzą — linia paragonu wie tylko o jednym dniu i jednej kasie.
 *
 * DWIE CENY, ZAWSZE OBIE:
 *   katalogowa  (`unit_price`)              — ile towar KOSZTOWAŁ na półce,
 *   zapłacona   (`value` / `quantity`)      — ile z niego zeszło po rabatach.
 * Wykres tylko po jednej z nich kłamie w obie strony: po katalogowej („drożeje!”, choć
 * płacimy mniej), po zapłaconej („taniej!”, choć to była jednorazowa promocja).
 *
 * ZASIĘG: katalog produktów jest wspólny dla domu, ale HISTORIA jest liczona wyłącznie
 * z paragonów, które wolno widzieć pytającemu (ledgerScope + K9: junior widzi swoje).
 * Bez tego junior poznałby zakupy PERSEVERY po cenach jednostkowych.
 */
const express = require('express');
const { q, pool } = require('../db');
const { ledgerScope } = require('../auth');
const { propozycje } = require('../ocr/produkt-baza');
const { dataISO } = require('../ocr/dostep');

const router = express.Router();

/** Warunek WHERE ograniczający paragony do tych, które pytający ma prawo widzieć. */
function zasieg(user) {
  const scope = ledgerScope(user);
  if (!scope.ledgers.length) return null;
  const p = { uid: user.uid };
  scope.ledgers.forEach((l, i) => { p[`l${i}`] = l; });
  const sql = `r.ledger_id IN (${scope.ledgers.map((_, i) => `:l${i}`).join(',')})`
    + (scope.ownOnly ? ' AND r.user_id = :uid' : '');
  return { sql, p };
}

const liczba = (v) => (v === null || v === undefined ? null : Number(v));

// GET /api/v1/products?szukaj=jogurt&limit=100 — katalog z podsumowaniem zakupów.
router.get('/', async (req, res, next) => {
  try {
    const z = zasieg(req.user);
    if (!z) return res.json({ items: [] });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    const szukaj = String(req.query.szukaj || '').trim().slice(0, 64);
    const rows = await q(
      `SELECT p.id, p.name, p.unit, p.pack_size, p.category_id, c.name AS category_name,
              p.product_category_id, pc.name AS product_category_name,
              COUNT(i.id) AS zakupow,
              ROUND(SUM(i.value), 2) AS wydano,
              MAX(r.receipt_date) AS ostatni_zakup
         FROM products p
         LEFT JOIN receipt_items i ON i.product_id = p.id
         LEFT JOIN receipts r ON r.id = i.receipt_id AND ${z.sql}
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN product_categories pc ON pc.id = p.product_category_id
        WHERE p.active = 1 ${szukaj ? 'AND p.name LIKE :szukaj' : ''}
        GROUP BY p.id
        ORDER BY ostatni_zakup IS NULL, ostatni_zakup DESC, p.name
        LIMIT ${limit}`,
      { ...z.p, szukaj: `%${szukaj}%` });
    res.json({
      items: rows.map((r) => ({
        ...r, wydano: liczba(r.wydano), zakupow: Number(r.zakupow),
        ostatni_zakup: dataISO(r.ostatni_zakup),
      })),
    });
  } catch (e) { next(e); }
});

// GET /api/v1/products/kategorie — drzewo kategorii PRODUKTOWYCH (migracja 014).
// Osobna oś od kategorii budżetowych: budżet opisuje przelew, ta oś opisuje towar.
router.get('/kategorie', async (req, res, next) => {
  try {
    const rows = await q('SELECT id, parent_id, name FROM product_categories'
      + ' WHERE active = 1 ORDER BY sort_order, name', {});
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// PATCH /api/v1/products/:id — korekta produktu przez człowieka: nazwa, jednostka,
// kategoria PRODUKTOWA. Kategorii budżetowej celowo tu nie ma — ona należy do wpisu
// w księdze, nie do towaru (dwie osie, decyzja Szymona 2026-07-28).
router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10) || 0;
    const [prod] = await q('SELECT id FROM products WHERE id = :id AND active = 1', { id });
    if (!prod) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    const sets = [], vals = [];
    if (b.name !== undefined) {
      const n = typeof b.name === 'string' ? b.name.trim().slice(0, 160) : '';
      if (!n) return res.status(400).json({ error: 'bad_name' });
      sets.push('name = ?'); vals.push(n);
    }
    if (b.unit !== undefined) {
      const u = typeof b.unit === 'string' ? b.unit.trim().slice(0, 8) : '';
      sets.push('unit = ?'); vals.push(u || null);
    }
    if (b.product_category_id !== undefined) {
      const raw = b.product_category_id;
      let pc = null;
      if (raw !== null && raw !== '') {
        pc = Number(raw);
        // nieistniejąca kategoria = 400 tutaj, nie surowy błąd klucza obcego z MySQL-a (pusty 500)
        if (!Number.isInteger(pc) || pc <= 0
          || !(await q('SELECT id FROM product_categories WHERE id = :p AND active = 1', { p: pc })).length) {
          return res.status(400).json({ error: 'bad_product_category' });
        }
      }
      sets.push('product_category_id = ?'); vals.push(pc);
    }
    if (!sets.length) return res.status(400).json({ error: 'nothing_to_update' });
    // pool.execute z `?`, nie helper q: q używa namedPlaceholders, a sets budujemy pozycyjnie
    await pool.execute(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    const [po] = await q(`SELECT p.id, p.name, p.unit, p.pack_size, p.product_category_id,
        pc.name AS product_category_name FROM products p
        LEFT JOIN product_categories pc ON pc.id = p.product_category_id WHERE p.id = :id`, { id });
    res.json({ ok: true, product: po });
  } catch (e) { next(e); }
});

// GET /api/v1/products/propozycje?nazwa=Jog%20Naturalny%20400g
// Kandydaci do scalenia dla nazwy z paragonu. To PROPOZYCJA — scala dopiero człowiek,
// wysyłając product_id przy poprawianiu pozycji (PATCH receipts/:id/items/:itemId).
router.get('/propozycje', async (req, res, next) => {
  try {
    res.json({ kandydaci: await propozycje(String(req.query.nazwa || ''), 5) });
  } catch (e) { next(e); }
});

// GET /api/v1/products/:id/ceny — historia cen jednego produktu.
// `zakupy` to pojedyncze zdarzenia (do wykresu punktowego i do sprawdzenia „gdzie taniej”),
// `miesiace` to średnie miesięczne (do trendu wieloletniego, gdzie punktów są setki).
router.get('/:id/ceny', async (req, res, next) => {
  try {
    const z = zasieg(req.user);
    const id = parseInt(req.params.id, 10) || 0;
    const [prod] = await q('SELECT id, name, unit, pack_size FROM products WHERE id = :id', { id });
    if (!prod || !z) return res.status(404).json({ error: 'not_found' });

    // Cena za jednostkę liczona z ILOŚCI, nie z liczby linii: „0,975 kg winogron” to jedna
    // linia i prawie kilogram. NULLIF chroni przed dzieleniem przez zero przy pozycjach,
    // w których ilości nie odczytano.
    const zakupy = await q(
      `SELECT r.receipt_date AS data, r.shop_name AS sklep, i.quantity AS ilosc,
              i.unit_price AS cena_katalogowa,
              ROUND(i.value / NULLIF(i.quantity, 0), 2) AS cena_zaplacona,
              i.discount AS rabat, i.value AS wartosc, r.id AS receipt_id
         FROM receipt_items i
         JOIN receipts r ON r.id = i.receipt_id
        WHERE i.product_id = :id AND ${z.sql}
        ORDER BY r.receipt_date DESC, i.id DESC
        LIMIT 500`, { ...z.p, id });

    const miesiace = await q(
      `SELECT DATE_FORMAT(r.receipt_date, '%Y-%m') AS miesiac,
              COUNT(*) AS zakupow,
              ROUND(AVG(i.unit_price), 2) AS srednia_katalogowa,
              ROUND(AVG(i.value / NULLIF(i.quantity, 0)), 2) AS srednia_zaplacona,
              ROUND(SUM(i.value), 2) AS wydano,
              ROUND(SUM(COALESCE(i.discount, 0)), 2) AS zaoszczedzono
         FROM receipt_items i
         JOIN receipts r ON r.id = i.receipt_id
        WHERE i.product_id = :id AND ${z.sql} AND r.receipt_date IS NOT NULL
        GROUP BY miesiac
        ORDER BY miesiac`, { ...z.p, id });

    res.json({
      produkt: prod,
      zakupy: zakupy.map((x) => ({
        ...x,
        data: dataISO(x.data),
        ilosc: liczba(x.ilosc),
        cena_katalogowa: liczba(x.cena_katalogowa),
        cena_zaplacona: liczba(x.cena_zaplacona),
        rabat: liczba(x.rabat),
        wartosc: liczba(x.wartosc),
      })),
      miesiace: miesiace.map((m) => ({
        ...m,
        zakupow: Number(m.zakupow),
        srednia_katalogowa: liczba(m.srednia_katalogowa),
        srednia_zaplacona: liczba(m.srednia_zaplacona),
        wydano: liczba(m.wydano),
        zaoszczedzono: liczba(m.zaoszczedzono),
      })),
    });
  } catch (e) { next(e); }
});

module.exports = router;
