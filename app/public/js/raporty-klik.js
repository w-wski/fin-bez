// Klik z Raportu do Historii (Z8/#25): wycinek „Wydatki wg kategorii" prowadzi do listy
// wpisów, które się na niego składają, zawężonej do OKRESU raportu. Wydzielone z raporty.js
// (limit 300 linii, konwencja repo) — ten moduł zna tylko DOM raportu i indeks kategorii;
// samą nawigację i wypełnienie filtrów w Historii robią core.js/historia.js.
import { $, el, zl, show, api, toast } from './core.js';
import { pokazHistorie } from './historia.js';
import { trybUkladania, filtryHistoriiZKategorii } from './raporty-uklad.js';

// Płaski indeks kategorii z /api/v1/categories: id rodzica -> [id dzieci] (klik w RODZICA
// ma zabrać też jego podkategorie — inaczej wycinek wykresu i lista wpisów by się rozjechały).
export function indeksKategorii(categories) {
  const dzieci = new Map();
  for (const c of categories || []) {
    const ids = (c.children || []).map((k) => k.id);
    if (ids.length) dzieci.set(c.id, ids);
  }
  return { dzieci };
}

// Data czytelna dla człowieka: DD.MM.RRRR–DD.MM.RRRR, bez nazw miesięcy (bez ryzyka
// odmiany w niepasującym przypadku).
export function opisOkres(from, to) {
  const pl = (d) => (d ? d.split('-').reverse().join('.') : '');
  return from && to ? `${pl(from)}–${pl(to)}` : '';
}

// Węzeł staje się klikalny i dostępny z klawiatury (Enter/Spacja), z aria-label opisującym
// dokąd prowadzi — dostępność jak w reszcie aplikacji (klasa `.klikalny` w raporty.css).
// Eksportowana: raporty.js podpina pod nią też kafle KPI (K2) i wiersz „(bez kategorii)" (K5).
export function uklikalnij(n, aria, onKlik) {
  n.classList.add('klikalny');
  n.tabIndex = 0;
  n.setAttribute('role', 'button');
  n.setAttribute('aria-label', aria);
  n.addEventListener('click', onKlik);
  n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onKlik(); } });
}

// Przejście do Historii: nawigacja (`show`) tu na miejscu, wypełnienie filtrów i pobranie
// listy robi pokazHistorie() z historia.js — ten moduł nie zna warstwy sieciowej Historii.
async function idzDoHistorii(filtry) {
  show('historia');
  await pokazHistorie(filtry);
}

// Podpina klik pod wiersz „Wydatki wg kategorii" — ma category_id wprost z /api/v1/summary.
// `id === null` (wpisy „bez kategorii") zostaje nieklikalny: nie ma czym filtrować w Historii.
export function klikKategoria(row, ledger, okres, id, label, idx) {
  if (id == null) return;
  const filtry = filtryHistoriiZKategorii(ledger, okres, id, label, idx);
  uklikalnij(row, `Pokaż wpisy: ${label} · ${okres.opis}`, () => idzDoHistorii(filtry));
}

// K2 (Z15): kafel KPI (Wydatki/Przychody/Bilans/Wpisy/Suma okresu) — bez kategorii, tylko
// okres raportu. „Bankowe do uzgodnienia" celowo NIE dostaje kliku: to zestawienie z wyciągu
// bankowego, nie z księgi, więc nie ma czym go zawęzić w Historii.
export function klikKpi(tile, ledger, okres, label) {
  const filtry = filtryHistoriiZKategorii(ledger, okres, null, label, null);
  uklikalnij(tile, `Pokaż wpisy: ${label} · ${okres.opis}`, () => idzDoHistorii(filtry));
}

// ---------- Tabele sekcji raportu (Z9/Z15) ----------
// Przeniesione tu z raporty.js (limit 300 linii) — generyczne budowanie tabel, bez logiki
// konkretnej sekcji (ta zostaje w raporty.js: loadTransfery/loadBartus/loadNajem).

// Tabela z nagłówkami, ZAWSZE w kontenerze `.overflow` — na 390 px sześć kolumn liczb w kroju
// o stałej szerokości znaku nie mieści się w żaden sposób, a wtedy alternatywą dla przewijania
// w poziomie jest łamanie „zł" do drugiej linii. `rows` to tablice komórek (gołe wartości).
export function tabela(headers, rows) {
  const t = el('table');
  t.innerHTML = '<thead><tr>' + headers.map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('') + '</tr></thead>';
  const tb = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    r.forEach((v, i) => tr.append(el('td', { class: i ? 'num' : '' }, String(v))));
    tb.append(tr);
  }
  t.append(tb);
  const w = el('div', { class: 'overflow' }); w.append(t); return w;
}

// Analityka użycia (tylko admin) — czas na kartach i akcje z ostatnich 30 dni.
export async function loadTelemetry(box) {
  try {
    const t = await api('/api/v1/reports/telemetry?days=30');
    box.innerHTML = '';
    box.append(el('h2', {}, 'Czas na kartach [min] wg osoby'));
    box.append(tabela(['Karta', 'Kto', 'Minuty', 'Zdarzenia'],
      t.by_view.map((r) => [r.view_name, r.user_name, Number(r.minutes), Number(r.events)])));
    box.append(el('h2', {}, 'Akcje (w tym offline)'));
    box.append(tabela(['Akcja', 'Kto', 'Razem', 'Offline'],
      t.by_action.map((r) => [r.action, r.user_name, Number(r.n), Number(r.offline_n) || 0])));
  } catch { box.innerHTML = ''; }
}

// ---------- K5 (Z15): „(bez kategorii)" — lista wpisów do nadania kategorii w miejscu ----------
// raporty.js robi `sekcja('bez-kategorii')` (czyści/tworzy kontener) i deleguje wypełnienie
// tutaj — ten moduł już zna `api`/`toast`, więc PATCH pojedynczego wpisu też tu mieszka.
export async function wypelnijBezKategorii(box, ledger, okres, categories) {
  box.append(el('h2', {}, 'Wpisy bez kategorii'));
  let rows;
  try { ({ rows } = await api(`/api/v1/reports/no-category?ledger=${ledger}&from=${okres.from}&to=${okres.to}`)); }
  catch { box.append(el('p', { class: 'msg' }, 'Nie udało się pobrać listy wpisów bez kategorii.')); return; }
  if (!rows.length) { box.append(el('p', { class: 'msg' }, 'Brak wpisów bez kategorii w tym okresie.')); return; }
  // Kategorie spłaszczone „Rodzic" / „Rodzic > Dziecko" — ten sam kształt co historia.js/catOptions.
  const flat = [];
  for (const c of categories) {
    flat.push({ id: c.id, label: c.name });
    for (const k of c.children) flat.push({ id: k.id, label: `${c.name} > ${k.name}` });
  }
  for (const r of rows) box.append(wierszBezKategorii(r, flat));
}

// Wybór kategorii zapisuje TYLKO temu wpisowi (PATCH /transactions/:id) i zdejmuje go z listy —
// wpisów bywa kilkanaście naraz, przeładowanie całej listy po każdym byłoby zbędnym ruchem sieci.
function wierszBezKategorii(r, flat) {
  const w = el('div', { class: 'barrow' });
  w.append(el('span', { class: 'bname' }, `${String(r.tx_date).slice(0, 10)} · ${r.description || '—'}`),
    el('span', { class: 'bval' }, zl(r.amount)));
  const sel = el('select', { title: 'Nadaj kategorię' });
  sel.append(el('option', { value: '' }, '— wybierz kategorię —'));
  for (const c of flat) sel.append(el('option', { value: c.id }, c.label));
  sel.onchange = async () => {
    if (!sel.value) return;
    try {
      await api('/api/v1/transactions/' + r.id, { method: 'PATCH', body: JSON.stringify({ category_id: Number(sel.value) }) });
    } catch (err) { toast('Nie zapisałem kategorii: ' + (err.data?.error || err.message)); return; }
    w.remove();
  };
  w.append(sel);
  return w;
}

// ---------- K3 (Z15): zwijane sekcje, stan zapamiętany NA SERWERZE (user_ui) ----------
// Domyślnie rozłożone (decyzja Szymona pkt 12); zero localStorage — zakaz zlecenia — dlatego
// `zwiniete` żyje wyłącznie w pamięci karty i synchronizuje się z GET/PUT /api/v1/ui/....
let zwiniete = new Set();
let zaladowane = false;               // pobieramy raz na życie karty — kolejne wejścia czytają z pamięci

// `odswiezZwijanie` (niżej) czeka na to PRZED pierwszym rysowaniem przycisków — inaczej
// pierwsze wejście na Raporty pokazałoby sekcje rozłożone na mgnienie oka, zanim doszłaby odpowiedź.
async function upewnijZaladowane() {
  if (zaladowane) return;
  zaladowane = true;
  try {
    const { wartosc } = await api('/api/v1/ui/raporty.zwiniete');
    zwiniete = new Set(Array.isArray(wartosc) ? wartosc : []);
  } catch { /* offline/błąd — sekcje zostają domyślnie rozłożone (pkt 12 decyzji Szymona) */ }
}

function zapiszZwiniete() {
  // Zapis nie blokuje UI — sekcja i tak jest już zwinięta na ekranie, zapis to tylko pamięć
  // na przyszłość (inne urządzenie/wejście); błąd zapisu nie unieważnia bieżącego kliku.
  api('/api/v1/ui/raporty.zwiniete', { method: 'PUT', body: JSON.stringify({ wartosc: [...zwiniete] }) }).catch(() => {});
}

const TYTULY_SEKCJI = {
  kpi: 'Kafle KPI', 'by-cat': 'Wydatki wg kategorii', trend: 'Trend 6 miesięcy',
  fvp: 'Rodzina vs PERSEVERA', telemetria: 'Telemetria', transfery: 'Zobowiązania i cele',
  bartus: 'Konto Bartusia', najem: 'Najem: Kamil → Szymon → Darek', 'bez-kategorii': 'Wpisy bez kategorii',
};

// Nagłówek-przycisk jednej sekcji `data-kafel` — wołane po KAŻDYM przerysowaniu (sekcje
// dynamiczne czyszczą innerHTML przy każdym loadReport()), więc usuwamy stary przycisk
// i budujemy świeży zamiast aktualizować — inaczej duplikowałby się przy powtórnym wejściu.
function uczynZwijalna(box) {
  const id = box.dataset.kafel;
  box.querySelector(':scope > .kafel-naglowek')?.remove();
  if (!id || !box.children.length) return;           // pusta sekcja (brak danych) — nic do zwijania
  const h2 = box.querySelector(':scope > h2');
  if (h2) h2.hidden = true;                           // tekst nagłówka przechodzi do przycisku
  const zwinieta = zwiniete.has(id);
  const btn = el('button', { type: 'button', class: 'kafel-naglowek', 'aria-expanded': String(!zwinieta) },
    `${zwinieta ? '▸' : '▾'} ${(h2 ? h2.textContent : TYTULY_SEKCJI[id]) || id}`);
  btn.onclick = () => {
    if (zwiniete.has(id)) zwiniete.delete(id); else zwiniete.add(id);
    uczynZwijalna(box);
    zapiszZwiniete();
  };
  box.prepend(btn);
  for (const n of box.children) if (n !== btn) n.hidden = zwinieta;
}

// Wołane RAZ na koniec loadReport() — wszystkie sekcje `data-kafel` karty naraz.
export async function odswiezZwijanie(stack) {
  await upewnijZaladowane();
  stack?.querySelectorAll(':scope > [data-kafel]').forEach(uczynZwijalna);
}

// Guzik „Ułóż"/„Gotowe" nad kaflami: przełącza tryb ręcznego układania z raporty-uklad.js
// (Z9). Zapis leci od razu po wyłączeniu trybu — bez osobnego przycisku „Zapisz".
export function initUkladBtn(box, btn) {
  if (!btn) return;
  const tryb = trybUkladania(box, (layout) => api('/api/v1/uklad', { method: 'PUT', body: JSON.stringify({ layout }) }));
  btn.onclick = async () => {
    if (btn.dataset.aktywny) {
      // Zapis leci przez PUT /uklad — offline/błąd rzuca, i wtedy przycisk MUSI zostać w trybie
      // edycji (nie udawać sukcesu), inaczej układ ginie po cichu bez śladu (Z14 #4).
      try {
        await tryb.wylacz();
        btn.textContent = 'Ułóż';
        delete btn.dataset.aktywny;
      } catch {
        toast('Nie zapisałem układu — spróbuj ponownie z siecią.');
      }
    } else { tryb.wlacz(); btn.textContent = 'Gotowe'; btn.dataset.aktywny = '1'; }
  };
}
