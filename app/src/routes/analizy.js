// routes/analizy.js — API analiz okresowych (21d, Z12). Admin only: analiza pokazuje
// zestawienie OBU ksiąg naraz (RODZINA + PERSEVERA), więc nie ma tu miejsca na rolę
// „adult, ale nie admin" tak jak przy raportach — decyzja Szymona przy tym zleceniu.
const express = require('express');
const { q } = require('../db');
const { policzOkres, wykonajAnalize, zakresOkresu, OKRESY_TYP } = require('../analizy');
const { zapiszDostep } = require('../rejestr');

const router = express.Router();

router.use((req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
  next();
});

function walidujOkres(req, res) {
  const okresTyp = String(req.query.okres_typ || req.body?.okres_typ || '');
  const okres = String(req.query.okres || req.body?.okres || '');
  if (!OKRESY_TYP.includes(okresTyp) || !zakresOkresu(okresTyp, okres)) {
    res.status(400).json({ error: 'bad_okres' });
    return null;
  }
  return { okresTyp, okres };
}

// Wiersz z bazy → JSON: `dane` z powrotem obiektem (JSON w kolumnie), sentinel 0 → null
// (kontrakt API „NULL = obie księgi" — w tabeli trzymamy 0, patrz migracja 020).
function zJsonKolumny(row) {
  return {
    okres_typ: row.okres_typ, okres: row.okres,
    ledger_id: row.ledger_id || null,
    dane: typeof row.dane === 'string' ? JSON.parse(row.dane) : row.dane,
    narracja: row.narracja, model: row.model, created_at: row.created_at,
  };
}

// GET /api/v1/analizy?okres_typ=&okres=&ledger= — odczyt ZAPISANEJ migawki (bez liczenia).
router.get('/', async (req, res, next) => {
  try {
    const w = walidujOkres(req, res);
    if (!w) return;
    const ledgerCol = parseInt(req.query.ledger, 10) || 0;
    const rows = await q(
      `SELECT okres_typ, okres, ledger_id, dane, narracja, model, created_at
         FROM analizy WHERE okres_typ=:t AND okres=:o AND ledger_id=:l`,
      { t: w.okresTyp, o: w.okres, l: ledgerCol });
    if (!rows.length) return res.json({ znaleziono: false });
    res.json({ znaleziono: true, analiza: zJsonKolumny(rows[0]) });
  } catch (e) { next(e); }
});

// GET /api/v1/analizy/lista — przegląd wszystkich zapisanych migawek, najnowsze pierwsze.
router.get('/lista', async (req, res, next) => {
  try {
    const rows = await q(
      `SELECT id, okres_typ, okres, ledger_id, model, created_at FROM analizy
        ORDER BY created_at DESC LIMIT 200`, {});
    res.json({ items: rows.map((r) => ({ ...r, ledger_id: r.ledger_id || null })) });
  } catch (e) { next(e); }
});

// POST /api/v1/analizy { okres_typ, okres, ledger_id? } — policz TERAZ (liczby zawsze,
// narracja gdy dostawca/wyłącznik na to pozwolą) i zapisz (UPSERT nadpisuje ten sam okres).
router.post('/', async (req, res, next) => {
  try {
    const w = walidujOkres(req, res);
    if (!w) return;
    const ledgerRaw = req.body?.ledger_id;
    const ledgerId = ledgerRaw === undefined || ledgerRaw === null || ledgerRaw === '' ? null
      : (Number.isInteger(Number(ledgerRaw)) ? Number(ledgerRaw) : NaN);
    if (Number.isNaN(ledgerId)) return res.status(400).json({ error: 'bad_ledger' });
    const wynik = await wykonajAnalize(w.okresTyp, w.okres, ledgerId);
    // Kanał 'analiza' (src/rejestr.js, KANALY) — administrator ŚWIADOMIE odpytuje całą
    // księgę na potrzeby analizy; audyt dostępu ma to widzieć tak samo jak eksport CSV.
    zapiszDostep('analiza', req.baseUrl + req.path, `${w.okresTyp}:${w.okres}`, wynik.dane.top_kategorie.length, null);
    res.json({ ok: true, ...wynik });
  } catch (e) {
    if (e.code === 'bad_okres') return res.status(400).json({ error: 'bad_okres' });
    next(e);
  }
});

module.exports = router;
