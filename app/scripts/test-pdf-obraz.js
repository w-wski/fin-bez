#!/usr/bin/env node
// Testy wyłuskiwania obrazu z PDF-a (src/pdf-obraz.js). PDF budujemy w teście — mały,
// ale o TEJ SAMEJ strukturze co plik z aplikacji sklepu: obraz RGB z maską przezroczystości
// w osobnym obiekcie. Prawdziwego paragonu nie trzymamy w repo (dane osobowe).
const zlib = require('zlib');
const { obrazZPdf, png, crc32, znajdzObrazy } = require('../src/pdf-obraz');

let bledy = 0;
function ok(warunek, opis) {
  if (warunek) return console.log('OK  ', opis);
  bledy++;
  console.error('BŁĄD', opis);
}
const rowne = (a, b, opis) => ok(JSON.stringify(a) === JSON.stringify(b), `${opis} → ${JSON.stringify(a)}`);
function rzuca(fn, fragment, opis) {
  try { fn(); } catch (e) {
    return ok(e.message.includes(fragment), `${opis} (${e.message})`);
  }
  bledy++;
  console.error('BŁĄD', `${opis} — NIE rzucił`);
}

/** Minimalny PDF z jednym obrazem i (opcjonalnie) maską — tyle, ile czyta nasz parser. */
function zrobPdf({ w, h, kolor, rgb, alfa, filtr = 'FlateDecode', bpc = 8 }) {
  const czesci = ['%PDF-1.4\n'];
  const push = (nr, slownik, dane) => {
    czesci.push(`${nr} 0 obj\n<</Type /XObject /Subtype /Image ${slownik} /Length ${dane.length}>>\nstream\n`);
    czesci.push(dane);
    czesci.push('\nendstream\nendobj\n');
  };
  const kanaly = kolor === 'DeviceGray' ? 1 : 3;
  push(4, `/Width ${w} /Height ${h} /ColorSpace /${kolor}${alfa ? ' /SMask 5 0 R' : ''} `
    + `/BitsPerComponent ${bpc} /Filter /${filtr}`, zlib.deflateSync(rgb || Buffer.alloc(w * h * kanaly)));
  if (alfa) push(5, `/Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, zlib.deflateSync(alfa));
  czesci.push('%%EOF\n');
  return Buffer.concat(czesci.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c, 'latin1'))));
}

// --- PNG, który sami składamy, musi być czytelny dla dekodera ---
const p = png(2, 2, 1, Buffer.from([0, 255, 128, 64]));
rowne([...p.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'sygnatura PNG');
rowne(p.slice(12, 16).toString('ascii'), 'IHDR', 'pierwszy blok to IHDR');
rowne([p.readUInt32BE(16), p.readUInt32BE(20), p[24], p[25]], [2, 2, 8, 0],
  'szerokość, wysokość, 8 bitów, typ 0 (odcienie szarości)');
rowne(p.slice(p.length - 8, p.length - 4).toString('ascii'), 'IEND', 'ostatni blok to IEND');
// Suma kontrolna liczona na znanym wzorcu (CRC32 z „123456789" = 0xCBF43926)
rowne(crc32(Buffer.from('123456789')).toString(16), 'cbf43926', 'CRC32 zgodne ze wzorcem');
rzuca(() => png(4, 4, 3, Buffer.alloc(10)), 'krótszy, niż zapowiada',
  'za mało próbek → odmowa, nie obraz w połowie czarny');

// --- odrzucanie tego, czego nie umiemy — z POWODEM, nie po cichu ---
rzuca(() => obrazZPdf(Buffer.from('to nie pdf')), 'to nie jest plik PDF', 'obcy plik');
rzuca(() => obrazZPdf('napis'), 'oczekiwano zawartości', 'nie-bufor');
rzuca(() => obrazZPdf(Buffer.from('%PDF-1.4\nbez obrazow\n%%EOF')), 'nie ma obrazu',
  'PDF z samym tekstem — mówimy, że nie ma z czego czytać');
rzuca(() => obrazZPdf(zrobPdf({ w: 2, h: 2, kolor: 'DeviceRGB', filtr: 'DCTDecode' })),
  'DCTDecode', 'nieobsługiwany filtr wymieniony z nazwy');
rzuca(() => obrazZPdf(zrobPdf({ w: 2, h: 2, kolor: 'DeviceCMYK' })),
  'DeviceCMYK', 'nieobsługiwana przestrzeń barw wymieniona z nazwy');
rzuca(() => obrazZPdf(zrobPdf({ w: 2, h: 2, kolor: 'DeviceRGB', bpc: 1 })),
  'bitów na składową', 'nieobsługiwana głębia');

// --- obraz BEZ maski: przechodzi wprost, zamieniony na odcienie szarości ---
const bezMaski = obrazZPdf(zrobPdf({
  w: 2, h: 1, kolor: 'DeviceRGB',
  rgb: Buffer.from([255, 255, 255, 0, 0, 0]),          // biały, czarny
}));
rowne([bezMaski.w, bezMaski.h, bezMaski.zMaska], [2, 1, false], 'obraz bez maski');

// --- obraz Z MASKĄ: to jest sedno, bo tak wygląda PDF z Biedronki ---
// Warstwa barwna prawie cała czarna, a treść siedzi w masce. Bez złożenia z maską
// wychodzi czarny prostokąt — dokładnie to zobaczyłem przy pierwszym podejściu.
const zMaska = obrazZPdf(zrobPdf({
  w: 3, h: 1, kolor: 'DeviceRGB',
  rgb: Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0]),       // wszystko czarne
  alfa: Buffer.from([0, 128, 255]),                    // przezroczyste, w połowie, kryjące
}));
ok(zMaska.zMaska, 'maska rozpoznana i użyta');
// Rozpakowanie własnego PNG-a, żeby sprawdzić PIKSELE, a nie tylko nagłówek.
function pikselePng(buf) {
  let i = 8, idat = [];
  while (i < buf.length) {
    const dl = buf.readUInt32BE(i);
    const typ = buf.slice(i + 4, i + 8).toString('ascii');
    if (typ === 'IDAT') idat.push(buf.slice(i + 8, i + 8 + dl));
    i += 12 + dl;
  }
  const surowe = zlib.inflateSync(Buffer.concat(idat));
  return [...surowe.slice(1)];      // jeden wiersz: bajt filtra + próbki
}
rowne(pikselePng(zMaska.png), [255, 127, 0],
  'krycie 0 → biel papieru, 128 → półton, 255 → czerń druku');

// --- wybór obrazu: treść (z maską) przed maską wpisaną jako osobny obiekt ---
const lista = znajdzObrazy(zrobPdf({
  w: 4, h: 4, kolor: 'DeviceRGB', rgb: Buffer.alloc(48), alfa: Buffer.alloc(16),
}));
rowne(lista.length, 2, 'znaleziono oba obiekty obrazu');
rowne(lista[0].maska, 5, 'pierwszy w kolejności to obraz Z MASKĄ, nie sama maska');

console.log(bledy ? `\n${bledy} BŁĘDÓW` : '\nWszystkie testy wyłuskiwania obrazu z PDF przeszły.');
process.exit(bledy ? 1 : 0);
