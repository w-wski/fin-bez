// Czyste reguły pól paragonu: normalizacja kodu i jednostki, liczby, daty, progi zgodności.
// ZERO bazy i ZERO DOM. Powód wydzielenia (audyt Z4): ./parse-receipt deklarował „czysta
// funkcja", a przez require('./slownik') ciągnął ../db i otwierał pulę MySQL w procesie testów.
// Kwoty zamienia na liczby WYŁĄCZNIE ../kwota — jedno miejsce w całej aplikacji.
const { parseKwota } = require('../kwota');

const TOL_POZYCJA = 0.02;   // K6: |ilość × cena − wartość| powyżej tej wartości = pozycja podejrzana
const TOL_SUMA = 0.05;      // K7: |suma pozycji − SUMA z paragonu| powyżej = ostrzeżenie (nie blokada)

// „ Mąka   TORTOWA 1kg " → „MAKA TORTOWA 1KG"
// Bez diakrytyków (OCR myli ą/a, ż/z), bez wielokrotnych spacji, wielkimi literami.
function normCode(code) {
  const s = String(code === null || code === undefined ? '' : code)
    .replace(/[łŁ]/g, (c) => (c === 'ł' ? 'l' : 'L'))   // ł/Ł nie rozkłada się w NFD
    .normalize('NFD').replace(/[\u0300-\u036f]/gu, '')  // ą→a, ć→c, ę→e, ń→n, ó→o, ś→s, ź/ż→z
    .toUpperCase()
    .replace(/\s+/gu, ' ')
    .trim();
  return s ? s.slice(0, 160) : null;
}

// Jednostka: lista wyboru + własna, max 8 znaków (kolumna VARCHAR(8)). Pusta = dozwolona (K5).
function normUnit(unit) {
  const s = String(unit === null || unit === undefined ? '' : unit).replace(/\s+/gu, ' ').trim();
  return s ? s.slice(0, 8) : null;
}

// Tekst z pola formularza: przycięty do limitu kolumny; puste = null (a nie pusty napis).
function txt(v, max) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  return s ? s.slice(0, max) : null;
}

// ILOŚĆ TO NIE KWOTA. „0,345" (waga sera) jest normalna, a grupowania tysięcy w ilości nie ma —
// parseKwota('0.345') dałoby 345 (trzycyfrowa grupa po kropce = tysiące), czyli pomyłkę o trzy
// rzędy wielkości w drugą stronę. Stąd wąski parser: jedna liczba, przecinek albo kropka,
// do trzech miejsc po przecinku (kolumna DECIMAL(8,3)); wszystko inne = null (odmowa zapisu).
function parseIlosc(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  // spacja W ŚRODKU liczby („1 000") to niejednoznaczny zapis — odmawiamy, nie zgadujemy
  const s = String(v === null || v === undefined ? '' : v).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  return Number(s);
}

// Data paragonu: format ISO ORAZ dzień, który naprawdę istnieje. „2026-02-31" przechodziło
// dalej i wywracało zapis błędem MySQL (500), a data spoza formatu cicho stawała się NULL-em
// przy odpowiedzi {ok:true}. null = „nie da się odczytać", wołający musi to obsłużyć.
function czyData(v) {
  const s = String(v === null || v === undefined ? '' : v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [r, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(r, m - 1, d));
  const realna = dt.getUTCFullYear() === r && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  return realna ? s : null;
}

// K6: ilość × cena ≠ wartość. Brak którejkolwiek z trzech liczb = nie ma czego sprawdzać
// (pozycja bez ilości nie jest „podejrzana", tylko niepełna).
function isInconsistent(item) {
  const qty = parseIlosc(item && item.quantity);
  const price = parseKwota(item && item.unit_price);
  const value = parseKwota(item && item.value);
  if (qty === null || price === null || value === null) return false;
  // RABAT tłumaczy różnicę i nie jest niezgodnością: cena jednostkowa jest KATALOGOWA,
  // a `value` to kwota ZAPŁACONA. Bez tego składnika każda przeceniona pozycja
  // (czereśnie 1,98 kg × 24,99 = 49,48, zapłacone 22,75) świeciła jako podejrzana.
  const rabat = parseKwota(item && item.discount) || 0;
  return Math.abs(qty * price - (value + rabat)) > TOL_POZYCJA + 1e-9;
}

// K7: różnica „suma pozycji − SUMA z paragonu"; null = brak danych albo mieści się w tolerancji.
function sumDiff(items, total) {
  const t = parseKwota(total);
  if (t === null || !Array.isArray(items) || !items.length) return null;
  const s = items.reduce((a, it) => a + (parseKwota(it && it.value) || 0), 0);
  const d = Math.round((s - t) * 100) / 100;
  return Math.abs(d) > TOL_SUMA ? d : null;
}

module.exports = {
  TOL_POZYCJA, TOL_SUMA,
  normCode, normUnit, txt, parseIlosc, czyData, isInconsistent, sumDiff,
};
