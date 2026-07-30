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
const { zapiszWyjscie } = require('../rejestr');

const TIMEOUT_MS = 30000;

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
        max_tokens: maxTokens || 700,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`anthropic http ${res.status}`);
    const body = await res.json();
    const tekst = (body.content || []).map((c) => c.text || '').join('').trim();
    if (!tekst) return null;
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
        max_tokens: maxTokens || 700,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`openrouter http ${res.status}`);
    const body = await res.json();
    const tekst = (body.choices?.[0]?.message?.content || '').trim();
    if (!tekst) return null;
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

module.exports = { narracja };
