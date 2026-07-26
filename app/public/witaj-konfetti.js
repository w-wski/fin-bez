/* witaj-konfetti.js — konfetti, które składa się w napis „Witaj <Imię>!", a potem
 * zsypuje się na dół i wysypuje poza ekran. Napis NIE jest obrazkiem: maskę liter
 * bierzemy z offscreen canvasu (measureText → fillText → getImageData), więc jest
 * zawsze ostry, zawsze tym samym krojem co aplikacja i zawsze z polskimi znakami.
 *
 * Wydajność (reguły z sześciu rund soczewki, sprawdzone na iPhonie):
 * jeden canvas zamiast setek elementów DOM, pozycje w Float32Array, rysowanie
 * pogrupowane po kolorze (8 wypełnień na klatkę, nie 400), maska liczona RAZ.
 * Kolory w hsl() — nie oklch(): starsze WebKity nie parsują oklch w fillStyle.
 */

const MAX = 520;
const STRIDE = 5;               // co ile pikseli maski bierzemy cząstkę
const HUES = [15, 45, 95, 160, 205, 260, 300, 335];
const TAU = Math.PI * 2;
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const WYRZUT_MS = 300;          // ile trwa sam wyrzut jednej cząstki przez otwór
/* Deterministyczny szum z indeksu: chmura ma wyglądać na przypadkową, ale plansza
   musi być powtarzalna (i odporna na pominięcie tapem w dowolnej chwili). */
const los = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };

export function silnik(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const st = {
    n: 0, tx: new Float32Array(MAX), ty: new Float32Array(MAX),
    sx: new Float32Array(MAX), sy: new Float32Array(MAX),
    x: new Float32Array(MAX), y: new Float32Array(MAX),
    jx: new Float32Array(MAX), jy: new Float32Array(MAX),
    cx: new Float32Array(MAX), cy: new Float32Array(MAX),
    ur: new Float32Array(MAX),
    vx: new Float32Array(MAX), vy: new Float32Array(MAX),
    op: new Float32Array(MAX), del: new Float32Array(MAX),
    r: new Float32Array(MAX), h: new Uint8Array(MAX),
    w: 0, hgt: 0, dpr: 1, sypie: false, os: null,
  };

  /** Maska napisu → cele cząstek. Wołane na starcie, po doładowaniu fontów
   *  i przy zmianie rozmiaru okna: wszystko, co zależy od układu, jest tutaj. */
  function przemierz(tekst, kotwicaY) {
    const dpr = st.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = st.w = window.innerWidth;
    const h = st.hgt = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const krój = (n) => `700 ${n}px 'SF Pro', -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
    const off = document.createElement('canvas');
    off.width = Math.round(w);
    const o = off.getContext('2d');
    // Najpierw krój z proporcji ekranu, potem ZWĘŻENIE, jeśli imię jest długie —
    // maska ma szerokość kadru, więc bez tego dłuższe powitanie zostałoby ucięte.
    let px = Math.max(30, Math.min(72, w * 0.135));
    o.font = krój(px);
    const szer = o.measureText(tekst).width;
    const limit = w * 0.86;
    if (szer > limit) px = Math.max(22, px * limit / szer);
    off.height = Math.round(px * 2.4);
    o.font = krój(px);
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.fillStyle = '#000';
    o.fillText(tekst, off.width / 2, off.height / 2);
    const dane = o.getImageData(0, 0, off.width, off.height).data;

    // Najpierw zbieramy wszystkie trafienia, potem przerzedzamy do MAX — inaczej
    // przy dłuższym imieniu napis urwałby się w połowie słowa.
    const trafienia = [];
    for (let yy = 0; yy < off.height; yy += STRIDE) {
      for (let xx = 0; xx < off.width; xx += STRIDE) {
        if (dane[(yy * off.width + xx) * 4 + 3] > 130) trafienia.push(xx, yy);
      }
    }
    const ile = trafienia.length / 2;
    const skok = ile > MAX ? ile / MAX : 1;
    st.n = Math.min(MAX, ile);
    for (let i = 0; i < st.n; i++) {
      const j = Math.floor(i * skok) * 2;
      st.tx[i] = trafienia[j];
      st.ty[i] = kotwicaY - off.height / 2 + trafienia[j + 1];
      st.r[i] = 2.8 + (i % 5) * 0.26;
      st.h[i] = i % HUES.length;
      st.op[i] = 1;
    }
    return { px, n: st.n };
  }

  /** Źródło = zad kucyka. WĄSKI OTWÓR: rozrzut startowy jest prawie zerowy
   *  w pionie (Szymon 07-26: „cienkim otworem"), a strumień idzie w LEWO.
   *  Tu też losujemy — deterministycznie, z indeksu — resztę drogi cząstki:
   *  koniec wyrzutu (jx, jy), miejsce w chmurze (cx, cy) i czas narodzin. */
  function zrodlo(x, y) {
    const os = st.os;
    const rozrzut = Math.min(st.w, st.hgt) * 0.17;
    const chmuraX = st.w * 0.34;
    const chmuraY = st.hgt * 0.355;
    const okno = (os.struga[1] - os.struga[0]) * 0.86;
    for (let i = 0; i < st.n; i++) {
      const a = los(i, 1), b = los(i, 2), c2 = los(i, 3), d = los(i, 4);
      st.sx[i] = x - 2;
      st.sy[i] = y + (a - 0.5) * 3.5;              // otwór: ~3,5 px wysokości
      st.jx[i] = x - 40 - b * 46;                  // wyrzut w lewo, różne długości
      st.jy[i] = st.sy[i] + (c2 - 0.5) * 14;
      // Chmura: gęstsza w środku (pierwiastek z promienia daje równomierne pole)
      const kat = a * TAU + b;
      const prom = Math.sqrt(c2) * rozrzut;
      st.cx[i] = chmuraX + Math.cos(kat) * prom * 1.25;
      st.cy[i] = chmuraY + Math.sin(kat) * prom * 0.8;
      st.ur[i] = os.struga[0] + (i / Math.max(1, st.n)) * okno;
      st.del[i] = d * 0.32;                        // rozłożenie składania napisu
      st.x[i] = st.sx[i];
      st.y[i] = st.sy[i];
      st.op[i] = 0;
    }
    st.sypie = false;
  }

  function osCzasu(os) { st.os = os; }

  /** Cały ruch przed zsypem: czysta funkcja czasu planszy.
   *  1. wyrzut wąskim otworem w lewo, 2. rozejście się w chmurę, 3. napis. */
  function rusz(t) {
    st.sypie = false;
    const napisA = st.os.napis[0], napisB = st.os.napis[1];
    for (let i = 0; i < st.n; i++) {
      const ur = st.ur[i];
      if (t < ur) { st.op[i] = 0; continue; }
      st.op[i] = 1;
      const koniecWyrzutu = ur + WYRZUT_MS;
      if (t < koniecWyrzutu) {
        const e = easeOut((t - ur) / WYRZUT_MS);
        st.x[i] = st.sx[i] + (st.jx[i] - st.sx[i]) * e;
        st.y[i] = st.sy[i] + (st.jy[i] - st.sy[i]) * e;
        continue;
      }
      // Kołysanie chmury: drobne, deterministyczne, gaśnie przy składaniu napisu.
      const kol = Math.sin(t / 620 + i * 0.7) * 4.5;
      const kol2 = Math.cos(t / 540 + i * 1.1) * 3.5;
      const eCh = Math.min(1, (t - koniecWyrzutu) / Math.max(1, napisA - koniecWyrzutu));
      const chX = st.jx[i] + (st.cx[i] - st.jx[i]) * easeOut(eCh);
      const chY = st.jy[i] + (st.cy[i] - st.jy[i]) * easeOut(eCh);
      if (t < napisA) { st.x[i] = chX + kol; st.y[i] = chY + kol2; continue; }
      const p = (t - napisA) / (napisB - napisA);
      const e = easeIO(Math.max(0, Math.min(1, (p - st.del[i]) / (1 - st.del[i]))));
      st.x[i] = chX + kol * (1 - e) + (st.tx[i] - chX) * e;
      st.y[i] = chY + kol2 * (1 - e) + (st.ty[i] - chY) * e;
    }
  }

  /** Zsyp: jedyny etap z całkowaniem — i tak jest jednokierunkowy. */
  function zsyp(dt, start) {
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

  function rysuj() {
    ctx.clearRect(0, 0, st.w, st.hgt);
    for (let hi = 0; hi < HUES.length; hi++) {
      ctx.beginPath();
      let pusty = true;
      for (let i = 0; i < st.n; i++) {
        if (st.h[i] !== hi || st.op[i] <= 0 || st.y[i] > st.hgt + 20) continue;
        ctx.moveTo(st.x[i] + st.r[i], st.y[i]);
        ctx.arc(st.x[i], st.y[i], st.r[i], 0, TAU);
        pusty = false;
      }
      if (pusty) continue;
      ctx.fillStyle = `hsl(${HUES[hi]} 74% 62%)`;
      ctx.fill();
    }
  }

  /** Czy wszystko wysypało się poza ekran (koniec zsypu, można sprzątać). */
  function pusto() {
    for (let i = 0; i < st.n; i++) if (st.y[i] < st.hgt + 20) return false;
    return true;
  }

  return { przemierz, zrodlo, osCzasu, rusz, zsyp, rysuj, pusto, stan: st };
}
