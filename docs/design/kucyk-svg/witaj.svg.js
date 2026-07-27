/* witaj.js — plansza powitalna między logowaniem Google a aplikacją (zamówienie
 * Bartusia, 2026-07-26). Kucyk wbiega, staje, patrzy na widza, PODNOSI OGON, z zadu
 * wydobywa się wąskim otworem konfetti, rozchodzi się w chmurę, z chmury składa się
 * napis „Witaj <Imię>!", OGON OPADA, kucyk się uśmiecha, stoi jeszcze chwilę i wybiega,
 * a POTEM napis zsypuje się poza dolną krawędź i wchodzą formularze.
 * Tęcza była tu wcześniej — wypadła 07-26 na życzenie Szymona („zbędna").
 * Kolejność taktów z ogonem jest wymogiem Szymona (07-26) — dlatego są osobnymi
 * aktami osi czasu, a nie efektem ubocznym innego ruchu.
 *
 * Dyscyplina jak w scenie logowania (sześć rund nauki na iPhonie):
 * wszystko jest CZYSTĄ FUNKCJĄ czasu (jedyny wyjątek: zsyp konfetti, jednokierunkowy),
 * animujemy tylko transform i opacity, zero filtrów, jeden requestAnimationFrame,
 * jeden canvas na wszystkie cząstki, pomiary układu robione RAZ.
 */

import { sceneSVG, zbierz } from './witaj-kucyk.js';
import { silnik } from './witaj-konfetti.js';
import { track } from './js/core.js';

/* Osada czasowa (ms od startu). 6,2 s — Szymon 07-26: „raczej 6 s". */
const A = {
  wbieg: [0, 800], spojrzy: [800, 1250], ogonUp: [1250, 1600],
  struga: [1600, 2350],        // wyrzut wąskim otworem w lewo
  chmura: [2350, 3150],        // rozejście się w chmurę
  napis: [3150, 4100],         // z chmury składa się powitanie
  ogonDown: [4100, 4400], usmiech: [4400, 4800],
  // 4800–5150: POSTÓJ na uśmiechu (Szymon: „konik powinien zostać chwilę dłużej")
  wybieg: [5150, 5600], zsyp: [5600, 6200],   // zsyp DOPIERO po wyjściu kucyka
};
const KONIEC = 6200;
const FADE = 340;                  // ostatnie ms: gaśnie zasłona, wchodzą formularze

const f = (t, [a, b]) => (t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/* Ogon nie staje jak zapora: wychyla się o 8% za daleko i wraca. */
const zOdbiciem = (x) => (x >= 1 ? 1 : easeOut(x) * (1 + 0.08 * Math.sin(x * Math.PI)));

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function styl() {
  return new Promise((res) => {
    if (document.querySelector('link[data-witaj]')) return res();
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/css/witaj.css';
    l.dataset.witaj = '1';
    l.onload = l.onerror = () => res();
    document.head.appendChild(l);
  });
}

function zbudujDOM(tekst) {
  const el = document.createElement('div');
  el.className = 'witaj';
  el.id = 'witaj';
  el.setAttribute('role', 'status');
  el.innerHTML = `<p class="witaj__czytnik">${tekst}</p>
    <div class="witaj__scena">${sceneSVG()}</div>
    <canvas class="witaj__konf" aria-hidden="true"></canvas>`;
  document.body.appendChild(el);
  return el;
}

class Plansza {
  constructor(el, imie) {
    this.el = el;
    this.tekst = `Witaj ${imie}!`;
    this.fx = zbierz(el);
    this.konf = silnik(el.querySelector('.witaj__konf'));
    this.t = 0;
    this.raf = 0;
    this.last = 0;
    this.wysypStart = false;
    this.pominiete = false;
    this.koniec = null;
    this.onSkip = this.onSkip.bind(this);
    this.frame = this.frame.bind(this);
    this.przemierz = this.przemierz.bind(this);
  }

  /** Wszystko, co zależy od układu strony — mierzone RAZ (i po zmianie rozmiaru
      oraz po doładowaniu fontu, bo od niego zależy wysokość napisu). */
  przemierz() {
    // preserveAspectRatio="meet": skala = mniejsze z dopasowań kadru 320×380.
    const s = this.el.querySelector('.w-scena').getBoundingClientRect();
    const skala = Math.max(0.01, Math.min(s.width / 320, s.height / 380));
    this.droga = (window.innerWidth / 2 + 90) / skala + 72;   // 72 = pół szerokości kucyka
    const r = this.fx.rump.getBoundingClientRect();
    this.konf.przemierz(this.tekst, window.innerHeight * 0.24);
    this.konf.osCzasu(A);
    this.konf.zrodlo(r.left + r.width / 2, r.top + r.height / 2);
  }

  klatka(t, dt) {
    const fx = this.fx;
    const wb = f(t, A.wbieg);
    const wy = f(t, A.wybieg);

    // 1+8. Wbieg i wybieg: pozycja + kłus. Amplituda kroku gaśnie razem z dojazdem,
    // więc nogi nie zatrzymują się w losowym wychyleniu.
    const x = -this.droga * (1 - easeOut(wb)) + this.droga * easeIO(wy);
    const amp = 17 * Math.max(1 - wb * wb, Math.min(1, wy * 3));
    const faza = t / 125;
    const bob = amp > 1 ? -Math.abs(Math.sin(faza)) * 3 : 0;
    fx.pony.style.transform = `translate(${x.toFixed(1)}px, ${bob.toFixed(2)}px)`;
    fx.legs.forEach((g, i) => {
      if (g) g.style.transform = `rotate(${(Math.sin(faza + i * 1.57) * amp).toFixed(2)}deg)`;
    });

    // 2. Staje i patrzy na widza (przenikanie dwóch twarzy) + mrugnięcie.
    const fr = f(t, A.spojrzy);
    if (fx.faceSide) fx.faceSide.style.opacity = (1 - fr).toFixed(3);
    if (fx.faceFront) fx.faceFront.style.opacity = fr.toFixed(3);
    if (fx.head) fx.head.style.transform = `rotate(${(-5 * fr).toFixed(2)}deg)`;
    const mrug = fr > 0.58 && fr < 0.76 ? 1 - Math.sin((fr - 0.58) / 0.18 * Math.PI) * 0.92 : 1;
    for (const e of fx.eyes) e.style.transform = `scaleY(${mrug.toFixed(3)})`;

    // 3+7. OGON: w górę PRZED konfetti, w dół PO napisie — nigdy razem z uśmiechem.
    const ogon = zOdbiciem(f(t, A.ogonUp)) - easeIO(f(t, A.ogonDown));
    if (fx.tail) fx.tail.style.transform = `rotate(${(85 * ogon).toFixed(2)}deg)`;

    // 4+5+6+9. Konfetti: wyrzut wąskim otworem → chmura → napis → zsyp poza ekran.
    // Trzy pierwsze fazy prowadzi silnik z jednego czasu (czysta funkcja t), zsyp
    // całkuje, bo jest jednokierunkowy i zaczyna się po wyjściu kucyka.
    if (t >= A.zsyp[0]) {
      this.konf.zsyp(dt, !this.wysypStart);
      this.wysypStart = true;
    } else if (t >= A.struga[0] - 16) {
      this.konf.rusz(t);
    }
    if (t >= A.struga[0] - 16) this.konf.rysuj();

    // 7. Uśmiech — dopiero po opadnięciu ogona.
    const sm = f(t, A.usmiech);
    for (const s of fx.smiles) s.style.opacity = sm.toFixed(3);

    // Zasłona gaśnie na końcu: formularze wchodzą fadeinem.
    this.el.style.opacity = (1 - f(t, [KONIEC - FADE, KONIEC])).toFixed(3);
  }

  frame(now) {
    const dt = this.last ? Math.min(48, now - this.last) : 16.7;
    this.last = now;
    this.t += dt;
    this.klatka(Math.min(this.t, KONIEC), dt);
    if (this.t >= KONIEC) return this.finisz(false);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Pominięcie tapem/klawiszem w dowolnej chwili — plansza gaśnie i wpuszcza do aplikacji. */
  onSkip() { if (!this.pominiete) { this.pominiete = true; this.finisz(true); } }

  finisz(pominiete) {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, this.onSkip);
    window.removeEventListener('resize', this.przemierz);
    this.el.classList.add('witaj--gasnie');
    track('Plansza powitalna', 'wpis', { pominieta: pominiete, ms: Math.round(this.t) });
    setTimeout(() => { this.el.remove(); this.koniec?.(); }, pominiete ? 240 : 60);
  }

  start() {
    return new Promise((res) => {
      this.koniec = res;
      window.__witajPlansza = this;      // ekspozycja: rig zrzutów steruje czasem
      for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, this.onSkip);
      window.addEventListener('resize', this.przemierz);
      this.przemierz();
      if (window.__stopKlatki) return;   // rig: zegar prowadzi test, nie przeglądarka
      // Font zmienia szerokość napisu, a od niej zależą cele cząstek — przemierz po
      // doładowaniu, ale tylko dopóki konfetti jeszcze nie wystartowało.
      document.fonts?.ready?.then(() => { if (this.t < A.struga[0]) this.przemierz(); });
      if (reduceMotion.matches) return this.bezRuchu();
      this.raf = requestAnimationFrame(this.frame);
    });
  }

  /** prefers-reduced-motion: sam napis, bez ruchu, krótko. */
  bezRuchu() {
    this.klatka(A.usmiech[1], 16.7);
    this.konf.rusz(A.napis[1]);
    this.konf.rysuj();
    setTimeout(() => this.finisz(false), 1200);
  }
}

/** Punkt wejścia. Nie rzuca: plansza jest ozdobą, więc każdy jej błąd musi
 *  kończyć się wpuszczeniem użytkownika do aplikacji, a nie białym ekranem. */
export async function zagraj(imie) {
  try {
    await styl();
    const el = zbudujDOM(`Witaj ${imie}!`);
    await new Plansza(el, imie).start();
  } catch (e) {
    console.error('plansza powitalna:', e.message);
    document.getElementById('witaj')?.remove();
  }
}
