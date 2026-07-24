const express = require('express');
const { q, pool } = require('../db');
const { ledgerScope } = require('../auth');

const router = express.Router();

// ---------- czysta logika (bez bazy, bez DOM) — testowana w scripts/test-kategorie.js ----------

const HEX = /^#[0-9a-fA-F]{6}$/;
const isHex = (v) => typeof v === 'string' && HEX.test(v);

// Ścisła liczba całkowita z zakresu. Dane z API bywają napisem, ale `parseInt` łykał
// '3abc' → 3, [3] → 3 i 3.7 → 3: literówka w wywołaniu przenosiła kategorię pod
// PRZYPADKOWEGO rodzica. Tutaj wszystko poza czystą liczbą całkowitą daje null (= 400).
function liczba(v, min, max) {
  const n = typeof v === 'number' ? v
    : (typeof v === 'string' && /^[0-9]{1,9}$/.test(v.trim()) ? Number(v.trim()) : NaN);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
const idCalkowite = (v) => liczba(v, 1, 999999999);

// Ścisła flaga 0/1. `b.active ? 1 : 0` przy {active:"0"} PRZYWRACAŁO kategorię (napis "0"
// jest w JS prawdziwy) — dokładnie odwrotnie, niż prosił wywołujący. Nieznane = 400.
function flaga(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return 1;
  if (v === false || v === 0 || v === '0' || v === 'false') return 0;
  return null;
}

// Nazwa: wyłącznie napis, przycięty do 96 znaków. Liczba ani obiekt nie stają się nazwą.
function nazwa(v) {
  if (typeof v !== 'string') return null;
  return v.trim().slice(0, 96) || null;
}

// Ciało PATCH-a → plan zapisu: {sets, values} idą prosto do UPDATE (placeholdery `?`),
// `parent`/`active`/`kaskada` sterują blokadą i kaskadą w transakcji. Błąd = {error}.
function polaPatcha(b) {
  const sets = [];
  const values = [];
  const plan = { sets, values, kaskada: b.cascade === true };
  if (b.name !== undefined) {
    const n = nazwa(b.name);
    if (!n) return { error: 'bad_name' };
    sets.push('name = ?'); values.push(n);
  }
  if (b.color !== undefined) {
    // null jest dozwolony ŚWIADOMIE: migracja 006 mówi „kolor NULL = przydziel automatycznie
    // z palety motywu", a admin musi mieć jak cofnąć kolor. Cokolwiek innego poza #rrggbb = 400.
    if (b.color !== null && !isHex(b.color)) return { error: 'bad_color' };
    sets.push('color = ?'); values.push(b.color === null ? null : b.color.toLowerCase());
  }
  if (b.active !== undefined) {
    const a = flaga(b.active);
    if (a === null) return { error: 'bad_active' };
    plan.active = a;
    sets.push('active = ?'); values.push(a);
  }
  if (b.sort_order !== undefined) {
    const so = liczba(b.sort_order, 0, 32767);
    if (so === null) return { error: 'bad_sort_order' };
    sets.push('sort_order = ?'); values.push(so);
  }
  if (b.parent_id !== undefined) {
    const parent = b.parent_id === null ? null : idCalkowite(b.parent_id);
    if (b.parent_id !== null && parent === null) return { error: 'bad_parent' };
    plan.parent = parent;
    sets.push('parent_id = ?'); values.push(parent);
  }
  if (!sets.length) return { error: 'nothing_to_update' };
  return plan;
}

// Czy wolno ustawić kategorii `id` rodzica `parentId`? Zwraca null (wolno) albo kod błędu.
// `rows`: [{id, parent_id, ledger_id}] — komplet kategorii księgi (+ kandydat na rodzica).
// Reguły (K5): drzewo ma DWA poziomy, rodzicem może być tylko korzeń z tej samej księgi,
// kategoria nie może stać się własnym rodzicem ani potomkiem.
function bladRodzica(rows, id, parentId) {
  if (parentId === null || parentId === undefined) return null;   // przeniesienie na korzeń
  const me = rows.find((r) => Number(r.id) === Number(id));
  const parent = rows.find((r) => Number(r.id) === Number(parentId));
  if (!me) return 'not_found';
  if (Number(parentId) === Number(id)) return 'parent_self';
  if (!parent) return 'parent_not_found';
  if (Number(parent.ledger_id) !== Number(me.ledger_id)) return 'parent_other_ledger';
  // Zapętlenie: idąc w górę od rodzica nie wolno natrafić na przenoszoną kategorię.
  // Licznik kroków kończy wędrówkę nawet po danych już zapętlonych (awaria/ręczny SQL).
  let cur = parent;
  for (let i = 0; cur && i <= rows.length; i++) {
    if (cur.parent_id != null && Number(cur.parent_id) === Number(id)) return 'parent_cycle';
    cur = cur.parent_id == null ? null : rows.find((r) => Number(r.id) === Number(cur.parent_id));
  }
  if (parent.parent_id != null) return 'parent_not_root';
  if (rows.some((r) => r.parent_id != null && Number(r.parent_id) === Number(id))) return 'parent_has_children';
  return null;
}

// Płaska lista wierszy → drzewo dwupoziomowe. ŻADEN wiersz nie może zniknąć: kategoria
// z rodzicem nieistniejącym, zarchiwizowanym albo zapętlonym (wyścig dwóch PATCH-ów,
// ręczny SQL, awaria) wraca jako korzeń z flagą `orphan`. Pusta odpowiedź przy niepustej
// tabeli oznaczałaby, że kategorie znikają z Wpisu, Historii, Paragonu i z Admina naraz —
// czyli że księgi nie da się naprawić z UI.
function budujDrzewo(rows) {
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const korzenie = [];
  const dzieci = [];
  for (const r of rows) {
    const parent = r.parent_id == null ? null : byId.get(Number(r.parent_id));
    // rodzic zdrowy = istnieje, to nie ta sama kategoria i sam jest korzeniem (drzewo ma 2 poziomy)
    if (r.parent_id == null) korzenie.push({ ...r, children: [] });
    else if (parent && Number(parent.id) !== Number(r.id) && parent.parent_id == null) dzieci.push(r);
    else korzenie.push({ ...r, children: [], orphan: true });
  }
  const idx = new Map(korzenie.map((r) => [Number(r.id), r]));
  for (const r of dzieci) idx.get(Number(r.parent_id)).children.push(r);
  return korzenie;
}

// ---------- trasy ----------

// GET /api/v1/categories?ledger=1[&all=1] — drzewo (parent + dzieci).
// all=1 dokłada archiwalne (active=0) i jest wyłącznie dla roli admin.
router.get('/', async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    // literówka w numerze księgi ma dać błąd, a nie po cichu pokazać kategorie innej księgi
    const zapytana = req.query.ledger ? idCalkowite(req.query.ledger) : null;
    if (req.query.ledger && zapytana === null) return res.status(400).json({ error: 'bad_ledger' });
    const ledger = zapytana || scope.ledgers[0] || 1;
    if (!scope.ledgers.includes(ledger)) return res.status(403).json({ error: 'ledger_forbidden' });
    const wszystkie = req.query.all === '1';
    if (wszystkie && req.user.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
    const rows = await q(
      `SELECT id, parent_id, name, color, sort_order, active FROM categories
        WHERE ledger_id = :l ${wszystkie ? '' : 'AND active = 1'}
        ORDER BY sort_order, name`,
      { l: ledger });
    res.json({ categories: budujDrzewo(rows) });
  } catch (e) { next(e); }
});

// POST /api/v1/categories {ledger_id, name, parent_id?}
// Nazwa istniejąca = brak duplikatu (INSERT IGNORE + unikat uq_cat2) — zwracamy istniejące id.
// Kategoria ZARCHIWIZOWANA nie wraca tędy do gry: przywracanie to uprawnienie admina
// (PATCH {active:1}), więc tutaj oddajemy 409, a UI prosi admina o decyzję. Inaczej junior
// dopisywałby nazwę i obchodził 403, które dostaje na PATCH-u.
router.post('/', async (req, res, next) => {
  try {
    const scope = ledgerScope(req.user);
    const b = req.body || {};
    const ledger = b.ledger_id === undefined ? (scope.ledgers[0] || 1) : idCalkowite(b.ledger_id);
    if (ledger === null) return res.status(400).json({ error: 'bad_ledger' });
    if (!scope.ledgers.includes(ledger)) return res.status(403).json({ error: 'ledger_forbidden' });
    const name = nazwa(b.name);
    if (!name) return res.status(400).json({ error: 'bad_input' });
    const bezRodzica = b.parent_id == null || b.parent_id === '';   // brak pola = kategoria główna
    const parent = bezRodzica ? null : idCalkowite(b.parent_id);
    if (!bezRodzica && parent === null) return res.status(400).json({ error: 'bad_parent' });
    if (parent !== null) {
      const rodzic = await q('SELECT id, ledger_id, parent_id FROM categories WHERE id = :p', { p: parent });
      if (!rodzic.length || rodzic[0].ledger_id !== ledger) return res.status(400).json({ error: 'parent_not_found' });
      if (rodzic[0].parent_id != null) return res.status(400).json({ error: 'parent_not_root' });
    }
    await q('INSERT IGNORE INTO categories (ledger_id, parent_id, name) VALUES (:l, :p, :n)',
      { l: ledger, p: parent, n: name });
    const found = await q(
      'SELECT id, active FROM categories WHERE ledger_id=:l AND name=:n AND (parent_id <=> :p) LIMIT 1',
      { l: ledger, n: name, p: parent });
    // INSERT IGNORE połyka też np. zerwany klucz obcy (rodzic zniknął w międzyczasie) —
    // wtedy nie ma czego zwrócić i lepiej powiedzieć to wprost niż wywrócić się na found[0].
    if (!found.length) return res.status(409).json({ error: 'not_created' });
    if (found[0].active === 0) {
      return res.status(409).json({ error: 'category_archived', id: found[0].id, name });
    }
    res.status(201).json({ id: found[0].id });
  } catch (e) { next(e); }
});

// Zapis PATCH-a w JEDNEJ transakcji SQL. Wiersze księgi są blokowane (FOR UPDATE) PRZED
// walidacją i zwalniane dopiero po COMMIT — bez tego dwa równoległe PATCH-e walidowały się
// na nieaktualnym stanie i potrafiły zbudować cykl 3→4→3 albo trzeci poziom drzewa.
// `zrodlo` to pula połączeń: w produkcji zawsze domyślna, podstawiana wyłącznie w teście
// (scripts/test-kategorie.js), żeby dało się sprawdzić kolejność BEGIN/FOR UPDATE/COMMIT bez bazy.
async function zapiszPatch(id, ledger, plan, zrodlo = pool) {
  const conn = await zrodlo.getConnection();
  try {
    await conn.beginTransaction();
    // cała księga + ewentualny nowy rodzic spoza niej (żeby odróżnić „inna księga" od „brak")
    const [rows] = await conn.execute(
      'SELECT id, ledger_id, parent_id, active FROM categories WHERE ledger_id = ? OR id = ? FOR UPDATE',
      [ledger, plan.parent || 0]);
    if (!rows.some((r) => Number(r.id) === id)) {
      await conn.rollback();
      return { status: 404, body: { error: 'not_found' } };
    }
    if (plan.parent !== undefined) {
      const blad = bladRodzica(rows, id, plan.parent);   // powtórna walidacja na ZABLOKOWANYCH danych
      if (blad) { await conn.rollback(); return { status: 400, body: { error: blad } }; }
    }
    // Archiwizacja korzenia chowała po cichu jego AKTYWNE podkategorie (z setkami wpisów).
    // Teraz wymaga świadomej zgody: 409 z liczbą dzieci, UI dopytuje i wraca z cascade:true.
    const dzieci = plan.active === 0
      ? rows.filter((r) => r.parent_id != null && Number(r.parent_id) === id && r.active === 1) : [];
    if (dzieci.length && !plan.kaskada) {
      await conn.rollback();
      return { status: 409, body: { error: 'has_active_children', children: dzieci.length } };
    }
    await conn.execute(`UPDATE categories SET ${plan.sets.join(', ')} WHERE id = ?`, [...plan.values, id]);
    if (dzieci.length) await conn.execute('UPDATE categories SET active = 0 WHERE parent_id = ? AND active = 1', [id]);
    await conn.commit();
    return { status: 200, body: { ok: true, id, archived_children: dzieci.length } };
  } catch (e) {
    await conn.rollback();
    if (e && e.code === 'ER_DUP_ENTRY') return { status: 409, body: { error: 'name_exists' } };
    // zakleszczenie/timeout blokady = ktoś przestawia to samo drzewo w tej samej chwili
    if (e && (e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT')) {
      return { status: 409, body: { error: 'busy' } };
    }
    throw e;
  } finally { conn.release(); }
}

// PATCH /api/v1/categories/:id {name?, parent_id?, active?, color?, sort_order?, cascade?} — tylko admin.
router.patch('/:id', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
    const scope = ledgerScope(req.user);
    const id = idCalkowite(req.params.id);
    if (!id) return res.status(400).json({ error: 'bad_id' });
    const plan = polaPatcha(req.body || {});
    if (plan.error) return res.status(400).json({ error: plan.error });
    // szybkie odsianie cudzej księgi; wiążąca walidacja i tak powtarza się pod blokadą
    const wstepne = await q('SELECT id, ledger_id FROM categories WHERE id = :id', { id });
    if (!wstepne.length) return res.status(404).json({ error: 'not_found' });
    if (!scope.ledgers.includes(wstepne[0].ledger_id)) return res.status(403).json({ error: 'ledger_forbidden' });
    const wynik = await zapiszPatch(id, wstepne[0].ledger_id, plan);
    res.status(wynik.status).json(wynik.body);
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.bladRodzica = bladRodzica;   // eksport dla scripts/test-kategorie.js
module.exports.isHex = isHex;
module.exports.budujDrzewo = budujDrzewo;
module.exports.polaPatcha = polaPatcha;
module.exports.idCalkowite = idCalkowite;
module.exports.zapiszPatch = zapiszPatch;
