// Kategorie: pobranie drzewa, cache offline, listy wyboru w formularzu Wpisu
// oraz pozycje „➕ DODAJ…" (K1–K3) z formularzem renderowanym do #catAddBox.
import { $, el, api, state, track, toast, CATS_CACHE_KEY } from './core.js';

export let CATS = [];
export const getCats = () => CATS;

const ostatni = { main: '', sub: '' };       // ostatni ZWYKŁY wybór — do cofnięcia po „Anuluj"
let dodawanie = null;                        // {podkat, pole} — otwarty formularz „DODAJ…"

const ksiega = () => $('#ledger').value || state.me.scope.ledgers[0];
const zamknijDodawanie = () => { dodawanie = null; $('#catAddBox').innerHTML = ''; };

// Kody błędów backendu po ludzku — użytkownik nie ma czytać ani „bad_input", ani „Failed to fetch".
const BLEDY = {
  bad_input: 'podaj nazwę kategorii',
  bad_parent: 'nie ma takiej kategorii nadrzędnej',
  parent_not_found: 'nie ma takiej kategorii nadrzędnej',
  parent_not_root: 'podkategoria nie może mieć własnych podkategorii',
  ledger_forbidden: 'nie masz dostępu do tej księgi',
  bad_ledger: 'nieprawidłowy numer księgi',
  not_created: 'nie udało się zapisać — odśwież stronę i spróbuj raz jeszcze',
  admin_only: 'to może zrobić tylko administrator',
};
function opisBledu(err) {
  // fetch przy zerwanej sieci rzuca TypeError „Failed to fetch" — nazywamy to po imieniu
  if (err instanceof TypeError || !navigator.onLine) return 'brak połączenia z internetem';
  return BLEDY[err.data?.error] || err.data?.error || err.message || 'nieznany błąd';
}

// Pozycja „➕ DODAJ…" ma PUSTĄ wartość i znacznik data-add: gdyby użytkownik zostawił ją
// zaznaczoną i zapisał wpis, wpis.js zobaczy „brak kategorii", a nie sztuczne id.
const jestDodaj = (sel) => sel.options[sel.selectedIndex]?.dataset.add === '1';

// Offline pozycja jest nieaktywna i mówi dlaczego (K8) — zamiast milczeć.
function opcjaDodaj(etykieta) {
  const o = el('option', { value: '', 'data-add': '1' },
    navigator.onLine ? etykieta : `${etykieta} — wymaga internetu`);
  o.disabled = !navigator.onLine;
  return o;
}

// Pozycja „➕ DODAJ…" jest zawsze ostatnia na liście.
function zaznaczDodaj(podkat) {
  const sel = podkat ? $('#catSub') : $('#catMain');
  sel.selectedIndex = sel.options.length - 1;
}

export function renderCats() {
  const main = $('#catMain');
  const chce = jestDodaj(main) ? ostatni.main : main.value;
  // migawka otwartego formularza: przerysowanie list (np. mrugnięcie sieci) nie może
  // skasować nazwy, którą użytkownik właśnie wpisuje — ani przestawić mu kursora
  const wznow = dodawanie && { podkat: dodawanie.podkat, tekst: dodawanie.pole.value,
    fokus: document.activeElement === dodawanie.pole };
  main.innerHTML = '';
  main.append(el('option', { value: '' }, 'Kategoria…'));
  for (const c of CATS) main.append(el('option', { value: String(c.id) }, c.name));
  main.append(opcjaDodaj('➕ DODAJ KATEGORIĘ'));
  main.value = CATS.some((c) => String(c.id) === chce) ? chce : '';
  main.onchange = onCatMain;                 // po każdym renderze (main.js ustawia to raz na starcie)
  $('#catSub').onchange = onCatSub;          // main.js nie podpina podkategorii — robimy to tutaj
  onCatMain();
  if (wznow) { zaznaczDodaj(wznow.podkat); pokazDodawanie(wznow.podkat, wznow.tekst, wznow.fokus); }
}

export async function loadCats() {
  const ledger = ksiega();
  try {
    CATS = (await api(`/api/v1/categories?ledger=${ledger}`)).categories;
    localStorage.setItem(CATS_CACHE_KEY + ledger, JSON.stringify(CATS)); // cache na offline
  } catch (err) {
    if (err.message === 'auth') throw err;
    try { CATS = JSON.parse(localStorage.getItem(CATS_CACHE_KEY + ledger)) || []; } catch { CATS = []; }
  }
  renderCats();
}

// Wybór kategorii: buduje listę podkategorii. Lista jest widoczna także wtedy, gdy kategoria
// nie ma podkategorii — zostaje pusta pozycja + „➕ DODAJ PODKATEGORIĘ" (K2).
export function onCatMain() {
  const main = $('#catMain'), sub = $('#catSub');
  if (jestDodaj(main)) return wybranoDodaj(false);
  ostatni.main = main.value;
  zamknijDodawanie();
  const c = CATS.find((x) => String(x.id) === main.value);
  if (!c) { sub.hidden = true; sub.innerHTML = ''; ostatni.sub = ''; return; }
  const chce = jestDodaj(sub) ? ostatni.sub : sub.value;
  const dzieci = c.children || [];
  sub.innerHTML = '';
  sub.append(el('option', { value: '' }, 'Podkategoria'));
  for (const k of dzieci) sub.append(el('option', { value: String(k.id) }, k.name));
  sub.append(opcjaDodaj('➕ DODAJ PODKATEGORIĘ'));
  sub.value = dzieci.some((k) => String(k.id) === chce) ? chce : '';
  ostatni.sub = sub.value;
  sub.hidden = false;
}

function onCatSub() {
  const sub = $('#catSub');
  if (jestDodaj(sub)) return wybranoDodaj(true);
  ostatni.sub = sub.value;
  zamknijDodawanie();
}

function przywrocWybor(podkat) {
  const pole = podkat ? $('#catSub') : $('#catMain');
  pole.value = podkat ? ostatni.sub : ostatni.main;
  if (!podkat) onCatMain();
}

// Użytkownik wybrał z listy pozycję „➕ DODAJ…" — tu (i tylko tu) sprawdzamy warunki wstępne.
function wybranoDodaj(podkat) {
  if (!navigator.onLine) {                   // K8: offline nie da rady — powiedz to wprost
    toast('Dodanie kategorii wymaga internetu. Wybierz istniejącą — wpis i tak zapisze się offline.');
    return przywrocWybor(podkat);
  }
  if (podkat && !$('#catMain').value) {
    toast('Najpierw wybierz kategorię, do której ma trafić podkategoria.');
    return przywrocWybor(podkat);
  }
  pokazDodawanie(podkat, '');
}

// Formularz dodawania — pojawia się WYŁĄCZNIE po wybraniu pozycji „➕ DODAJ…" (K1).
// `tekst` niesie nazwę przy odtwarzaniu formularza po przerysowaniu list, a `fokus`
// pilnuje, żeby odtworzenie nie zabrało kursora z innego pola formularza Wpisu.
function pokazDodawanie(podkat, tekst, fokus = true) {
  const box = $('#catAddBox');
  box.innerHTML = '';
  const pole = el('input', { type: 'text', maxlength: '96', class: 'catadd-nazwa',
    placeholder: podkat ? 'Nazwa podkategorii' : 'Nazwa kategorii' });
  pole.value = tekst || '';
  // type="button": #catAddBox siedzi w #txForm, domyślny submit zapisałby transakcję
  const zapisz = el('button', { type: 'button', class: 'btn primary' }, 'Zapisz');
  const anuluj = el('button', { type: 'button', class: 'btn' }, 'Anuluj');
  zapisz.onclick = () => zapiszNowa(pole, podkat);
  anuluj.onclick = () => { zamknijDodawanie(); przywrocWybor(podkat); };
  pole.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); zapiszNowa(pole, podkat); } };
  const wiersz = el('div', { class: 'row catadd' });
  wiersz.append(pole, zapisz, anuluj);
  box.append(wiersz);
  dodawanie = { podkat, pole };
  if (fokus) pole.focus();
}

const wszystkieId = () => new Set(CATS.flatMap((c) => [c.id, ...(c.children || []).map((k) => k.id)]));

async function zapiszNowa(pole, podkat) {
  const name = String(pole.value || '').trim();
  if (!name) return toast('Podaj nazwę.');
  if (!navigator.onLine) return toast('Brak internetu — kategorię dodasz, gdy wróci sieć. Nazwa zostaje w formularzu.');
  const parent = podkat ? $('#catMain').value : null;
  // kategoria nadrzędna mogła zniknąć z listy w trakcie pisania (np. admin ją zarchiwizował) —
  // bez tego podkategoria zapisałaby się cicho jako kategoria główna
  if (podkat && !parent) return toast('Kategoria nadrzędna zniknęła z listy — wybierz ją jeszcze raz.');
  const przed = wszystkieId();
  try {
    const r = await api('/api/v1/categories', { method: 'POST',
      body: JSON.stringify({ ledger_id: ksiega(), name, parent_id: parent }) });
    zamknijDodawanie();
    await loadCats();                        // odśwież drzewo + cache offline
    wybierz(r.id, podkat);
    track('Dodanie kategorii', 'wpis', { detail: podkat ? 'podkategoria' : 'kategoria' });
    // K3: nazwa mogła już istnieć (INSERT IGNORE + unikat) — wtedy tylko ją wybieramy
    toast(przed.has(r.id) ? `„${name}" już istniała — wybrałem ją.` : `Dodano: ${name}`);
  } catch (err) {
    if (err.message === 'auth') return;
    if (err.data?.error === 'category_archived') return archiwalna(err.data, podkat);
    // Formularz i wpisana nazwa ZOSTAJĄ otwarte — nikt nie ma przepisywać tekstu po błędzie.
    toast('Nie udało się dodać: ' + opisBledu(err));
    pole.focus();
  }
}

// Nazwa trafiła w kategorię z archiwum. POST jej nie przywraca — to uprawnienie admina
// (PATCH {active:1}), więc pozostali dostają jasną prośbę zamiast cichego obejścia 403.
function archiwalna(dane, podkat) {
  if (state.me?.role !== 'admin') {
    return toast(`„${dane.name}" jest w archiwum — poproś administratora o przywrócenie.`);
  }
  toast(`„${dane.name}" jest w archiwum.`, { label: 'Przywróć', onClick: () => przywroc(dane, podkat) });
}

async function przywroc(dane, podkat) {
  try {
    await api(`/api/v1/categories/${dane.id}`, { method: 'PATCH', body: JSON.stringify({ active: 1 }) });
    zamknijDodawanie();
    await loadCats();
    wybierz(dane.id, podkat);
    track('Przywrócenie kategorii', 'wpis', { detail: podkat ? 'podkategoria' : 'kategoria' });
    toast(`Przywrócono „${dane.name}" i wybrano.`);
  } catch (err) {
    if (err.message === 'auth') return;
    toast('Nie udało się przywrócić: ' + opisBledu(err));
  }
}

function wybierz(id, podkat) {
  if (!podkat) { $('#catMain').value = String(id); ostatni.main = String(id); onCatMain(); return; }
  onCatMain();                               // przebuduj listę podkategorii o nową pozycję
  $('#catSub').value = String(id);
  ostatni.sub = String(id);
}

// Zostawiona pozycja „➕ DODAJ KATEGORIĘ" + kliknięcie dużego „Zapisz" zapisywały wpis BEZ
// kategorii i w ciszy (wpis.js widzi pustą wartość). Przechwytujemy submit w fazie
// przechwytywania — zanim dojdzie do wpis.js — i mówimy, co zostało niedokończone.
$('#txForm')?.addEventListener('submit', (e) => {
  if (!jestDodaj($('#catMain')) && !jestDodaj($('#catSub'))) return;
  e.preventDefault();
  e.stopPropagation();
  toast('Dokończ dodawanie kategorii („Zapisz" przy nazwie) albo kliknij „Anuluj" — wpis NIE został zapisany.');
  dodawanie?.pole.focus();
}, true);

// Zmiana stanu sieci przerysowuje listy: pozycje „➕ DODAJ…" mają być aktywne dokładnie
// wtedy, gdy da się ich użyć. Wybór użytkownika i otwarty formularz są przy tym zachowywane.
window.addEventListener('online', renderCats);
window.addEventListener('offline', renderCats);
