// Paleta kolorów kategorii (K6). Kolory liczone w przestrzeni OKLCH: stała jasność
// i chroma + równomiernie rozłożony odcień = jednakowa waga wizualna każdej kategorii
// i czytelność w obu motywach. Podkategoria dziedziczy odcień rodzica, zmienia się jasność.
//
// Moduł CELOWO niczego nie importuje i nie dotyka DOM — dzięki temu jest testowalny
// w Node (scripts/test-kategorie.js) i nadaje się do użycia w przeglądarce bez zmian.

export const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHex = (v) => typeof v === 'string' && HEX.test(v);

const START = 25;                          // odcień pierwszej kategorii (ciepła czerwień)
const JASNY = { L: 0.62, C: 0.13 };        // oklch(62% 0.13 h) — motyw jasny
const CIEMNY = { L: 0.72, C: 0.11 };       // oklch(72% 0.11 h) — motyw ciemny
const KROK_PODKAT = 0.06;                  // o tyle jaśniejsza/ciemniejsza każda kolejna podkategoria

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// liniowe sRGB -> sRGB z gammą; wejście domknięte do 0–1, żeby kolor spoza gamutu
// dawał najbliższy możliwy, a nie NaN.
const kanal = (u) => {
  const x = clamp(u, 0, 1);
  const g = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(clamp(g, 0, 1) * 255).toString(16).padStart(2, '0');
};

// OKLCH -> '#rrggbb'. L: 0–1 (jasność), C: 0–0.4 (chroma), H: stopnie (odcień).
export function oklchHex(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return '#'
    + kanal(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
    + kanal(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
    + kanal(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

// n odcieni rozłożonych równomiernie po kole barw, zaczynając od START.
export function odcienie(n) {
  const ile = Math.max(Number(n) || 0, 1);
  return Array.from({ length: ile }, (_, i) => (START + (360 * i) / ile) % 360);
}

// Kolory dla całego drzewa: [{id, color}] — korzenie i podkategorie, w kolejności drzewa.
export function paletaDrzewa(drzewo, ciemny = false) {
  const { L, C } = ciemny ? CIEMNY : JASNY;
  const hs = odcienie(drzewo.length);
  const out = [];
  drzewo.forEach((k, i) => {
    out.push({ id: k.id, color: oklchHex(L, C, hs[i]) });
    (k.children || []).forEach((pod, j) => {
      const krok = (j + 1) * KROK_PODKAT * (ciemny ? -1 : 1);
      out.push({ id: pod.id, color: oklchHex(clamp(L + krok, 0.32, 0.92), C * 0.9, hs[i]) });
    });
  });
  return out;
}
