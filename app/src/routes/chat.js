// routes/chat.js — API czatu analiz (Z20, pyt. 5-6): POST /api/v1/chat, GET /popularne,
// GET /koszty (admin, telemetria K8). Montowany z auth.requireAuth (patrz artefakt oddania —
// linia w app.js, plik poza moim zakresem). Czat WYŁĄCZNIE CZYTA: router nie importuje nic
// poza `q`/`chat`/`dostawca`/`wylaczniki`/`rejestr` (żadnego zapisu do ksiąg/kategorii).
const express = require('express');
const { czyWlaczona } = require('../wylaczniki');
const { zapiszDostep, kosztyMiesieczne } = require('../rejestr');
const { zakresOkresu, OKRESY_TYP } = require('../analizy');
const { czat } = require('../model/dostawca');
const chat = require('../chat');

const router = express.Router();

// Wyłącznik model_zewnetrzny bramkuje rozmowę i podpowiedzi (K5): wyłączony → 403, front
// sonduje GET /popularne i chowa sekcję czatu. NIE bramkuje /koszty — telemetria Admina ma
// pokazywać WYDANE dotąd pieniądze także wtedy, gdy Szymon świadomie wyłączył modalność.
router.use(async (req, res, next) => {
  try {
    // Czat TYLKO dla admina (weryfikacja Z20, K3): karta Analizy i tak jest admin-only,
    // a podsumowania okresów to agregaty CAŁEJ księgi — rola ownOnly (junior) dostawałaby
    // przez czat sumy wydatków rodziców. Czat dla reszty rodziny = osobne zlecenie
    // z filtrowaniem kontekstu per ownOnly (jak routes/reports.js), nie zdjęcie tej bramki.
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    if (req.path === '/koszty') return next();
    if (!(await czyWlaczona('model_zewnetrzny'))) return res.status(403).json({ error: 'model_wylaczony' });
    next();
  } catch (e) { next(e); }
});

function walidujOkres(req, res) {
  const okresTyp = String(req.body?.okres_typ || req.query.okres_typ || '');
  const okres = String(req.body?.okres || req.query.okres || '');
  if (!OKRESY_TYP.includes(okresTyp) || !zakresOkresu(okresTyp, okres)) {
    res.status(400).json({ error: 'bad_okres' });
    return null;
  }
  return { okresTyp, okres };
}

// POST / { okres_typ, okres, pytanie, szeroki? } — pytanie o WYBRANY okres (K2/K3).
router.post('/', async (req, res, next) => {
  try {
    const w = walidujOkres(req, res);
    if (!w) return;
    const pytanie = String(req.body?.pytanie || '').trim().slice(0, 512);
    if (!pytanie) return res.status(400).json({ error: 'bad_pytanie' });
    const szeroki = !!req.body?.szeroki;

    // Twardy limit $5/mies. ŁĄCZNIE, sprawdzony PRZED wywołaniem modelu (K4) — 429, model
    // NIE jest wywoływany wcale (żadnego fetch, ani grosza więcej ponad limit).
    const wydano = await chat.wydanoWTymMiesiacu();
    if (chat.limitOsiagniety(wydano)) {
      return res.status(429).json({
        error: 'limit_miesieczny',
        komunikat: 'Osiągnięto miesięczny limit 5 USD na czat analiz — spróbuj w kolejnym miesiącu.',
      });
    }

    // Rezerwacja PRZED fetch (weryfikacja Z20, K4a): wiersz z kosztem minimalnym wchodzi do
    // sumy limitu od razu, więc równoległe żądania nie prześlizgną się razem pod progiem.
    const rozmowaId = await chat.rezerwujRozmowe({
      userId: req.user.uid, okresTyp: w.okresTyp, okres: w.okres, szeroki, pytanie,
    });
    const { kontekst, uzytoSzczegolow } = await chat.budujKontekst({
      user: req.user, okresTyp: w.okresTyp, okres: w.okres, pytanie, szeroki,
    });
    const wiadomosci = chat.zbudujWiadomosci(kontekst, pytanie);
    const wynik = await czat(wiadomosci, { userId: req.user.uid });

    await chat.zapiszRozmowe({ rozmowaId, wynik });
    // Kanał 'analiza' (jak POST /api/v1/analizy): user ŚWIADOMIE odpytuje dane okresu.
    zapiszDostep('analiza', req.baseUrl + req.path, `${w.okresTyp}:${w.okres}`, 1, null);

    if (!wynik) {
      // Klucz/saldo/timeout — komunikat CZYTELNY, nigdy cicha pustka (zasady bezpieczeństwa).
      return res.json({ ok: true, odpowiedz: null, komunikat: 'model niedostępny — sprawdź saldo OpenRouter', uzyto_szczegolow: uzytoSzczegolow });
    }
    res.json({ ok: true, odpowiedz: wynik.tekst, model: wynik.model, uzyto_szczegolow: uzytoSzczegolow });
  } catch (e) { next(e); }
});

// GET /popularne — max 3 najczęstsze pytania TEGO usera (K2), do podpowiedzi w UI.
router.get('/popularne', async (req, res, next) => {
  try {
    res.json({ items: await chat.popularnePytania(req.user.uid, 3) });
  } catch (e) { next(e); }
});

// GET /koszty — telemetria Admina (K8): suma miesięczna per user per źródło + stan limitu.
// Admin only: koszty innych userów to informacja administracyjna, nie dana usera samego siebie.
router.get('/koszty', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
    const wydanoLacznie = await chat.wydanoWTymMiesiacu();
    res.json({
      pozycje: await kosztyMiesieczne(),
      limit_usd: chat.LIMIT_USD,
      wydano_czat_usd: wydanoLacznie,
      limit_osiagniety: chat.limitOsiagniety(wydanoLacznie),
    });
  } catch (e) { next(e); }
});

module.exports = router;
