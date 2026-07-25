// Propozycje przydziału kategorii (zlecenie Z5). Decyzja Szymona z 2026-07-24: „Zaproponuj,
// a ja wybiorę w aplikacji, które jest które". Skrypt reorganizacji (scripts/reorganize-
// categories.js) zapisuje propozycje do `category_proposals` i NIE rusza transakcji —
// przepięcie dzieje się WYŁĄCZNIE tutaj, w `accept`, na świadomą decyzję człowieka.
// To jedyne miejsce w aplikacji, które zmienia kategorię, księgę, typ i tag hurtem, więc:
// jedna transakcja SQL, wiersze pod FOR UPDATE, bramka na kubełkach księga × typ (fakt vs
// ruch wynikający z propozycji), jeden wpis = jeden UPDATE i zero wpisów z Kosza.
// Wszystkie trasy tylko dla roli admin (K6) — przydział to decyzja właściciela ksiąg.
//
// KOSZ: wpisy usunięte miękko (`t.deleted_at IS NOT NULL`) NIE BIORĄ UDZIAŁU w przydziale —
// ani w skrypcie, ani tutaj. Reszta aplikacji (transactions.js) wyklucza je z każdej edycji,
// a nagłówek grupy liczący wpisy z Kosza nie dawał się uzgodnić z /summary. Skrypt niczego
// nie archiwizuje (K3), więc przywrócony wpis zostaje w swojej starej, NADAL AKTYWNEJ
// kategorii i Szymon przepnie go w Historii — nie wróci jako TRANSFER z cudzej księgi po
// zmianie, której Historia nigdy by mu nie pozwoliła wykonać. Nie „naprawiaj" tego z powrotem.
const express = require('express');
const { pool, q } = require('../db');
const { ledgerScope } = require('../auth');
const { kluczGrupy, parsujKlucz, parsujIds, docelowaKsiega, groszeZ, bladRetarget, grupujCele,
  dubleWpisow, nieaktualna, kubelki, oczekiwanaDelta, rozbieznosci, tkniete } = require('../proposals-core');

const router = express.Router();
const LIMIT_WPISOW = 500;
// Propozycja opisuje wpis w miejscu, w którym leżał przy jej powstaniu. Jeśli wpis został
// od tamtej pory ręcznie przeniesiony, para (obecna → proponowana) z nagłówka grupy KŁAMIE,
// a licznik „do przydziału" liczy wpis dwa razy (stara propozycja + nowa z kolejnego
// przebiegu). Dlatego wszędzie liczą się WYŁĄCZNIE propozycje zgodne z faktem.
const AKTUALNE = "p.status = 'NOWA' AND t.deleted_at IS NULL AND (t.category_id <=> p.from_category_id)";

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
const lista = (ids) => ids.map(Number).join(',');   // ids są już zwalidowane jako liczby całkowite

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
      // Grupa może być MIESZANA (różne reguły, księgi, typy, tagi — np. A30 nadaje tag
      // z miesiąca wpisu). MIN pomija NULL-e, więc bez licznika różnorodności nagłówek
      // pokazywał pigułkę „→ księga PERSEVERA" dla wpisów, które zostają w RODZINIE.
      // COALESCE w COUNT(DISTINCT …) jest konieczne: samo COUNT(DISTINCT) nie liczy NULL-i.
      `SELECT p.from_category_id f, p.to_category_id t2, MIN(p.rule_id) rule_id,
              MIN(p.to_ledger_id) to_ledger_id, MIN(CAST(p.to_type AS CHAR)) to_type, MIN(p.tag) tag,
              COUNT(DISTINCT p.rule_id) regul, COUNT(DISTINCT COALESCE(p.to_ledger_id, 0)) ksiag,
              COUNT(DISTINCT COALESCE(p.tag, '')) tagow, COUNT(DISTINCT COALESCE(CAST(p.to_type AS CHAR), '')) typow,
              COUNT(*) n, SUM(t.amount) suma,
              SUBSTRING(GROUP_CONCAT(t.description ORDER BY t.tx_date DESC SEPARATOR ' § '), 1, 300) opisy
         FROM category_proposals p JOIN transactions t ON t.id = p.transaction_id
        WHERE ${AKTUALNE} AND t.ledger_id IN (${lista(led)})
        GROUP BY p.from_category_id, p.to_category_id
        ORDER BY n DESC, p.to_category_id`, {});
    const nazwy = await sciezki();
    const jeden = (r, ile, v) => (Number(ile) > 1 ? null : v);
    const groups = rows.map((r) => ({
      key: kluczGrupy(r.f, r.t2),
      from_id: r.f == null ? null : Number(r.f),
      from: r.f == null ? '(bez kategorii)' : (nazwy.get(Number(r.f)) || `kat. ${r.f}`),
      to_id: Number(r.t2),
      to: nazwy.get(Number(r.t2)) || `kat. ${r.t2}`,
      n: Number(r.n),
      kwota: groszeZ(r.suma) / 100,
      rule_id: jeden(r, r.regul, r.rule_id),
      regul: Number(r.regul),
      to_ledger_id: r.to_ledger_id == null ? null : jeden(r, r.ksiag, Number(r.to_ledger_id)),
      ksiag: Number(r.ksiag),
      to_type: jeden(r, r.typow, r.to_type),
      tag: jeden(r, r.tagow, r.tag),
      przyklady: String(r.opisy || '').split(' § ').filter(Boolean).slice(0, 3),
    }));
    res.json({ groups, total: groups.reduce((s, g) => s + g.n, 0), limit: LIMIT_WPISOW });
  } catch (e) { next(e); }
});

// GET /api/v1/proposals/:key/items — lista wpisów jednej grupy (data, kwota, opis, kto).
// `total` obok `limit`: lista jest OBCIĘTA, a front musi napisać wprost „pokazano 500 z 700".
// Bez tego Szymon przewijał 500 wpisów, uznawał że przejrzał wszystko i przyjmował grupę
// razem z 200 wpisami, których nigdy nie widział.
router.get('/:key/items', async (req, res, next) => {
  try {
    const led = ksiegi(req);
    if (!led) return res.status(400).json({ error: 'bad_ledger' });
    const g = parsujKlucz(req.params.key);
    if (!g) return res.status(400).json({ error: 'bad_group' });
    const gdzie = `${AKTUALNE} AND p.to_category_id = :to AND (p.from_category_id <=> :from)
          AND t.ledger_id IN (${lista(led)})`;
    const zrodlo = 'FROM category_proposals p JOIN transactions t ON t.id = p.transaction_id';
    const rows = await q(
      `SELECT p.id, p.rule_id, p.to_ledger_id, p.to_type, p.tag, t.id tx_id, t.tx_date, t.amount, t.type,
              t.description, u.name user_name
         ${zrodlo} JOIN users u ON u.id = t.user_id
        WHERE ${gdzie} ORDER BY t.tx_date DESC, t.id DESC LIMIT ${LIMIT_WPISOW}`, g);
    const [{ n }] = await q(`SELECT COUNT(*) n ${zrodlo} WHERE ${gdzie}`, g);
    res.json({ items: rows, limit: LIMIT_WPISOW, total: Number(n) });
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
      WHERE ${AKTUALNE} AND p.to_category_id = :to AND (p.from_category_id <=> :from)
        AND t.ledger_id IN (${lista(led)})`, g);
  return { ids: rows.map((r) => Number(r.id)) };
}

// Zakleszczenie/timeout blokady = ktoś (drugie okno, skrypt) rusza te same wiersze w tej samej
// chwili. To nie awaria: 409 „busy" i powtórz, dokładnie jak w categories.js. Surowy komunikat
// MySQL-a w 500 nic Szymonowi nie mówi.
const zajete = (e) => e && (e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT');

// K7: przyjęcie propozycji. JEDNA transakcja SQL, wiersze zablokowane przed walidacją.
// Pomijamy propozycje: już rozstrzygnięte (idempotencja), NIEAKTUALNE (wpis przeniesiony
// ręcznie w Historii — przyjęcie cofałoby decyzję Szymona bez śladu) oraz wpisy z Kosza.
// Bramka: kubełki księga × typ na dotkniętych wpisach muszą się zmienić DOKŁADNIE tak, jak
// wynika z przyjmowanych propozycji, a kwota i data żadnego wpisu w ogóle. Inaczej ROLLBACK.
// `zrodlo` to pula połączeń — podstawiana wyłącznie w testach (scripts/test-reorganize-prop.js).
async function przyjmij(ids, uid, zrodlo = pool) {
  if (!ids.length) return { status: 200, body: { ok: true, przyjete: 0, pominiete: 0 } };
  const conn = await zrodlo.getConnection();
  try {
    await conn.beginTransaction();
    const [props] = await conn.query(
      `SELECT p.id, p.transaction_id, p.status, p.from_category_id, p.to_category_id, p.to_ledger_id,
              p.to_type, p.tag, t.category_id, t.ledger_id, t.type, t.tag tx_tag, t.amount, t.tx_date,
              t.deleted_at
         FROM category_proposals p JOIN transactions t ON t.id = p.transaction_id
        WHERE p.id IN (?) FOR UPDATE`, [ids]);
    const otwarte = props.filter((p) => p.status === 'NOWA');
    const duble = dubleWpisow(otwarte);
    if (duble.length) {
      await conn.rollback();
      return { status: 400, body: { error: 'sprzeczne_propozycje', transactions: duble.slice(0, 20) } };
    }
    const stare = otwarte.filter((p) => nieaktualna(p));
    const kosz = otwarte.filter((p) => !nieaktualna(p) && p.deleted_at != null);
    const nowe = otwarte.filter((p) => !nieaktualna(p) && p.deleted_at == null);
    // Propozycja zdezaktualizowana (wpis przeniesiony ręcznie w Historii) dostaje własny
    // status z migracji 009 i datę, ale BEZ `decided_by` — to nie jest decyzja człowieka.
    // Gdyby wpaść tu na „ODRZUCONA", ślad kłamałby, że Szymon powiedział „nie".
    if (stare.length) {
      await conn.query("UPDATE category_proposals SET status='NIEAKTUALNA', decided_at=NOW() WHERE id IN (?) AND status='NOWA'",
        [stare.map((p) => Number(p.id))]);
    }
    const pominiete = props.length - nowe.length;
    const raport = { pominiete, nieaktualne: stare.length, w_koszu: kosz.length };
    if (!nowe.length) {
      // Nie ma czego przepiąć — idempotencja, nie błąd. COMMIT tylko wtedy, gdy jest co
      // utrwalić (znaczniki nieaktualnych); inaczej żądanie nie zostawia w bazie śladu.
      if (stare.length) await conn.commit(); else await conn.rollback();
      return { status: 200, body: { ok: true, przyjete: 0, ...raport } };
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
      // Cel w archiwum = właściciel schował tę kategorię ręcznie. Dawniej accept po cichu
      // podnosił jej `active` z powrotem, czyli odwracał jego decyzję — a `retarget` ten sam
      // cel odrzucał jako `category_archived`. Jedna reguła: ODMAWIAMY, nie przywracamy.
      if (!Number(c.active)) {
        await conn.rollback();
        return { status: 400, body: { error: 'category_archived', proposal: Number(p.id), category: Number(c.id) } };
      }
    }
    const txIds = [...new Set(nowe.map((p) => Number(p.transaction_id)))];
    for (const g of grupujCele(nowe).values()) {
      await conn.query('UPDATE transactions SET category_id=?, ledger_id=?, type=?, tag=? WHERE id IN (?)',
        [g.c, g.l, g.t, g.g, g.ids]);
    }
    await conn.query(
      "UPDATE category_proposals SET status='PRZYJETA', decided_by=?, decided_at=NOW() WHERE id IN (?) AND status='NOWA'",
      [uid, nowe.map((p) => Number(p.id))]);
    const [po] = await conn.query('SELECT id, ledger_id, type, amount, tx_date FROM transactions WHERE id IN (?)', [txIds]);
    const zle = [...rozbieznosci(kubelki(nowe), kubelki(po), oczekiwanaDelta(nowe)), ...tkniete(nowe, po)];
    if (zle.length) {
      await conn.rollback();
      return { status: 500, body: { error: 'ksiega_sie_nie_zgadza', rozbieznosci: zle.slice(0, 5) } };
    }
    await conn.commit();
    return { status: 200, body: { ok: true, przyjete: nowe.length, ...raport } };
  } catch (e) {
    await conn.rollback();
    if (zajete(e)) return { status: 409, body: { error: 'busy' } };
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
    const props = await q('SELECT p.id, p.transaction_id, p.to_ledger_id, t.ledger_id FROM category_proposals p'
      + ` JOIN transactions t ON t.id = p.transaction_id WHERE p.id IN (${lista(z.ids)}) AND ${AKTUALNE}`, {});
    const [k] = await q('SELECT id, ledger_id, active FROM categories WHERE id = :id', { id: cel });
    const blad = bladRetarget(props, k);
    if (blad) return res.status(400).json(blad);
    const ids = props.map((p) => Number(p.id));
    // uq_prop (transaction_id, to_category_id): dla któregoś wpisu taka propozycja już jest —
    // być może ODRZUCONA. Nadpisanie jej po cichu skasowałoby decyzję „nie". Mówimy KTÓRY
    // wpis blokuje, bo 409 na całą grupę bez wskazania winnego nie da się rozplątać w UI.
    const kol = await q('SELECT id, transaction_id FROM category_proposals WHERE to_category_id = :cel'
      + ` AND transaction_id IN (${lista(props.map((p) => p.transaction_id))}) AND id NOT IN (${lista(ids)})`, { cel });
    if (kol.length) {
      return res.status(409).json({ error: 'proposal_exists', transaction: Number(kol[0].transaction_id),
        proposal: Number(kol[0].id), ile: kol.length });
    }
    const r = await q(`UPDATE category_proposals SET to_category_id = :cel WHERE id IN (${lista(ids)}) AND status = 'NOWA'`,
      { cel });
    res.json({ ok: true, przestawione: r.affectedRows, to_category_id: cel });
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'proposal_exists' });
    if (zajete(e)) return res.status(409).json({ error: 'busy' });
    next(e);
  }
});

module.exports = router;
// eksport dla scripts/test-reorganize-prop.js (testy bez bazy i bez HTTP). Czyste pomocniki
// mieszkają w src/proposals-core.js — tam też są testowane.
module.exports.przyjmij = przyjmij;
module.exports.AKTUALNE = AKTUALNE;
module.exports.LIMIT_WPISOW = LIMIT_WPISOW;
