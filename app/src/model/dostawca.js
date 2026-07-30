// model/dostawca.js — JEDYNE miejsce w repo, które zna dostawców modeli językowych (Z12).
// Warstwa WYMIENIALNA (decyzja Szymona): dziś Anthropic, jutro model lokalny family-os —
// to ma być przepięcie (nowy `case` niżej), nigdy przepisanie wywołujących (src/analizy.js
// zna wyłącznie `narracja(prompt, opts)`, nic więcej).
//
// Wybór dostawcy: env MODEL_DOSTAWCA ('anthropic' | 'brak', domyślnie 'brak' — klucza API
// jeszcze nie ma w .env, więc aplikacja MUSI działać offline-z-liczb bez tego pliku robiąc
// cokolwiek). Błąd dostawcy (sieć, limit, zły klucz) → null + console.error: analiza ma
// powstać MIMO padu modelu, nigdy na odwrót.
const { czyWlaczona } = require('../wylaczniki');
const { zapiszWyjscie, zapiszKosztApi } = require('../rejestr');

// Estymata kosztu, gdy OpenRouter NIE zwraca `usage.cost` w odpowiedzi (nie każdy klucz/model
// ma włączone rozliczanie generacji) — grube $/1k tokenów łącznie (in+out), env-owalne bez
// zmiany kodu. To tylko ESTYMATA: prawdziwy koszt jest w `usage.cost`, gdy dostępny.
const KOSZT_EST_USD_1K = parseFloat(process.env.OPENROUTER_EST_USD_1K || '0.002');

const TIMEOUT_MS = 30000;
// Limit tokenów odpowiedzi. 700 było za mało (omówienie urywało się w połowie zdania),
// więc domyślnie 1600 z możliwością podniesienia przez env bez zmiany kodu.
const DOMYSLNY_LIMIT = parseInt(process.env.MODEL_MAX_TOKENS || '1600', 10);

// Czyty fetch (bez SDK — zero nowych zależności w package.json). `fetch` jest globalne
// od Node 18 (patrz src/auth.js — używa go do wymiany kodu OAuth tym samym wzorcem).
async function anthropicNarracja(prompt, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null; // klucza jeszcze nie ma w .env — tryb offline mimo dostawcy 'anthropic'
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens || DOMYSLNY_LIMIT,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`anthropic http ${res.status}`);
    const body = await res.json();
    const tekst = (body.content || []).map((c) => c.text || '').join('').trim();
    if (!tekst) return null;
    if (body.stop_reason === 'max_tokens') {
      console.error('model/dostawca: narracja ucięta na max_tokens — podnieś MODEL_MAX_TOKENS');
    }
    // #26: telemetria wychodząca — liczby i cel, NIGDY treść (patrz src/rejestr.js).
    zapiszWyjscie('anthropic', 'analiza', 1, prompt.length);
    return { tekst, model };
  } catch (e) {
    console.error('model/dostawca: narracja anthropic nieudana —', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// OpenRouter — format OpenAI chat completions. Domyślny model 'openrouter/auto':
// router OpenRouter sam dobiera najlepszy model do zadania (decyzja Szymona 2026-07-30).
async function openrouterNarracja(prompt, maxTokens) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null; // brak klucza w .env — tryb offline mimo dostawcy 'openrouter'
  const model = process.env.OPENROUTER_MODEL || 'openrouter/auto';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens || DOMYSLNY_LIMIT,
        // 'openrouter/auto' może trafić na model rozumujący, a jego tokeny rozumowania
        // liczą się do max_tokens — bez tego omówienie urywało się w połowie zdania.
        reasoning: { exclude: true },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`openrouter http ${res.status}`);
    const body = await res.json();
    const tekst = (body.choices?.[0]?.message?.content || '').trim();
    if (!tekst) return null;
    // Ucięcie na limicie: lepiej mieć w logu ślad niż cicho zapisać połowę zdania.
    if (body.choices?.[0]?.finish_reason === 'length') {
      console.error('model/dostawca: narracja ucięta na max_tokens — podnieś MODEL_MAX_TOKENS');
    }
    // Przy 'openrouter/auto' realnie użyty model wraca w odpowiedzi — zapisujemy TEN,
    // żeby w tabeli `analizy` było widać, kto naprawdę pisał narrację.
    const uzyty = body.model || model;
    zapiszWyjscie('openrouter', 'analiza', 1, prompt.length);
    return { tekst, model: uzyty };
  } catch (e) {
    console.error('model/dostawca: narracja openrouter nieudana —', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Jedyna funkcja publiczna: prompt → { tekst, model } albo null (tryb offline/błąd).
 *  Wywołujący (src/analizy.js) NIGDY nie sprawdza, KTÓRY to dostawca — tylko wynik. */
async function narracja(prompt, { maxTokens } = {}) {
  const dostawca = process.env.MODEL_DOSTAWCA || 'brak';
  if (dostawca === 'brak') return null;
  if (dostawca === 'anthropic' || dostawca === 'openrouter') {
    // Wyłącznik modalności (Z11, migracja 019) sprawdzany PRZED wywołaniem — Szymon musi
    // świadomie włączyć 'model_zewnetrzny' w Adminie, inaczej dane nie wychodzą wcale.
    if (!(await czyWlaczona('model_zewnetrzny'))) return null;
    return dostawca === 'anthropic'
      ? anthropicNarracja(prompt, maxTokens)
      : openrouterNarracja(prompt, maxTokens);
  }
  // Nieznana wartość env — traktujemy jak 'brak' (bezpieczny domyślny stan), ale mówimy o tym.
  console.error('model/dostawca: nieznany MODEL_DOSTAWCA —', dostawca);
  return null;
}

// Czat (Z20, pyt. 5-6): ZAWSZE przez OpenRouter, niezależnie od MODEL_DOSTAWCA (który rządzi
// tylko narracją Analiz) — decyzja Szymona 2026-07-30. Bramkowane tym samym wyłącznikiem
// 'model_zewnetrzny', bo to ta sama droga wyjścia danych na zewnątrz. `messages` = tablica
// {role, content} jak w OpenAI chat/completions (system + user) — WOŁAJĄCY (src/chat.js)
// odpowiada za to, żeby żadna wiadomość nie niosła imion userów (Z12 zakaz danych osobowych).
async function czat(messages, { maxTokens, userId } = {}) {
  if (!(await czyWlaczona('model_zewnetrzny'))) return null;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null; // brak klucza — front pokazuje „model niedostępny — sprawdź saldo"
  const model = process.env.OPENROUTER_MODEL || 'openrouter/auto';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens || DOMYSLNY_LIMIT,
        reasoning: { exclude: true }, // patrz komentarz przy openrouterNarracja
        messages,
      }),
      signal: ctrl.signal,
    });
    // Błąd klucza/salda (401/402/429...) → rzuca niżej, catch zwraca null: front dostaje
    // czytelny komunikat „model niedostępny — sprawdź saldo OpenRouter" (Z20 zasady bezpieczeństwa).
    if (!res.ok) throw new Error(`openrouter http ${res.status}`);
    const body = await res.json();
    const tekst = (body.choices?.[0]?.message?.content || '').trim();
    if (!tekst) return null;
    const uzyty = body.model || model;
    const tokensIn = Number.isFinite(body.usage?.prompt_tokens) ? body.usage.prompt_tokens : null;
    const tokensOut = Number.isFinite(body.usage?.completion_tokens) ? body.usage.completion_tokens : null;
    // Koszt: `usage.cost` gdy OpenRouter je liczy, inaczej estymata z tokenów — NIGDY brak liczby
    // wcale (twardy limit $5/mies. w src/chat.js musi mieć CZYM sumować, patrz K4).
    const koszt = typeof body.usage?.cost === 'number' ? body.usage.cost
      : (tokensIn !== null && tokensOut !== null
        ? Math.round(((tokensIn + tokensOut) / 1000) * KOSZT_EST_USD_1K * 1e6) / 1e6
        : null);
    const znakow = messages.reduce((s, m) => s + String(m.content || '').length, 0);
    zapiszWyjscie('openrouter', 'czat', 1, znakow);
    zapiszKosztApi(userId, 'czat', uzyty, tokensIn, tokensOut, koszt);
    return { tekst, model: uzyty, tokens: { in: tokensIn, out: tokensOut }, koszt };
  } catch (e) {
    console.error('model/dostawca: czat openrouter nieudany —', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { narracja, czat };
