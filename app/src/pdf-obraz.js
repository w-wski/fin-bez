/* pdf-obraz.js — wyłuskanie OBRAZU paragonu z PDF-a wygenerowanego przez aplikację sklepu.
 *
 * Dlaczego to w ogóle istnieje: sprawdziliśmy PDF-a z Biedronki i nie ma w nim ANI JEDNEGO
 * znaku tekstu — zero fontów, zero operatorów `Tj`/`TJ`, a treść to dwie bitmapy 1000×2460.
 * Czyli taki PDF niesie dokładnie tyle, co zdjęcie paragonu, i jedyna droga do jego treści
 * prowadzi przez rozpoznawanie tekstu. Zamiast dołączać bibliotekę do PDF-ów (ciężka,
 * a użyjemy z niej jednej rzeczy), wyciągamy sam obraz i oddajemy go tesseractowi, który
 * już w projekcie jest.
 *
 * Obsługujemy dokładnie to, co spotykamy w praktyce: `FlateDecode`, 8 bitów na składową,
 * DeviceRGB albo DeviceGray, bez maski i bez predyktora. Każdy inny wariant kończy się
 * JAWNYM błędem z nazwą filtra — cicha próba „może się uda" dałaby tesseractowi śmieci
 * i wyglądałaby jak zły OCR, a nie jak nieobsługiwany plik.
 *
 * Obraz wychodzi jako PNG, bo `zlib` już mamy, a PNG to (upraszczając) właśnie strumień
 * zdeflatowanych wierszy — ten sam, który dostajemy z PDF-a, tylko z bajtem filtra
 * na początku każdego wiersza.
 */

const zlib = require('zlib');

/* CRC32 — PNG wymaga sumy kontrolnej przy każdym bloku. Tablica liczona raz. */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function blok(typ, dane) {
  const naglowek = Buffer.alloc(8);
  naglowek.writeUInt32BE(dane.length, 0);
  naglowek.write(typ, 4, 'ascii');
  const suma = Buffer.alloc(4);
  suma.writeUInt32BE(crc32(Buffer.concat([naglowek.slice(4), dane])), 0);
  return Buffer.concat([naglowek, dane, suma]);
}

/** Surowe próbki (wiersz po wierszu, bez dopełnień) → PNG.
 *  `kanaly`: 1 = odcienie szarości, 3 = RGB. */
function png(w, h, kanaly, probki) {
  const naWiersz = w * kanaly;
  if (probki.length < naWiersz * h) {
    throw new Error(`obraz w PDF-ie jest krótszy, niż zapowiada (${probki.length} z ${naWiersz * h} bajtów)`);
  }
  // PNG trzyma przed każdym wierszem bajt „typ filtra"; 0 = brak filtra.
  const zFiltrem = Buffer.alloc((naWiersz + 1) * h);
  for (let y = 0; y < h; y++) {
    zFiltrem[y * (naWiersz + 1)] = 0;
    probki.copy(zFiltrem, y * (naWiersz + 1) + 1, y * naWiersz, (y + 1) * naWiersz);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;                               // bitów na składową
  ihdr[9] = kanaly === 1 ? 0 : 2;            // 0 = szarość, 2 = RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    blok('IHDR', ihdr),
    blok('IDAT', zlib.deflateSync(zFiltrem, { level: 6 })),
    blok('IEND', Buffer.alloc(0)),
  ]);
}

const liczba = (slownik, klucz) => {
  const m = slownik.match(new RegExp(`/${klucz}\\s+(\\d+)`));
  return m ? parseInt(m[1], 10) : null;
};
const nazwa = (slownik, klucz) => {
  const m = slownik.match(new RegExp(`/${klucz}\\s*/(\\w+)`));
  return m ? m[1] : null;
};

/** Wszystkie obrazy w PDF-ie, od największego, z numerem obiektu — numer jest potrzebny,
 *  bo obraz może wskazywać na MASKĘ PRZEZROCZYSTOŚCI (`/SMask 5 0 R`) jako osobny obiekt.
 *  Rozmiar liczymy w pikselach, nie w bajtach: paragon jest największym obrazem w pliku. */
function znajdzObrazy(pdf) {
  const tekst = pdf.toString('latin1');
  const out = [];
  const re = /(\d+)\s+0\s+obj([\s\S]{0,700}?)stream\r?\n/g;
  let m;
  while ((m = re.exec(tekst)) !== null) {
    const slownik = m[2];
    if (!/\/Subtype\s*\/Image/.test(slownik)) continue;
    const start = m.index + m[0].length;
    const koniec = tekst.indexOf('endstream', start);
    if (koniec < 0) continue;
    const w = liczba(slownik, 'Width'), h = liczba(slownik, 'Height');
    if (!w || !h) continue;
    const sm = slownik.match(/\/SMask\s+(\d+)\s+0\s+R/);
    out.push({
      obiekt: parseInt(m[1], 10),
      w, h, piksele: w * h,
      filtr: nazwa(slownik, 'Filter'),
      kolor: nazwa(slownik, 'ColorSpace'),
      bpc: liczba(slownik, 'BitsPerComponent'),
      maPredyktor: /\/Predictor\s+([2-9]|\d\d)/.test(slownik),
      maska: sm ? parseInt(sm[1], 10) : null,
      od: start, do: koniec,
    });
  }
  // Najpierw obrazy Z MASKĄ: to one są treścią. Obraz bez maski o tym samym rozmiarze
  // jest zwykle właśnie tą maską wpisaną jako osobny obiekt.
  return out.sort((a, b) => (b.maska ? 1 : 0) - (a.maska ? 1 : 0) || b.piksele - a.piksele);
}

/** Złożenie obrazu z maską przezroczystości NA BIAŁYM TLE, w odcieniach szarości.
 *  To nie ozdoba, to warunek czytelności: w PDF-ie z Biedronki warstwa barwna jest
 *  prawie cała czarna, a CAŁA treść paragonu siedzi w masce (22 kB koloru wobec 105 kB
 *  maski). Sam obraz RGB, wzięty bez maski, daje czarny prostokąt — tesseract nie ma
 *  na nim czego czytać, a wyglądałoby to na zły OCR, nie na zły odczyt pliku. */
function zloz(w, h, kanaly, probki, alfa) {
  const out = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * kanaly;
    // Luminancja BT.601 — dla obrazu jednokanałowego to po prostu jego wartość.
    const luma = kanaly === 1 ? probki[p]
      : Math.round(0.299 * probki[p] + 0.587 * probki[p + 1] + 0.114 * probki[p + 2]);
    const a = alfa ? alfa[i] / 255 : 1;
    out[i] = Math.round(255 + a * (luma - 255));      // krycie 0 = biel papieru
  }
  return out;
}

const KANALY = { DeviceGray: 1, CalGray: 1, DeviceRGB: 3, CalRGB: 3 };

/**
 * PDF → PNG z największym obrazem w środku.
 * @returns {{png: Buffer, w: number, h: number}}
 * @throws Error z czytelnym powodem, gdy PDF ma tekst zamiast obrazu albo obraz
 *         w wariancie, którego nie umiemy rozpakować.
 */
function obrazZPdf(pdf) {
  if (!Buffer.isBuffer(pdf)) throw new Error('oczekiwano zawartości pliku PDF');
  if (pdf.slice(0, 5).toString('latin1') !== '%PDF-') throw new Error('to nie jest plik PDF');
  const obrazy = znajdzObrazy(pdf);
  if (!obrazy.length) throw new Error('w tym PDF-ie nie ma obrazu — nie umiem z niego wyciągnąć paragonu');

  const powody = [];
  for (const o of obrazy) {
    const kanaly = KANALY[o.kolor];
    if (o.filtr !== 'FlateDecode') { powody.push(`filtr ${o.filtr || '?'}`); continue; }
    if (o.bpc !== 8) { powody.push(`${o.bpc || '?'} bitów na składową`); continue; }
    if (!kanaly) { powody.push(`przestrzeń barw ${o.kolor || '?'}`); continue; }
    if (o.maPredyktor) { powody.push('predyktor w strumieniu'); continue; }
    let surowe;
    try {
      surowe = zlib.inflateSync(pdf.slice(o.od, o.do));
    } catch (e) { powody.push('strumień nie daje się rozpakować'); continue; }

    let alfa = null;
    if (o.maska !== null) {
      const m = obrazy.find((x) => x.obiekt === o.maska);
      // Maska o innych wymiarach wymagałaby przepróbkowania — nie spotykamy tego,
      // więc zamiast zgadywać, składamy bez niej i mówimy o tym w wyniku.
      if (m && m.w === o.w && m.h === o.h && m.filtr === 'FlateDecode' && m.bpc === 8) {
        try { alfa = zlib.inflateSync(pdf.slice(m.od, m.do)); } catch { alfa = null; }
      }
    }
    const szare = zloz(o.w, o.h, kanaly, surowe, alfa);
    return { png: png(o.w, o.h, 1, szare), w: o.w, h: o.h, zMaska: !!alfa };
  }
  throw new Error('obrazu z tego PDF-a nie umiem rozpakować (' + [...new Set(powody)].join(', ') + ')');
}

module.exports = { obrazZPdf, png, crc32, znajdzObrazy };
