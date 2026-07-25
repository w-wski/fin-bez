/* glass.js — soczewka „Liquid Glass": czysta prezentacja, zero API/sesji/selektorów main.js.
 * Model interakcji (Szymon, 2026-07-25): klik w soczewkę chwyta ją na kursor (sticky, drugi
 * klik puszcza; przeciąganie też działa); po puszczeniu POWOLNY dojazd do bliższej pozycji
 * (dół = faza 1, góra = logowanie); osiadłą można złapać znów i machać po ekranie — smuga
 * bąbelków podąża z opóźnieniem, napisy zniekształcają się pod szkłem; zjazd w dół to droga
 * powrotna. Pion soczewki JEST postępem choreografii: p = f(y), plateau p=1 w strefie zabawy;
 * skala/hero/przyciski wynikają z p (klatki z glass-mapa.js), poziom jest wolny w chwycie. */

import { LENS_BASE, installLensMap, lerp, clamp01, sampleTrack, spawnBubbles, keepActiveTabVisible } from './glass-mapa.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const K_DRAG = 0.34;   // podążanie za wskaźnikiem: żwawe, ale z masą
const K_SNAP = 0.06;   // dojazd po puszczeniu: powolny, „estetyczny" (~1 s)
const K_TRAIL = 0.055; // smuga bąbelków: wyraźnie z tyłu za soczewką
const CLICK_MS = 300;  // klik vs przeciągnięcie
const CLICK_PX = 6;

class LoginStage {
  constructor(root) {
    this.root = root;
    this.lens = root.querySelector('.lens');
    this.mark = root.querySelector('.login__mark');
    this.bubbles = root.querySelector('.login__bubbles');

    this.p = 0;
    this.pTarget = 0;
    this.x = 0; this.y = 0;          // aktualny środek soczewki (px)
    this.grab = null;                 // { mode:'lens'|'bg', sticky, px, py, startPx, startPy, t0, fromY }
    this.trail = { x: 0, y: 0 };
    this.settled = false;
    this.viaKeyboard = false;
    this.raf = 0;
    this.last = 0;

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onKey = this.onKey.bind(this);
    this.frame = this.frame.bind(this);

    root.addEventListener('pointerdown', this.onPointerDown);
    root.addEventListener('wheel', this.onWheel, { passive: false });
    root.addEventListener('keydown', this.onKey);
  }

  /* ---------- geometria toru ---------- */

  anchorCenter() {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!this.mark) return { cx: vw / 2, cy: vh * 0.30 };
    const r = this.mark.getBoundingClientRect();
    if (!r.width && !r.height) return { cx: vw / 2, cy: vh * 0.30 };
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  trackPoint(p) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const { a, b, t } = sampleTrack(p);
    const res = (k) => (k.anchor ? (({ cx, cy }) => ({ cx, cy }))(this.anchorCenter()) : { cx: k.cx * vw, cy: k.cy * vh });
    const ca = res(a), cb = res(b);
    return {
      x: lerp(ca.cx, cb.cx, t), y: lerp(ca.cy, cb.cy, t), s: lerp(a.s, b.s, t),
      hero: lerp(a.hero, b.hero, t), dest: lerp(a.dest, b.dest, t),
    };
  }

  yStart() { return window.innerHeight * 1.08; }                       // spoczynek fazy 1 (jak klatka p=0)
  yPlay() { return this.anchorCenter().cy + window.innerHeight * 0.16; } // górna strefa zabawy: p trzyma 1
  pFromY(y) { return clamp01((this.yStart() - y) / Math.max(1, this.yStart() - this.yPlay())); }

  apply() {
    const tp = this.trackPoint(this.p);
    const half = (LENS_BASE * tp.s) / 2;
    const st = this.root.style;
    st.setProperty('--ls', tp.s.toFixed(4));
    st.setProperty('--lx', `${(this.x - half).toFixed(2)}px`);
    st.setProperty('--ly', `${(this.y - half).toFixed(2)}px`);
    st.setProperty('--hero-a', tp.hero.toFixed(3));
    st.setProperty('--dest-a', tp.dest.toFixed(3));
    st.setProperty('--p', this.p.toFixed(4));

    // Refrakcja jest droga: włączona w ruchu i w chwycie, wyłączona po osiadnięciu.
    const moving = !!this.grab || !!this.raf;
    this.root.classList.toggle('is-refracting', moving || (this.p > 0.12 && this.p < 0.999));
    this.root.classList.toggle('is-dragging', !!this.grab);

    const done = this.p >= 0.995;
    if (done !== this.settled) {
      this.settled = done;
      this.root.classList.toggle('is-open', done);
      if (done && this.viaKeyboard) {
        const cta = this.root.querySelector('.login__actions a, .login__actions button');
        if (cta) cta.focus({ preventScroll: true });
      }
    }
  }

  applyTrail(dt) {
    if (!this.bubbles) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    // W trybie zabawy smuga wisi nad soczewką (dół kolumny ≈ jej środek); poza nim wraca na oś.
    const play = this.p > 0.9 && this.grab;
    const wx = play ? this.x - vw / 2 : 0;
    const wy = play ? this.y - vh * 0.39 : 0;
    const k = 1 - Math.pow(1 - K_TRAIL, dt / 16.7);
    this.trail.x += (wx - this.trail.x) * k;
    this.trail.y += (wy - this.trail.y) * k;
    this.bubbles.style.setProperty('--trail-x', `${this.trail.x.toFixed(1)}px`);
    this.bubbles.style.setProperty('--trail-y', `${this.trail.y.toFixed(1)}px`);
  }

  frame(now) {
    const dt = this.last ? Math.min(64, now - this.last) : 16.7;
    this.last = now;
    let busy = false;

    if (this.grab) {
      const k = 1 - Math.pow(1 - K_DRAG, dt / 16.7);
      if (this.grab.mode === 'lens') {
        this.x += (this.grab.px - this.x) * k;
        this.y += (this.grab.py - this.y) * k;
      } else {
        // chwyt za tło: palec steruje wysokością (swipe w górę), soczewka trzyma się osi toru
        const yWant = this.grab.fromY - (this.grab.startPy - this.grab.py) * 1.15;
        this.y += (yWant - this.y) * k;
        this.x += (this.trackPoint(this.p).x - this.x) * k * 0.6;
      }
      this.p = this.pFromY(this.y);
      busy = true;
    } else {
      const k = 1 - Math.pow(1 - K_SNAP, dt / 16.7);
      this.p += (this.pTarget - this.p) * k;
      const tp = this.trackPoint(this.p);
      this.x += (tp.x - this.x) * k * 1.7;
      this.y += (tp.y - this.y) * k * 1.7;
      if (Math.abs(this.pTarget - this.p) > 0.0012 || Math.abs(tp.x - this.x) > 0.4 || Math.abs(tp.y - this.y) > 0.4) {
        busy = true;
      } else {
        this.p = this.pTarget;
        const end = this.trackPoint(this.p);
        this.x = end.x; this.y = end.y;
      }
    }

    this.applyTrail(dt);
    busy = busy || Math.abs(this.trail.x) > 0.5 || Math.abs(this.trail.y) > 0.5;

    if (busy) this.raf = requestAnimationFrame(this.frame);
    else { this.raf = 0; this.last = 0; }
    this.apply();
  }

  wake() { if (!this.raf) { this.last = 0; this.raf = requestAnimationFrame(this.frame); } }

  animateTo(v) { this.pTarget = clamp01(v); this.wake(); }

  jump(v) {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; this.last = 0; }
    this.p = this.pTarget = clamp01(v);
    const tp = this.trackPoint(this.p);
    this.x = tp.x; this.y = tp.y;
    this.apply();
  }

  release() {
    if (!this.grab) return;
    this.grab = null;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    // najbliższa pozycja: powyżej połowy drogi — góra, poniżej — powrót na dół
    this.animateTo(this.p >= 0.5 ? 1 : 0);
  }

  onPointerDown(e) {
    if (e.target.closest('a, button, input, select, .theme-switch')) return;
    if (this.grab && this.grab.sticky) { this.release(); return; }   // drugi klik puszcza
    this.viaKeyboard = false;
    const onLens = !!e.target.closest('.lens');
    if (this.settled && !onLens) return;                              // po otwarciu tło nie ciągnie
    this.grab = {
      mode: onLens ? 'lens' : 'bg', sticky: false,
      px: e.clientX, py: e.clientY, startPx: e.clientX, startPy: e.clientY,
      t0: performance.now(), fromY: this.y, type: e.pointerType,
    };
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.wake();
  }

  onPointerMove(e) {
    if (!this.grab) return;
    e.preventDefault();
    this.grab.px = e.clientX;
    this.grab.py = e.clientY;
    this.wake();
  }

  onPointerUp(e) {
    const g = this.grab;
    if (!g) return;
    const quick = performance.now() - g.t0 < CLICK_MS
      && Math.hypot(e.clientX - g.startPx, e.clientY - g.startPy) < CLICK_PX;
    // Klik myszą w soczewkę = chwyt na kursor (bez trzymania); ruch śledzi pointermove.
    if (quick && g.mode === 'lens' && g.type === 'mouse' && !g.sticky) {
      g.sticky = true;
      window.removeEventListener('pointerup', this.onPointerUp);
      window.removeEventListener('pointercancel', this.onPointerUp);
      return;
    }
    // Szybki tap (dotyk — w soczewkę lub tło) albo klik w tło w fazie 1: zaproszenie,
    // soczewka rusza na górę sama.
    if (quick && !this.settled) {
      this.grab = null;
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
      window.removeEventListener('pointercancel', this.onPointerUp);
      this.animateTo(1);
      return;
    }
    this.release();
  }

  onWheel(e) {
    this.viaKeyboard = false;
    if (this.settled && e.deltaY > 0) return;
    e.preventDefault();
    const travel = Math.max(220, window.innerHeight * 0.55);
    this.p = clamp01(this.p + e.deltaY / travel);
    const tp = this.trackPoint(this.p);
    this.x = tp.x; this.y = tp.y;
    this.apply();
    clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => this.animateTo(this.p >= 0.5 ? 1 : 0), 120);
  }

  onKey(e) {
    if (['Enter', ' ', 'ArrowUp', 'PageUp'].includes(e.key)) {
      if (e.target.closest('a, button, input, select')) return;
      e.preventDefault();
      this.viaKeyboard = true;
      this.animateTo(1);
    } else if (['ArrowDown', 'PageDown', 'Escape'].includes(e.key)) {
      e.preventDefault();
      if (this.grab) { this.release(); return; }
      this.animateTo(0);
    }
  }

  reset() { this.jump(0); }
  open() { this.jump(1); }
}

/* ---------- start ---------- */

function boot() {
  const root = document.querySelector('.login');
  if (!root) return;

  const supported = installLensMap() && CSS.supports('filter', 'url(#fin-refract)');
  if (!supported) document.documentElement.classList.add('no-refract');

  spawnBubbles(root.querySelector('.login__bubbles'));

  const stage = new LoginStage(root);

  const settle = () => {
    if (reduceMotion.matches) { document.documentElement.classList.add('no-refract'); stage.open(); }
    else stage.reset();
  };
  settle();
  reduceMotion.addEventListener?.('change', settle);

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!stage.grab) stage.jump(stage.pTarget); }, 120);
  });

  // main.js pokazuje/chowa sekcje przez atrybut `hidden` — wracamy wtedy do stanu wyjściowego.
  const section = document.getElementById('view-login');
  if (section) {
    new MutationObserver(() => {
      root.classList.toggle('is-live', !section.hidden);
      if (!section.hidden) settle();
    }).observe(section, { attributes: true, attributeFilter: ['hidden'] });
    root.classList.toggle('is-live', !section.hidden);
  }
}

function bootAll() { boot(); keepActiveTabVisible(reduceMotion); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootAll);
else bootAll();
