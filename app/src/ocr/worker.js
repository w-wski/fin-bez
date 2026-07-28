/* worker.js — JEDEN worker tesseracta na proces. Start zajmuje 2–4 s (rozpakowanie modelu
 * języka polskiego), potem kolejne odczyty są szybkie, więc tworzymy go raz i leniwie:
 * użytkownik, który nigdy nie wejdzie na kartę „Paragon", nie płaci za to niczym.
 *
 * Wyjęte z routes/receipts.js — trasa HTTP nie jest właścicielem silnika OCR, a od kiedy
 * z tego samego workera korzystają trzy drogi wejścia (zdjęcie, PDF, powtórny odczyt),
 * trzymanie go przy jednej z nich było mylące.
 *
 * DWIE OSŁONY, obie postawione po awarii na produkcji 2026-07-27 (wgranie PDF-a kończyło
 * się odpowiedzią 503 — czyli NIE naszym błędem 400, tylko martwym procesem aplikacji):
 *
 *  1. Sprawdzenie modelu PRZED startem. Brakowało `pol.traineddata.gz`, bo katalog
 *     `ocr-data/` nigdy nie trafił do repozytorium. Sam brak pliku byłby drobiazgiem,
 *     gdyby nie osłona druga.
 *  2. `errorHandler`. Bez niego tesseract.js na każdy błąd workera robi `throw` WEWNĄTRZ
 *     nasłuchu zdarzeń (createWorker.js:247) — a wyjątek rzucony tam nie ma kogo złapać
 *     i ZABIJA CAŁY PROCES aplikacji. Jedno wgranie pliku kładło serwer wszystkim,
 *     nie tylko sobie. Z `errorHandler` ten sam błąd wraca normalnym odrzuceniem
 *     obietnicy, a proces żyje dalej.
 *
 * Do tego BUDZIK. Uszkodzony model (obcięty plik po nieudanym rsync) nie kończy się
 * błędem: tesseract zapada się w sobie i nie odpowiada NIGDY — sprawdzone, ponad 90 s
 * ciszy. Żądanie wisi, aż serwer je zerwie, i użytkownik znowu dostaje 503 bez powodu.
 * Dlatego start ma termin: po nim mówimy wprost, że silnik nie wstał.
 *
 * Nieudany start ZERUJE obietnicę: bez tego jeden błąd zostawał w pamięci na zawsze
 * i każde kolejne żądanie dostawało tę samą odrzuconą obietnicę, nawet po naprawieniu
 * przyczyny.
 */
const fs = require('fs');
const path = require('path');

const OCR_LANG_DIR = process.env.OCR_LANG_DIR || path.join(__dirname, '..', '..', 'ocr-data');
const START_MS = Number(process.env.OCR_START_TIMEOUT_MS) || 30000;
const MODEL = 'pol.traineddata';
let workerPromise = null;

/** Zwraca `.gz` albo rozpakowany model, jeśli któryś leży na dysku; inaczej `null`. */
function znajdzModel() {
  for (const nazwa of [`${MODEL}.gz`, MODEL]) {
    const p = path.join(OCR_LANG_DIR, nazwa);
    if (fs.existsSync(p)) return { sciezka: p, gzip: nazwa.endsWith('.gz') };
  }
  return null;
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const model = znajdzModel();
      if (!model) {
        // Komunikat trafia wprost do użytkownika (trasa zwraca go jako `error`), więc
        // mówi po polsku, co jest nie tak i co dalej działa mimo tego.
        throw new Error(`Brak modelu języka polskiego dla rozpoznawania tekstu (${MODEL}.gz `
          + `w katalogu ${OCR_LANG_DIR}). Bez niego czytam tylko e-paragony .json.`);
      }
      const { createWorker } = require('tesseract.js');
      const start = createWorker('pol', 1, {
        langPath: OCR_LANG_DIR,
        cachePath: OCR_LANG_DIR,
        gzip: model.gzip,
        logger: () => {},
        // Sama OBECNOŚĆ tej funkcji wyłącza `throw` zabijający proces (patrz nagłówek).
        errorHandler: (e) => console.error('[ocr] błąd workera:', String(e).slice(0, 500)),
      });
      let budzik;
      const termin = new Promise((_, odrzuc) => {
        budzik = setTimeout(() => odrzuc(new Error(
          `Silnik rozpoznawania tekstu nie wstał w ${Math.round(START_MS / 1000)} s. `
          + `Sprawdź plik ${model.sciezka} — najczęściej jest niekompletny.`)), START_MS);
      });
      // Worker, który przyjdzie po terminie, ma zostać ubity: inaczej wisiałby w pamięci
      // procesu do końca jego życia, a nikt już po niego nie sięgnie.
      start.then((w) => (budzik && clearTimeout(budzik), w)).catch(() => {});
      return Promise.race([start, termin]).catch((e) => {
        clearTimeout(budzik);
        start.then((w) => w.terminate()).catch(() => {});
        throw e;
      });
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

module.exports = { getWorker, OCR_LANG_DIR, znajdzModel };
