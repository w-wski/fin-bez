// Analizy: karta „Analizy" (21d, Z12) — miesiąc/kwartał/rok, liczby zawsze, narracja
// modelu gdy dostępna. Cała treść budowana z JS do #analizyBox (wzorzec z admin.js/produkty.js
// — index.html trzyma tylko pusty kontener). Widoczne wyłącznie dla admina (routes/analizy.js).
import { $, el, api, zl, state, refreshers, track } from './core.js';

const KSIEGI = { 1: 'RODZINA', 2: 'PERSEVERA' };
const NAZWY_TYPU = { miesiac: 'Miesiąc', kwartal: 'Kwartał', rok: 'Rok' };

let typ = 'miesiac';
let okres = domyslnyOkres(typ);

function domyslnyOkres(t) {
  const dzis = new Date();
  const r = dzis.getFullYear(), m = dzis.getMonth() + 1;
  if (t === 'rok') return String(r);
  if (t === 'kwartal') return `${r}-Q${Math.ceil(m / 3)}`;
  return `${r}-${String(m).padStart(2, '0')}`;
}

// Krok o jeden okres wprzód/wstecz (kierunek ±1) — kalendarzowy sąsiad, ten sam
// wzorzec co poprzedniOkres w src/analizy.js (kwartał sąsiaduje z kwartałem, nie z 91 dniami).
function przesunOkres(t, o, kier) {
  if (t === 'rok') return String(Number(o) + kier);
  if (t === 'kwartal') {
    const r = Number(o.slice(0, 4)), kw = Number(o.slice(6)) + kier;
    if (kw < 1) return `${r - 1}-Q4`;
    if (kw > 4) return `${r + 1}-Q1`;
    return `${r}-Q${kw}`;
  }
  const [r, m] = o.split('-').map(Number);
  const mm = m + kier;
  if (mm < 1) return `${r - 1}-12`;
  if (mm > 12) return `${r + 1}-01`;
  return `${r}-${String(mm).padStart(2, '0')}`;
}

function opisBledu(err) {
  return (err instanceof TypeError) ? 'brak połączenia z internetem' : (err?.data?.error || err?.message || 'błąd');
}

function pasekOkresu() {
  const pasek = el('div', { class: 'stack an-pasek' });
  const chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Typ okresu' });
  for (const t of ['miesiac', 'kwartal', 'rok']) {
    const b = el('button', { type: 'button', class: t === typ ? 'active' : '' }, NAZWY_TYPU[t]);
    b.onclick = () => { typ = t; okres = domyslnyOkres(typ); rysuj(); };
    chips.append(b);
  }
  const strzalki = el('div', { class: 'row an-strzalki' });
  const wstecz = el('button', { class: 'btn small', type: 'button', 'aria-label': 'Poprzedni okres' }, '◀');
  const etykieta = el('span', { class: 'an-okres-label' }, okres);
  const wprzod = el('button', { class: 'btn small', type: 'button', 'aria-label': 'Następny okres' }, '▶');
  wstecz.onclick = () => { okres = przesunOkres(typ, okres, -1); rysuj(); };
  wprzod.onclick = () => { okres = przesunOkres(typ, okres, 1); rysuj(); };
  strzalki.append(wstecz, etykieta, wprzod);
  pasek.append(chips, strzalki);
  return pasek;
}

function kafel(label, wartosc) {
  const t = el('div', { class: 'tile' });
  t.append(el('b', {}, wartosc), el('span', {}, label));
  return t;
}

function kpiKsiegi(dane) {
  const box = el('div', { class: 'kpi' });
  for (const k of dane.ksiegi) {
    const nazwa = KSIEGI[k.ledger_id] || `Księga ${k.ledger_id}`;
    box.append(kafel(`Przychody · ${nazwa}`, zl(k.przychody)));
    box.append(kafel(`Wydatki · ${nazwa}`, zl(k.wydatki)));
    if (k.transfery) box.append(kafel(`Transfery · ${nazwa}`, zl(k.transfery)));
  }
  return box;
}

function zmianaTxt(t, poprzednio) {
  if (poprzednio === null || poprzednio === undefined || !poprzednio) return '— brak bazy';
  const pct = Math.round(((t - poprzednio) / poprzednio) * 1000) / 10;
  const znak = pct > 0 ? '+' : (pct < 0 ? '−' : '');
  return `${znak}${Math.abs(pct).toFixed(1).replace('.', ',')} % vs poprz.`;
}

function topKategorie(dane) {
  const box = el('div', { class: 'bary' });
  if (!dane.top_kategorie.length) {
    box.append(el('p', { class: 'msg' }, 'Brak wydatków w tym okresie.'));
    return box;
  }
  for (const t of dane.top_kategorie) {
    const r = el('div', { class: 'barrow' });
    r.append(el('span', { class: 'bname' }, t.kategoria), el('span', { class: 'bval' }, zl(t.total)),
      el('span', { class: 'bpct' }, zmianaTxt(t.total, t.poprzednio)));
    box.append(r);
  }
  return box;
}

function paragonySekcja(dane) {
  const box = el('div', { class: 'stack' });
  const kpi = el('div', { class: 'kpi' });
  kpi.append(kafel('Suma paragonowa', zl(dane.suma_paragonowa)), kafel('Rabaty łącznie', zl(dane.rabaty_lacznie)));
  box.append(kpi);
  if (dane.koszyk_top5.length) {
    const lista = el('div', { class: 'bary' });
    for (const k of dane.koszyk_top5) {
      const r = el('div', { class: 'barrow' });
      r.append(el('span', { class: 'bname' }, k.name), el('span', { class: 'bval' }, zl(k.wydano)));
      lista.append(r);
    }
    box.append(el('h3', {}, 'Koszyk — top 5 produktów'), lista);
  }
  return box;
}

// Narracja: gdy jest — tekst modelu; gdy null — informacja SPOKOJNA, nie komunikat błędu
// (§5 zlecenia: brak modelu to normalny, oczekiwany stan aplikacji offline-z-liczb).
function narracjaSekcja(narracja) {
  if (narracja) return el('p', { class: 'msg an-narracja' }, narracja);
  return el('p', { class: 'msg' }, 'Analiza z liczb — podłącz model w konfiguracji, żeby dostać omówienie.');
}

async function przygotujAnalize(box) {
  box.innerHTML = 'Liczę…';
  try {
    const wynik = await api('/api/v1/analizy', {
      method: 'POST', body: JSON.stringify({ okres_typ: typ, okres }),
    });
    track('Analiza przygotowana', 'analizy', { detail: `${typ}:${okres}` });
    wyswietl(box, wynik.dane, wynik.narracja);
  } catch (err) {
    box.innerHTML = '';
    box.append(el('p', { class: 'msg err' }, 'Nie udało się przygotować analizy: ' + opisBledu(err)));
  }
}

function wyswietl(box, dane, narracja) {
  box.innerHTML = '';
  box.append(kpiKsiegi(dane));
  box.append(el('h3', {}, 'Top 5 kategorii wydatków'), topKategorie(dane));
  box.append(el('h3', {}, 'Paragony'), paragonySekcja(dane));
  box.append(el('h3', {}, 'Omówienie'), narracjaSekcja(narracja));
}

async function wczytajZapisana(box) {
  box.innerHTML = '';
  try {
    const r = await api(`/api/v1/analizy?okres_typ=${typ}&okres=${encodeURIComponent(okres)}`);
    if (r.znaleziono) wyswietl(box, r.analiza.dane, r.analiza.narracja);
    else box.append(el('p', { class: 'msg' }, 'Dla tego okresu nie ma jeszcze zapisanej analizy — kliknij „Przygotuj analizę".'));
  } catch (err) {
    box.append(el('p', { class: 'msg err' }, 'Nie udało się wczytać: ' + opisBledu(err)));
  }
}

function rysuj() {
  const glowny = $('#analizyBox');
  glowny.innerHTML = '';
  glowny.append(pasekOkresu());
  const przycisk = el('button', { class: 'btn primary', type: 'button' }, 'Przygotuj analizę');
  const wynikBox = el('div', { class: 'stack an-wynik' });
  przycisk.onclick = () => przygotujAnalize(wynikBox);
  glowny.append(przycisk, wynikBox);
  wczytajZapisana(wynikBox);
}

export function initAnalizy() {
  refreshers.analizy = rysuj;
}

export function loadAnalizy() {
  rysuj();
}
