/* Trzy warianty kucyka-jednorożca do planszy powitalnej (zamówienie Bartusia,
 * 2026-07-26). Wybór należy do Szymona — dopiero wybrany wariant trafi do
 * app/public/witaj-kucyk.js. To NIE jest kod produkcyjny: leży w docs/, poza
 * zasięgiem bramki preflight, i służy wyłącznie podglądowi.
 *
 * Kontrakt każdego wariantu (od niego zależy cała choreografia, więc jest wspólny):
 *   viewBox 0 0 240 180, ziemia na y=156, kucyk zwrócony w PRAWO.
 *   .leg--bl .leg--br .leg--fl .leg--fr  — nogi, obrót w stawie (--ox/--oy → transform-origin)
 *   .tail .mane                          — ogon i grzywa (bezwładność: własna faza)
 *   .head                                — cała głowa (obrót przy spojrzeniu)
 *   .face--side / .face--front           — profil / twarz na widza (przenikanie opacity)
 *   .smile                               — uśmiech (opacity 0 → 1)
 *   .rump                                — punkt zaczepienia tęczy (zad, x/y w cx/cy)
 * Proporcje są ŹREBIĘCE, nie końskie: duża głowa (r 30 przy korpusie 88 długości),
 * krótkie nogi (32 px), korpus-beczułka. Paleta grzywy, ogona i tęczy = odcienie
 * bąbelków z ekranu logowania, żeby plansza była z tej samej rodziny co ekran,
 * z którego wychodzi.
 */

export const HUES = [15, 45, 95, 160, 205, 260, 300, 335];
const t = (h, l = 78, c = 0.17) => `oklch(${l}% ${c} ${h})`;

/* [klucz, staw x, staw y, kopyto x, kopyto y] — tylne dwie rysujemy ZA korpusem,
   przednie PRZED nim, więc nogi trzymają się ciała, a nie wiszą pod nim. */
const LEGS = [['bl', 80, 110, 74, 156], ['br', 94, 112, 98, 156],
              ['fl', 126, 110, 120, 156], ['fr', 140, 112, 146, 156]];
const leg = (k, inner) => `<g class="leg leg--${k}" style="--ox:${LEGS.find((l) => l[0] === k)[1]}px;--oy:${LEGS.find((l) => l[0] === k)[2]}px">${inner}</g>`;
const tyl = (f) => LEGS.slice(0, 2).map(f).join('');
const przod = (f) => LEGS.slice(2).map(f).join('');

const CIEN = '<ellipse class="cien" cx="106" cy="157" rx="56" ry="6" fill="oklch(45% .03 280)" opacity=".10"/>';
const RUMP = '<ellipse class="rump" cx="66" cy="94" rx="1" ry="1" fill="none" stroke="none"/>';

/* ---------- A. Bajkowy: pełne, miękkie kształty, duże oko, puszysta grzywa ---------- */
const SIERSC_A = 'oklch(97.5% .012 300)';
const A = `
<g class="pony pony--a">
  ${CIEN}
  <g class="tail">
    ${HUES.slice(0, 5).map((h, i) => `<path d="M68 ${76 + i * 3} C48 ${90 + i * 5}, ${38 - i * 2} ${116 + i * 4}, ${46 + i * 4} ${146 - i * 3}"
      stroke="${t(h)}" stroke-width="10" stroke-linecap="round" fill="none"/>`).join('')}
  </g>
  <g class="legs legs--tyl">
    ${tyl(([k, x1, y1, x2, y2]) => leg(k, `
      <path d="M${x1} ${y1} L${x2} ${y2 - 6}" stroke="oklch(90% .035 300)" stroke-width="16" stroke-linecap="round"/>
      <path d="M${x2} ${y2 - 7} v3" stroke="oklch(64% .07 300)" stroke-width="16" stroke-linecap="round"/>`))}
  </g>
  ${RUMP}
  <path class="neck" d="M138 94 L163 60" stroke="${SIERSC_A}" stroke-width="40" stroke-linecap="round"/>
  <path class="body" d="M62 96 C62 74, 80 62, 106 62 C134 62, 150 74, 150 96 C150 118, 132 128, 106 128 C80 128, 62 118, 62 96 Z"
        fill="${SIERSC_A}"/>
  <path d="M78 122 C96 129, 128 128, 146 118 C136 127, 100 131, 78 122 Z" fill="oklch(92% .025 300)"/>
  <g class="legs legs--przod">
    ${przod(([k, x1, y1, x2, y2]) => leg(k, `
      <path d="M${x1} ${y1} L${x2} ${y2 - 6}" stroke="${SIERSC_A}" stroke-width="16" stroke-linecap="round"/>
      <path d="M${x2} ${y2 - 7} v3" stroke="oklch(64% .07 300)" stroke-width="16" stroke-linecap="round"/>`))}
  </g>
  <g class="head">
    <g class="face face--side">
      <ellipse cx="176" cy="52" rx="30" ry="27" fill="${SIERSC_A}"/>
      <ellipse cx="197" cy="65" rx="13" ry="10.5" fill="oklch(95% .028 40)"/>
      <ellipse cx="200" cy="62" rx="1.7" ry="2.2" fill="oklch(74% .05 300)"/>
      <ellipse cx="163" cy="62" rx="8" ry="6" fill="oklch(92% .05 20)" opacity=".55"/>
      <ellipse class="eye" cx="184" cy="48" rx="5.4" ry="6.2" fill="oklch(26% .04 280)"/>
      <circle cx="186" cy="45.5" r="2" fill="#fff"/>
      <path class="smile" d="M190 71 q6 5 12 -1" stroke="oklch(56% .08 30)" stroke-width="2.3"
            fill="none" stroke-linecap="round" opacity="0"/>
    </g>
    <g class="face face--front" opacity="0">
      <ellipse cx="176" cy="52" rx="31" ry="28" fill="${SIERSC_A}"/>
      <ellipse cx="176" cy="68" rx="15" ry="11" fill="oklch(95% .028 40)"/>
      <ellipse cx="171" cy="66" rx="1.7" ry="2.2" fill="oklch(74% .05 300)"/>
      <ellipse cx="181" cy="66" rx="1.7" ry="2.2" fill="oklch(74% .05 300)"/>
      <ellipse cx="153" cy="60" rx="8" ry="6" fill="oklch(92% .05 20)" opacity=".5"/>
      <ellipse cx="199" cy="60" rx="8" ry="6" fill="oklch(92% .05 20)" opacity=".5"/>
      <ellipse class="eye" cx="164" cy="47" rx="5.4" ry="6.4" fill="oklch(26% .04 280)"/>
      <ellipse class="eye" cx="188" cy="47" rx="5.4" ry="6.4" fill="oklch(26% .04 280)"/>
      <circle cx="166" cy="44.5" r="2" fill="#fff"/><circle cx="190" cy="44.5" r="2" fill="#fff"/>
      <path class="smile" d="M167 72 q9 6 18 0" stroke="oklch(56% .08 30)" stroke-width="2.5"
            fill="none" stroke-linecap="round" opacity="0"/>
    </g>
    <path class="ear" d="M156 30 L159 12 L170 27 Z" fill="oklch(95% .02 300)"/>
    <path class="horn" d="M174 26 L191 -3 L184 29 Z" fill="oklch(91% .08 85)"/>
    <g class="mane">
      ${HUES.slice(2, 7).map((h, i) => `<path d="M${160 - i * 7} ${28 + i * 4} C${150 - i * 8} ${40 + i * 4}, ${142 - i * 7} ${52 + i * 5}, ${130 - i * 5} ${70 + i * 6}"
        stroke="${t(h)}" stroke-width="11" stroke-linecap="round" fill="none"/>`).join('')}
    </g>
  </g>
</g>`;

/* ---------- B. Geometryczny: figury pierwotne, płaskie kolory, grzywa-klin ---------- */
const SIERSC_B = 'oklch(95% .02 285)';
const B = `
<g class="pony pony--b">
  ${CIEN}
  <g class="tail">
    ${HUES.slice(0, 5).map((h, i) => `<rect x="${62 + i * 5}" y="72" width="9" height="${64 - i * 7}" rx="4.5"
      fill="${t(h, 80, 0.15)}" transform="rotate(${30 - i * 6} ${66 + i * 5} 74)"/>`).join('')}
  </g>
  <g class="legs legs--tyl">
    ${tyl(([k, x1, y1, x2, y2]) => leg(k, `
      <rect x="${Math.min(x1, x2) - 6}" y="${y1 - 4}" width="13" height="${y2 - y1 + 4}" rx="6.5" fill="oklch(88% .04 285)"/>
      <rect x="${Math.min(x1, x2) - 6}" y="${y2 - 9}" width="13" height="9" rx="4" fill="oklch(64% .07 285)"/>`))}
  </g>
  ${RUMP}
  <rect class="neck" x="132" y="50" width="34" height="48" rx="17" fill="${SIERSC_B}" transform="rotate(24 149 74)"/>
  <rect class="body" x="60" y="62" width="92" height="64" rx="30" fill="${SIERSC_B}"/>
  <g class="legs legs--przod">
    ${przod(([k, x1, y1, x2, y2]) => leg(k, `
      <rect x="${Math.min(x1, x2) - 6}" y="${y1 - 4}" width="13" height="${y2 - y1 + 4}" rx="6.5" fill="${SIERSC_B}"/>
      <rect x="${Math.min(x1, x2) - 6}" y="${y2 - 9}" width="13" height="9" rx="4" fill="oklch(64% .07 285)"/>`))}
  </g>
  <g class="head">
    <g class="face face--side">
      <rect x="148" y="26" width="58" height="52" rx="24" fill="${SIERSC_B}"/>
      <rect x="184" y="54" width="26" height="21" rx="10.5" fill="oklch(92% .035 55)"/>
      <circle class="eye" cx="184" cy="48" r="5" fill="oklch(28% .035 285)"/>
      <path class="smile" d="M190 70 h11" stroke="oklch(54% .08 20)" stroke-width="2.5" stroke-linecap="round" opacity="0"/>
    </g>
    <g class="face face--front" opacity="0">
      <rect x="146" y="24" width="60" height="56" rx="26" fill="${SIERSC_B}"/>
      <rect x="163" y="56" width="26" height="20" rx="10" fill="oklch(92% .035 55)"/>
      <circle class="eye" cx="164" cy="47" r="5" fill="oklch(28% .035 285)"/>
      <circle class="eye" cx="188" cy="47" r="5" fill="oklch(28% .035 285)"/>
      <path class="smile" d="M168 72 h16" stroke="oklch(54% .08 20)" stroke-width="2.7" stroke-linecap="round" opacity="0"/>
    </g>
    <path class="ear" d="M155 28 L158 10 L169 26 Z" fill="oklch(92% .025 285)"/>
    <path class="horn" d="M172 26 L182 -5 L190 26 Z" fill="oklch(89% .09 85)"/>
    <g class="mane">
      ${HUES.slice(2, 7).map((h, i) => `<rect x="${157 - i * 7}" y="${24 + i * 4}" width="9" height="${32 + i * 5}" rx="4.5"
        fill="${t(h, 80, 0.15)}" transform="rotate(${26 + i * 5} ${161 - i * 7} ${26 + i * 4})"/>`).join('')}
    </g>
  </g>
</g>`;

/* ---------- C. Konturowy: rysunek linią, kolor tylko w grzywie, ogonie i różku ---------- */
const C = `
<g class="pony pony--c">
  ${CIEN}
  <g class="tail" fill="none" stroke-width="5" stroke-linecap="round">
    ${HUES.slice(0, 4).map((h, i) => `<path d="M68 ${76 + i * 4} C48 ${92 + i * 5}, ${40 - i} ${118 + i * 4}, ${48 + i * 4} ${144 - i * 3}"
      stroke="${t(h, 70, 0.18)}"/>`).join('')}
  </g>
  <g fill="var(--bg, #fff)" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
    <g class="legs legs--tyl">
      ${tyl(([k, x1, y1, x2, y2]) => leg(k, `<rect x="${Math.min(x1, x2) - 5.5}" y="${y1 - 8}" width="11" height="${y2 - y1 + 8}" rx="5.5"/>`))}
    </g>
    ${RUMP}
    <path class="neck" d="M128 96 C130 74, 144 58, 162 48 L184 74 C166 88, 146 100, 128 96 Z"/>
    <path class="body" d="M62 96 C62 74, 80 62, 106 62 C134 62, 150 74, 150 96 C150 118, 132 128, 106 128 C80 128, 62 118, 62 96 Z"/>
    <g class="legs legs--przod">
      ${przod(([k, x1, y1, x2, y2]) => leg(k, `<rect x="${Math.min(x1, x2) - 5.5}" y="${y1 - 8}" width="11" height="${y2 - y1 + 8}" rx="5.5"/>`))}
    </g>
    <g class="head">
      <g class="face face--side">
        <path d="M176 25 C196 25, 208 38, 207 52 C206 66, 194 77, 180 77 C162 77, 148 64, 148 50 C148 35, 160 25, 176 25 Z"/>
        <path d="M199 64 q6 3 5 9" stroke-width="2.6" fill="none"/>
        <circle class="eye" cx="184" cy="48" r="3.8" fill="currentColor" stroke="none"/>
        <path class="smile" d="M189 70 q6 5 11 -1" stroke-width="2.6" fill="none" opacity="0"/>
      </g>
      <g class="face face--front" opacity="0">
        <ellipse cx="176" cy="51" rx="30" ry="27"/>
        <path d="M164 68 q12 8 24 0" stroke-width="2.6" fill="none"/>
        <circle class="eye" cx="165" cy="47" r="3.8" fill="currentColor" stroke="none"/>
        <circle class="eye" cx="187" cy="47" r="3.8" fill="currentColor" stroke="none"/>
        <path class="smile" d="M167 71 q9 7 18 0" stroke-width="2.8" fill="none" opacity="0"/>
      </g>
      <path class="ear" d="M156 29 L159 11 L170 26"/>
      <path class="horn" d="M174 26 L190 -3 L184 28" stroke="${t(85, 68, 0.16)}" fill="none"/>
      <g class="mane" fill="none" stroke-width="5" stroke-linecap="round">
        ${HUES.slice(2, 7).map((h, i) => `<path d="M${160 - i * 7} ${29 + i * 4} C${150 - i * 8} ${41 + i * 4}, ${142 - i * 7} ${53 + i * 5}, ${130 - i * 5} ${71 + i * 6}"
          stroke="${t(h, 70, 0.18)}"/>`).join('')}
      </g>
    </g>
  </g>
</g>`;

/* Tęcza z zadu — rysowana ZA kucykiem (nie przez korpus), łukiem w lewo, w górę
   i w prawo, do strefy, w której składa się napis. W planszy odsłaniana maską. */
export function rainbow(x = 66, y = 94) {
  return `<g class="rainbow">${HUES.slice(0, 6).map((h, i) => `
    <path d="M${x} ${y - 6 + i * 6} C${x - 46} ${y + 30 - i * 2}, ${x + 40} ${y - 78 - i * 6}, ${x + 168} ${y - 66 - i * 7}"
      stroke="${t(h, 80, 0.19)}" stroke-width="7" fill="none" stroke-linecap="round" opacity=".92"/>`).join('')}</g>`;
}

export const PONIES = { a: A, b: B, c: C };
export const NAZWY = { a: 'A — Bajkowy', b: 'B — Geometryczny', c: 'C — Konturowy' };
