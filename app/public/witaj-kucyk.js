/* witaj-kucyk.js — rysunek sceny planszy powitalnej: kucyk-jednorożec (wariant A
 * „bajkowy", wybrany przez Szymona 07-26 z trzech propozycji w docs/design/kucyki/),
 * tęcza z zadu i uchwyty do animowania. Zero logiki czasu — tę prowadzi witaj.js.
 *
 * Układ współrzędnych: viewBox -38 -190 320 380. Kucyk stoi na y=156, zwrócony w PRAWO;
 * kadr jest wyraźnie szerszy i wyższy od niego — stąd jego skromny rozmiar na ekranie
 * i miejsce na napis nad nim. Proporcje źrebięce: duża głowa, krótkie nogi,
 * korpus-beczułka. Paleta grzywy i ogona = odcienie bąbelków z ekranu logowania.
 */

export const HUES = [15, 45, 95, 160, 205, 260, 300, 335];
export const SIERSC = 'oklch(93.5% .035 295)';    // nie biała: biel ginęła w tle
export const KONTUR = 'oklch(56% .065 295)';       // czyta się i na jasnym, i na ciemnym
const t = (h, l = 78, c = 0.17) => `oklch(${l}% ${c} ${h})`;

/* Zaczepy transformów (współrzędne viewBox) — witaj.js ustawia je jako
   transform-origin, więc muszą być tu, przy geometrii, a nie tam. */
export const OS = {
  tail: [68, 76],            // nasada ogona
  head: [150, 60],           // kark: obrót głowy przy spojrzeniu na widza
  legs: { bl: [80, 110], br: [94, 112], fl: [126, 110], fr: [140, 112] },
};

const LEGS = [['bl', 80, 110, 74, 156], ['br', 94, 112, 98, 156],
              ['fl', 126, 110, 120, 156], ['fr', 140, 112, 146, 156]];
const noga = ([k, x1, y1, x2, y2]) => `
  <g class="w-leg w-leg--${k}">
    <path d="M${x1} ${y1} L${x2} ${y2 - 6}" stroke="${KONTUR}" stroke-width="21" stroke-linecap="round"/>
    <path d="M${x1} ${y1} L${x2} ${y2 - 6}" stroke="${k[0] === 'b' ? 'oklch(88% .045 295)' : SIERSC}"
          stroke-width="16" stroke-linecap="round"/>
    <path d="M${x2} ${y2 - 7} v3" stroke="oklch(58% .08 295)" stroke-width="16" stroke-linecap="round"/>
  </g>`;

/* Znacznik zadu: punkt, z którego sypie się konfetti (Szymon 07-26: bez tęczy,
   strumień leci wprost z zadu po podniesieniu ogona). Leży POZA grupą kucyka —
   kucyk w czasie sypania stoi, więc pozycja jest stała i mierzy się ją raz. */
const ZAD = '<circle class="w-rump" cx="64" cy="92" r="1" fill="none" stroke="none"/>';

const TWARZ_BOK = `
<g class="w-face w-face--side">
  <ellipse cx="176" cy="52" rx="30" ry="27" fill="${SIERSC}" stroke="${KONTUR}" stroke-width="2.6"/>
  <ellipse cx="197" cy="65" rx="13" ry="10.5" fill="oklch(95% .028 40)"/>
  <ellipse cx="200" cy="62" rx="1.7" ry="2.2" fill="oklch(74% .05 300)"/>
  <ellipse cx="163" cy="62" rx="8" ry="6" fill="oklch(92% .05 20)" opacity=".55"/>
  <ellipse class="w-eye" cx="184" cy="48" rx="5.4" ry="6.2" fill="oklch(26% .04 280)" style="--ox:184px;--oy:48px"/>
  <circle cx="186" cy="45.5" r="2" fill="#fff"/>
  <path class="w-smile" d="M190 71 q6 5 12 -1" stroke="oklch(56% .08 30)" stroke-width="2.3"
        fill="none" stroke-linecap="round" opacity="0"/>
</g>`;

const TWARZ_PRZOD = `
<g class="w-face w-face--front" opacity="0">
  <ellipse cx="176" cy="52" rx="31" ry="28" fill="${SIERSC}" stroke="${KONTUR}" stroke-width="2.6"/>
  <ellipse cx="176" cy="68" rx="15" ry="11" fill="oklch(95% .028 40)"/>
  <ellipse cx="171" cy="66" rx="1.7" ry="2.2" fill="oklch(74% .05 300)"/>
  <ellipse cx="181" cy="66" rx="1.7" ry="2.2" fill="oklch(74% .05 300)"/>
  <ellipse cx="153" cy="60" rx="8" ry="6" fill="oklch(92% .05 20)" opacity=".5"/>
  <ellipse cx="199" cy="60" rx="8" ry="6" fill="oklch(92% .05 20)" opacity=".5"/>
  <ellipse class="w-eye" cx="164" cy="47" rx="5.4" ry="6.4" fill="oklch(26% .04 280)" style="--ox:164px;--oy:47px"/>
  <ellipse class="w-eye" cx="188" cy="47" rx="5.4" ry="6.4" fill="oklch(26% .04 280)" style="--ox:188px;--oy:47px"/>
  <circle cx="166" cy="44.5" r="2" fill="#fff"/><circle cx="190" cy="44.5" r="2" fill="#fff"/>
  <path class="w-smile" d="M167 72 q9 6 18 0" stroke="oklch(56% .08 30)" stroke-width="2.5"
        fill="none" stroke-linecap="round" opacity="0"/>
</g>`;

/** Cała scena. Kadr jest SZERSZY od kucyka (Szymon 07-26: „mniejszy powinien być
 *  ten konik") — przy skalowaniu `meet` większy viewBox = mniejszy kucyk na ekranie,
 *  a wbieg nadal zaczyna się poza ekranem, nie przy krawędzi jakiegoś pudełka. */
export function sceneSVG() {
  return `<svg class="w-scena" viewBox="-38 -190 320 380" aria-hidden="true" focusable="false">
  ${ZAD}
  <g class="w-pony">
    <ellipse class="w-cien" cx="106" cy="157" rx="56" ry="6" fill="oklch(45% .03 280)" opacity=".10"/>
    <g class="w-tail">
      ${HUES.slice(0, 5).map((h, i) => `<path d="M68 ${76 + i * 3} C48 ${90 + i * 5}, ${38 - i * 2} ${116 + i * 4}, ${46 + i * 4} ${146 - i * 3}"
        stroke="${t(h)}" stroke-width="10" stroke-linecap="round" fill="none"/>`).join('')}
    </g>
    <g class="w-legs w-legs--tyl">${LEGS.slice(0, 2).map(noga).join('')}</g>
    <path d="M138 94 L163 60" stroke="${KONTUR}" stroke-width="45" stroke-linecap="round"/>
    <path class="w-neck" d="M138 94 L163 60" stroke="${SIERSC}" stroke-width="40" stroke-linecap="round"/>
    <path class="w-body" d="M62 96 C62 74, 80 62, 106 62 C134 62, 150 74, 150 96 C150 118, 132 128, 106 128 C80 128, 62 118, 62 96 Z"
          fill="${SIERSC}" stroke="${KONTUR}" stroke-width="2.6"/>
    <path d="M78 122 C96 129, 128 128, 146 118 C136 127, 100 131, 78 122 Z" fill="oklch(88% .05 295)"/>
    <g class="w-legs w-legs--przod">${LEGS.slice(2).map(noga).join('')}</g>
    <g class="w-head">
      ${TWARZ_BOK}
      ${TWARZ_PRZOD}
      <path d="M156 30 L159 12 L170 27 Z" fill="oklch(90% .045 295)" stroke="${KONTUR}" stroke-width="2.2"/>
      <path class="w-horn" d="M174 26 L191 -3 L184 29 Z" fill="oklch(89% .11 85)" stroke="${KONTUR}" stroke-width="2.2"/>
      <g class="w-mane">
        ${HUES.slice(2, 7).map((h, i) => `<path d="M${160 - i * 7} ${28 + i * 4} C${150 - i * 8} ${40 + i * 4}, ${142 - i * 7} ${52 + i * 5}, ${130 - i * 5} ${70 + i * 6}"
          stroke="${t(h)}" stroke-width="11" stroke-linecap="round" fill="none"/>`).join('')}
      </g>
    </g>
  </g>
</svg>`;
}

/** Uchwyty + jednorazowe ustawienia, których nie da się zapisać w CSS-ie
 *  (transform-origin z geometrii viewBoxa, długości ścieżek tęczy). */
export function zbierz(root) {
  const q = (s) => root.querySelector(s);
  const qa = (s) => [...root.querySelectorAll(s)];
  const orig = (el, [x, y]) => { if (el) el.style.transformOrigin = `${x}px ${y}px`; };
  orig(q('.w-tail'), OS.tail);
  orig(q('.w-head'), OS.head);
  for (const [k, o] of Object.entries(OS.legs)) orig(q(`.w-leg--${k}`), o);
  for (const e of qa('.w-eye')) e.style.transformOrigin = `${e.style.getPropertyValue('--ox')} ${e.style.getPropertyValue('--oy')}`;

  return {
    pony: q('.w-pony'), tail: q('.w-tail'), head: q('.w-head'), mane: q('.w-mane'),
    legs: Object.keys(OS.legs).map((k) => q(`.w-leg--${k}`)),
    eyes: qa('.w-eye'), smiles: qa('.w-smile'),
    faceSide: q('.w-face--side'), faceFront: q('.w-face--front'),
    rump: q('.w-rump'),
  };
}
