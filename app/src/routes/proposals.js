// Propozycje przydziału kategorii (zlecenie Z5). Decyzja Szymona z 2026-07-24: „Zaproponuj,
// a ja wybiorę w aplikacji, które jest które". Skrypt reorganizacji (scripts/reorganize-
// categories.js) zapisuje propozycje do `category_proposals` i NIE rusza transakcji —
// przepięcie dzieje się WYŁĄCZNIE tutaj, w `accept`, na świadomą decyzję człowieka.
// To jedyne miejsce w aplikacji, które zmienia kategorię, księgę, typ i tag hurtem, więc:
// jedna transakcja SQL, wiersze pod FOR UPDATE, bramka na liczbie wpisów i sumie kwot.
// Wszystkie trasy tylko dla roli admin (K6) — przydział to decyzja właściciela ksiąg.
const express = require('express');
const { pool, q } = require('../db');
const { ledgerScope } = require('../auth');
const { parseKwota } = require('../kwota');   // jedyne miejsce, gdzie napis staje się kwotą

const router = express.Router();
const LIMIT_WPISOW = 500;

// --- czyste pomocniki (testowane w scripts/test-reorganize-scen.js) ---

// Klucz grupy = para (kategoria obecna → proponowana). „0" na pierwszej pozycji = wpis bez
// kategorii (from_category_id IS NULL), bo w URL-u nie ma sensownego zapisu NULL-a.
const kluczGrupy = (from, to) => `${Number(from) || 0}-${Number(to)}`;
function parsujKlucz(k) {
  const m = /^(\d+)-(\d+)$/.exec(String(k == null ? '' : k));
  if (!m) return null;
  const to = Number(m[2]);
  return to > 0 ? { from: Number(m[1]) || null, to } : null;
}
// Identyfikatory propozycji z ciała żądania — same liczby całkowite dodatnie albo null.
// Pusta lista jest poprawna (żądanie nic nie robi), napis „5 OR 1=1" nie.
function parsujIds(v) {
  if (!Array.isArray(v) || v.length > 5000) return null;
  const ids = v.map((x) => Number(x));
  return ids.every((n) => Number.isInteger(n) && n > 0) ? [...new Set(ids)] : null;
}
// Księga, w której wpis wyląduje: z propozycji, a gdy ta księgi nie zmienia — obecna księga wpisu.
const docelowaKsiega = (p) => Number(p.to_ledger_id || p.ledger_id);
// Suma kwot w groszach — przez parseKwota, bo SUM(amount) wraca z MySQL jako NAPIS.
const groszeZ = (suma) => Math.round((parseKwota(suma) || 0) * 100);

// K8: nowy cel musi istnieć, być AKTYWNY i leżeć w księdze, w której wpis wyląduje.
// Kategoria z cudzej księgi to ten sam błąd, który w Historii pokazywał „—" zamiast nazwy.
function bladRetarget(props, cel) {
  if (!props.length) return 'nothing_to_update';
  if (!cel) return 'category_not_found';
  if (!Number(cel.active)) return 'category_archived';
  if (props.some((p) => docelowaKsiega(p) !== Number(cel.ledger_id))) return 'category_other_ledger';
  return null;
}

// Księgi, których dotyczy żądanie: zasięg roli przecięty z opcjonalnym ?ledger=. null = błąd.
// Pusty zasięg też jest błędem — nie budujemy „IN ()", które i tak wywala składnię SQL.
function ksiegi(req) {
  const dozwolone = ledgerScope(req.user).ledgers;
  if (!dozwolone.length) return null;
  const p = req.query.ledger === undefined ? (req.body || {}).ledger : req.query.ledger;
  if (p === undefined || p === '' || p === null) return dozwolone;
  const n = Number(p);
  return dozwolone.includes(n) ? [n] : null;
}
const lista = (ids) => ids.join(',');   // ids są już zwalidowane jako liczby całkowite

// Ścieżki kategorii („Dom i media > Czynsz") jednym zapytaniem — zamiast dokładania JOIN-ów
// po rodzicach do każdego zapytania grupującego.
async function sciezki() {
  const rows = await q('SELECT id, parent_id, name FROM categories', {});
  const byId = new Map(rows.map((c) => [Number(c.id), c]));
  const m = new Map();
  for (const c of rows) {
    const p = c.parent_id ? byId.get(Number(c.parent_id)) : null;
    m.set(Number(c.id), p ? `${p.name} > ${c.name}` : c.name);
  }
  return m;
}

router.use((req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
  next();
});

// GET /api/v1/proposals?ledger= — propozycje POGRUPOWANE po parze (obecna → proponowana).
// Sortowanie po liczbie wpisów malejąco: Szymon zaczyna od grup, które jednym kliknięciem
// zamykają najwięcej pracy (K9).
router.get('/', async (req, res, next) => {
  try {
    const led = ksiegi(req);
    if (!led) return res.status(400).json({ error: 'bad_ledger' });
    const rows = await q(
      // MIN po ENUM-ie liczy się po pozycji w typie, więc `to_type` bierzemy jako tekst.
      // Grupa może mieć różne tagi (A30: tag z miesiąca wpisu) — wtedy nie pokazujemy
      // żadnego, żeby nagłówek nie obiecywał jednego tagu dla wszystkich wpisów.
      `SELECT p.from_category_id f, p.to_category_id t2, MIN(p.rule_id) rule_id,
              MIN(p.to_ledger_id) to_ledger_id, MIN(CAST(p.to_type AS CHAR)) to_type, MIN(p.tag) tag,
              COUNT(DISTINCT p.tag) tagow, COUNT(DISTINCT p.to_type) typow,
              COUNT(*) n, SUM(t.amount) suma,
              SUBSTRING(GROUP_CONCAT(t.description ORDER BY t.tx_date DESC SEPARATOR ' § '), 1, 300) opisy
         FROM category_proposals p JOIN transactions t ON t.id = p.transaction_id
        WHERE p.status = 'NOWA' AND t.ledger_id IN (${lista(led)})
        GROUP BY p.from_category_id, p.to_category_id
        ORDER BY n DESC, p.to_category_id`, {});
    const nazwy = await sciezki();
    const groups = rows.map((r) => ({
      key: kluczGrupy(r.f, r.t2),
      from_id: r.f == null ? null : Number(r.f),
      from: r.f == null ? '(bez kategorii)' : (nazwy.get(Number(r.f)) || `kat. ${r.f}`),
      to_id: Number(r.t2),
      to: nazwy.get(Number(r.t2)) || `kat. ${r.t2}`,
      n: Number(r.n),
      kwota: groszeZ(r.suma) / 100,
      rule_id: r.rule_id,
      to_ledger_id: r.to_ledger_id == null ? null : Number(r.to_ledger_id),
      to_type: Number(r.typow) > 1 ? null : r.to_type,
      tag: Number(r.tagow) > 1 ? null : r.tag,
      przyklady: String(r.opisy || '').split(' § ').filter(Boolean).slice(0, 3),
    }));
    res.json({ groups, total: groups.reduce((s, g) => s + g.n, 0) });
  } catch (e) { next(e); }
});

// GET /api/v1/proposals/:key/items — pełna lista wpisów jednej grupy (data, kwota, opis, kto).
router.get('/:key/items', async (req, res, next) => {
  try {
    const led = ksiegi(req);
    if (!led) return res.status(400).json({ error: 'bad_ledger' });
    const g = parsujKlucz(req.params.key);
    if (!g) return res.status(400).json({ error: 'bad_group' });
    const rows = await q(
      `SELECT p.id, p.rule_id, p.to_type, p.tag, t.id tx_id, t.tx_date, t.amount, t.type,
              t.description, t.deleted_at, u.name user_name
         FROM category_proposals p JOIN transactions t ON t.id = p.transaction_id
         JOIN users u ON u.id = t.user_id
        WHERE p.status = 'NOWA' AND p.to_category_id = :to AND (p.from_category_id <=> :from)
          AND t.ledger_id IN (${lista(led)})
        ORDER BY t.tx_date DESC, t.id DESC LIMIT ${LIMIT_WPISOW}`, g);
    res.json({ items: rows, limit: LIMIT_WPISOW });
  } catch (e) { next(e); }
});

// Wspólne dla accept/reject/retarget: żądanie dotyczy CAŁEJ GRUPY (`group`) albo wybranych
// identyfikatorów (`ids`). Grupę rozwijamy tu na identyfikatory — dalej kod nie zna grup.
async function idsZadania(req) {
  const b = req.body || {};
  if (b.ids !== undefined) {
    const ids = parsujIds(b.ids);
    return ids ? { ids } : { error: 'bad_ids' };
  }
  const led = ksiegi(req);
  if (!led) return { error: 'bad_ledger' };
  const g = parsujKlucz(b.group);
  if (!g) return { error: 'bad_group' };
  const rows = await q(
    `SELECT p.id FROM category_proposals p JOIN transactions t ON t.id = p.transaction_id
      WHERE p.status = 'NOWA' AND p.to_category_id = :to AND (p.from_category_id <=> :from)
        AND t.ledger_id IN (${lista(led)})`, g);
  return { ids: rows.map((r) => Number(r.id)) };
}

// Wpisy o tym samym celu idą jednym UPDATE-em. `tag: null` w propozycji = bez zmiany tagu,
// więc bierzemy tag, który wpis ma dziś (nie czyścimy go po cichu).
function grupujCele(nowe) {
  const grupy = new Map();
  for (const p of nowe) {
    const cel = { c: Number(p.to_category_id), l: docelowaKsiega(p), t: p.to_type || p.type,
      g: p.tag == null ? (p.tx_tag == null ? null : p.tx_tag) : p.tag };
    const k = `${cel.c}|${cel.l}|${cel.t}|${cel.g == null ? '' : cel.g}`;
    if (!grupy.has(k)) grupy.set(k, { ...cel, ids: [] });
    grupy.get(k).ids.push(Number(p.transaction_id));
  }
  return grupy;
}

// Migawka dotkniętych wpisów: ile ich jest i ile łącznie kosztują (w groszach).
async function migawka(conn, txIds) {
  const [[r]] = await conn.query('SELECT COUNT(*) n, SUM(amount) suma FROM transactions WHERE id IN (?)', [txIds]);
  return { n: Number(r.n), gr: groszeZ(r.suma) };
}

// K7: przyjęcie propozycji. JEDNA transakcja SQL, wiersze zablokowane przed walidacją.
// Bramka: liczba wpisów i suma kwot dotkniętych transakcji przed i po MUSZĄ być identyczne —
// przydział zmienia kategorię, księgę, typ i tag, a nigdy kwotę, datę ani liczbę wpisów.
// Ponowne przyjęcie tej samej grupy nic nie robi (statusy nie są już NOWA).
// `zrodlo` to pula połączeń — podstawiana wyłącznie w testach (scripts/test-reorganize-scen.js).
async function przyjmij(ids, uid, zrodlo = pool) {
  if (!ids.length) return { status: 200, body: { ok: true, przyjete: 0, pominiete: 0 } };
  const conn = await zrodlo.getConnection();
  try {
    await conn.beginTransaction();
    const [props] = await conn.query(
      `SELECT p.id, p.transaction_id, p.status, p.to_category_id, p.to_ledger_id, p.to_type, p.tag,
              t.ledger_id, t.type, t.tag tx_tag
         FROM category_proposals p JOIN transactions t ON t.id = p.transaction_id
        WHERE p.id IN (?) FOR UPDATE`, [ids]);
    const nowe = props.filter((p) => p.status === 'NOWA');
    if (!nowe.length) {
      await conn.rollback();   // nie ma czego zapisać — idempotencja, nie błąd
      return { status: 200, body: { ok: true, przyjete: 0, pominiete: props.length } };
    }
    // Kategoria docelowa musi należeć do księgi, w której wpis wyląduje (kategoriaWKsiedze
    // z transactions.js). Inaczej wpis miałby kategorię cudzej księgi i znikał z raportów.
    const [kat] = await conn.query('SELECT id, ledger_id, active FROM categories WHERE id IN (?) FOR UPDATE',
      [[...new Set(nowe.map((p) => Number(p.to_category_id)))]]);
    const byId = new Map(kat.map((c) => [Number(c.id), c]));
    for (const p of nowe) {
      const c = byId.get(Number(p.to_category_id));
      if (!c || Number(c.ledger_id) !== docelowaKsiega(p)) {
        await conn.rollback();
        return { status: 400, body: { error: 'bad_category', proposal: Number(p.id) } };
      }
    }
    const txIds = [...new Set(nowe.map((p) => Number(p.transaction_id)))];
    const przed = await migawka(conn, txIds);
    for (const g of grupujCele(nowe).values()) {
      await conn.query('UPDATE transactions SET category_id=?, ledger_id=?, type=?, tag=? WHERE id IN (?)',
        [g.c, g.l, g.t, g.g, g.ids]);
    }
    // Kategoria, do której NAPRAWDĘ trafiły wpisy, nie może zostać w archiwum — inaczej wpis
    // wisi na active=0 i wypada z list wyboru. Skrypt niczego nie archiwizuje, ale właściciel
    // mógł schować cel ręcznie między przebiegiem a przyjęciem.
    const uspione = [...byId.values()].filter((c) => !Number(c.active)).map((c) => Number(c.id));
    if (uspione.length) await conn.query('UPDATE categories SET active=1 WHERE id IN (?)', [uspione]);
    await conn.query(
      "UPDATE category_proposals SET status='PRZYJETA', decided_by=?, decided_at=NOW() WHERE id IN (?) AND status='NOWA'",
      [uid, nowe.map((p) => Number(p.id))]);
    const po = await migawka(conn, txIds);
    if (przed.n !== po.n || przed.gr !== po.gr) {
      await conn.rollback();
      return { status: 500, body: { error: 'ksiega_sie_nie_zgadza', przed, po } };
    }
    await conn.commit();
    return { status: 200, body: { ok: true, przyjete: nowe.length, pominiete: props.length - nowe.length,
      przywrocone_kategorie: uspione.length } };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
}

router.post('/accept', async (req, res, next) => {
  try {
    const z = await idsZadania(req);
    if (z.error) return res.status(400).json({ error: z.error });
    const w = await przyjmij(z.ids, req.user.uid);
    res.status(w.status).json(w.body);
  } catch (e) { next(e); }
});

// Odrzucenie jest TRWAŁE: skrypt nie odtworzy tej pary (wpis, cel) przy kolejnym przebiegu (K4).
router.post('/reject', async (req, res, next) => {
  try {
    const z = await idsZadania(req);
    if (z.error) return res.status(400).json({ error: z.error });
    if (!z.ids.length) return res.json({ ok: true, odrzucone: 0 });
    const r = await q("UPDATE category_proposals SET status='ODRZUCONA', decided_by=:by, decided_at=NOW()"
      + ` WHERE id IN (${lista(z.ids)}) AND status='NOWA'`, { by: req.user.uid });
    res.json({ ok: true, odrzucone: r.affectedRows });
  } catch (e) { next(e); }
});

// K8: Szymon wskazuje INNY cel niż proponowany. Sama zmiana celu NIC nie przepina — wpis
// rusza się dopiero przy accept. Typ i księga zostają takie, jak proponuje reguła (nowy cel
// musi leżeć w tej samej księdze, więc przydział nie zmienia księgi ukradkiem).
router.post('/retarget', async (req, res, next) => {
  try {
    const z = await idsZadania(req);
    if (z.error) return res.status(400).json({ error: z.error });
    const cel = Number((req.body || {}).to_category_id);
    if (!Number.isInteger(cel) || cel <= 0) return res.status(400).json({ error: 'bad_category' });
    if (!z.ids.length) return res.status(400).json({ error: 'nothing_to_update' });
    const props = await q('SELECT p.id, p.to_ledger_id, t.ledger_id FROM category_proposals p'
      + ' JOIN transactions t ON t.id = p.transaction_id'
      + ` WHERE p.id IN (${lista(z.ids)}) AND p.status = 'NOWA'`, {});
    const [k] = await q('SELECT id, ledger_id, active FROM categories WHERE id = :id', { id: cel });
    const blad = bladRetarget(props, k);
    if (blad) return res.status(400).json({ error: blad });
    const ids = props.map((p) => Number(p.id));
    const r = await q(`UPDATE category_proposals SET to_category_id = :cel WHERE id IN (${lista(ids)}) AND status = 'NOWA'`,
      { cel });
    res.json({ ok: true, przestawione: r.affectedRows, to_category_id: cel });
  } catch (e) {
    // uq_prop (transaction_id, to_category_id): dla tego wpisu taka propozycja już jest —
    // być może ODRZUCONA. Nadpisanie jej po cichu skasowałoby decyzję „nie".
    if (e && e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'proposal_exists' });
    next(e);
  }
});

module.exports = router;
// eksport dla scripts/test-reorganize-scen.js (testy bez bazy i bez HTTP)
module.exports.kluczGrupy = kluczGrupy;
module.exports.parsujKlucz = parsujKlucz;
module.exports.parsujIds = parsujIds;
module.exports.bladRetarget = bladRetarget;
module.exports.docelowaKsiega = docelowaKsiega;
module.exports.groszeZ = groszeZ;
module.exports.grupujCele = grupujCele;
module.exports.przyjmij = przyjmij;
