/* glass.js — soczewka „Liquid Glass": czysta prezentacja, zero API/sesji/selektorów main.js.
 * Interakcje (Szymon 07-25): klik chwyta soczewkę na kursor (drugi puszcza; drag też działa);
 * po puszczeniu powolny dojazd do bliższej pozycji; osiadłą można machać po ekranie (dym
 * bąbelków, napisy zniekształcają się pod szkłem); zjazd w dół = droga powrotna.
 * Pion soczewki JEST postępem: p = f(y), plateau p=1 u góry; reszta z klatek glass-mapa.js. */

import { LENS_BASE, installLensMap, clamp01, trackPoint, anchorCenter, emitBubble, keepActiveTabVisible } from './glass-mapa.js';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const K_DRAG = 0.34;   // podążanie za wskaźnikiem: żwawe, ale z masą
const K_SNAP = 0.06;   // dojazd po puszczeniu: powolny, „estetyczny" (~1 s)
const CLICK_MS = 300; const CLICK_PX = 6; // klik vs przeciągnięcie

class LoginStage {
  constructor(root) {
    this.root = root;
    this.lens = root.querySelector('.lens');
    this.world = root.querySelector('.lens__world');
    this.title = root.querySelector('.login__inner .login__title');
    this.bubbles = root.querySelector('.login__bubbles');

    this.p = 0;
    this.pTarget = 0;
    this.x = 0; this.y = 0;          // aktualny środek soczewki (px)
    this.s = 1;
    this.grab = null;                 // { mode:'lens'|'bg', sticky, px, py, startPx, startPy, t0, fromY }
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

  /* Geometria toru mieszka w glass-mapa.js (trackPoint/anchorCenter na żywym DOM). */
  trackPoint(p) { return trackPoint(this.root, p); }

  // spoczynek fazy 1 (jak klatka p=0) / górna strefa zabawy, gdzie p trzyma 1
  yStart() { return window.innerHeight * 1.08; }
  yPlay() { return anchorCenter(this.root).cy + window.innerHeight * 0.16; }
  pFromY(y) { return clamp01((this.yStart() - y) / Math.max(1, this.yStart() - this.yPlay())); }

  apply() {
    const tp = this.trackPoint(this.p);
    this.s = tp.s;
    const tx = this.x - (LENS_BASE * tp.s) / 2;
    const ty = this.y - (LENS_BASE * tp.s) / 2;
    // Transformy wprost na elementach (nie przez zmienne CSS): zmiana custom property
    // na .login unieważniała style całej sceny co klatkę — główny powód klatkowania.
    this.lens.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${tp.s.toFixed(4)})`;
    if (this.world) {
      this.world.style.transform = `scale(${(1 / tp.s).toFixed(5)}) translate(${(-tx).toFixed(2)}px, ${(-ty).toFixed(2)}px)`;
    }
    // Tytuł zapala się WYŁĄCZNIE w pełni zakryty: klatki uzbrajają narodziny (dest>0),
    // decyduje geometria — cały prostokąt tytułu (rect liczy aktualny slide) musi
    // mieścić się w kole. Zatrzask do zjazdu (dest==0); awaryjnie p>0.8.
    if (tp.dest <= 0) this.born = false;
    else if (!this.born && this.title) {
      const r = this.title.getBoundingClientRect();
      const dx = Math.max(Math.abs(r.left - this.x), Math.abs(r.right - this.x));
      const dy = Math.max(Math.abs(r.top - this.y), Math.abs(r.bottom - this.y));
      this.born = Math.hypot(dx, dy) <= (LENS_BASE * tp.s) / 2 - 4 || this.p > 0.8;
    }
    const st = this.root.style;
    st.setProperty('--hero-a', tp.hero.toFixed(3));
    st.setProperty('--dest-a', this.born ? '1' : '0');
    st.setProperty('--dest-s', tp.dsl.toFixed(3));
    st.setProperty('--cta-a', tp.cta.toFixed(3));

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

  /* Emisja dymu: bąbelki rodzą się przy górnej krawędzi soczewki, ale WYŁĄCZNIE
     nad linią tytułu (referencja: poniżej napisu ich nie ma). Im szybszy ruch,
     tym gęstsza emisja i większe bąble — „namnażają się" przy machaniu. */
  emitOne(burst) {
    if (reduceMotion.matches || !this.bubbles) return;
    const t = this.title && this.title.getBoundingClientRect();
    if (t && t.height && this.y > t.top - 8) return;
    emitBubble(this.bubbles, this.x, this.y - (LENS_BASE * (this.s || 1)) * 0.28, burst);
  }

  emit(dt, speed) {
    this.emitMs = (this.emitMs || 0) + dt;
    const rate = this.grab ? (speed > 7 ? 40 : 85) : 180;
    if (this.emitMs >= rate) {
      this.emitMs = 0;
      this.emitOne(this.grab ? (speed > 7 ? 1.35 : 1.1) : 0.9);
    }
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

    if (busy) {
      const speed = Math.hypot(this.x - (this.lx ?? this.x), this.y - (this.ly ?? this.y));
      this.emit(dt, speed);
    }
    this.lx = this.x; this.ly = this.y;

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

  unbind() {
    for (const ev of ['pointermove', 'pointerup', 'pointercancel']) {
      window.removeEventListener(ev, ev === 'pointermove' ? this.onPointerMove : this.onPointerUp);
    }
  }

  release() {
    if (!this.grab) return;
    this.grab = null;
    this.unbind();
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
    // Szybki tap/klik w fazie 1 = zaproszenie: soczewka rusza na górę sama.
    if (quick && !this.settled) {
      this.grab = null;
      this.unbind();
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

  reset() { this.jump(0); } open() { this.jump(1); }
}

function boot() {
  const root = document.querySelector('.login');
  if (!root) return;

  const supported = installLensMap() && CSS.supports('filter', 'url(#fin-refract)');
  if (!supported) document.documentElement.classList.add('no-refract');

  const stage = window.__finStage = new LoginStage(root); // ekspozycja: rig zrzutów steruje p

  // Emisja spoczynkowa: scena oddycha także, gdy nic się nie rusza (rzadsza niż w geście).
  setInterval(() => {
    if (!document.hidden && !root.closest('#view-login')?.hidden && !stage.raf) stage.emitOne(0.9);
  }, 650);

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
