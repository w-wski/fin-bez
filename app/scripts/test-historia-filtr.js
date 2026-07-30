#!/usr/bin/env node
// Testy czystej logiki Historii (Z17): reset filtra (K3/K7 — „Wyczyść" zeruje okres i produkuje
// URL bez jego parametrów) i kolejka toastów FIFO (K4 — toast czeka, gdy arkusz „Więcej" jest
// otwarty). Bez przeglądarki: historia-filtr.js/arkusz.js importują core.js, a core.js dotyka
// `document`/`window` NA STARCIE modułu (visibilitychange, netBadge) — więc, jak w
// scripts/test-uklad.js, podstawiamy minimalną atrapę PRZED dynamicznym importem.
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

let bledy = 0;
let liczbaAsercji = 0;
const A = {
  strictEqual: (...a) => { liczbaAsercji++; assert.strictEqual(...a); },
  deepStrictEqual: (...a) => { liczbaAsercji++; assert.deepStrictEqual(...a); },
};
function t(opis, fn) {
  try { fn(); console.log('OK  ', opis); }
  catch (e) { bledy++; console.error('BŁĄD', opis, '—', e.message); }
}

// Atrapa wystarczająca do samego ZAŁADOWANIA core.js (moduł tylko REJESTRUJE nasłuchy na
// starcie, nic więcej) — testowane funkcje niżej są czyste i tych nasłuchów nie dotykają.
global.window = { addEventListener() {} };
global.document = {
  visibilityState: 'visible',
  addEventListener() {},
  querySelector() { return null; },
  getElementById() { return null; },
  createElement() { return { setAttribute() {}, append() {}, style: {} }; },
};
global.navigator = { onLine: true };
global.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

(async () => {
  const { resetStanuFiltra, paramsFiltra, FILTR_DOMYSLNY } = await import(
    pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'historia-filtr.js')).href);
  const { dodajDoKolejki, oproznijKolejke } = await import(
    pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'arkusz.js')).href);

  // ---------- K3/K7: reset stanu filtra ----------

  t('resetStanuFiltra() zeruje okres (from/to puste) i nie zostawia kategorii', () => {
    const s = resetStanuFiltra();
    A.strictEqual(s.from, '');
    A.strictEqual(s.to, '');
    A.strictEqual(s.categoryIds, null);
  });

  t('resetStanuFiltra() zwraca nową kopię, nie referencję do FILTR_DOMYSLNY (nie da się zepsuć wspólnego stanu)', () => {
    const s = resetStanuFiltra();
    s.from = '2026-01-01';
    A.strictEqual(FILTR_DOMYSLNY.from, '');
  });

  // ---------- K5 (4.): filtr po resecie produkuje URL bez parametrów okresu ----------

  t('paramsFiltra(resetStanuFiltra()) nie ma from/to/type/category — pusty URL', () => {
    A.strictEqual(paramsFiltra(resetStanuFiltra()).toString(), '');
  });

  t('paramsFiltra z wypełnionym stanem niesie from/to/type i kategorie po przecinku', () => {
    const p = paramsFiltra({ from: '2026-01-01', to: '2026-01-31', type: 'WYDATEK', categoryIds: [3, 7] });
    A.strictEqual(p.get('from'), '2026-01-01');
    A.strictEqual(p.get('to'), '2026-01-31');
    A.strictEqual(p.get('type'), 'WYDATEK');
    A.strictEqual(p.get('category'), '3,7');
  });

  // ---------- K4: kolejka toastów FIFO ----------

  t('kolejka toastów jest FIFO — pierwszy dodany wychodzi pierwszy', () => {
    let k = [];
    k = dodajDoKolejki(k, { text: 'pierwszy' });
    k = dodajDoKolejki(k, { text: 'drugi' });
    k = dodajDoKolejki(k, { text: 'trzeci' });
    A.deepStrictEqual(k.map((w) => w.text), ['pierwszy', 'drugi', 'trzeci']);
  });

  t('zamknięcie arkusza opróżnia kolejkę toastów (oproznijKolejke() → [])', () => {
    let k = dodajDoKolejki(dodajDoKolejki([], { text: 'a' }), { text: 'b' });
    k = oproznijKolejke();
    A.deepStrictEqual(k, []);
  });

  if (bledy) {
    console.error(`\n${bledy} testów Historia/filtr NIE przeszło.`);
    process.exit(1);
  }
  console.log(`\nWszystkie testy Historia/filtr przeszły (${liczbaAsercji} asercji).`);
})();
