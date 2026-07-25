/* glass-mapa.js — materiał soczewki i drobne pomocniki sceny: mapa przemieszczenia,
 * tor gestu, bąbelki, scroller nawigacji. Wydzielone z glass.js pod bramkę preflight
 * (<300 linii/plik). Spec: DESIGN-SPEC-GLASS §1. */

export const LENS_BASE = 256;               // px — bok bazowego pudełka soczewki (skalowany transformem).
                                     // Mniejsze pudełko = tańszy filtr; wielkość na ekranie robi transform.
export const MAP_SIZE = 256;                // px — rozdzielczość mapy przemieszczenia
export const RELEASE_THRESHOLD = 0.4;       // powyżej — dobiega do 1, poniżej — wraca do 0


/* ---------- 1. Mapa przemieszczenia (generowana RAZ) ---------- */

/** ODWRÓCENIE obrazu (prawdziwa wypukła soczewka) NIE siedzi w tej mapie —
 *  robi je transform kopii świata w glass.js (odbicie przez środek soczewki ×
 *  LENS_M): czysta geometria na GPU, działa identycznie na iOS. WebKit nie
 *  realizował offsetów mapy > promień (nagranie 07-25 23:10 — napis w soczewce
 *  zwykły), więc filtr wraca do sprawdzonego, łagodnego profilu: powiększenie +
 *  beczka, offsety ≤ 1, atrybut scale=84 jak przed odwróceniem.
 *  R = przesunięcie X, G = przesunięcie Y, 128 = zero. Alfa zawsze 255 — filtry
 *  SVG liczą na kanałach premultiplikowanych, alfa 0 dałaby ogromny skok zamiast
 *  zera. Koło wycina border-radius soczewki, nie mapa. */
export const LENS_M = 1.8;           // powiększenie odwróconego obrazu (transform świata)

export function buildLensMap(size = MAP_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const px = img.data;
  const R = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (x + 0.5 - R) / R;
      const dy = (y + 0.5 - R) / R;
      const r = Math.hypot(dx, dy);
      let ox = 0;
      let oy = 0;

      if (r <= 1) {
        // Powiększenie + beczka; przy rancie przesunięcie WYGASA do zera —
        // czysty obrys koła: skrajny piksel zostaje na miejscu, nic nie
        // wyjeżdża poza soczewkę.
        const lens = r * 0.55;
        const barrel = Math.pow(r, 2.6) * 0.20;
        const f = r < 0.90 ? 1 : Math.max(0, 1 - (r - 0.90) / 0.10);
        const mag = Math.min(1, lens + barrel) * f * f;
        const inv = r > 1e-6 ? 1 / r : 0;
        ox = -dx * inv * mag;
        oy = -dy * inv * mag;
      }

      px[i] = Math.round(128 + ox * 127);
      px[i + 1] = Math.round(128 + oy * 127);
      px[i + 2] = 128;
      px[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export function installLensMap() {
  const node = document.getElementById('fin-refract-map');
  if (!node) return false;
  const url = buildLensMap();
  node.setAttribute('href', url);
  node.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url); // starsze WebKit
  return true;
}

/* ---------- 2. Choreografia ---------- */

/** Klatki kluczowe: cx/cy to ułamki viewportu, s — skala pudełka bazowego;
 *  `anchor` = środek .login__mark z żywego DOM.
 *
 *  Model z referencji Wabi (Szymon, 07-25 nocą, runda 3): tytuł ma DWIE warstwy.
 *  `dlens` — słowo w kopii sceny POD SZKŁEM (widoczne wyłącznie przez soczewkę,
 *  jako nieczytelna, odwrócona smuga wędrująca po przeciwnej stronie tafli).
 *  `dest` — PRAWDZIWY tytuł: nie istnieje przez całą wspinaczkę, wysuwa się
 *  spod kamyka dopiero na samej górze (rampa .80→.88 + zjazd dsl 1.27→1).
 *  `dsl` prowadzi pozycję OBU warstw: 0 = 30vh poniżej celu, 1 = na miejscu,
 *  >1 = schowany ZA kamykiem, lekko powyżej celu — przez wspinaczkę słowo jedzie
 *  tuż pod środkiem soczewki, więc smuga cały czas jest w polu tafli.
 *  W dół — dokładnie ta sama droga wstecz (zero zatrzasków, czysta funkcja p). */
export const KEYFRAMES = [
  { p: 0.00, cx: 0.5, cy: 1.08, s: 1.85, hero: 1, dest: 0, dlens: 0, dsl: 0, cta: 0 },
  { p: 0.30, cx: 0.5, cy: 0.86, s: 1.42, hero: 0.7, dest: 0, dlens: 0, dsl: 0, cta: 0 },
  { p: 0.36, cx: 0.5, cy: 0.80, s: 1.32, hero: 0.5, dest: 0, dlens: 1, dsl: 0.10, cta: 0 },
  // dsl prowadzi słowo TUŻ POD ŚRODKIEM soczewki przez całą wspinaczkę — okno
  // źródła odbicia to R/M wokół środka, więc smuga w tafli żyje tylko wtedy,
  // gdy słowo trzyma się blisko osi szkła (wartości = tor soczewki w vh).
  { p: 0.50, cx: 0.5, cy: 0.585, s: 1.12, hero: 0, dest: 0, dlens: 1, dsl: 0.70, cta: 0 },
  { p: 0.58, cx: 0.5, cy: 0.545, s: 1.00, hero: 0, dest: 0, dlens: 1, dsl: 0.85, cta: 0 },
  { p: 0.80, anchor: true, s: 0.55, hero: 0, dest: 0, dlens: 1, dsl: 1.30, cta: 0 },
  { p: 0.88, anchor: true, s: 0.40, hero: 0, dest: 0, dlens: 1, dsl: 1.30, cta: 0 },
  // Prawdziwy tytuł wychodzi DOPIERO, gdy soczewka realnie dojechała (uwaga
  // 07-25 23:10: „pojawia się zanim soczewka dojedzie") — rampa .935→.985,
  // słowo wysuwa się w dół spod dolnej krawędzi kamyka (dsl>1 → 1).
  { p: 0.935, anchor: true, s: 0.33, hero: 0, dest: 0, dlens: 1, dsl: 1.26, cta: 0 },
  { p: 0.985, anchor: true, s: 0.26, hero: 0, dest: 1, dlens: 1, dsl: 1.03, cta: 0 },
  { p: 1.00, anchor: true, s: 0.25, hero: 0, dest: 1, dlens: 1, dsl: 1, cta: 1 },
];

export function anchorCenter(root) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const mark = root.querySelector('.login__mark');
  const r = mark && mark.getBoundingClientRect();
  if (!r || (!r.width && !r.height)) return { cx: vw / 2, cy: vh * 0.30 };
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

function resolveK(root, k) {
  if (k.anchor) return anchorCenter(root);
  return { cx: (k.cx ?? 0.5) * window.innerWidth, cy: (k.cy ?? 0.5) * window.innerHeight };
}

/** Pełny punkt toru dla postępu p: pozycja, skala, przezroczystości i slide tytułu. */
export function trackPoint(root, p) {
  const { a, b, t } = sampleTrack(p);
  const ca = resolveK(root, a), cb = resolveK(root, b);
  return {
    x: lerp(ca.cx, cb.cx, t), y: lerp(ca.cy, cb.cy, t), s: lerp(a.s, b.s, t),
    hero: lerp(a.hero, b.hero, t), dest: lerp(a.dest, b.dest, t),
    dlens: lerp(a.dlens, b.dlens, t), dsl: lerp(a.dsl, b.dsl, t), cta: lerp(a.cta, b.cta, t),
  };
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function sampleTrack(p) {
  let a = KEYFRAMES[0];
  let b = KEYFRAMES[KEYFRAMES.length - 1];
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (p >= KEYFRAMES[i].p && p <= KEYFRAMES[i + 1].p) { a = KEYFRAMES[i]; b = KEYFRAMES[i + 1]; break; }
  }
  const span = b.p - a.p;
  const t = span > 0 ? (p - a.p) / span : 0;
  return { a, b, t };
}

/* ---------- 2a. Warstwy napisów — zapisy INLINE, nie zmienne CSS ----------
   Zmiana custom property na .login unieważnia style całej sceny co klatkę (główne
   źródło klatkowania na iOS). Zamiast tego trzymamy uchwyty i piszemy opacity/
   transform wprost, wyłącznie gdy wartość faktycznie się zmieniła. */
export function collectFx(root) {
  const q = (s) => root.querySelector(s);
  return {
    heroR: q('.login__inner .login__hero'), heroC: q('.lens__world .login__hero'),
    hint: q('.login__hint'),
    titleR: q('.login__inner .login__title'), titleC: q('.lens__world .login__title'),
    subR: q('.login__inner .login__sub'), subC: q('.lens__world .login__sub'),
    acts: q('.login__actions'), sw: q('.login__switch'),
    hero: -1, dsl: -1, dest: -1, dlens: -1, cta: -1,
  };
}

export function applyFx(fx, tp, vh) {
  if (Math.abs(fx.hero - tp.hero) > 0.001) {
    fx.hero = tp.hero;
    const o = tp.hero.toFixed(3);
    const t = `translateY(calc(-50% - ${((1 - tp.hero) * 52).toFixed(1)}px))`;
    for (const h of [fx.heroR, fx.heroC]) if (h) { h.style.opacity = o; h.style.transform = t; }
    if (fx.hint) fx.hint.style.opacity = o;
  }
  if (Math.abs(fx.dsl - tp.dsl) > 0.0005) {
    fx.dsl = tp.dsl;
    const t = `translateY(${((1 - tp.dsl) * 0.30 * vh).toFixed(1)}px)`;
    if (fx.titleR) fx.titleR.style.transform = t;
    if (fx.titleC) fx.titleC.style.transform = t;
  }
  if (fx.titleR && Math.abs(fx.dest - tp.dest) > 0.001) { fx.dest = tp.dest; fx.titleR.style.opacity = tp.dest.toFixed(3); }
  if (fx.titleC && Math.abs(fx.dlens - tp.dlens) > 0.001) { fx.dlens = tp.dlens; fx.titleC.style.opacity = tp.dlens.toFixed(3); }
  if (Math.abs(fx.cta - tp.cta) > 0.001) {
    fx.cta = tp.cta;
    const o = tp.cta.toFixed(3);
    for (const n of [fx.subR, fx.subC, fx.acts, fx.sw]) if (n) n.style.opacity = o;
  }
}

/* ---------- 3. Bąbelki ---------- */

/* Bąbelki = EMITER, nie statyczna kolumna. Każdy bąbelek rodzi się przy soczewce
   i od chwili narodzin leci swobodnie w górę (animacja CSS, jednorazowa) — więc gdy
   soczewka wędruje, powstaje wąż/smuga jak dym: świeże trzymają się soczewki, stare
   płyną już własną drogą. Żywe, szklane kolory (życzenie Szymona 2026-07-25). */
export const BUBBLE_HUES = [15, 45, 95, 160, 205, 260, 300, 335];
const MAX_BUBBLES = 64;

export function emitBubble(host, x, y, burst = 1) {
  if (!host || host.childElementCount >= MAX_BUBBLES) return;
  const hue = BUBBLE_HUES[Math.floor(Math.random() * BUBBLE_HUES.length)];
  const b = document.createElement('span');
  b.className = 'bubble';
  b.style.left = `${(x + (Math.random() - 0.5) * 44).toFixed(1)}px`;
  b.style.top = `${(y + (Math.random() - 0.5) * 18).toFixed(1)}px`;
  b.style.setProperty('--b-size', `${(6 + Math.pow(Math.random(), 1.9) * 34 * burst).toFixed(1)}px`);
  b.style.setProperty('--b-hue', hue);
  b.style.setProperty('--b-hue2', (hue + 50 + Math.random() * 70).toFixed(0));
  b.style.setProperty('--b-dur', `${(4.5 + Math.random() * 6).toFixed(1)}s`);
  b.style.setProperty('--b-drift', `${(Math.random() * 110 - 55).toFixed(1)}px`);
  b.style.setProperty('--b-op', (0.55 + Math.random() * 0.4).toFixed(2));
  b.addEventListener('animationend', () => b.remove());
  host.appendChild(b);
}

/* ---------- 4. Nawigacja-scroller ----------
   Na telefonie nav przewija się w poziomie — aktywna zakładka sama wjeżdża w kadr.
   Obserwujemy klasę, której i tak używa main.js, i niczego w nim nie zmieniamy. */
export function keepActiveTabVisible(reduceMotion) {
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

