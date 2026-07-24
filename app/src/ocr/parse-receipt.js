// Parser tekstu OCR polskiego paragonu fiskalnego → nagłówek + pozycje.
// Heurystyki odporne na typowe zniekształcenia tesseracta (O/0, l/1, przecinki).
// CZYSTA funkcja — bez bazy, bez DOM (./pola i ../kwota też są czyste), testowana
// w scripts/test-receipt-parser.js.
//
// KAŻDE pole jest PROPOZYCJĄ do ręcznej poprawki (zlecenie Z4). Dlatego:
// - ocr_name zostaje na zawsze jako ślad audytowy (nigdy nie nadpisywany),
// - code startuje jako kopia odczytu i to ono jest edytowane przez człowieka,
// - progi zgodności liczb są wspólne z resztą aplikacji (./pola).
const { parseKwota } = require('../kwota');
const { isInconsistent, sumDiff, parseIlosc, czyData } = require('./pola');

// Kwota na paragonie: „4,99", „12.99", ale też „1 234,56" i „1.234,56" (grupy tysięcy).
// Bez grup tysięcy wzorzec `\d+[.,]\d{2}` czytał „1.234,56" jako 1,23 — pomyłka o trzy rzędy
// wielkości, która trafiała prosto do księgi. Odczytany napis zamienia na liczbę parseKwota.
const KWOTA = '\\d{1,3}(?:[ .]\\d{3})*[.,]\\d{2}';
// "1 x 4,99 4,99" / "2 szt. * 3,50 = 7,00" / "0.345 x 29,90 10,32"
const RE_QTY_PRICE = new RegExp(`(\\d+(?:[.,]\\d{1,3})?)\\s*(?:szt\\.?|x|\\*|×)\\s*(${KWOTA})\\s*[= ]?\\s*(${KWOTA})`, 'i');
const RE_TRAILING_VALUE = new RegExp(`(${KWOTA})\\s*[A-D]?\\s*$`);     // wartość + opc. litera VAT
const RE_TOTAL = new RegExp(`(SUMA|RAZEM|SUMA\\s*PLN|DO\\s*ZAP[ŁL]ATY)\\D*(${KWOTA})`, 'i');
const RE_DATE = /(\d{4})[-.\/](\d{2})[-.\/](\d{2})|(\d{2})[-.\/](\d{2})[-.\/](\d{4})/;
const RE_NIP = /NIP[:\s]*((?:\d[- ]?){10})(?!\d)/i; // formaty 3-3-2-2 i 3-2-2-3
const NOISE = /PARAGON|FISKALNY|NIEFISKALNY|PTU|VAT|SPRZED|OPODATK|ROZLICZENIE|GOTÓWKA|GOTOWKA|KARTA|RESZTA|KASA|KASJER|WYDRUK|^\s*[-=*#.]{3,}\s*$/i;

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
    const mT = l.match(RE_TOTAL); if (mT) out.total = parseKwota(mT[2]); // ostatnia SUMA wygrywa
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
      const poz = {
        line_no: ++lineNo, ocr_name: finalName.slice(0, 255), code: finalName.slice(0, 255),
        quantity: parseIlosc(m[1]), unit_price: parseKwota(m[2]), value: parseKwota(m[3]),
      };
      poz.low_confidence = isInconsistent(poz);                      // ilość×cena ≠ wartość
      out.items.push(poz);
      continue;
    }
    // fallback: "NAZWA ....... 12,99" — paragon nie podał ilości ani ceny jednostkowej.
    // Nie zgadujemy „1 szt." (to byłby fakt zmyślony przez maszynę) — pola zostają puste
    // do uzupełnienia ręcznego; pewna jest tylko wartość.
    const mV = l.match(RE_TRAILING_VALUE);
    if (mV) {
      const name = l.slice(0, l.lastIndexOf(mV[1])).replace(/[.…_*-]+\s*$/, '').trim();
      if (/\p{L}{3,}/u.test(name) && !NOISE.test(name)) {
        out.items.push({ line_no: ++lineNo, ocr_name: name.slice(0, 255), code: name.slice(0, 255),
          quantity: null, unit_price: null, value: parseKwota(mV[1]), low_confidence: false });
      }
    }
  }

  // sanity: suma pozycji vs SUMA paragonu (K7 — ostrzeżenie, nigdy blokada)
  const roznica = sumDiff(out.items, out.total);
  if (roznica !== null) {
    const s = out.items.reduce((a, b) => a + (b.value || 0), 0);
    out.warnings.push(`Suma pozycji (${s.toFixed(2)}) ≠ SUMA paragonu (${out.total.toFixed(2)}) — sprawdź pozycje.`);
  }
  if (!out.items.length) out.warnings.push('Nie rozpoznano żadnej pozycji — spróbuj lepszego kadru/kontrastu albo „popraw AI".');
  return out;
}

// Czy w zapisanym paragonie jest już praca CZŁOWIEKA? Odtwarzamy propozycję maszyny z zachowanego
// ocr_text i porównujemy ją ze stanem w bazie: wszystko, co się różni, wpisał (albo zatwierdził
// ze słownika) człowiek. Używa tego brama „Popraw AI" — ponowny odczyt kasuje pozycje, więc wolno
// mu ruszyć wyłącznie surowy odczyt maszyny, w którym nie ma czego stracić.
function sladyRecznejPracy(rc, items) {
  const p = parseReceipt((rc && rc.ocr_text) || '');
  const tekst = (v) => (v === null || v === undefined ? '' : String(v).trim());
  if (tekst(rc.shop_name) !== tekst(p.shop_name)) return true;
  // po stronie propozycji też przez czyData: parser bywa optymistą („2026-02-31"), a do bazy
  // trafia wtedy NULL — inaczej paragon z nieistniejącą datą wyglądałby na poprawiony ręcznie
  if (tekst(rc.receipt_date).slice(0, 10) !== (czyData(p.receipt_date) || '')) return true;
  if (parseKwota(rc.total) !== parseKwota(p.total)) return true;
  if (items.length !== p.items.length) return true;
  return items.some((it, i) => {
    const m = p.items[i];
    if (!it.ocr_name || tekst(it.ocr_name) !== tekst(m.ocr_name)) return true;   // dopisana ręcznie / inny odczyt
    if (tekst(it.code) !== tekst(it.ocr_name)) return true;                      // poprawiony kod
    if (it.name || it.unit || it.category_id) return true;                       // opis/jednostka/kategoria
    return parseIlosc(it.quantity) !== parseIlosc(m.quantity)
      || parseKwota(it.unit_price) !== parseKwota(m.unit_price)
      || parseKwota(it.value) !== parseKwota(m.value);
  });
}

module.exports = { parseReceipt, sladyRecznejPracy };
