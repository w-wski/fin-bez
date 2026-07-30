// Arkusz „Więcej" + toast: dwie rzeczy w jednym pliku, bo są ściśle sprzężone (Z17 K4 — toast
// nie może wjechać na otwarty arkusz, z-index 60 nad 40 w tej samej strefie ekranu) i razem
// mieszczą się pod limitem 300 linii, którego core.js już nie miał (299/300). main.js importuje
// toast/otworzArkusz/zamknijArkusz z core.js — ten re-eksportuje stąd, bez zmiany jego importów.
import { el } from './core.js';

let otwarty = false;              // czy arkusz „Więcej" jest teraz na ekranie
let sprzatnijNasluch = null;      // usuwa nasłuch klik-poza przy zamknięciu (bez wycieku)
let toastTimer = null;
let kolejkaToastow = [];          // FIFO: komunikaty czekające, póki arkusz jest otwarty

// Czyste funkcje kolejki — bez DOM, testowalne wprost (scripts/test-historia-filtr.js).
export const dodajDoKolejki = (kolejka, wpis) => [...kolejka, wpis];
export const oproznijKolejke = () => [];

function pokazToastTeraz(text, action) {
  let box = document.getElementById('toast');
  if (!box) { box = el('div', { id: 'toast', class: 'toast', role: 'status' }); document.body.append(box); }
  box.innerHTML = '';
  box.append(el('span', {}, text));
  if (action) {
    const b = el('button', { class: 'btn small' }, action.label);
    b.onclick = () => { box.hidden = true; action.onClick(); };
    box.append(b);
  }
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, action ? 12000 : 4000);
}

// Opróżnianie SEKWENCYJNE (weryfikacja Z17, K4): toast z akcją „Cofnij" musi być realnie
// widoczny i klikalny — pętla renderująca wszystkie naraz nadpisywałaby je w jednej klatce
// i użytkownik straciłby możliwość cofnięcia wszystkich poza ostatnim. Każdy komunikat
// dostaje pełny czas ekranowy; kolejny wjeżdża po zniknięciu poprzedniego.
function oproznijKolejkeToastow() {
  if (otwarty) return; // arkusz otwarto ponownie w trakcie opróżniania — wznowi kolejne zamknięcie
  const nastepny = kolejkaToastow.shift();
  if (!nastepny) return;
  pokazToastTeraz(nastepny.text, nastepny.action);
  if (kolejkaToastow.length) {
    setTimeout(oproznijKolejkeToastow, nastepny.action ? 12100 : 4100);
  }
}

// Krótki komunikat u dołu ekranu, opcjonalnie z akcją (np. „Cofnij"). Jeden toast naraz —
// kolejny zastępuje poprzedni. Gdy arkusz jest otwarty, czeka w kolejce zamiast wjeżdżać nań.
export function toast(text, action) {
  if (otwarty) { kolejkaToastow = dodajDoKolejki(kolejkaToastow, { text, action }); return; }
  pokazToastTeraz(text, action);
}

export function otworzArkusz() {
  const a = document.getElementById('sheet');
  if (!a) return;
  a.hidden = false;
  document.getElementById('navMore')?.setAttribute('aria-expanded', 'true');
  a.querySelector('.sheet-item:not([hidden])')?.focus();
  otwarty = true;
  instalujZamykanieKlikiem(a);
}

// Nasłuch w fazie CAPTURE na całym dokumencie: klik/tap poza panelem `.sheet` zamyka arkusz
// i zatrzymuje dalszą propagację, ZANIM zdarzenie dotrze do przycisku pod spodem — inaczej
// pierwsze tapnięcie zamykałoby arkusz i JEDNOCZEŚNIE aktywowało to, co było pod palcem (K2).
function instalujZamykanieKlikiem(a) {
  if (sprzatnijNasluch) return;
  const panel = a.querySelector('.sheet');
  const naKlik = (e) => {
    if (panel && panel.contains(e.target)) return;   // klik WEWNĄTRZ arkusza — nie ruszamy
    e.preventDefault();
    e.stopPropagation();
    zamknijArkusz();
  };
  document.addEventListener('click', naKlik, true);
  sprzatnijNasluch = () => document.removeEventListener('click', naKlik, true);
}

export function zamknijArkusz() {
  const a = document.getElementById('sheet');
  if (a) a.hidden = true;
  document.getElementById('navMore')?.setAttribute('aria-expanded', 'false');
  otwarty = false;
  oproznijKolejkeToastow();
  if (sprzatnijNasluch) { sprzatnijNasluch(); sprzatnijNasluch = null; }
}
