// Parser tekstu OCR polskiego paragonu fiskalnego → nagłówek + pozycje.
// Heurystyki odporne na typowe zniekształcenia tesseracta (O/0, l/1, przecinki).
// Czysta funkcja — testowana w scripts/test-receipt-parser.js.

// "1 x 4,99 4,99" / "2 szt. * 3,50 = 7,00" / "0.345 x 29,90 10,32"
const RE_QTY_PRICE = /(\d+(?:[.,]\d{1,3})?)\s*(?:szt\.?|x|\*|×)\s*(\d+[.,]\d{2})\s*[= ]?\s*(\d+[.,]\d{2})/i;
const RE_TRAILING_VALUE = /(\d+[.,]\d{2})\s*[A-D]?\s*$/;     // wartość + opc. litera VAT
const RE_TOTAL = /(SUMA|RAZEM|SUMA\s*PLN|DO\s*ZAP[ŁL]ATY)\D*(\d+[.,]\d{2})/i;
const RE_DATE = /(\d{4})[-.\/](\d{2})[-.\/](\d{2})|(\d{2})[-.\/](\d{2})[-.\/](\d{4})/;
const RE_NIP = /NIP[:\s]*((?:\d[- ]?){10})(?!\d)/i; // formaty 3-3-2-2 i 3-2-2-3
const NOISE = /PARAGON|FISKALNY|NIEFISKALNY|PTU|VAT|SPRZED|OPODATK|ROZLICZENIE|GOTÓWKA|GOTOWKA|KARTA|RESZTA|KASA|KASJER|WYDRUK|^\s*[-=*#.]{3,}\s*$/i;

function num(s) { return parseFloat(String(s).replace(',', '.')); }

function parseReceipt(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { shop_name: null, receipt_date: null, total: null, nip: null, items: [], warnings: [] };

  // sklep: pierwsza sensowna linia (litery, nie same cyfry, przed linią z NIP/adresem)
  for (const l of lines.slice(0, 5)) {
    if (/\p{L}{3,}/u.test(l) && !RE_NIP.test(l) && !/PARAGON/i.test(l)) { out.shop_name = l.slice(0, 128); break; }
  }
  for (const l of lines) {
    const mN = l.match(RE_NIP); if (mN && !out.nip) { const d = mN[1].replace(/[- ]/g, ''); if (d.length === 10) out.nip = d; }
    const mD = l.match(RE_DATE);
    if (mD && !out.receipt_date) {
      out.receipt_date = mD[1] ? `${mD[1]}-${mD[2]}-${mD[3]}` : `${mD[6]}-${mD[5]}-${mD[4]}`;
    }
    const mT = l.match(RE_TOTAL); if (mT) out.total = num(mT[2]); // ostatnia SUMA wygrywa
  }

  // pozycje: między początkiem a linią SUMA
  const totalIdx = lines.findIndex((l) => RE_TOTAL.test(l));
  const body = totalIdx > 0 ? lines.slice(0, totalIdx) : lines;
  let lineNo = 0;
  for (let i = 0; i < body.length; i++) {
    const l = body[i];
    if (NOISE.test(l) || RE_NIP.test(l) || RE_DATE.test(l)) continue;
    let m = l.match(RE_QTY_PRICE);
    if (m) {
      const name = l.slice(0, l.indexOf(m[0])).replace(/[.…_-]+$/, '').trim();
      // nazwa bywa w linii wyżej (paragon łamie pozycję na 2 linie)
      const prev = !name && i > 0 && /\p{L}{3,}/u.test(body[i - 1]) && !body[i - 1].match(RE_TRAILING_VALUE)
        ? body[i - 1] : null;
      const finalName = (name || prev || '').trim();
      if (!finalName) continue;
      out.items.push({
        line_no: ++lineNo, ocr_name: finalName.slice(0, 255),
        quantity: num(m[1]), unit_price: num(m[2]), value: num(m[3]),
        low_confidence: Math.abs(num(m[1]) * num(m[2]) - num(m[3])) > 0.02, // ilość×cena ≠ wartość
      });
      continue;
    }
    // fallback: "NAZWA ....... 12,99" (bez ilości)
    const mV = l.match(RE_TRAILING_VALUE);
    if (mV) {
      const name = l.slice(0, l.lastIndexOf(mV[1])).replace(/[.…_*-]+\s*$/, '').trim();
      if (/\p{L}{3,}/u.test(name) && !NOISE.test(name)) {
        out.items.push({ line_no: ++lineNo, ocr_name: name.slice(0, 255),
          quantity: 1, unit_price: num(mV[1]), value: num(mV[1]), low_confidence: false });
      }
    }
  }

  // sanity: suma pozycji vs SUMA paragonu
  if (out.total !== null && out.items.length) {
    const s = out.items.reduce((a, b) => a + (b.value || 0), 0);
    if (Math.abs(s - out.total) > 0.05) {
      out.warnings.push(`Suma pozycji (${s.toFixed(2)}) ≠ SUMA paragonu (${out.total.toFixed(2)}) — sprawdź pozycje.`);
    }
  }
  if (!out.items.length) out.warnings.push('Nie rozpoznano żadnej pozycji — spróbuj lepszego kadru/kontrastu albo „popraw AI".');
  return out;
}

module.exports = { parseReceipt };
