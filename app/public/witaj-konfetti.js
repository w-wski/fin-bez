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

export function silnik(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const st = {
    n: 0, tx: new Float32Array(MAX), ty: new Float32Array(MAX),
    sx: new Float32Array(MAX), sy: new Float32Array(MAX),
    x: new Float32Array(MAX), y: new Float32Array(MAX),
    vx: new Float32Array(MAX), vy: new Float32Array(MAX),
    op: new Float32Array(MAX), del: new Float32Array(MAX),
    r: new Float32Array(MAX), h: new Uint8Array(MAX),
    w: 0, hgt: 0, dpr: 1, sypie: false,
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
      st.del[i] = (i / Math.max(1, st.n)) * 0.62;   // strumień: wychodzą kolejno, nie salwą
      st.op[i] = 1;
    }
    return { px, n: st.n };
  }

  /** Punkt wysypu = koniec tęczy (mierzony na ekranie, nie zgadywany). */
  function zrodlo(x, y) {
    for (let i = 0; i < st.n; i++) {
      const a = (i / Math.max(1, st.n)) * TAU;
      st.sx[i] = x + Math.cos(a * 3.1) * 7 - 4;
      st.sy[i] = y + Math.sin(a * 2.7) * 7;
      st.x[i] = st.sx[i];
      st.y[i] = st.sy[i];
    }
    st.sypie = false;
  }

  /** Lot do liter: czysta funkcja postępu (p 0→1), więc pominięcie tapem
   *  nie zostawia cząstek w losowym miejscu. */
  function lot(p) {
    st.sypie = false;
    for (let i = 0; i < st.n; i++) {
      const pi = Math.max(0, Math.min(1, (p - st.del[i]) / (1 - st.del[i])));
      const e = easeOut(pi);
      st.x[i] = st.sx[i] + (st.tx[i] - st.sx[i]) * e;
      // lekki łuk: cząstka wznosi się nad prostą i dopiero spada na literę
      const luk = Math.min(90, Math.abs(st.ty[i] - st.sy[i]) * 0.16);
      st.y[i] = st.sy[i] + (st.ty[i] - st.sy[i]) * e - Math.sin(e * Math.PI) * luk;
      st.op[i] = pi > 0 ? 1 : 0;
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

  return { przemierz, zrodlo, lot, zsyp, rysuj, pusto, stan: st };
}
