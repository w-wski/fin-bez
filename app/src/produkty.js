/* produkty.js — CZYSTE reguły tożsamości produktu. Zero bazy, zero DOM, zero sieci.
 *
 * Odpowiedź na pytanie Szymona (2026-07-27): „czy produkty mają swoją tabelę". Mają
 * (migracja 012), ale sam schemat nie rozpoznaje niczego. Rozpoznawanie zaczyna się tutaj.
 *
 * Zadanie: z linii paragonu („Jog Naturalny 400g", „BorówkaAmeryk 300g", „KarmaPuff1250g")
 * wyciągnąć trzy rzeczy, których potrzebuje analiza zakupów:
 *
 *   1. KLUCZ ALIASU  — po czym poznajemy, że to znowu TEN SAM towar w TYM SAMYM sklepie.
 *   2. GRAMATURA     — żeby „400 g" i „1 kg" tego samego jogurtu dało się porównać po cenie
 *                      za kilogram, a nie po cenie za sztukę.
 *   3. RDZEŃ NAZWY   — nazwa bez liczb i skrótów, do podpowiadania scaleń między sklepami
 *                      („Jog Naturalny 400g" z Biedronki ≈ „JOGURT NAT. 400G" z Lidla).
 *
 * ZASADA NADRZĘDNA: ten moduł niczego nie SCALA. Liczy podobieństwo i układa kandydatów
 * w kolejności — decyzję „to jest ten sam produkt" podejmuje człowiek. Automatyczne
 * scalanie po podobieństwie nazw zlepiłoby „Mleko 3,2%" z „Mleko 0,5%" i zafałszowało
 * historię cen w sposób, którego potem nie da się odkręcić bez ręcznego przeglądu.
 * (Szymon jeszcze nie rozstrzygnął tego pytania — do czasu decyzji obowiązuje wariant
 * ostrożny: propozycja, nigdy fakt.)
 */

const { normCode } = require('./ocr/pola');

// Sieci rozpoznawane po SŁOWIE KLUCZOWYM w nagłówku paragonu. Nagłówek bywa długi
// („BIEDRONKA \"CODZIENNIE NISKIE CENY\" 3135”) i różny sklep w sklep — numer placówki
// nie może rozbijać jednej sieci na kilkanaście osobnych „sklepów”, bo wtedy każdy alias
// uczy się od zera. Lista rośnie w miarę wgrywania paragonów; nieznana sieć nie jest
// błędem — dostaje klucz ze swojej własnej nazwy.
const SIECI = [
  'BIEDRONKA', 'LIDL', 'KAUFLAND', 'AUCHAN', 'CARREFOUR', 'NETTO', 'ALDI', 'DINO',
  'STOKROTKA', 'ZABKA', 'FRESHMARKET', 'INTERMARCHE', 'POLOMARKET', 'SPOLEM', 'DELIKATESY CENTRUM',
  'ROSSMANN', 'HEBE', 'SUPERPHARM', 'DROGERIA NATURA',
  'LEROY MERLIN', 'CASTORAMA', 'OBI', 'JYSK', 'IKEA', 'DECATHLON', 'MEDIA EXPERT', 'MEDIAMARKT',
  'EMPIK', 'PEPCO', 'ACTION', 'KIK', 'SMYK',
  'ORLEN', 'BP', 'SHELL', 'CIRCLE K', 'MOYA', 'AMIC', 'LOTOS',
];

/** Nagłówek paragonu → klucz sklepu (kolumna `product_aliases.shop`, VARCHAR(64)).
 *  Nierozpoznana sieć: dwa pierwsze słowa nazwy, bo trzecim bywa już adres. */
function normSklep(nazwa) {
  const s = normCode(nazwa);
  if (!s) return '*';                                   // brak nazwy = alias globalny
  const bezOzdob = s.replace(/["'„”»«]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const siec of SIECI) if (bezOzdob.includes(siec)) return siec;
  return bezOzdob.replace(/[^A-Z0-9 .-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2)
    .join(' ').slice(0, 64) || '*';
}

// Jednostki bazowe: masa w kg, objętość w l, reszta w sztukach. Przelicznik NA jednostkę bazową.
const JEDNOSTKI = {
  MG: [1e-6, 'kg'], G: [0.001, 'kg'], DAG: [0.01, 'kg'], DKG: [0.01, 'kg'], KG: [1, 'kg'],
  ML: [0.001, 'l'], CL: [0.01, 'l'], DL: [0.1, 'l'], L: [1, 'l'],
  SZT: [1, 'szt'], SZTUK: [1, 'szt'], OP: [1, 'szt'], OPAK: [1, 'szt'],
};
// „2X400G”, „400 G”, „1,5L”, „1250g” — liczba, opcjonalna krotność, jednostka tuż obok.
const GRAMATURA = /(?:(\d+)\s*[X*]\s*)?(\d+(?:[.,]\d+)?)\s*(MG|DKG|DAG|KG|G|ML|CL|DL|L|SZTUK|SZT|OPAK|OP)\b/g;

/** Gramatura z nazwy → { wartosc, jednostka } w jednostce bazowej, albo null.
 *  Bierzemy OSTATNIE wystąpienie: w „Jog Naturalny 2% 400g” pierwsze to zawartość tłuszczu
 *  (bez jednostki, więc i tak odpada), ale w „Chleb 500g x2 1kg” ostatnie jest tym właściwym. */
function gramatura(nazwa) {
  const s = normCode(nazwa);
  if (!s) return null;
  // Przyklejona jednostka („1250g”) wymaga granicy PRZED liczbą, żeby „B 2x 6,49” nie udawało
  // gramatury — dlatego wzorzec czyta z odstępem, a odstęp wstawiamy sami tam, gdzie go brak.
  const zOdstepem = s.replace(/(\d)(MG|DKG|DAG|KG|G|ML|CL|DL|L|SZTUK|SZT|OPAK|OP)\b/g, '$1 $2');
  let m, ostatnie = null;
  GRAMATURA.lastIndex = 0;
  while ((m = GRAMATURA.exec(zOdstepem)) !== null) ostatnie = m;
  if (!ostatnie) return null;
  const [, krotnosc, liczba, jedn] = ostatnie;
  const [mnoznik, baza] = JEDNOSTKI[jedn];
  const wartosc = Number(liczba.replace(',', '.')) * (krotnosc ? Number(krotnosc) : 1) * mnoznik;
  if (!Number.isFinite(wartosc) || wartosc <= 0) return null;
  return { wartosc: Math.round(wartosc * 1000) / 1000, jednostka: baza };
}

// Skróty kasowe → pełne słowa. Kasa fiskalna ma ~20 znaków na nazwę, więc każdy sklep
// skraca inaczej; bez rozwinięcia „Jog” i „JOGURT” to dla porównywarki dwa różne słowa.
const ROZWINIECIA = {
  JOG: 'JOGURT', JOGURT: 'JOGURT', NAT: 'NATURALNY', NATUR: 'NATURALNY',
  CZEK: 'CZEKOLADA', CZEKOL: 'CZEKOLADA', MLE: 'MLEKO', MLEK: 'MLEKO',
  SER: 'SER', SEREK: 'SEREK', MAS: 'MASLO', MASL: 'MASLO',
  WOD: 'WODA', SOK: 'SOK', NAP: 'NAPOJ', PIECZ: 'PIECZYWO', CHL: 'CHLEB',
  WINOGR: 'WINOGRONA', BOROWKA: 'BOROWKA', AMERYK: 'AMERYKANSKA',
  POM: 'POMIDOR', ZIEM: 'ZIEMNIAKI', MARCH: 'MARCHEW', CEB: 'CEBULA',
  PAP: 'PAPIER', TOAL: 'TOALETOWY', PROSZ: 'PROSZEK', PLYN: 'PLYN',
};
// Słowa, które nic nie mówią o tożsamości towaru — wypadają przed porównaniem.
const SZUM = new Set(['LUZ', 'SZT', 'OPAK', 'PROMO', 'PROMOCJA', 'NOWOSC', 'BIO', 'X', 'PLN', 'ZL']);

/** Nazwa z paragonu → lista słów-rdzeni: bez liczb, bez gramatury, ze skrótami rozwiniętymi.
 *  To materiał do PORÓWNYWANIA, nigdy do pokazania człowiekowi. */
function rdzen(nazwa) {
  // Rozklejenie PRZED normalizacją: „BorówkaAmeryk” to dwa słowa i widać to wyłącznie po
  // wielkiej literze w środku — normCode podnosi wszystko do wielkich i granica przepada.
  const rozklejone = String(nazwa === null || nazwa === undefined ? '' : nazwa)
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2');
  const s = normCode(rozklejone);
  if (!s) return [];
  return s
    .replace(/(\d)(MG|DKG|DAG|KG|G|ML|CL|DL|L|SZTUK|SZT|OPAK|OP)\b/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\b/g, ' ')
    .split(/\s+/)
    .map((w) => ROZWINIECIA[w] || w)
    .filter((w) => w.length >= 2 && !SZUM.has(w));
}

/** Nazwa dla człowieka z surowej linii paragonu: „Jog Naturalny 400g” zostaje jak jest,
 *  tylko przycięte odstępy. Nie „poprawiamy” pisowni — to ślad tego, co było na papierze. */
const nazwaCzytelna = (s) => String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 160);

/** Współczynnik Dice’a na parach liter: 1 = te same słowa, 0 = nic wspólnego.
 *  Odporny na literówki OCR („MASLO” vs „MASL0”), inaczej niż porównanie znak po znaku. */
function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pary = (s) => { const t = []; for (let i = 0; i < s.length - 1; i++) t.push(s.slice(i, i + 2)); return t; };
  const A = pary(a);
  const B = pary(b);
  const licznik = new Map();
  for (const p of A) licznik.set(p, (licznik.get(p) || 0) + 1);
  let wspolne = 0;
  for (const p of B) if (licznik.get(p) > 0) { licznik.set(p, licznik.get(p) - 1); wspolne++; }
  return (2 * wspolne) / (A.length + B.length);
}

/** Podobieństwo dwóch nazw towaru: 0…1.
 *
 *  Liczy się z dwóch części, bo obie potrafią samodzielnie skłamać:
 *   – SŁOWA: każde słowo pierwszej nazwy szuka najlepszego odpowiednika w drugiej,
 *     wynik to średnia (a nie „ile słów identycznych”, bo skróty rzadko są identyczne);
 *   – GRAMATURA: zgodna podbija, JAWNIE RÓŻNA obcina wynik o połowę. „Mleko 1 l” i
 *     „Mleko 0,5 l” to dla analizy cen dwa różne produkty, choć nazwy niemal te same.
 *     Brak gramatury po którejś stronie niczego nie zmienia — nie karzemy za brak danych.
 */
function podobienstwo(a, b) {
  const ra = rdzen(a);
  const rb = rdzen(b);
  if (!ra.length || !rb.length) return 0;
  const [krotsza, dluzsza] = ra.length <= rb.length ? [ra, rb] : [rb, ra];
  const suma = krotsza.reduce((acc, w) => acc + Math.max(...dluzsza.map((x) => dice(w, x))), 0);
  // Kara za słowa, których druga nazwa w ogóle nie ma („mleko” vs „mleko bez laktozy”).
  let wynik = (suma / krotsza.length) * (krotsza.length / dluzsza.length) ** 0.5;
  const ga = gramatura(a);
  const gb = gramatura(b);
  if (ga && gb) {
    const zgodna = ga.jednostka === gb.jednostka && Math.abs(ga.wartosc - gb.wartosc) < 1e-6;
    wynik = zgodna ? Math.min(1, wynik * 1.15) : wynik * 0.5;
  }
  return Math.round(wynik * 1000) / 1000;
}

const PROG = 0.62;      // niżej zaczynają się przypadkowe zbieżności („SOK” ≈ „SOS”)

/** Kandydaci do scalenia, od najlepszego. `lista` to obiekty z polem `name` (produkty z bazy).
 *  Zwraca `{ ...produkt, wynik }` — bez progu nie zwracamy niczego, żeby UI nie musiało
 *  filtrować i żeby próg był JEDEN, wspólny dla wszystkich wołających. */
function kandydaci(nazwa, lista, { prog = PROG, ile = 5 } = {}) {
  return (lista || [])
    .map((p) => ({ ...p, wynik: podobienstwo(nazwa, p.name) }))
    .filter((p) => p.wynik >= prog)
    .sort((x, y) => y.wynik - x.wynik || String(x.name).localeCompare(String(y.name), 'pl'))
    .slice(0, ile);
}

/** Klucz aliasu: para (sklep, znormalizowany kod), dokładnie taka, jaką trzyma UNIQUE
 *  w `product_aliases`. Kod krótszy niż 2 znaki nie jest kluczem — „A” pasowałoby do wszystkiego. */
function kluczAliasu(sklep, kod) {
  const code = normCode(kod);
  if (!code || code.length < 2) return null;
  return { shop: normSklep(sklep), code_norm: code };
}

module.exports = { normSklep, gramatura, rdzen, nazwaCzytelna, dice, podobienstwo, kandydaci, kluczAliasu, PROG, SIECI };
