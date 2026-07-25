/* glass-mapa.js — materiał soczewki i drobne pomocniki sceny: mapa przemieszczenia,
 * tor gestu, bąbelki, scroller nawigacji. Wydzielone z glass.js pod bramkę preflight
 * (<300 linii/plik). Spec: DESIGN-SPEC-GLASS §1. */

export const LENS_BASE = 256;               // px — bok bazowego pudełka soczewki (skalowany transformem).
                                     // Mniejsze pudełko = tańszy filtr; wielkość na ekranie robi transform.
export const MAP_SIZE = 256;                // px — rozdzielczość mapy przemieszczenia
export const RELEASE_THRESHOLD = 0.4;       // powyżej — dobiega do 1, poniżej — wraca do 0


/* ---------- 1. Mapa przemieszczenia (generowana RAZ) ---------- */

/** Profil sferyczny: R = przesunięcie X, G = przesunięcie Y, 128 = zero.
 *  Alfa zawsze 255 — filtry SVG liczą na kanałach premultiplikowanych, więc alfa 0
 *  wyzerowałaby R/G i dała gigantyczne przesunięcie zamiast żadnego. Koło wycina
 *  border-radius soczewki, nie mapa. */
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
        // Powiększenie liniowe + beczka; przy rancie przesunięcie WYGASA do zera —
        // stąd czysty obrys koła: piksel na krawędzi zostaje na miejscu, więc żaden
        // fragment obrazu (ani refleks) nie może „wyjechać" poza soczewkę.
        // (Poprzedni wariant robił odwrotnie — wzmacniał przesunięcie na rancie —
        // i to była ta odklejona obwódka z nagrań produkcji.)
        const lens = r * 0.55;                                    // równomierne powiększenie
        const barrel = Math.pow(r, 2.6) * 0.20;                   // beczka: proste linie w łuk
        const fade = r < 0.90 ? 1 : Math.max(0, 1 - (r - 0.90) / 0.10);
        const mag = Math.min(1, lens + barrel) * fade * fade;
        const inv = r > 1e-6 ? 1 / r : 0;
        ox = -dx * inv * mag;                                     // próbkujemy bliżej środka => powiększenie
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

/** Klatki kluczowe: cx/cy to ułamki viewportu, s — skala pudełka bazowego.
 *  Klatki specjalne rozwiązuje glass.js z żywego DOM: `anchor` = środek .login__mark,
 *  `heroc`/`textc` = środek bloku hero / tytułu, `cover:'hero'|'dest'` = skala,
 *  przy której soczewka ZAKRYWA cały dany blok tekstu.
 *
 *  Zasada „zero fade" (Szymon, referencja Wabi): napisy przełączają się TWARDO
 *  (klatki .50→.54 i .68→.72 leżą tuż obok siebie), ale zawsze pod taflą — stary
 *  napis znika, gdy soczewka go zakrywa, nowy rodzi się już zniekształcony pod
 *  szkłem, a odsłania go dopiero kurczenie się soczewki w drodze do kotwicy.
 *  W dół — ta sama droga wstecz: soczewka rośnie na wysokości tekstu i go „zjada".
 *  `cta` steruje osobno przyciskami na dole (te wolno wjeżdżają — nie są pod szkłem). */
export const KEYFRAMES = [
  { p: 0.00, cx: 0.5, cy: 1.08, s: 1.85, hero: 1, dest: 0, cta: 0 },
  { p: 0.28, cx: 0.5, cy: 0.86, s: 1.80, hero: 1, dest: 0, cta: 0 },
  { p: 0.50, heroc: true, cover: 'hero', hero: 1, dest: 0, cta: 0 },
  { p: 0.54, heroc: true, cover: 'hero', hero: 0, dest: 0, cta: 0 },
  { p: 0.68, textc: true, cover: 'dest', hero: 0, dest: 0, cta: 0.1 },
  { p: 0.72, textc: true, cover: 'dest', hero: 0, dest: 1, cta: 0.35 },
  { p: 1.00, anchor: true, s: 0.25, hero: 0, dest: 1, cta: 1 },
];

/** Prostokąt obejmujący listę elementów (viewport px). */
export function blockRect(els) {
  let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
  for (const el of els) {
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    L = Math.min(L, r.left); T = Math.min(T, r.top);
    R = Math.max(R, r.right); B = Math.max(B, r.bottom);
  }
  if (!Number.isFinite(L)) return null;
  return { cx: (L + R) / 2, cy: (T + B) / 2, w: R - L, h: B - T };
}

/* Rozwiązywanie klatek na żywym DOM: kotwica (.login__mark), środek bloku tekstu,
   skala „cover" zakrywająca cały blok. */
function blok(root, which) {
  const sel = which === 'hero' ? ['.login__hero'] : ['.login__title', '.login__sub'];
  return blockRect(sel.map((s) => root.querySelector('.login__inner ' + s)));
}

export function anchorCenter(root) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const mark = root.querySelector('.login__mark');
  const r = mark && mark.getBoundingClientRect();
  if (!r || (!r.width && !r.height)) return { cx: vw / 2, cy: vh * 0.30 };
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

function resolveK(root, k) {
  if (k.anchor) return anchorCenter(root);
  if (k.heroc || k.textc) {
    const b = blok(root, k.heroc ? 'hero' : 'dest');
    if (b) return { cx: b.cx, cy: b.cy };
  }
  return { cx: (k.cx ?? 0.5) * window.innerWidth, cy: (k.cy ?? 0.5) * window.innerHeight };
}

function scaleK(root, k) {
  if (k.cover) {
    const b = blok(root, k.cover);
    if (b) return Math.min(2.8, (Math.hypot(b.w, b.h) + 44) / LENS_BASE);
  }
  return k.s;
}

/** Pełny punkt toru dla postępu p: pozycja, skala i przezroczystości warstw. */
export function trackPoint(root, p) {
  const { a, b, t } = sampleTrack(p);
  const ca = resolveK(root, a), cb = resolveK(root, b);
  return {
    x: lerp(ca.cx, cb.cx, t), y: lerp(ca.cy, cb.cy, t),
    s: lerp(scaleK(root, a), scaleK(root, b), t),
    hero: lerp(a.hero, b.hero, t), dest: lerp(a.dest, b.dest, t), cta: lerp(a.cta, b.cta, t),
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
  b.style.setProperty('--b-size', `${(4 + Math.pow(Math.random(), 2.1) * 26 * burst).toFixed(1)}px`);
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

