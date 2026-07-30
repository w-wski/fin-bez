// Analizy: karta „Analizy" (21d, Z12) — miesiąc/kwartał/rok, liczby zawsze, narracja
// modelu gdy dostępna. Cała treść budowana z JS do #analizyBox (wzorzec z admin.js/produkty.js
// — index.html trzyma tylko pusty kontener). Widoczne wyłącznie dla admina (routes/analizy.js).
// Góra karty (Z20, pkt 14): WSPÓLNY komponent pasekOkresu() z pasek-okresu.js, zero
// własnego markupu paska — trzy niezależne implementacje (Raporty/Analizy/Historia)
// scalone w jedno źródło prawdy.
import { $, el, api, zl, refreshers, track } from './core.js';
import { pasekOkresu, domyslnyOkres } from './pasek-okresu.js';
import { renderChat } from './analizy-chat.js';

const KSIEGI = { 1: 'RODZINA', 2: 'PERSEVERA' };

let typ = 'miesiac';
let okres = domyslnyOkres(typ);

function opisBledu(err) {
  return (err instanceof TypeError) ? 'brak połączenia z internetem' : (err?.data?.error || err?.message || 'błąd');
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

// Czat (Z20, pkt 13) renderuje się POD omówieniem, w OSOBNYM kontenerze (#analizyChatBox) —
// ta karta czyści #analizyBox przy każdej zmianie okresu i skasowałaby rozmowę, gdyby czat
// mieszkał w tym samym drzewie (patrz komentarz w index.html).
function odswiezCzat() {
  const box = $('#analizyChatBox');
  if (box) renderChat(box, { okresTyp: typ, okres });
}

function wyswietl(box, dane, narracja) {
  box.innerHTML = '';
  box.append(kpiKsiegi(dane));
  box.append(el('h3', {}, 'Top 5 kategorii wydatków'), topKategorie(dane));
  box.append(el('h3', {}, 'Paragony'), paragonySekcja(dane));
  box.append(el('h3', {}, 'Omówienie'), narracjaSekcja(narracja));
  odswiezCzat();
}

async function wczytajZapisana(box) {
  box.innerHTML = '';
  try {
    const r = await api(`/api/v1/analizy?okres_typ=${typ}&okres=${encodeURIComponent(okres)}`);
    if (r.znaleziono) wyswietl(box, r.analiza.dane, r.analiza.narracja);
    else {
      box.append(el('p', { class: 'msg' }, 'Dla tego okresu nie ma jeszcze zapisanej analizy — kliknij „Przygotuj analizę".'));
      odswiezCzat(); // czat pyta o okres niezależnie od tego, czy migawka już istnieje
    }
  } catch (err) {
    box.append(el('p', { class: 'msg err' }, 'Nie udało się wczytać: ' + opisBledu(err)));
  }
}

function rysuj() {
  const glowny = $('#analizyBox');
  glowny.innerHTML = '';
  const pasek = pasekOkresu({
    typ, okres,
    onChange: (t, o) => { typ = t; okres = o; rysuj(); },
  });
  const przycisk = el('button', { class: 'btn primary', type: 'button' }, 'Przygotuj analizę');
  const wynikBox = el('div', { class: 'stack an-wynik' });
  // disabled na czas POST — podwójny klik to dwa płatne wywołania modelu (Z14 #9).
  przycisk.onclick = async () => { przycisk.disabled = true; await przygotujAnalize(wynikBox); przycisk.disabled = false; };
  glowny.append(pasek.element, przycisk, wynikBox);
  wczytajZapisana(wynikBox);
}

export function initAnalizy() {
  refreshers.analizy = rysuj;
}

export function loadAnalizy() {
  rysuj();
}
