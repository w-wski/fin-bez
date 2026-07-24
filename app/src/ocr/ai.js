// HYBRYDA „Popraw AI": ponowny odczyt zdjęcia modelem wizyjnym. JEDYNE miejsce w aplikacji,
// w którym zdjęcie paragonu opuszcza serwer — i tylko po jawnym kliknięciu użytkownika
// (routes/receipts.js pilnuje, żeby nie ruszyć paragonu zaksięgowanego ani poprawionego ręcznie).
const { parseKwota } = require('../kwota');
const { parseIlosc } = require('./pola');

const PROMPT = 'Odczytaj ten polski paragon. Zwróć WYŁĄCZNIE JSON: '
  + '{"shop_name":str|null,"receipt_date":"YYYY-MM-DD"|null,"total":number|null,'
  + '"items":[{"ocr_name":str,"quantity":number,"unit":str|null,"unit_price":number,"value":number}]}. '
  + 'Kwoty jako liczby z kropką. Pomiń rabaty jako osobne pozycje — odejmij je od wartości pozycji.';

async function odczytajAI(b64) {
  const model = process.env.AI_OCR_MODEL || 'claude-haiku-4-5-20251001'; // tani model wizyjny wg CENNIK
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 2000,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: PROMPT },
      ] }],
    }),
  });
  if (!resp.ok) return { error: 'ai_failed', status: resp.status };
  const out = await resp.json();
  const tekst = (out.content?.[0]?.text || '').replace(/^```json?\s*|\s*```$/g, '');
  let parsed;
  try { parsed = JSON.parse(tekst); } catch { return { error: 'ai_bad_json' }; }
  // Liczby od modelu przechodzą przez te same parsery co pola formularza — model bywa kreatywny
  // („1 234,56", „12,50 zł"), a do bazy ma wejść liczba albo nic (nigdy zgadywane zero).
  parsed.items = (parsed.items || []).map((it, i) => ({
    line_no: i + 1, ocr_name: String(it.ocr_name || '').slice(0, 255), code: String(it.ocr_name || '').slice(0, 255),
    quantity: parseIlosc(it.quantity), unit_price: parseKwota(it.unit_price ?? it.value), value: parseKwota(it.value),
  })).filter((it) => it.ocr_name && it.value !== null);
  parsed.total = parseKwota(parsed.total);
  parsed.warnings = [];
  return parsed;
}

module.exports = { odczytajAI };
