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

/** POZYCJA nie stoi w klatkach: soczewka jedzie PROSTO od spoczynku pod ekranem
 *  do kotwicy (.login__mark z żywego DOM), liniowo w p. To celowe — `p` liczy się
 *  z wysokości soczewki (pFromY w glass.js), więc liniowy tor jest dokładną
 *  odwrotnością tamtego wzoru i chwyt palcem ma tę samą skalę co dojazd sam.
 *  Poprzednio klatki stawiały soczewkę na kotwicy już przy p=0.80, a p=1 wypadało
 *  0.16vh PONIŻEJ kotwicy — w geście soczewka miała więc rozmiar docelowy (i napis!)
 *  jeszcze w połowie ekranu i przez napis „Finansowa" jechała już malutka
 *  (uwaga Szymona 07-26 wieczorem). p = po prostu „ile drogi do domu". */
export const START_CY = 1.08;               // spoczynek: środek soczewki pod krawędzią ekranu

export function trackPos(root, p) {
  const home = anchorCenter(root);
  const y0 = window.innerHeight * START_CY;
  return { x: lerp(window.innerWidth / 2, home.cx, p), y: lerp(y0, home.cy, p) };
}

/** Klatki kluczowe: s — skala pudełka bazowego, resztę patrz applyFx.
 *  `hero` — pierwszy napis (gaśnie, gdy szkło się zbliża).
 *  `dest`  — tytuł „Finansowa": nie istnieje przez CAŁĄ wspinaczkę (także w kopii
 *  pod szkłem — smuga pod soczewką WYCOFANA 07-26, życzenie Szymona), wyłania się
 *  spod kamyka dopiero na samej górze; `dsl` prowadzi jego pozycję (1 = na miejscu,
 *  >1 = schowany ZA kamykiem, lekko powyżej celu).
 *  `cta` — podtytuł + przyciski, dopiero gdy tytuł stoi już w miejscu.
 *  Pomniejszanie ROZŁOŻONE na sam koniec drogi: do p=0.86 soczewka trzyma się
 *  wielkości ~1 (przez napis przechodzi duża), rozmiar docelowy osiąga dopiero
 *  siadając na kotwicy. Ta sama krzywa w dół = zabrana z domu rośnie natychmiast.
 *  W dół dokładnie ta sama droga wstecz (zero zatrzasków, czysta funkcja p). */
export const KEYFRAMES = [
  { p: 0.00, s: 1.85, hero: 1, dest: 0, dsl: 1.30, cta: 0 },
  { p: 0.20, s: 1.70, hero: 0.92, dest: 0, dsl: 1.30, cta: 0 },
  { p: 0.40, s: 1.52, hero: 0.62, dest: 0, dsl: 1.30, cta: 0 },
  { p: 0.56, s: 1.36, hero: 0.28, dest: 0, dsl: 1.30, cta: 0 },
  { p: 0.70, s: 1.22, hero: 0, dest: 0, dsl: 1.30, cta: 0 },
  { p: 0.86, s: 1.02, hero: 0, dest: 0, dsl: 1.30, cta: 0 },
  { p: 0.92, s: 0.86, hero: 0, dest: 0, dsl: 1.30, cta: 0 },
  // Tytuł wychodzi DOPIERO tutaj — i nie „pojawia się", a wysuwa spod kamyka
  // (zasłona, patrz applyFx). Kamyk jest wtedy jeszcze 2–3× większy od docelowego,
  // rozmiar docelowy bierze na ostatnich pikselach drogi. Okno cofnięte o ~0,2 s
  // względem pierwszej wersji (Szymon 07-26: „lekko wcześniej niech się pojawia").
  { p: 0.94, s: 0.74, hero: 0, dest: 1, dsl: 1.28, cta: 0 },
  { p: 0.96, s: 0.60, hero: 0, dest: 1, dsl: 1.22, cta: 0 },
  { p: 0.972, s: 0.48, hero: 0, dest: 1, dsl: 1.14, cta: 0 },
  { p: 0.985, s: 0.36, hero: 0, dest: 1, dsl: 1.06, cta: 0 },
  { p: 0.993, s: 0.30, hero: 0, dest: 1, dsl: 1.01, cta: 0.35 },
  { p: 1.00, s: 0.25, hero: 0, dest: 1, dsl: 1.00, cta: 1 },
];

export function anchorCenter(root) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const mark = root.querySelector('.login__mark');
  const r = mark && mark.getBoundingClientRect();
  if (!r || (!r.width && !r.height)) return { cx: vw / 2, cy: vh * 0.30 };
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

/** Pełny punkt toru dla postępu p: pozycja, skala, przezroczystości i slide tytułu. */
export function trackPoint(root, p) {
  const { a, b, t } = sampleTrack(p);
  const pos = trackPos(root, p);
  return {
    x: pos.x, y: pos.y, s: lerp(a.s, b.s, t),
    hero: lerp(a.hero, b.hero, t), dest: lerp(a.dest, b.dest, t),
    dsl: lerp(a.dsl, b.dsl, t), cta: lerp(a.cta, b.cta, t),
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
export const SLIDE = 0.30;      // skala poślizgu tytułu (dsl=0 → 30vh pod celem)

/** Pomiar POZYCJI SPOCZYNKOWEJ tytułu (bez transformu) — potrzebny do zasłony.
 *  Osobno, bo w chwili budowy sceny sekcja logowania jest jeszcze `hidden`
 *  (offsetTop = 0); glass.js woła to z jump(), czyli przy wejściu na widok,
 *  po zmianie rozmiaru okna i po doładowaniu fontów. */
export function measureFx(fx) {
  if (!fx.titleR || !fx.titleR.offsetHeight) return;
  fx.titleY0 = fx.titleR.offsetTop;
  fx.titleH = fx.titleR.offsetHeight;
}

export function collectFx(root) {
  const q = (s) => root.querySelector(s);
  return {
    heroR: q('.login__inner .login__hero'), heroC: q('.lens__world .login__hero'),
    hint: q('.login__hint'),
    titleR: q('.login__inner .login__title'), titleC: q('.lens__world .login__title'),
    subR: q('.login__inner .login__sub'), subC: q('.lens__world .login__sub'),
    acts: q('.login__actions'), sw: q('.login__switch'),
    titleY0: 0, titleH: 0,
    hero: -1, dsl: -1, dest: -1, cta: -1, cut: -1,
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
    const t = `translateY(${((1 - tp.dsl) * SLIDE * vh).toFixed(1)}px)`;
    if (fx.titleR) fx.titleR.style.transform = t;
    if (fx.titleC) fx.titleC.style.transform = t;
  }
  // WYSUNIĘCIE spod kamyka to ZASŁONA, nie pojawianie się: słowo jest przycięte do
  // tej części, która wystaje poniżej dolnej krawędzi soczewki. Napis jest szerszy
  // niż kamyk, więc sam fade byłoby widać po bokach („nie może być widać fadein");
  // przy zjeżdżaniu w dół chowa się z powrotem tą samą drogą. Geometria liczona
  // z toru (zero odczytów DOM na klatkę), zapis tylko przy realnej zmianie.
  const cut = Math.min(fx.titleH, tp.y + (LENS_BASE * tp.s) / 2 - (fx.titleY0 + (1 - tp.dsl) * SLIDE * vh));
  if (Math.abs(fx.cut - cut) > 0.5) {
    fx.cut = cut;
    const v = cut > 0 ? `inset(${cut.toFixed(1)}px 0 0 0)` : 'none';
    for (const n of [fx.titleR, fx.titleC]) if (n) n.style.clipPath = v;
  }
  // Jedna widoczność dla obu warstw tytułu: w oryginale i w kopii pod szkłem.
  // Osobny kanał `dlens` (nieczytelna smuga wędrująca pod soczewką w czasie
  // wspinaczki) WYCOFANY 07-26 — Szymon: „usuń ten pierwszy napis". Kopia zostaje,
  // bo dzięki niej osiadły kamyk nadal załamuje napis, gdy się nim machnie.
  if (Math.abs(fx.dest - tp.dest) > 0.001) {
    fx.dest = tp.dest;
    const o = tp.dest.toFixed(3);
    for (const n of [fx.titleR, fx.titleC]) if (n) n.style.opacity = o;
  }
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

