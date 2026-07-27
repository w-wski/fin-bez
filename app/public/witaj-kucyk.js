/* witaj-kucyk.js — kucyk-jednorożec w PIXEL ART (Szymon 07-27: „konwencja pixel style
 * jak w referencji"). Rysowany na tym samym canvasie i tej samej siatce pikseli co napis,
 * więc plansza jest jednym spójnym obrazem, a nie SVG-iem obok cząstek.
 * Poprzedni wariant był wektorowy (SVG, wariant A „bajkowy" z docs/design/kucyki/) —
 * zastąpiony 07-27, bo referencja Bartusia jest jednoznacznie pikselowa.
 *
 * Dwie decyzje, które robią tu całą robotę:
 *
 * 1. MAPY TRZYMAJĄ TYLKO SYLWETKĘ — czarny kontur dokłada `obrysuj()` przez dylatację
 *    (piksel pusty, który dotyka wypełnionego, staje się czarny). Ręczne wpisywanie
 *    konturu w mapę to setki znaków, w których łatwo o dziurę; tak kontur jest wszędzie
 *    równy 1 px, jak w referencji. Linie WEWNĘTRZNE (oko, uśmiech) wpisuje się w mapę
 *    wprost — dylatacja ich nie zgadnie.
 *
 * 2. TĘCZA IDZIE PASMAMI PO RZĘDACH, nie per piksel: grzywa, ogon i róg to w mapie
 *    jeden znak (`M`/`T`/`G`), a barwę wybiera numer rzędu. Dzięki temu sylwetkę da się
 *    rysować i poprawiać, a pasma zawsze wychodzą proste i równoległe.
 *
 * Ruch jest KLATKOWY, nie ciągły: pixel art nie znosi obrotów ani skalowania
 * podpikselowego, więc chód to dwie klatki nóg, podniesienie ogona to trzy pozy ogona,
 * a obrót do widza to cięcie na osobną mapę. Zero transformów CSS.
 */

const PALETA = {
  K: '#141018',        // kontur — czerń z nutą fioletu, jak w referencji
  W: '#f7f5fb',        // sierść
  S: '#c3ccde',        // cień sierści (siwy błękit)
  H: '#3b4a7a',        // kopyto
  P: '#f49ec1',        // róż: chrapy, policzki
  o: '#141018',        // oko — ten sam ton co kontur, osobny znak dla czytelności mapy
  x: '#ffffff',        // iskra w grzywie
};
export const TECZA = ['#f5453f', '#fb8b28', '#ffd633', '#57c93f', '#2fc0d8', '#2f6fe0', '#8c46d6'];
const PASMO = 2;       // ile rzędów pikseli ma jedno pasmo tęczy

/* ------------------------------------------------------------------ sylwetki */
/* Kucyk z profilu, PYSKIEM W PRAWO. Wchodzi z lewej i wychodzi w prawo, więc ta sama
   mapa obsługuje oba przebiegi — nic nie trzeba odbijać. */
const KORPUS = [
  '..........................G',
  '.........................GG',
  '.............MM..........GG',
  '............MMMM........GGG',
  '...........MMMMMM.W....GGG',
  '..........MMMMMMM.WWW.GGG',
  '.........MMMMMMMMWWWWWWWWWW',
  '.........MMMMMMMMWWWWWWWWWWWW',
  '........MMMMMMMMMWWWWWWWWWWWWW',
  '........MMMMMMMMMWWWWWWWooWWWWW',
  '.......MMMMMMMMMMWWWWWWWooWWWWW',
  '.......MMMMMMMMMMWWWWWWWWWWWWWWWWWW',
  '.......MMMMMMMMMMWWWWWWWWWWWWWWWWPP',
  '......MMMMMMMMMMMWWWWWWWWWWWWWWWPP',
  '......MMMMMMMMMMMWWWWWWWWWWWWWW',
  '......MMMMMMMMMMWWWWWWWWWWWW',
  '...WWWMMMMMMMMMWWWWWWWWWW',
  '.WWWWWWWMMMMMMWWWWWWWWWW',
  'WWWWWWWWWMMMMWWWWWWWWWWW',
  'WWWWWWWWWWWWWWWWWWWWWWWW',
  'WWWWWWWWWWWWWWWWWWWWWWWW',
  'WWWWWWWWWWWWWWWWWWWWWWWW',
  'WWWWWWWWWWWWWWWWWWWWWWWW',
  '.WWWWWWWWWWWWWWWWWWWWWWW',
  '.WWWWWWWWWWWWWWWWWWWWWW',
  '.SWWWWWWWWWWWWWWWWWWWWS',
  '..SSWWWWWWWWWWWWWWWWSS',
];

/* Ogon: trzy pozy, bo obrót pixel artu wygląda jak błąd. Nasada każdej mapy siada
   WEWNĄTRZ zadu i chowa się pod korpusem (ogon malowany PRZED nim) — dzięki temu ogon
   nie może się oderwać od kucyka niezależnie od pozy. */
const OGON_DOL = [
  '.....TTTTTTT',
  '...TTTTTTTTTT',
  '..TTTTTTTTTTT',
  '.TTTTTxTTTTT',
  '.TTTTTTTTTT',
  'TTTTTTTTT',
  'TTTTTTTT',
  '.TTTTTT',
  '.TTTTT',
  '..TTT',
  '..TT',
];
const OGON_SROD = [
  '.....TTTTTT',
  '..TTTTTTTTTTT',
  '.TTTTxTTTTTTTT',
  'TTTTTTTTTTTTTT',
  '.TTTTTTTTTTTTT',
  '..TTTTTTTTTTT',
  '.....TTTTTTT',
];
const OGON_GORA = [
  '..TT',
  '.TTTT',
  '.TTTTT',
  'TTTTTTT',
  'TTTTTxTTT',
  '.TTTTTTTTTT',
  '..TTTTTTTTTTT',
  '...TTTTTTTTTTTT',
  '....TTTTTTTTTTTT',
  '.....TTTTTTTTTTT',
  '.......TTTTTTTTT',
];

/* Nogi jako osobna warstwa POD korpusem: dwie klatki chodu i jedna postawa stojąca. */
const NOGI_STOI = [
  '...WWW..........WWW',
  '...WWW..........WWW',
  '...WWW..........WWW',
  '...SWW..........SWW',
  '...SWW..........SWW',
  '...HHH..........HHH',
];
const NOGI_A = [
  '..WWW...........WWW',
  '..WWW...........WWW',
  '.WWW.............WWW',
  '.WWW.............WWW',
  'WWWW.............WWWW',
  'HHHH.............HHHH',
];
const NOGI_B = [
  '....WWW........WWW',
  '....WWW........WWW',
  '....WWWW......WWWW',
  '.....WWW.......WWW',
  '.....WWW.......WWW',
  '.....HHH.......HHH',
];

/* Poza „przód": kucyk obrócony do widza, z uśmiechem. */
const PRZOD = [
  '..............G',
  '.............GG',
  '.............GG',
  '......MM....GG...MM',
  '.....MMMM..GG...MMMM',
  '....MMMMMWWWWWWWMMMMM',
  '....MMMMWWWWWWWWWMMMM',
  '...MMMMWWWWWWWWWWWMMMM',
  '...MMMMWWWWWWWWWWWMMMM',
  '...MMMWWooWWWWWooWWMMM',
  '...MMMWWooWWWWWooWWMMM',
  '...MMMWWWWWWWWWWWWWMMM',
  '....MMWWPWWWWWWWPWWMM',
  '....MMWWWKWWWKWWWWMM',
  '.....MWWWWKKKWWWWWM',
  '......WWWWWWWWWWWW',
  '.......WWWWWWWWWW',
  '......WWWWWWWWWWWW',
  '.....WWWWWWWWWWWWWW',
  '.....WWWWWWWWWWWWWW',
  '.....WWWWWWWWWWWWWW',
  '.....SWWWWWWWWWWWWS',
  '.....WWWW....WWWW',
  '.....WWWW....WWWW',
  '.....WWWW....WWWW',
  '.....HHHH....HHHH',
];

/* Kotwice warstw w pikselach siatki KORPUSU (kolumna, rząd mapy — nie konturu). */
const KOTWICE = {
  ogonDol: [-9, 17], ogonSrod: [-10, 16], ogonGora: [-12, 11], nogi: [1, 26],
};

/* ----------------------------------------------------------- rasteryzacja */

/** Mapa (tablica napisów o RÓŻNEJ długości) → siatka o równej szerokości.
 *  Rzędów nie trzeba dopełniać kropkami na końcu — to jedyny powód, dla którego
 *  te mapy da się edytować bez liczenia znaków. */
function siatka(mapa) {
  const w = Math.max(...mapa.map((r) => r.length));
  return { w, h: mapa.length, r: mapa.map((r) => r.padEnd(w, '.')) };
}

/** Barwa piksela. `M`/`T`/`G` biorą kolor z pasma tęczy wyznaczonego przez RZĄD,
 *  z przesunięciem per warstwa, żeby ogon nie był kopią grzywy. */
function barwa(znak, rzad, przes) {
  if (znak === 'M' || znak === 'T' || znak === 'G') {
    return TECZA[(Math.floor(rzad / PASMO) + przes) % TECZA.length];
  }
  return PALETA[znak] || null;
}

/** Kontur przez dylatację: pusty piksel dotykający wypełnionego (8 sąsiadów) staje się
 *  czarny. Zwraca NOWĄ siatkę, o 1 piksel większą z każdej strony. */
function obrysuj(s) {
  const w = s.w + 2, h = s.h + 2;
  const r = [];
  for (let y = 0; y < h; y++) {
    let linia = '';
    for (let x = 0; x < w; x++) {
      const z = (s.r[y - 1] || '')[x - 1] || '.';
      if (z !== '.') { linia += z; continue; }
      let sasiad = false;
      for (let dy = -1; dy <= 1 && !sasiad; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const c = (s.r[y - 1 + dy] || '')[x - 1 + dx];
          if (c && c !== '.') { sasiad = true; break; }
        }
      }
      linia += sasiad ? 'K' : '.';
    }
    r.push(linia);
  }
  return { w, h, r };
}

/** Siatka → lista poziomych ODCINKÓW jednej barwy. Bez scalania jedna klatka to ~700
 *  wywołań fillRect; ze scalaniem — kilkadziesiąt. Liczone RAZ, przy pierwszym użyciu. */
function odcinki(mapa, przes) {
  const s = obrysuj(siatka(mapa));
  const out = [];
  for (let y = 0; y < s.h; y++) {
    let x = 0;
    while (x < s.w) {
      const c = barwa(s.r[y][x], y, przes);
      if (!c) { x++; continue; }
      let n = 1;
      while (x + n < s.w && barwa(s.r[y][x + n], y, przes) === c) n++;
      out.push([x, y, n, c]);
      x += n;
    }
  }
  return { w: s.w, h: s.h, seg: out };
}

const pamiec = new Map();
function warstwa(nazwa, mapa, przes) {
  if (!pamiec.has(nazwa)) pamiec.set(nazwa, odcinki(mapa, przes));
  return pamiec.get(nazwa);
}

/** Wymiary całej figury w pikselach siatki — plansza liczy z nich drogę wbiegu
 *  i wybiegu tak, żeby kucyk NAPRAWDĘ zszedł za krawędź kadru. */
export function rozmiar() {
  const k = warstwa('korpus', KORPUS, 0);
  const p = warstwa('przod', PRZOD, 0);
  const g = warstwa('ogonGora', OGON_GORA, 3);
  // Lewa krawędź figury to nasada ogona w pozie „w górę", nie korpus — od niej zależy
  // droga wybiegu, więc licz ją, nie zgaduj.
  const lewo = Math.min(0, KOTWICE.ogonGora[0] - 1);
  return {
    lewo, w: k.w - lewo, wKorpus: k.w, h: KOTWICE.nogi[1] + NOGI_STOI.length + 2,
    // Punkty odniesienia do złożenia obu póz: DÓŁ (linia ziemi) i ŚRODEK figury,
    // w pikselach mapy. Bez nich kucyk po obrocie do widza podskakuje i ucieka w bok.
    bokDol: KOTWICE.nogi[1] + NOGI_STOI.length,
    bokSrodek: Math.round((k.w - 2) / 2),
    przodDol: PRZOD.length,
    przodSrodek: Math.round((p.w - 2) / 2),
    wPrzod: p.w, hPrzod: p.h, wOgon: g.w,
  };
}

/** Maluje warstwę tak, żeby piksel (0,0) JEJ MAPY wylądował na (kol, rzad) siatki
 *  korpusu. Siatka z konturem jest o 1 px większa z każdej strony — stąd przesunięcie
 *  o -1; bez niego kotwice kłamały o jeden piksel i ogon odklejał się od zadu. */
function maluj(ctx, w, kol, rzad, ox, oy, S) {
  const bx = ox + (kol - 1) * S, by = oy + (rzad - 1) * S;
  for (const [x, y, n, c] of w.seg) {
    ctx.fillStyle = c;
    ctx.fillRect(bx + x * S, by + y * S, n * S, S);
  }
}

/**
 * Rysuje kucyka. `ox`/`oy` to lewy-górny piksel figury w pikselach EKRANU, `S` to bok
 * jednego piksela siatki.
 * @param {object} p { poza:'bok'|'przod', ogon:0..1, krok:number|null }
 *   `ogon`: 0 opuszczony, ~0,5 w połowie, 1 podniesiony — PROGI, nie interpolacja
 *   (pixel art ma klatki). `krok`: faza chodu; `null` = stoi.
 */
export function rysuj(ctx, ox, oy, S, p) {
  if (p.poza === 'przod') {
    maluj(ctx, warstwa('przod', PRZOD, 0), 0, 0, ox, oy, S);
    return;
  }
  const o = p.ogon >= 0.66 ? ['ogonGora', OGON_GORA]
    : p.ogon >= 0.33 ? ['ogonSrod', OGON_SROD] : ['ogonDol', OGON_DOL];
  const [kx, ky] = KOTWICE[o[0]];
  maluj(ctx, warstwa(o[0], o[1], 3), kx, ky, ox, oy, S);             // ogon ZA korpusem
  const n = p.krok === null ? ['nogiStoi', NOGI_STOI]
    : (p.krok % 1) < 0.5 ? ['nogiA', NOGI_A] : ['nogiB', NOGI_B];
  const [nx, ny] = KOTWICE.nogi;
  maluj(ctx, warstwa(n[0], n[1], 0), nx, ny, ox, oy, S);
  maluj(ctx, warstwa('korpus', KORPUS, 0), 0, 0, ox, oy, S);
}

/** Otwory, z których lecą chmury — w pikselach siatki, od lewego górnego piksela
 *  figury. Zad jest z TYŁU (lewo), pysk z PRZODU (prawo). */
export const OTWORY = { zad: [1, 20], pysk: [35, 12] };
