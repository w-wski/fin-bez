#!/usr/bin/env node
// Test regresyjny awarii z produkcji 2026-07-27: wgranie PDF-a zwracało 503, bo proces
// aplikacji UMIERAŁ. Przyczyna: brak modelu języka → tesseract.js rzuca wyjątek wewnątrz
// nasłuchu zdarzeń, gdzie nie ma go kto złapać.
//
// Ten plik jest inny niż reszta testów: samo jego DOJŚCIE DO KOŃCA jest dowodem. Gdyby
// osłona z src/ocr/worker.js przestała działać, proces testu zginąłby w połowie — nie
// byłoby „BŁĄD", byłby brak wyniku i czerwone `npm test`.
const fs = require('fs');
const os = require('os');
const path = require('path');

let bledy = 0;
function ok(warunek, opis) {
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));

/** Każdy przypadek dostaje ŚWIEŻY moduł: worker.js czyta katalog raz, przy wczytaniu. */
function zKatalogiem(dir, ms) {
  process.env.OCR_LANG_DIR = dir;
  if (ms) process.env.OCR_START_TIMEOUT_MS = String(ms);
  delete require.cache[require.resolve('../src/ocr/worker')];
  return require('../src/ocr/worker');
}

(async () => {
  // --- 1. Pusty katalog: odmowa PRZED dotknięciem tesseracta, z powodem po polsku ---
  const pusty = zKatalogiem(path.join(tmp, 'pusty'));
  fs.mkdirSync(path.join(tmp, 'pusty'));
  ok(pusty.znajdzModel() === null, 'brak modelu rozpoznany jako brak, nie jako plik');
  try {
    await pusty.getWorker();
    ok(false, 'brak modelu → powinno odrzucić');
  } catch (e) {
    ok(/Brak modelu języka polskiego/.test(e.message), `powód po polsku (${e.message.slice(0, 48)}…)`);
    ok(/e-paragony/.test(e.message), 'komunikat mówi, co MIMO TO działa');
  }
  // Drugie wywołanie ma spróbować od nowa (obietnica wyzerowana), a nie oddać stary błąd.
  let drugie = false;
  try { await pusty.getWorker(); } catch { drugie = true; }
  ok(drugie, 'po nieudanym starcie kolejne żądanie próbuje jeszcze raz');

  // --- 2. Model uszkodzony: NIE wolno wisieć w nieskończoność ---
  // Sprawdzone ręcznie: bez budzika tesseract milczy ponad 90 s, żądanie wisi, a serwer
  // zrywa je z kodem 503 — czyli objaw identyczny jak przy pierwotnej awarii.
  const zlyDir = path.join(tmp, 'zly');
  fs.mkdirSync(zlyDir);
  fs.writeFileSync(path.join(zlyDir, 'pol.traineddata.gz'), 'to nie jest model');
  const zly = zKatalogiem(zlyDir, 3000);
  ok(zly.znajdzModel() !== null, 'uszkodzony plik jest widoczny jako model (poznamy go dopiero przy starcie)');
  const t = Date.now();
  try {
    await zly.getWorker();
    ok(false, 'uszkodzony model → powinno odrzucić');
  } catch (e) {
    ok(/nie wstał w 3 s/.test(e.message), `budzik zadzwonił (${e.message.slice(0, 60)}…)`);
    ok(Date.now() - t < 15000, `odmowa w ${Date.now() - t} ms, nie po zerwaniu połączenia`);
  }

  // --- 3. Model w repozytorium: bramka przed deployem bez modelu ---
  // Bez tego pliku aparat i PDF nie działają NIGDZIE — a brak zauważa się dopiero
  // na produkcji, przy pierwszym paragonie.
  delete process.env.OCR_LANG_DIR;
  delete require.cache[require.resolve('../src/ocr/worker')];
  const domyslny = require('../src/ocr/worker');
  const m = domyslny.znajdzModel();
  ok(!!m, `model języka polskiego leży w repozytorium (${domyslny.OCR_LANG_DIR})`);
  if (m) ok(fs.statSync(m.sciezka).size > 1e6, `model ma sensowny rozmiar (${Math.round(fs.statSync(m.sciezka).size / 1024)} kB)`);

  console.log(bledy ? `\n${bledy} BŁĘDÓW` : '\nWszystkie testy osłon silnika OCR przeszły.');
  // Twarde wyjście: po przypadku 2 w tle został zawieszony wątek workera, który sam
  // nigdy nie odpowie i trzymałby proces przy życiu.
  process.exit(bledy ? 1 : 0);
})();
