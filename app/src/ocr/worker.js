/* worker.js — JEDEN worker tesseracta na proces. Start zajmuje 2–4 s (rozpakowanie modelu
 * języka polskiego), potem kolejne odczyty są szybkie, więc tworzymy go raz i leniwie:
 * użytkownik, który nigdy nie wejdzie na kartę „Paragon", nie płaci za to niczym.
 *
 * Wyjęte z routes/receipts.js — trasa HTTP nie jest właścicielem silnika OCR, a od kiedy
 * z tego samego workera korzystają trzy drogi wejścia (zdjęcie, PDF, powtórny odczyt),
 * trzymanie go przy jednej z nich było mylące.
 *
 * Nieudany start ZERUJE obietnicę: bez tego jeden błąd (np. brak modelu na dysku) zostawał
 * w pamięci na zawsze i każde kolejne żądanie dostawało tę samą odrzuconą obietnicę,
 * nawet po naprawieniu przyczyny.
 */
const path = require('path');

const OCR_LANG_DIR = process.env.OCR_LANG_DIR || path.join(__dirname, '..', '..', 'ocr-data');
let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      return createWorker('pol', 1, { langPath: OCR_LANG_DIR, gzip: true, cachePath: OCR_LANG_DIR, logger: () => {} });
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

module.exports = { getWorker, OCR_LANG_DIR };
