/* eparagon.js — czytanie e-PARAGONU z pliku .json.
 *
 * To NIE jest format Biedronki. To `JPK_KASA_PARAGON_v2-0` — państwowy standard e-Paragonu
 * (Ministerstwo Finansów), więc ten sam parser obsłuży każdy sklep, który wydaje e-paragony,
 * nie tylko Jeronimo Martins. Dlatego moduł nazywa się `eparagon`, a nie `biedronka`.
 *
 * Budowa pliku: koperta JSON, w niej pole `data` = token JWS (RS256, `x5c` z certyfikatem
 * sprzedawcy). Środkowy segment tokenu to WŁAŚCIWY dokument fiskalny. Ta sama treść jest
 * w kopercie powtórzona jeszcze raz, w polu `body`, w formie do wydruku (sellLine /
 * discountLine / vatSummary). Czytamy TOKEN, bo to on jest podpisany — `body` to widok.
 *
 * Trzy pułapki, na które ten kod odpowiada wprost:
 *
 * 1. KWOTY SĄ CAŁKOWITE, W GROSZACH (`brutto: 2275` = 22,75 zł). Nigdy nie przepuszczamy
 *    ich przez `parseFloat` — grosz zgubiony na paragonie wraca jako niezgodność
 *    z wyciągiem bankowym.
 * 2. ILOŚĆ JEST NAPISEM Z PRZECINKIEM (`"1,980"` = 1,98 kg). `Number("1,980")` to NaN.
 * 3. RABAT MA DWIE REPREZENTACJE: `pozycja.towar.brutto` jest już PO rabacie liniowym,
 *    a `body.sellLine.total` jest PRZED nim. Mieszanie tych dwóch źródeł daje sumę
 *    niezgodną z paragonem — bierzemy wyłącznie wersję z tokenu.
 *
 * Poza rabatami liniowymi bywają RABATY GLOBALNE (u nas: dwa vouchery), które nie należą
 * do żadnej pozycji. Suma pozycji minus rabaty globalne musi dać `podsum.sumaBrutto` —
 * i to jest sprawdzane, nie założone.
 */

const ZNAKI_JEDN = /\s+(luz|kg)\s*$/i;

/** base64url → tekst. Token JWS używa alfabetu URL i nie ma dopełnienia „=". */
const b64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

/** Ilość: napis z PRZECINKIEM dziesiętnym. Zwraca liczbę albo null (nie 0 —
 *  brak ilości i ilość zerowa to dwie różne rzeczy). */
function ilosc(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** Grosze → liczba całkowita. Odrzuca wszystko, co nie jest liczbą całkowitą,
 *  żeby błąd formatu nie zamienił się cicho w NaN w księdze. */
function grosze(v) {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  return null;
}

/** Czy koperta wygląda na e-paragon JPK. Sprawdzamy przed próbą dekodowania,
 *  żeby użytkownik dostał „to nie e-paragon", a nie wyjątek z base64. */
function czyEParagon(obj) {
  return !!(obj && typeof obj === 'object' && typeof obj.data === 'string' && obj.data.split('.').length === 3);
}

/** Nazwa z kasy fiskalnej: dopełniona spacjami i zakończona literą stawki VAT
 *  („Czereśnie Luz            C"). Zwracamy oczyszczony kod i wykrytą jednostkę. */
function nazwaIJednostka(nazwa, vatId, il) {
  let s = String(nazwa || '').replace(/\s+/g, ' ').trim();
  // Litera stawki na końcu to nie część nazwy towaru — to kolumna PTU z wydruku.
  if (vatId && s.toUpperCase().endsWith(` ${String(vatId).toUpperCase()}`)) s = s.slice(0, -2).trim();
  // „Luz" znaczy towar na wagę. Poza tym: ilość ułamkowa = waga, całkowita = sztuki.
  const luz = ZNAKI_JEDN.test(s);
  const jedn = luz || (il !== null && !Number.isInteger(il)) ? 'kg' : 'szt.';
  return { kod: s, jednostka: jedn };
}

/**
 * Koperta e-paragonu → nasz kształt paragonu.
 * Rzuca `Error` z czytelnym powodem, jeśli plik nie jest e-paragonem albo się nie sumuje:
 * paragon, który się nie zgadza, NIE MOŻE wejść do księgi po cichu.
 */
function czytaj(obj) {
  if (!czyEParagon(obj)) throw new Error('to nie jest e-paragon JPK (brak podpisanego pola „data")');
  let dok;
  try {
    dok = JSON.parse(b64url(obj.data.split('.')[1])).dokument;
  } catch (e) {
    throw new Error('nie udało się odczytać dokumentu z tokenu e-paragonu: ' + e.message);
  }
  if (!dok || !dok.paragon) throw new Error('token e-paragonu nie zawiera paragonu');
  const wersja = dok.naglowek && dok.naglowek.wersja;
  const p = dok.paragon;
  const pod = dok.podmiot1 || {};

  const pozycje = [];
  const rabatyGlobalne = [];
  for (const w of p.pozycja || []) {
    if (w.towar) {
      const t = w.towar;
      const il = ilosc(t.ilosc);
      const { kod, jednostka } = nazwaIJednostka(t.nazwa, t.idStPTU, il);
      const rabat = t.rabat ? grosze(t.rabat.wart) : 0;
      pozycje.push({
        kod,
        nazwaSurowa: String(t.nazwa || ''),
        ilosc: il,
        jednostka,
        cenaJedn: grosze(t.cena),          // cena katalogowa za jednostkę, w groszach
        wartosc: grosze(t.brutto),         // ZAPŁACONE za pozycję, PO rabacie liniowym
        rabat: rabat === null ? 0 : rabat, // ujemny albo 0
        vat: t.idStPTU || null,
        storno: !!t.oper,
      });
    } else if (w.rabat) {
      rabatyGlobalne.push({ nazwa: String(w.rabat.nazwa || 'rabat'), wartosc: grosze(w.rabat.wart) || 0 });
    }
  }

  const podsum = p.podsum || {};
  const total = grosze(podsum.sumaBrutto);
  if (total === null) throw new Error('e-paragon bez sumy brutto');

  // BRAMKA: suma pozycji minus rabaty globalne musi dać sumę z paragonu. Bez tego
  // literówka w formacie albo nasz błąd w rozumieniu rabatów wchodzi do ksiąg jako fakt.
  const sumaPozycji = pozycje.reduce((a, x) => a + (x.wartosc || 0), 0);
  const sumaRabatow = rabatyGlobalne.reduce((a, x) => a + x.wartosc, 0);
  const wyliczone = sumaPozycji + sumaRabatow;      // rabaty są ujemne
  if (wyliczone !== total) {
    throw new Error(`e-paragon się nie sumuje: pozycje ${sumaPozycji} + rabaty ${sumaRabatow} `
      + `= ${wyliczone}, a paragon mówi ${total} (w groszach)`);
  }

  const zaplata = (p.platnosc || []).filter((x) => !x.reszta)
    .map((x) => ({ nazwa: String(x.nazwa || x.forma || ''), wartosc: grosze(x.wart) || 0 }));

  return {
    format: 'jpk', wersja: wersja || null,
    sklep: sklepZNazwy(obj, pod),
    nip: pod.NIP || null,
    adres: adres(pod.adresPod),
    data: (p.zakSprzed || (dok.naglowek && dok.naglowek.dataJPK) || '').slice(0, 10) || null,
    czas: p.zakSprzed || null,
    waluta: podsum.waluta || 'PLN',
    total, opusty: grosze(podsum.sumaOpust) || 0, podatek: grosze(podsum.sumaPod) || 0,
    vat: (podsum.sumaNetto || []).map((v) => ({ stawka: v.idStPTU, brutto: grosze(v.brutto), vat: grosze(v.vat) })),
    stawki: (p.stPTU || []).map((s) => ({ id: s.id, wart: s.wart })),
    zaplata,
    // Klucz przeciw duplikatom: numer unikatowy kasy + identyfikator dokumentu w JPK.
    // Ta para jest globalnie jednoznaczna, więc ten sam plik wgrany dwa razy nie zrobi
    // dwóch paragonów — i nie musimy do tego zgadywać z sumy i daty, jak przy OCR.
    klucz: [pod.nrUnik || '?', p.JPKID || '?', p.nrDok || '?'].join('|'),
    kasa: p.nrKasy || null, kasjer: p.kasjer || null, nrParagonu: p.nrParag || null,
    pozycje, rabatyGlobalne,
  };
}

/** Nazwa sklepu: w tokenie jest tylko spółka („JERONIMO MARTINS POLSKA S.A."), a marka
 *  siedzi w nagłówku do wydruku („BIEDRONKA ... 3135"). Wolimy markę — to ona mówi
 *  człowiekowi, gdzie był, i po niej będziemy grupować ceny między sklepami. */
function sklepZNazwy(obj, pod) {
  for (const h of obj.header || []) {
    const t = h.headerText && h.headerText.headerTextLines;
    if (!t) continue;
    const czysty = String(t).replace(/<[^>]*>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"');
    const linia = czysty.split('\n').map((x) => x.trim()).filter(Boolean)[0];
    if (linia) return linia.slice(0, 128);
  }
  return pod.nazwaPod ? String(pod.nazwaPod).slice(0, 128) : null;
}

const adres = (a) => (a ? [a.ulica, `${a.kodPoczt || ''} ${a.miejsc || ''}`.trim()].filter(Boolean).join(', ') : null);

module.exports = { czyEParagon, czytaj, ilosc, grosze, nazwaIJednostka };
