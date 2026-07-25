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
        // Trzy składowe, każda odpowiada za inny fragment obrazu z referencji.
        // Składowa liniowa MUSI dominować: to ona daje równomierne powiększenie (~1,9×)
        // w środku soczewki i zeruje dyspersję dokładnie w centrum (ox → 0 przy r → 0).
        const lens = r * 0.55;                                    // równomierne powiększenie
        const barrel = Math.pow(r, 2.6) * 0.20;                   // beczka: proste linie wyginają się w łuk
        const t = Math.max(0, (r - 0.88) / 0.12);
        const rim = t * t * 0.07;                                 // „zawinięcie" obrazu w pierścień przy rancie
        const mag = Math.min(1, lens + barrel + rim);
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
 *  Ostatnia klatka nie ma cx/cy — pozycję docelową bierzemy z prawdziwego elementu
 *  `.login__mark` w przepływie, żeby krążek siedział idealnie nad tytułem w każdej szerokości. */
/* Kaustyka żyje na DOLNYM obwodzie bańki, więc w szczycie łuku dolna krawędź musi
   mieścić się w kadrze: przy s=1.16 (średnica 371 px) środek na 0.61vh daje krawędź
   na ~0.83vh — dokładnie tam, gdzie jest w `ref-02-luk-kaustyka.png`. */
export const KEYFRAMES = [
  { p: 0.00, cx: 0.5, cy: 1.08, s: 1.85, caustic: 0.00, dest: 0, hero: 1 },
  { p: 0.20, cx: 0.5, cy: 0.80, s: 1.63, caustic: 0.55, dest: 0, hero: 0 },
  { p: 0.42, cx: 0.5, cy: 0.61, s: 1.45, caustic: 1.00, dest: 0, hero: 0 },
  { p: 0.64, cx: 0.5, cy: 0.55, s: 1.08, caustic: 0.38, dest: 0, hero: 0 },
  { p: 0.82, anchor: true, s: 0.53, caustic: 0.08, dest: 0.85, hero: 0 },
  { p: 1.00, anchor: true, s: 0.25, caustic: 0.00, dest: 1, hero: 0 },
];

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

/* Bąbelki = matowe kamyki mlecznego szkła; ton to szept pastelu (szałwia / róż / niebo
   — te same barwy co plamy tła), nie kolor. Ruch robią animacje CSS (kompozytor). */
export const BUBBLE_HUES = [165, 25, 250];

export function spawnBubbles(host, count = 16) {
  if (!host || host.childElementCount) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const b = document.createElement('span');
    b.className = 'bubble';
    const size = 4 + Math.pow(Math.random(), 2.6) * 26;           // dużo drobnych, kilka większych
    const hue = BUBBLE_HUES[Math.floor(Math.random() * BUBBLE_HUES.length)];
    b.style.setProperty('--b-size', `${size.toFixed(1)}px`);
    // Start wąsko nad krążkiem; rozrzut robi dopiero dryf w trakcie wznoszenia — smuga, nie konfetti.
    b.style.setProperty('--b-x', `${(50 + (Math.random() - 0.5) * 26).toFixed(2)}%`);
    b.style.setProperty('--b-hue', hue);
    b.style.setProperty('--b-c', (0.010 + Math.random() * 0.014).toFixed(3)); // chroma-szept
    b.style.setProperty('--b-dur', `${(11 + Math.random() * 16).toFixed(1)}s`);
    b.style.setProperty('--b-delay', `${(-Math.random() * 22).toFixed(1)}s`);
    b.style.setProperty('--b-drift', `${(Math.random() * 120 - 60).toFixed(1)}px`);
    b.style.setProperty('--b-op', (0.5 + Math.random() * 0.35).toFixed(2));
    frag.appendChild(b);
  }
  host.appendChild(frag);
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

