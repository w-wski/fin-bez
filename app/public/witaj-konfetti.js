/* witaj-konfetti.js — konfetti, które składa się w napis „Witaj <Imię>!", a potem spada
 * poza dolną krawędź. Od 07-27 konfetti to KWADRATOWE PIKSELE na tej samej siatce co
 * kucyk (Szymon: „te literki również zrobione z pikseli"), a nie okrągłe kropki.
 *
 * Napis NIE jest obrazkiem ani ręcznie rysowanym fontem pikselowym: maskę liter bierzemy
 * z offscreen canvasu (measureText → fillText → getImageData) i PRÓBKUJEMY JĄ CO `S`
 * PIKSELI, a każde trafienie rysujemy jako kwadrat S×S dokładnie na siatce. Dzięki temu
 * pikselowy wygląd dostaje KAŻDE imię — także „Zażółć" — bez rysowania 60 glifów z
 * polskimi znakami, których i tak nie dałoby się utrzymać w spójnym stylu.
 *
 * DWA ŹRÓDŁA (Szymon 07-27): pierwsza chmura wychodzi z zadu i nosi LEWĄ połowę napisu,
 * druga z pyska i nosi PRAWĄ. Podział przez medianę x celów: jest jednocześnie
 * przestrzenny (lewa naprawdę jest lewa) i równoliczny (obie chmury tej samej gęstości).
 *
 * Wydajność (reguły z sześciu rund soczewki, sprawdzone na iPhonie): jeden canvas zamiast
 * setek elementów DOM, pozycje w Float32Array, rysowanie pogrupowane po kolorze (7
 * wypełnień na klatkę, nie 400), maska liczona RAZ. Kolory w hex — nie oklch(): starsze
 * WebKity nie parsują oklch w fillStyle.
 */

import { TECZA } from './witaj-kucyk.js';

const MAX = 900;
const TAU = Math.PI * 2;
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
// Wznoszenie po paraboli: pion RUSZA POWOLI i przyspiesza, podczas gdy poziom (easeOut)
// robi swoje od razu. Zestawione razem dają tor, który najpierw ucieka w bok i lekko
// w dół, a dopiero potem zakręca w górę — czyli to, co widać, gdy coś zostaje wyplute.
const easeIn = (x) => x * x;
const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const WYRZUT_MS = 300;          // ile trwa sam wyrzut jednej cząstki przez otwór
/* Deterministyczny szum z indeksu: chmura ma wyglądać na przypadkową, ale plansza musi
   być powtarzalna (i odporna na pominięcie tapem w dowolnej chwili). */
const los = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };

export function silnik(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const st = {
    n: 0, S: 4,
    tx: new Float32Array(MAX), ty: new Float32Array(MAX),
    sx: new Float32Array(MAX), sy: new Float32Array(MAX),
    x: new Float32Array(MAX), y: new Float32Array(MAX),
    jx: new Float32Array(MAX), jy: new Float32Array(MAX),
    cx: new Float32Array(MAX), cy: new Float32Array(MAX),
    ur: new Float32Array(MAX), del: new Float32Array(MAX),
    vx: new Float32Array(MAX), vy: new Float32Array(MAX),
    op: new Float32Array(MAX), pol: new Uint8Array(MAX), h: new Uint8Array(MAX),
    w: 0, hgt: 0, dpr: 1, sypie: false, os: null,
  };

  /** Maska napisu → cele cząstek, próbkowana co `S` pikseli i przyciągnięta do siatki.
   *  Wołane na starcie, po doładowaniu fontów i przy zmianie rozmiaru okna. */
  function przemierz(tekst, kotwicaY, S) {
    const dpr = st.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = st.w = window.innerWidth;
    const h = st.hgt = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const krój = (n) => `800 ${n}px 'SF Pro', -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
    const off = document.createElement('canvas');
    off.width = Math.round(w);
    const o = off.getContext('2d');
    // Najpierw krój z proporcji ekranu, potem ZWĘŻENIE, jeśli imię jest długie — maska ma
    // szerokość kadru, więc bez tego dłuższe powitanie zostałoby ucięte.
    let px = Math.max(34, Math.min(78, w * 0.145));
    o.font = krój(px);
    const szer = o.measureText(tekst).width;
    const limit = w * 0.86;
    if (szer > limit) px = Math.max(24, px * limit / szer);
    off.height = Math.round(px * 2.4);
    o.font = krój(px);
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.fillStyle = '#000';
    o.fillText(tekst, off.width / 2, off.height / 2);
    const dane = o.getImageData(0, 0, off.width, off.height).data;

    // Krok próbkowania ROŚNIE, dopóki trafienia nie zmieszczą się w MAX. Przerzedzanie
    // gotowej listy (stary sposób) robiło w literach dziury — przy napisie z pikseli
    // dziura to nie „mniej konfetti", to nieczytelny wyraz.
    let krok = S, traf = [];
    for (let próba = 0; próba < 8; próba++) {
      traf = zbierz(dane, off.width, off.height, krok);
      if (traf.length / 2 <= MAX) break;
      krok = Math.ceil(krok * 1.3);
    }
    st.S = krok;
    // Podział na połowy: sortujemy po x i cięcie przez środek listy.
    const pary = [];
    for (let i = 0; i < traf.length; i += 2) pary.push([traf[i], traf[i + 1]]);
    pary.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    st.n = Math.min(MAX, pary.length);
    const polowa = Math.floor(st.n / 2);   // ta sama liczba, co w polowaN(0)
    const gy = kotwicaY - off.height / 2;
    // Barwa idzie PIONOWYMI PASMAMI po szerokości napisu, nie losowo per piksel. Losowa
    // barwa co piksel była pierwszą wersją i napis był z niej NIECZYTELNY: oko składa
    // literę z ciągłej plamy koloru, a nie z konfetti w kształcie litery. Pasma dają
    // tęczę przez całe powitanie i każdą literę w jednym–dwóch kolorach.
    const x0 = pary.length ? pary[0][0] : 0;
    const x1 = pary.length ? pary[pary.length - 1][0] : 1;
    const pasmo = Math.max(1, (x1 - x0) / TECZA.length);
    for (let i = 0; i < st.n; i++) {
      st.tx[i] = Math.round((pary[i][0] + (w - off.width) / 2) / krok) * krok;
      st.ty[i] = Math.round((gy + pary[i][1]) / krok) * krok;
      st.pol[i] = i < polowa ? 0 : 1;
      st.h[i] = Math.min(TECZA.length - 1, Math.floor((pary[i][0] - x0) / pasmo));
      st.op[i] = 1;
    }
    return { px, n: st.n, S: krok };
  }

  function zbierz(dane, w, h, krok) {
    const out = [];
    for (let yy = 0; yy < h; yy += krok) {
      for (let xx = 0; xx < w; xx += krok) {
        if (dane[(yy * w + xx) * 4 + 3] > 130) out.push(xx, yy);
      }
    }
    return out;
  }

  /** Dwa źródła: `zad` (lewa połowa napisu, strumień w LEWO) i `pysk` (prawa, w PRAWO).
   *  WĄSKI OTWÓR: rozrzut startowy jest prawie zerowy w pionie. Tu też losujemy —
   *  deterministycznie, z indeksu — resztę drogi cząstki: koniec wyrzutu, miejsce
   *  w chmurze i czas narodzin. */
  function zrodla(zad, pysk) {
    const os = st.os;
    const rozrzut = Math.min(st.w, st.hgt) * 0.15;
    const okna = [os.chmura1, os.chmura2];
    const centra = [[st.w * 0.28, st.hgt * 0.42], [st.w * 0.71, st.hgt * 0.42]];
    for (let i = 0; i < st.n; i++) {
      const p = st.pol[i];
      const zr = p === 0 ? zad : pysk;
      const kier = p === 0 ? -1 : 1;                 // zad wyrzuca w lewo, pysk w prawo
      const a = los(i, 1), b = los(i, 2), c2 = los(i, 3), d = los(i, 4);
      st.sx[i] = zr[0];
      st.sy[i] = zr[1] + (a - 0.5) * 3.5;            // otwór: ~3,5 px wysokości
      st.jx[i] = zr[0] + kier * (26 + b * 44);
      // Koniec wyrzutu leży PONIŻEJ otworu (Szymon 07-28: „pod lekkim kątem w dół,
      // dopiero potem parabolą w górę”). Wcześniej otwór pluł poziomo i cząstki od razu
      // szły do chmury, więc strumień czytał się jak linia, a nie jak wyrzut.
      st.jy[i] = st.sy[i] + 7 + c2 * 12;
      // Chmura: gęstsza w środku (pierwiastek z promienia daje równomierne pole).
      const kat = a * TAU + b;
      const prom = Math.sqrt(c2) * rozrzut;
      st.cx[i] = centra[p][0] + Math.cos(kat) * prom * 1.15;
      st.cy[i] = centra[p][1] + Math.sin(kat) * prom * 0.85;
      // Narodziny rozłożone w OKNIE SWOJEJ chmury, po kolei od strony źródła.
      const okno = okna[p];
      const u = p === 0 ? 1 - (i / Math.max(1, polowaN(0))) : (i - polowaN(0)) / Math.max(1, polowaN(1));
      st.ur[i] = okno[0] + Math.max(0, Math.min(1, u)) * (okno[1] - okno[0]) * 0.8;
      st.del[i] = d * 0.3;                           // rozłożenie składania napisu
      st.x[i] = st.sx[i];
      st.y[i] = st.sy[i];
      st.op[i] = 0;
    }
    st.sypie = false;
  }

  const polowaN = (p) => (p === 0 ? Math.floor(st.n / 2) : st.n - Math.floor(st.n / 2));

  function osCzasu(os) { st.os = os; }

  /** Cały ruch przed zsypem: czysta funkcja czasu planszy.
   *  1. wyrzut wąskim otworem, 2. rozejście się w chmurę, 3. napis. */
  function rusz(t) {
    st.sypie = false;
    const napisA = st.os.napis[0], napisB = st.os.napis[1];
    for (let i = 0; i < st.n; i++) {
      const ur = st.ur[i];
      if (t < ur) { st.op[i] = 0; continue; }
      st.op[i] = 1;
      const koniecWyrzutu = ur + WYRZUT_MS;
      if (t < koniecWyrzutu) {
        const u = (t - ur) / WYRZUT_MS;
        st.x[i] = st.sx[i] + (st.jx[i] - st.sx[i]) * easeOut(u);
        st.y[i] = st.sy[i] + (st.jy[i] - st.sy[i]) * easeIn(u);   // opada, przyspieszając
        continue;
      }
      // Kołysanie chmury: drobne, deterministyczne, gaśnie przy składaniu napisu.
      const kol = Math.sin(t / 620 + i * 0.7) * 4.5;
      const kol2 = Math.cos(t / 540 + i * 1.1) * 3.5;
      const eCh = Math.min(1, (t - koniecWyrzutu) / Math.max(1, napisA - koniecWyrzutu));
      const chX = st.jx[i] + (st.cx[i] - st.jx[i]) * easeOut(eCh);
      // Poziom easeOut, pion easeIn — razem parabola w górę, w stronę napisu.
      const chY = st.jy[i] + (st.cy[i] - st.jy[i]) * easeIn(eCh);
      if (t < napisA) { st.x[i] = chX + kol; st.y[i] = chY + kol2; continue; }
      const p = (t - napisA) / (napisB - napisA);
      const e = easeIO(Math.max(0, Math.min(1, (p - st.del[i]) / (1 - st.del[i]))));
      st.x[i] = chX + kol * (1 - e) + (st.tx[i] - chX) * e;
      st.y[i] = chY + kol2 * (1 - e) + (st.ty[i] - chY) * e;
    }
  }

  /** Zsyp: jedyny etap z całkowaniem — i tak jest jednokierunkowy. */
  function zsyp(dt) {
    if (!st.sypie) {
      st.sypie = true;
      for (let i = 0; i < st.n; i++) {
        st.vx[i] = (st.tx[i] - st.w / 2) * 0.0016 + ((i % 7) - 3) * 0.012;
        st.vy[i] = 0.02 + (i % 11) * 0.004;
      }
    }
    for (let i = 0; i < st.n; i++) {
      st.vy[i] += 0.0034 * dt;
      st.x[i] += st.vx[i] * dt;
      st.y[i] += st.vy[i] * dt;
    }
  }

  /** Rysowanie: KWADRATY przyciągnięte do siatki `S`. Zaokrąglenie pozycji do siatki jest
   *  tym, co odróżnia „piksele" od „kwadracików w losowych miejscach" — bez niego napis
   *  po złożeniu miałby postrzępione krawędzie. */
  function rysuj() {
    const S = st.S;
    for (let hi = 0; hi < TECZA.length; hi++) {
      let pusty = true;
      for (let i = 0; i < st.n; i++) {
        if (st.h[i] !== hi || st.op[i] <= 0 || st.y[i] > st.hgt + 20) continue;
        if (pusty) { ctx.fillStyle = TECZA[hi]; pusty = false; }
        ctx.fillRect(Math.round(st.x[i] / S) * S, Math.round(st.y[i] / S) * S, S, S);
      }
    }
  }

  /** Czy wszystko wysypało się poza ekran (koniec zsypu, można sprzątać). */
  function pusto() {
    for (let i = 0; i < st.n; i++) if (st.y[i] < st.hgt + 20) return false;
    return true;
  }

  /** Kucyk i napis dzielą JEDEN canvas (jedna siatka pikseli = jeden obraz), więc
   *  czyszczenie nie może siedzieć w `rysuj()` — kolejność ustala plansza:
   *  czyść → kucyk → cząstki. */
  function czysc() { ctx.clearRect(0, 0, st.w, st.hgt); }

  return { przemierz, zrodla, osCzasu, rusz, zsyp, rysuj, czysc, pusto, ctx, stan: st };
}
