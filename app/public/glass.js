/* glass.js — materiał „Liquid Glass" i choreografia ekranu logowania.
 *
 * Wyłącznie warstwa prezentacji: nie dotyka API, sesji ani selektorów czytanych przez main.js.
 * Spec: docs/design/DESIGN-SPEC-GLASS.md §1 i §4.
 *
 * Sedno: soczewka nie rozmywa tła, tylko je ZAŁAMUJE. Kopia sceny leży wewnątrz koła,
 * skontrtransformowana tak, by pokrywała się 1:1 z prawdziwą sceną, i przechodzi przez
 * feDisplacementMap sterowany mapą sferyczną wygenerowaną raz na canvasie. Trzy przebiegi
 * o różnej sile dają aberrację chromatyczną (tęczowe obwódki przy rancie).
 */

import { LENS_BASE, RELEASE_THRESHOLD, installLensMap, KEYFRAMES, lerp, clamp01, sampleTrack, spawnBubbles } from './glass-mapa.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

class LoginStage {
  constructor(root) {
    this.root = root;
    this.lens = root.querySelector('.lens');
    this.world = root.querySelector('.lens__world');
    this.mark = root.querySelector('.login__mark');
    this.hint = root.querySelector('.login__hint');

    this.p = 0;
    this.target = 0;
    this.raf = 0;
    this.last = 0;
    this.dragging = false;
    this.dragFrom = 0;
    this.dragStartY = 0;
    this.settled = false;
    this.viaKeyboard = false;

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onKey = this.onKey.bind(this);
    this.tick = this.tick.bind(this);

    this.bind();
  }

  bind() {
    const surface = this.root;
    surface.addEventListener('pointerdown', this.onPointerDown);
    surface.addEventListener('wheel', this.onWheel, { passive: false });
    surface.addEventListener('keydown', this.onKey);
    // klik/tap w kopułę — droga bez przeciągania
    this.lens.addEventListener('click', () => { if (!this.dragging) this.animateTo(1); });
  }

  /** Pozycja docelowa krążka brana z prawdziwego elementu w przepływie. */
  anchorCenter() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!this.mark) return { cx: vw / 2, cy: vh * 0.30 };
    const r = this.mark.getBoundingClientRect();
    if (!r.width && !r.height) return { cx: vw / 2, cy: vh * 0.30 };
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  apply(p) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { a, b, t } = sampleTrack(p);

    const resolve = (k) => (k.anchor ? this.anchorCenter() : { cx: k.cx * vw, cy: k.cy * vh });
    const ca = resolve(a);
    const cb = resolve(b);

    const s = lerp(a.s, b.s, t);
    const cx = lerp(ca.cx, cb.cx, t);
    const cy = lerp(ca.cy, cb.cy, t);
    const half = (LENS_BASE * s) / 2;

    const st = this.root.style;
    st.setProperty('--ls', s.toFixed(4));
    st.setProperty('--lx', `${(cx - half).toFixed(2)}px`);
    st.setProperty('--ly', `${(cy - half).toFixed(2)}px`);
    st.setProperty('--caustic-a', lerp(a.caustic, b.caustic, t).toFixed(3));
    st.setProperty('--hero-a', lerp(a.hero, b.hero, t).toFixed(3));
    st.setProperty('--dest-a', lerp(a.dest, b.dest, t).toFixed(3));
    st.setProperty('--p', p.toFixed(4));

    // Refrakcja jest droga — trzymamy ją włączoną tylko wtedy, gdy naprawdę coś załamuje.
    this.root.classList.toggle('is-refracting', p > 0.12);
    const done = p >= 0.999;
    if (done !== this.settled) {
      this.settled = done;
      this.root.classList.toggle('is-open', done);
      if (done && this.viaKeyboard) {
        const cta = this.root.querySelector('.login__actions a, .login__actions button');
        if (cta) cta.focus({ preventScroll: true });
      }
    }
    this.p = p;
  }

  /* Dojazd liczony CZASEM, nie klatkami: przy zgubionej klatce animacja nadrabia
     zamiast stawać w miejscu (filtr refrakcji potrafi kosztować całą klatkę). */
  tick(now) {
    const dt = this.last ? Math.min(64, now - this.last) : 16.7;
    this.last = now;
    const diff = this.target - this.p;
    if (Math.abs(diff) < 0.001) {
      this.apply(this.target);
      this.raf = 0;
      this.last = 0;
      return;
    }
    const k = 1 - Math.pow(1 - 0.16, dt / 16.7);
    this.apply(this.p + diff * k);
    this.raf = requestAnimationFrame(this.tick);
  }

  animateTo(v) {
    this.target = clamp01(v);
    if (!this.raf) { this.last = 0; this.raf = requestAnimationFrame(this.tick); }
  }

  set(v) {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.target = clamp01(v);
    this.apply(this.target);
  }

  travel() { return Math.max(220, window.innerHeight * 0.55); }

  onPointerDown(e) {
    if (this.settled) return;
    if (e.target.closest('a, button, input, select, .theme-switch')) return;
    this.viaKeyboard = false;
    this.dragging = true;
    this.dragFrom = this.p;
    this.dragStartY = e.clientY;
    this.root.setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  onPointerMove(e) {
    if (!this.dragging) return;
    e.preventDefault();
    this.set(this.dragFrom + (this.dragStartY - e.clientY) / this.travel());
  }

  onPointerUp() {
    if (!this.dragging) return;
    this.dragging = false;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.animateTo(this.p >= RELEASE_THRESHOLD ? 1 : 0);
  }

  onWheel(e) {
    this.viaKeyboard = false;
    if (this.settled && e.deltaY > 0) return;
    e.preventDefault();
    this.set(this.p + e.deltaY / this.travel());
    clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => this.animateTo(this.p >= RELEASE_THRESHOLD ? 1 : 0), 120);
  }

  onKey(e) {
    if (['Enter', ' ', 'ArrowUp', 'PageUp'].includes(e.key)) {
      if (e.target.closest('a, button, input, select')) return;
      e.preventDefault();
      this.viaKeyboard = true;
      this.animateTo(1);
    } else if (['ArrowDown', 'PageDown', 'Escape'].includes(e.key)) {
      e.preventDefault();
      this.animateTo(0);
    }
  }

  reset() { this.set(0); }
  open() { this.set(1); }
}

/* ---------- 4. Start ---------- */

function boot() {
  const root = document.querySelector('.login');
  if (!root) return;

  const supported = installLensMap() && CSS.supports('filter', 'url(#fin-refract)');
  if (!supported) document.documentElement.classList.add('no-refract');

  spawnBubbles(root.querySelector('.login__bubbles'));

  const stage = new LoginStage(root);

  // Reduced motion: ekran startuje gotowy do logowania, bez gestu i bez ruchu.
  const settle = () => {
    if (reduceMotion.matches) { document.documentElement.classList.add('no-refract'); stage.open(); }
    else stage.reset();
  };
  settle();
  reduceMotion.addEventListener?.('change', settle);

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => stage.apply(stage.p), 120);
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

/* Nawigacja na telefonie jest poziomym scrollerem — aktywna zakładka musi sama wjechać
   w kadr, inaczej „gdzie jestem" bywa ucięte krawędzią. Dokładane z zewnątrz:
   obserwujemy klasę, której i tak używa main.js, i niczego w nim nie zmieniamy. */
function keepActiveTabVisible() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const reveal = () => {
    const on = nav.querySelector('button.active');
    if (on && nav.scrollWidth > nav.clientWidth) {
      on.scrollIntoView({ inline: 'center', block: 'nearest',
        behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    }
  };
  new MutationObserver(reveal).observe(nav, {
    subtree: true, attributes: true, attributeFilter: ['class'],
  });
  reveal();
}

function bootAll() { boot(); keepActiveTabVisible(); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootAll);
else bootAll();
