// ro/api.js — API tylko-do-odczytu (Z10, pkt 16+18), montowany pod /api/ro/v1.
// NAJWYŻSZA OSTROŻNOŚĆ: jedyna droga, którą dane finansowe rodziny wychodzą poza aplikację
// (Claude i dashboard — TĄ SAMĄ drogą). WYŁĄCZNIE GET, zero zapisu: router nie importuje
// nic poza `q` z ../db (same odczyty) i `requireToken` z ./auth — brak jakiegokolwiek
// słowa kluczowego zapisu SQL w tym pliku pilnowany testem (scripts/test-ro-api.js, grep).
// Zapis (housekeeping tokenów) siedzi wyłącznie w ./auth.js, poza tym plikiem.
const express = require('express');
const { q } = require('../db');
const { requireToken } = require('./auth');
const { czyData } = require('../ocr/pola');
const { wymagajModalnosci } = require('../wylaczniki'); // Z11 (21a): domyślnie WYŁĄCZONE

// zapiszDostep dostarcza Z11 (src/rejestr.js): zapiszDostep(kanal, endpoint, okres, wierszy,
// tokenId), kanał 'ro_api'. Import miękki: dopóki ten moduł nie istnieje w drzewie (scalenie
// równoległych zleceń), audyt dostępu po prostu nic nie robi — router ma działać ZANIM
// rejestr powstanie, nie odwrotnie. Fire-and-forget po stronie rejestru (patrz jego kod).
let zapiszDostep = () => {};
try { ({ zapiszDostep } = require('../rejestr')); } catch { /* Z11 jeszcze nie scalone */ }
const odnotuj = (req, okres, n) => zapiszDostep('ro_api', `ro:${req.path}`, okres, n, req.roToken?.id);

const router = express.Router();

// WYŁĄCZNIE GET na całym routerze — zanim jeszcze doszliśmy do tokenu, bo to zakaz
// bezwarunkowy (nawet nieautoryzowany POST ma dostać 405, nie 401).
router.use((req, res, next) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  next();
});
// KOLEJNOŚĆ CELOWA: najpierw token, potem wyłącznik modalności. Anonim (zły/brak token)
// ma dostać 401 i NIC WIĘCEJ — 503 zdradzałoby stan konfiguracji egresu (czy Szymon w ogóle
// włączył 'ro_api' w Adminie) komuś, kto nie udowodnił nawet, że ma prawo pytać. Dopiero
// posiadacz WAŻNEGO tokenu może się dowiedzieć, że droga jest administracyjnie zablokowana.
router.use(requireToken);
// Wyłącznik modalności (Z11, migracja 019): dopóki Szymon świadomie nie włączy 'ro_api'
// w Adminie (Z12), ta droga wyjścia danych jest zablokowana nawet dla ważnego tokenu.
router.use(wymagajModalnosci('ro_api'));

const inClause = (ids) => ids.map((_, i) => `:l${i}`).join(',');
const paramy = (ids) => Object.fromEntries(ids.map((id, i) => [`l${i}`, id]));
const liczba = (v) => (v === null || v === undefined ? null : Number(v));

// GET /podsumowanie?od=&do= — sumy wg księgi × typ (bez pojedynczych wpisów).
router.get('/podsumowanie', async (req, res, next) => {
  try {
    const ledgers = req.roToken.ledgers;
    if (!ledgers.length) return res.json({ od: null, do: null, pozycje: [] });
    const od = czyData(req.query.od), doD = czyData(req.query.do);
    if (!od || !doD) return res.status(400).json({ error: 'bad_period' });
    const rows = await q(
      `SELECT t.ledger_id, t.type, ROUND(SUM(t.amount),2) AS suma, COUNT(*) AS n
         FROM transactions t
        WHERE t.deleted_at IS NULL AND t.ledger_id IN (${inClause(ledgers)})
          AND t.tx_date BETWEEN :od AND :doD
        GROUP BY t.ledger_id, t.type ORDER BY t.ledger_id, t.type`,
      { ...paramy(ledgers), od, doD });
    odnotuj(req, `${od}..${doD}`, rows.length);
    res.json({
      od, do: doD,
      pozycje: rows.map((r) => ({ ledger_id: r.ledger_id, type: r.type, suma: liczba(r.suma), n: Number(r.n) })),
    });
  } catch (e) { next(e); }
});

// Zawężenie ?ledger= do zasięgu tokenu — literówka albo próba wyjścia poza zasięg = 403,
// nie ciche zignorowanie (żeby konsument wiedział, że dostał węższy wynik niż prosił).
function ledgerZakres(req, res) {
  const ledgers = req.roToken.ledgers;
  if (!req.query.ledger) return ledgers;
  const l = parseInt(req.query.ledger, 10);
  if (!ledgers.includes(l)) { res.status(403).json({ error: 'ledger_forbidden' }); return null; }
  return [l];
}

// Limit listy /wpisy — patrz `ucieto` w odpowiedzi: konsument MUSI wiedzieć, że dostał
// przycięty wynik, inaczej policzy sumę z 1000 wierszy i uzna ją za kompletną (zaniżenie
// bez śladu — dokładnie to, czego księga rachunkowa nie może robić po cichu).
const LIMIT_WPISOW = 1000;

// GET /wpisy?od=&do=&ledger= — TO WYPUSZCZA SZCZEGÓŁY: zasięg z tokenu, nigdy szerszy.
// Okres obowiązkowy (lista może być długa) — bez niego LIMIT i tak by uciął, ale po cichu.
router.get('/wpisy', async (req, res, next) => {
  try {
    const ledgers = ledgerZakres(req, res);
    if (ledgers === null) return;
    if (!ledgers.length) return res.json({ items: [], ucieto: false });
    const od = czyData(req.query.od), doD = czyData(req.query.do);
    if (!od || !doD) return res.status(400).json({ error: 'bad_period' });
    const rows = await q(
      `SELECT t.tx_date AS data, t.amount AS kwota, t.type AS typ, t.description AS opis,
              t.payment_method AS forma_platnosci,
              COALESCE(CONCAT(COALESCE(CONCAT(rodzic.name,' > '),''), dziecko.name),'(bez kategorii)') AS kategoria
         FROM transactions t
         LEFT JOIN categories dziecko ON dziecko.id = t.category_id AND dziecko.ledger_id = t.ledger_id
         LEFT JOIN categories rodzic ON rodzic.id = dziecko.parent_id
        WHERE t.deleted_at IS NULL AND t.ledger_id IN (${inClause(ledgers)})
          AND t.tx_date BETWEEN :od AND :doD
        ORDER BY t.tx_date DESC, t.id DESC LIMIT ${LIMIT_WPISOW}`,
      { ...paramy(ledgers), od, doD });
    odnotuj(req, `${od}..${doD}`, rows.length);
    res.json({
      items: rows.map((r) => ({
        data: r.data, kwota: liczba(r.kwota), typ: r.typ,
        kategoria: r.kategoria, opis: r.opis, payment_method: r.forma_platnosci,
      })),
      ucieto: rows.length === LIMIT_WPISOW,
    });
  } catch (e) { next(e); }
});

// GET /kategorie?ledger= — drzewo ścieżek jako napisy ("Rodzic > Dziecko"), bez id/userów.
router.get('/kategorie', async (req, res, next) => {
  try {
    const ledgers = ledgerZakres(req, res);
    if (ledgers === null) return;
    if (!ledgers.length) return res.json({ items: [] });
    const rows = await q(
      `SELECT COALESCE(CONCAT(rodzic.name,' > '),'') AS prefiks, dziecko.name AS nazwa
         FROM categories dziecko LEFT JOIN categories rodzic ON rodzic.id = dziecko.parent_id
        WHERE dziecko.ledger_id IN (${inClause(ledgers)}) AND dziecko.active = 1
        ORDER BY dziecko.sort_order, dziecko.name`, paramy(ledgers));
    odnotuj(req, null, rows.length);
    res.json({ items: rows.map((r) => r.prefiks + r.nazwa) });
  } catch (e) { next(e); }
});

// Poniższe dwa endpointy DUBLUJĄ zapytania z routes/products.js (koszyk/drozeje) — scalenie
// w jedną wspólną funkcję wychodziłoby poza pliki przypisane temu zleceniu (products.js nie
// jest moim plikiem). Odnotowane w artefakcie jako duplikacja do ewentualnego refaktoru.

// GET /produkty/koszyk?od=&do= — co i za ile kupiono w okresie, w zasięgu tokenu.
// Pozycje BEZ przypisanego produktu (i.product_id IS NULL) NIE znikają z sumy po cichu —
// JOIN products by je odciął bez śladu, więc wracają osobną liczbą (wzorzec 1:1 z
// routes/products.js#koszyk), żeby suma koszyka zgadzała się z księgą.
router.get('/produkty/koszyk', async (req, res, next) => {
  try {
    const ledgers = req.roToken.ledgers;
    if (!ledgers.length) return res.json({ items: [], bez_produktu: { pozycji: 0, wydano: 0 } });
    const od = czyData(req.query.od), doD = czyData(req.query.do);
    if (!od || !doD) return res.status(400).json({ error: 'bad_period' });
    const zasieg = `r.ledger_id IN (${inClause(ledgers)}) AND r.receipt_date BETWEEN :od AND :doD`;
    const p = { ...paramy(ledgers), od, doD };
    const rows = await q(
      `SELECT p.name, p.unit, pc.name AS kategoria, COUNT(*) AS zakupow,
              ROUND(SUM(i.quantity), 3) AS ilosc, ROUND(SUM(i.value), 2) AS wydano
         FROM receipt_items i
         JOIN receipts r ON r.id = i.receipt_id
         JOIN products p ON p.id = i.product_id
         LEFT JOIN product_categories pc ON pc.id = p.product_category_id
        WHERE ${zasieg}
        GROUP BY p.id ORDER BY wydano DESC LIMIT 300`, p);
    const [poza] = await q(
      `SELECT COUNT(*) AS n, ROUND(SUM(i.value), 2) AS wydano
         FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
        WHERE ${zasieg} AND i.product_id IS NULL`, p);
    odnotuj(req, `${od}..${doD}`, rows.length);
    res.json({
      items: rows.map((x) => ({
        name: x.name, unit: x.unit, kategoria: x.kategoria,
        zakupow: Number(x.zakupow), ilosc: liczba(x.ilosc), wydano: liczba(x.wydano),
      })),
      bez_produktu: { pozycji: Number(poza?.n || 0), wydano: liczba(poza?.wydano) },
    });
  } catch (e) { next(e); }
});

// GET /produkty/drozeje?od=&do= — ranking „co najbardziej zdrożało" (okres vs poprzedni
// równej długości), w zasięgu tokenu. Logika 1:1 z routes/products.js#drozeje.
router.get('/produkty/drozeje', async (req, res, next) => {
  try {
    const ledgers = req.roToken.ledgers;
    if (!ledgers.length) return res.json({ items: [] });
    const od = czyData(req.query.od), doD = czyData(req.query.do);
    if (!od || !doD) return res.status(400).json({ error: 'bad_period' });
    const rows = await q(
      `SELECT p.name, p.unit,
              ROUND(AVG(CASE WHEN r.receipt_date BETWEEN :od AND :doD
                    THEN i.value / NULLIF(i.quantity, 0) END), 2) AS teraz,
              ROUND(AVG(CASE WHEN r.receipt_date < :od
                    AND r.receipt_date >= DATE_SUB(:od, INTERVAL DATEDIFF(:doD, :od) + 1 DAY)
                    THEN i.value / NULLIF(i.quantity, 0) END), 2) AS poprzednio
         FROM receipt_items i
         JOIN receipts r ON r.id = i.receipt_id
         JOIN products p ON p.id = i.product_id
        WHERE r.ledger_id IN (${inClause(ledgers)}) AND i.quantity > 0
        GROUP BY p.id
       HAVING teraz IS NOT NULL AND poprzednio IS NOT NULL AND poprzednio > 0
        ORDER BY (teraz - poprzednio) / poprzednio DESC LIMIT 100`, { ...paramy(ledgers), od, doD });
    odnotuj(req, `${od}..${doD}`, rows.length);
    res.json({
      items: rows.map((x) => ({
        name: x.name, unit: x.unit, teraz: liczba(x.teraz), poprzednio: liczba(x.poprzednio),
        zmiana_proc: Math.round(((Number(x.teraz) - Number(x.poprzednio)) / Number(x.poprzednio)) * 1000) / 10,
      })),
    });
  } catch (e) { next(e); }
});

module.exports = router;
