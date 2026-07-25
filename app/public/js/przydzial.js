// Karta „Przydział" (tylko admin): propozycje reorganizacji kategorii do przyjęcia przez
// człowieka. Decyzja Szymona z 2026-07-24: „Zaproponuj, a ja wybiorę w aplikacji, które jest
// które" — skrypt reorganizacji NIC nie przepina, każda kwota rusza się dopiero tutaj.
// Grupy idą po liczbie wpisów malejąco: najpierw to, co zamyka najwięcej pracy jednym
// kliknięciem. Renderujemy do #przydzialBox (index.html trzyma tylko pusty kontener).
import { $, el, api, zl, state, track, toast, refreshers } from './core.js';

const KSIEGI = { 1: 'RODZINA', 2: 'PERSEVERA' };
const BLEDY = {
  admin_only: 'przydział to decyzja administratora',
  bad_ledger: 'nieprawidłowa księga',
  bad_group: 'nie ma takiej grupy — odśwież widok',
  bad_ids: 'nieprawidłowe identyfikatory propozycji',
  bad_category: 'kategoria docelowa nie należy do księgi, w której ma wylądować wpis',
  category_not_found: 'nie ma takiej kategorii',
  category_archived: 'ta kategoria jest w archiwum — przywróć ją w panelu Admin',
  category_other_ledger: 'kategoria musi być z tej samej księgi, w której wpis wyląduje',
  proposal_exists: 'dla tego wpisu taka propozycja już istnieje (może odrzucona)',
  nothing_to_update: 'nie ma czego zmieniać — odśwież widok',
  ksiega_sie_nie_zgadza: 'PRZERWANO I WYCOFANO: liczba wpisów albo suma kwot nie zgadzała się po przepięciu',
};
// fetch przy zerwanej sieci rzuca TypeError „Failed to fetch" — to nie komunikat dla człowieka
const opisBledu = (err) => (err instanceof TypeError || !navigator.onLine)
  ? 'brak połączenia z internetem'
  : (BLEDY[err?.data?.error] || err?.data?.error || err?.message || 'błąd');

let ksiega = 0;          // wybrana księga
let grupy = [], razem = 0;
let otwarta = null;      // key rozwiniętej grupy
let wpisy = [];          // wpisy rozwiniętej grupy
let celujemy = null;     // key grupy, dla której wybieramy inny cel
let kategorie = null;    // spłaszczona lista kategorii księgi (do „Zmień cel…")
let zajete = false;      // trwa zapis — jedna decyzja naraz

async function pobierz() {
  const r = await api(`/api/v1/proposals?ledger=${ksiega}`);
  grupy = r.groups || [];
  razem = r.total || 0;
}

async function odswiez() {
  try {
    await pobierz();
    if (otwarta && !grupy.some((g) => g.key === otwarta)) { otwarta = null; wpisy = []; }
    if (celujemy && !grupy.some((g) => g.key === celujemy)) celujemy = null;
    rysuj();
  } catch (err) {
    if (err.message === 'auth') return;
    $('#przydzialBox').innerHTML = '';
    $('#przydzialBox').append(el('p', { class: 'msg err' }, 'Nie udało się wczytać propozycji: ' + opisBledu(err)));
  }
}

// Jedna decyzja naraz: accept przepina wpisy w transakcji SQL, a dwa równoległe przydziały
// pracowałyby na liście, która zmienia się pod stopami.
async function decyzja(sciezka, body, opis) {
  if (zajete) return toast('Poczekaj — poprzednia decyzja jeszcze się zapisuje.');
  zajete = true;
  try {
    const w = await api(`/api/v1/proposals/${sciezka}`, { method: 'POST', body: JSON.stringify(body) });
    track('Przydział kategorii', 'przydzial', { detail: `${sciezka}; ${opis}` });
    const ile = w.przyjete ?? w.odrzucone ?? w.przestawione ?? 0;
    toast(w.przywrocone_kategorie ? `${opis}: ${ile}. Kategoria docelowa wróciła z archiwum.` : `${opis}: ${ile}.`);
    otwarta = null;
    wpisy = [];
    celujemy = null;
    await odswiez();
  } catch (err) {
    if (err.message === 'auth') return;
    toast('Nie zapisano: ' + opisBledu(err));
    await odswiez();
  } finally { zajete = false; }
}

// Decyzja obejmuje CAŁĄ grupę (bez `ids`) albo wskazane wpisy.
const cialo = (g, ids) => (ids ? { ids } : { group: g.key, ledger: ksiega });

async function rozwin(g) {
  if (otwarta === g.key) { otwarta = null; wpisy = []; return rysuj(); }
  try {
    const r = await api(`/api/v1/proposals/${g.key}/items?ledger=${ksiega}`);
    wpisy = r.items || [];
    otwarta = g.key;
    rysuj();
  } catch (err) {
    if (err.message !== 'auth') toast('Nie udało się wczytać wpisów: ' + opisBledu(err));
  }
}

// Lista kategorii księgi, w której wpis wyląduje — do wskazania INNEGO celu niż proponowany.
// Trasa /categories zwraca wyłącznie aktywne, a serwer i tak odmawia celu z archiwum (K8).
async function wczytajKategorie(led) {
  if (kategorie && kategorie.led === led) return kategorie.lista;
  const r = await api(`/api/v1/categories?ledger=${led}`);
  const lista = [];
  for (const k of r.categories || []) {
    lista.push({ id: k.id, path: k.name });
    for (const p of k.children || []) lista.push({ id: p.id, path: `${k.name} > ${p.name}` });
  }
  kategorie = { led, lista };
  return lista;
}

async function pokazWyborCelu(g) {
  celujemy = celujemy === g.key ? null : g.key;
  if (celujemy) {
    try { await wczytajKategorie(g.to_ledger_id || ksiega); }
    catch (err) {
      celujemy = null;
      if (err.message !== 'auth') toast('Nie udało się wczytać kategorii: ' + opisBledu(err));
    }
  }
  rysuj();
}

function wyborCelu(g) {
  const box = el('div', { class: 'row wrap prz-cel' });
  const s = el('select', { title: 'Nowa kategoria docelowa' });
  for (const k of (kategorie && kategorie.lista) || []) s.append(el('option', { value: String(k.id) }, k.path));
  s.value = String(g.to_id);
  const ok = el('button', { class: 'btn primary small', type: 'button' }, 'Ustaw cel');
  ok.onclick = () => decyzja('retarget', { ...cialo(g), to_category_id: Number(s.value) }, 'Zmieniono cel');
  const nie = el('button', { class: 'btn small', type: 'button' }, 'Anuluj');
  nie.onclick = () => { celujemy = null; rysuj(); };
  box.append(el('span', { class: 'msg' }, 'Zamiast propozycji przydziel do:'), s, ok, nie,
    el('span', { class: 'msg' }, 'Zmiana celu nic nie przepina — wpisy ruszą się dopiero po „Przyjmij".'));
  return box;
}

// „1000 Czynsz → Dom i media > Czynsz · 23 wpisy · 4 600,00 zł · A3"
function naglowekGrupy(g) {
  const w = el('div', { class: 'row wrap prz-head' });
  const przelacz = el('button', { class: 'btn small prz-para', type: 'button', title: 'Pokaż wpisy grupy' },
    `${otwarta === g.key ? '▾' : '▸'} ${g.from} → ${g.to}`);
  przelacz.onclick = () => rozwin(g);
  const ile = g.n === 1 ? '1 wpis' : `${g.n} wpisy`;
  w.append(przelacz, el('span', { class: 'prz-meta' }, `· ${ile} · ${zl(g.kwota)} · ${g.rule_id}`));
  if (g.to_ledger_id) w.append(el('span', { class: 'pill' }, '→ księga ' + (KSIEGI[g.to_ledger_id] || g.to_ledger_id)));
  if (g.to_type) w.append(el('span', { class: 'pill' }, '→ typ ' + g.to_type));
  if (g.tag) w.append(el('span', { class: 'pill' }, '# ' + g.tag));
  return w;
}

function przyciskiGrupy(g) {
  const w = el('div', { class: 'row wrap prz-akcje' });
  const przyjmij = el('button', { class: 'btn primary small', type: 'button' }, 'Przyjmij');
  przyjmij.onclick = () => decyzja('accept', cialo(g), `Przydzielono do „${g.to}"`);
  const cel = el('button', { class: 'btn small', type: 'button' }, 'Zmień cel…');
  cel.onclick = () => pokazWyborCelu(g);
  const odrzuc = el('button', { class: 'btn small', type: 'button' }, 'Odrzuć');
  odrzuc.onclick = () => {
    if (confirm(`Odrzucić propozycję dla ${g.n} wpis(ów)?\n\n`
      + 'Decyzja „nie" jest trwała — kolejne uruchomienie skryptu tej propozycji nie odtworzy.\n'
      + 'Wpisy zostają tam, gdzie są (nic nie ginie).')) decyzja('reject', cialo(g), 'Odrzucono');
  };
  w.append(przyjmij, cel, odrzuc);
  return w;
}

function wierszWpisu(it) {
  const w = el('div', { class: 'row wrap prz-wpis' });
  w.append(el('span', { class: 'prz-data' }, it.tx_date), el('strong', {}, zl(it.amount)),
    el('span', { class: 'prz-opis' }, it.description || '—'),
    el('span', { class: 'msg' }, `${it.type} · ${it.user_name}${it.deleted_at ? ' · w koszu' : ''}`));
  if (it.to_type) w.append(el('span', { class: 'pill' }, '→ ' + it.to_type));
  if (it.tag) w.append(el('span', { class: 'pill' }, '# ' + it.tag));
  const przyjmij = el('button', { class: 'btn small', type: 'button', title: 'Przydziel ten jeden wpis' }, 'Przyjmij');
  przyjmij.onclick = () => decyzja('accept', { ids: [it.id] }, 'Przydzielono wpis');
  const odrzuc = el('button', { class: 'btn small', type: 'button', title: 'Zostaw ten wpis tam, gdzie jest' }, 'Odrzuć');
  odrzuc.onclick = () => decyzja('reject', { ids: [it.id] }, 'Odrzucono wpis');
  w.append(przyjmij, odrzuc);
  return w;
}

function pasekNarzedzi() {
  const pasek = el('div', { class: 'row wrap prz-tools' });
  const wybor = el('select', { title: 'Księga' });
  for (const id of state.me?.scope.ledgers || [1]) {
    wybor.append(el('option', { value: String(id) }, KSIEGI[id] || `Księga ${id}`));
  }
  wybor.value = String(ksiega);
  wybor.onchange = () => {
    ksiega = parseInt(wybor.value, 10);
    otwarta = null; wpisy = []; celujemy = null; kategorie = null;
    odswiez();
  };
  pasek.append(wybor, el('strong', { class: 'prz-licznik' }, `do przydziału: ${razem}`));
  return pasek;
}

function rysuj() {
  const box = $('#przydzialBox');
  box.innerHTML = '';
  box.append(el('h2', {}, 'Przydział kategorii'), pasekNarzedzi());
  if (!grupy.length) {
    box.append(el('p', { class: 'msg' }, 'Nic do przydziału w tej księdze. Propozycje pojawiają się tutaj '
      + 'po uruchomieniu skryptu reorganizacji taksonomii (scripts/reorganize-categories.js).'));
    return;
  }
  const lista = el('div', { class: 'prz-lista' });
  for (const g of grupy) {
    const karta = el('div', { class: 'prz-grupa' });
    karta.append(naglowekGrupy(g));
    if (g.przyklady?.length) karta.append(el('p', { class: 'msg prz-przyklady' }, 'np. ' + g.przyklady.join(' · ')));
    karta.append(przyciskiGrupy(g));
    if (celujemy === g.key) karta.append(wyborCelu(g));
    if (otwarta === g.key) {
      const w = el('div', { class: 'prz-wpisy' });
      wpisy.forEach((it) => w.append(wierszWpisu(it)));
      if (!wpisy.length) w.append(el('p', { class: 'msg' }, 'Brak wpisów w tej grupie — odśwież widok.'));
      karta.append(w);
    }
    lista.append(karta);
  }
  box.append(lista);
  box.append(el('p', { class: 'msg' },
    'Przyjęcie przepina wpisy (kategoria, a gdy propozycja tak mówi — księga, typ i tag) w jednej '
    + 'transakcji, z kontrolą liczby wpisów i sumy kwot. Kwota ani data nie zmieniają się nigdy. '
    + 'Stare kategorie zostają aktywne — schowasz je w panelu Admin, gdy nic w nich nie zostanie.'));
}

export function initPrzydzial() {
  refreshers.przydzial = async () => {
    if (!ksiega) ksiega = state.me?.scope.ledgers[0] || 1;
    await odswiez();
  };
}
