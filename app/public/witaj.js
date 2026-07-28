/* witaj.js — plansza powitalna między logowaniem Google a aplikacją (zamówienie Bartusia,
 * 2026-07-26; przebudowa na PIXEL ART i nową reżyserię 2026-07-27).
 *
 * Reżyseria (Szymon 07-27, dosłownie): unicorn wchodzi z LEWEJ → staje → podnosi ogon →
 * wypuszcza chmurę z zadu (PÓŁ napisu) → opuszcza ogon → wypluwa z pyska drugą chmurę
 * (drugie pół) → z chmur formuje się napis, a unicorn obraca się do nas z uśmiechem →
 * chwila pauzy → schodzi do PRAWEJ → napis spada, gdy unicorna już nie ma. Około 8 s.
 *
 * Które pół którą chmurą: zad jest z TYŁU (lewa strona kadru), pysk z PRZODU (prawa), więc
 * chmura z zadu nosi LEWĄ połowę napisu, a chmura z pyska PRAWĄ. Inaczej połowy musiałyby
 * się mijać w powietrzu.
 *
 * Kucyk i napis leżą na JEDNYM canvasie i JEDNEJ siatce pikseli — inaczej „pixel style"
 * rozjeżdża się na dwie różne rozdzielczości. Kolejność klatki: czyść → kucyk → cząstki.
 *
 * Dyscyplina jak w scenie logowania (sześć rund nauki na iPhonie): wszystko jest CZYSTĄ
 * FUNKCJĄ czasu (jedyny wyjątek: zsyp konfetti, jednokierunkowy), jeden requestAnimationFrame,
 * jeden canvas, zero filtrów, pomiary układu robione RAZ.
 */

import { rysuj as rysujKucyka, rozmiar, OTWORY } from './witaj-kucyk.js';
import { silnik } from './witaj-konfetti.js';
import { track } from './js/core.js';

/* Osada czasowa (ms od startu). ~8 s — Szymon 07-27: „może być nawet 8 s". */
const A = {
  wbieg: [0, 950],             // wchodzi z lewej i staje na środku
  ogonUp: [1050, 1400],
  chmura1: [1400, 2250],       // z zadu, lewa połowa napisu
  ogonDown: [2350, 2650],
  chmura2: [2700, 3550],       // z pyska, prawa połowa
  napis: [3600, 4600],         // obie chmury składają się w powitanie
  obrot: [4250, 4500],         // obraca się do widza W TRAKCIE składania napisu
  obrotZ: [5900, 6050],        // z powrotem w bok, przed wybiegiem
  wybieg: [6050, 6950],        // schodzi do prawej
  zsyp: [7050, 8000],          // napis spada DOPIERO, gdy kucyka już nie ma
};
const KONIEC = 8200;
const FADE = 380;              // ostatnie ms: gaśnie zasłona, wchodzą formularze
const LINIA = 0.70;            // linia ziemi w ułamku wysokości kadru
const NAPIS_Y = 0.27;          // środek napisu w ułamku wysokości kadru

const f = (t, [a, b]) => (t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

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
    <canvas class="witaj__plotno" aria-hidden="true"></canvas>`;
  document.body.appendChild(el);
  return el;
}

class Plansza {
  constructor(el, imie) {
    this.el = el;
    this.tekst = `Witaj ${imie}!`;
    this.konf = silnik(el.querySelector('.witaj__plotno'));
    this.g = this.konf.ctx;
    this.mapa = rozmiar();
    this.t = 0;
    this.raf = 0;
    this.last = 0;
    this.pominiete = false;
    this.koniec = null;
    this.onSkip = this.onSkip.bind(this);
    this.frame = this.frame.bind(this);
    this.przemierz = this.przemierz.bind(this);
  }

  /** Wszystko, co zależy od układu okna — mierzone RAZ (i po zmianie rozmiaru oraz po
      doładowaniu fontu, bo od niego zależy szerokość napisu). */
  przemierz() {
    const w = window.innerWidth, h = window.innerHeight;
    // Bok piksela: KORPUS ma zajmować ~58 % szerokości kadru. Liczymy z korpusu, nie
    // z pełnego zasięgu figury — ten drugi obejmuje ogon w pozie „w górę", więc kucyk
    // wychodził o trzecią część za mały. Piksel musi być LICZBĄ CAŁKOWITĄ, inaczej
    // sprite trafia na pół piksela ekranu i cały kontur się rozmywa.
    // 0,29 zamiast 0,58 (Szymon 07-28: „powinien być 2× mniejszy”). Dolna granica spada
    // z 4 na 3, bo przy wąskim telefonie połowa z czterech to trzy — inaczej ograniczenie
    // zjadłoby całą zmianę i kucyk zostałby tej samej wielkości.
    this.S = Math.max(3, Math.min(12, Math.round(w * 0.29 / this.mapa.wKorpus)));
    const S = this.S;
    this.ziemia = Math.round(h * LINIA / S) * S;
    this.oy = this.ziemia - this.mapa.bokDol * S;
    this.srodekX = Math.round((w / 2 - this.mapa.bokSrodek * S) / S) * S;
    // Droga wbiegu/wybiegu liczona z FAKTYCZNEJ szerokości figury (z ogonem w górze),
    // żeby kucyk naprawdę zszedł za krawędź, a nie stanął na niej.
    this.droga = w / 2 + (this.mapa.w - this.mapa.lewo) * S;
    this.konf.osCzasu(A);
    // Napis dostaje siatkę DWA RAZY drobniejszą od kucyka. Ta sama siatka co sprite dawała
    // literom siedem rzędów pikseli — za mało, żeby „ś" różniło się od „s", a wyraz od
    // plamy. Pół piksela sprite'a to nadal ta sama siatka (jeden piksel kucyka = 2×2
    // piksele napisu), więc obraz zostaje spójny, a powitanie jest czytelne.
    this.konf.przemierz(this.tekst, Math.round(h * NAPIS_Y), Math.max(2, Math.round(S / 2)));
    // Otwory liczymy dla pozycji ŚRODKOWEJ: obie chmury lecą, gdy kucyk stoi.
    this.konf.zrodla(
      [this.srodekX + OTWORY.zad[0] * S, this.oy + OTWORY.zad[1] * S],
      [this.srodekX + OTWORY.pysk[0] * S, this.oy + OTWORY.pysk[1] * S],
    );
  }

  /** Poza kucyka jako czysta funkcja czasu. Obrót to CIĘCIE na inną mapę w połowie
   *  taktu plus mały podskok — pixel art nie interpoluje obrotu. */
  poza(t) {
    const przod = t >= (A.obrot[0] + A.obrot[1]) / 2 && t < (A.obrotZ[0] + A.obrotZ[1]) / 2;
    const skok = Math.max(f(t, A.obrot) * (1 - f(t, A.obrot)), f(t, A.obrotZ) * (1 - f(t, A.obrotZ)));
    return { przod, podskok: skok * 4 };     // 0…1 skali, ×4 = do 1 piksela siatki w górę
  }

  klatka(t, dt) {
    const S = this.S;
    const wb = f(t, A.wbieg), wy = f(t, A.wybieg);
    const x = this.srodekX - this.droga * (1 - easeOut(wb)) + this.droga * easeIO(wy);
    // Chód: dwie klatki nóg, tempo stałe; kiedy stoi — poza stojąca, nie losowe wychylenie.
    const idzie = wb < 1 || wy > 0;
    const p = this.poza(t);
    const ogon = f(t, A.ogonUp) - f(t, A.ogonDown);
    const bob = idzie ? (Math.floor(t / 110) % 2) * S : 0;   // podskok kłusu: 0 albo 1 piksel
    const oy = Math.round(this.oy - p.podskok * S - bob);

    this.konf.czysc();
    if (p.przod) {
      // Obie pozy na TEJ SAMEJ linii ziemi i tym samym środku figury.
      rysujKucyka(this.g,
        Math.round(x) + (this.mapa.bokSrodek - this.mapa.przodSrodek) * S,
        oy + (this.mapa.bokDol - this.mapa.przodDol) * S,
        S, { poza: 'przod', ogon: 0, krok: null });
    } else {
      rysujKucyka(this.g, Math.round(x / S) * S, oy, S,
        { poza: 'bok', ogon, krok: idzie ? t / 220 : null });
    }

    // Konfetti: dwie chmury → napis → zsyp poza ekran.
    if (t >= A.zsyp[0]) this.konf.zsyp(dt);
    else if (t >= A.chmura1[0] - 16) this.konf.rusz(t);
    if (t >= A.chmura1[0] - 16) this.konf.rysuj();

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
      document.fonts?.ready?.then(() => { if (this.t < A.chmura1[0]) this.przemierz(); });
      if (reduceMotion.matches) return this.bezRuchu();
      this.raf = requestAnimationFrame(this.frame);
    });
  }

  /** prefers-reduced-motion: gotowy napis i kucyk patrzący na widza, bez ruchu, krótko. */
  bezRuchu() {
    this.klatka(A.napis[1], 16.7);
    this.konf.rusz(A.napis[1]);
    this.konf.rysuj();
    setTimeout(() => this.finisz(false), 1400);
  }
}

/** Punkt wejścia. Nie rzuca: plansza jest ozdobą, więc każdy jej błąd musi kończyć się
 *  wpuszczeniem użytkownika do aplikacji, a nie białym ekranem. */
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
