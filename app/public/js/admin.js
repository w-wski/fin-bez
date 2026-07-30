// Panel administracyjny (widoczny wyłącznie dla roli admin).
// Zawartość renderowana z JS do kontenera #adminBox — index.html trzyma tylko pusty kontener.
// Zakres (K4, K6, K7): drzewo kategorii księgi + zmiana nazwy, rodzica, archiwizacja/przywrócenie
// oraz kolory (ręcznie i „Przydziel automatycznie" z palety OKLCH pasującej do motywu).
import { $, el, api, state, track, toast, refreshers } from './core.js';
import { initAdminDostep } from './admin-dostep.js';
// paleta.js jest wczytywana LENIWO (dopiero przy „Przydziel automatycznie"): nie ma jej na
// liście app-shella w sw.js, więc statyczny import mógłby wywrócić start aplikacji offline.
const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

const KSIEGI = { 1: 'RODZINA', 2: 'PERSEVERA' };
const BLEDY = {
  admin_only: 'to może zrobić tylko administrator',
  parent_self: 'kategoria nie może być własnym rodzicem',
  parent_cycle: 'to zapętliłoby drzewo (rodzic jest potomkiem tej kategorii)',
  parent_not_root: 'rodzicem może być tylko kategoria główna — drzewo ma dwa poziomy',
  parent_other_ledger: 'rodzic musi być z tej samej księgi',
  parent_has_children: 'kategoria z podkategoriami nie może stać się podkategorią',
  parent_not_found: 'nie ma takiej kategorii nadrzędnej',
  name_exists: 'taka nazwa już istnieje na tym poziomie',
  bad_color: 'kolor musi być w formacie #rrggbb',
  bad_name: 'nazwa nie może być pusta',
  bad_parent: 'nieprawidłowy identyfikator kategorii nadrzędnej',
  bad_active: 'nieprawidłowa wartość pola „aktywna"',
  bad_sort_order: 'kolejność musi być liczbą 0–32767',
  bad_id: 'nieprawidłowy identyfikator kategorii',
  bad_ledger: 'nieprawidłowy numer księgi',
  nothing_to_update: 'nic się nie zmieniło',
  not_found: 'tej kategorii już nie ma — odśwież widok',
  has_active_children: 'kategoria ma aktywne podkategorie',
  busy: 'ktoś właśnie zmienia to samo drzewo — spróbuj jeszcze raz',
};
// fetch przy zerwanej sieci rzuca TypeError „Failed to fetch" — to nie jest komunikat dla człowieka
const opisBledu = (err) => (err instanceof TypeError || !navigator.onLine)
  ? 'brak połączenia z internetem'
  : (BLEDY[err?.data?.error] || err?.data?.error || err?.message || 'błąd');

let ksiega = 0;              // wybrana księga
let zArchiwalnymi = false;   // czy pokazywać kategorie active=0
let drzewo = [];
let zajete = false;          // trwa zapis — patrz `zapisz()`
// K1: drzewo renderuje się DOMYŚLNIE złożone do korzeni; klik rozwija wyłącznie jej dzieci.
// Stan nie musi przeżyć wejścia do aplikacji (K1) — zwykła zmienna modułu, zerowana zmianą księgi.
let rozwiniete = new Set();

async function pobierz() {
  const r = await api(`/api/v1/categories?ledger=${ksiega}${zArchiwalnymi ? '&all=1' : ''}&counts=1`);
  drzewo = r.categories;
}

async function odswiez() {
  try {
    await pobierz();
    rysuj();
  } catch (err) {
    if (err.message === 'auth') return;
    $('#adminBox').innerHTML = '';
    $('#adminBox').append(el('p', { class: 'msg err' },
      'Nie udało się wczytać kategorii: ' + opisBledu(err)));
  }
}

// Jeden PATCH = jedna zmiana pola. Po niepowodzeniu przerysowujemy widok, żeby
// pole wróciło do stanu z bazy (a nie zostało z wartością, której serwer nie przyjął).
// Zwraca null przy powodzeniu, a przy błędzie sam błąd — z `cicho` wywołujący obsługuje go
// sam (archiwizacja kaskadowa musi umieć dopytać użytkownika, nie tylko pokazać komunikat).
// Jednocześnie leci najwyżej JEDEN zapis: listy `onchange` odpalają PATCH bez czekania,
// a dwa naraz działałyby na drzewie, które właśnie zmienia się pod stopami (serwer i tak
// je rozsądzi pod blokadą, ale użytkownik dostałby wtedy niezrozumiałą odmowę).
async function zapisz(id, pola, cicho) {
  if (zajete) {
    toast('Poczekaj — poprzednia zmiana jeszcze się zapisuje.');
    return Object.assign(new Error('zajete'), { data: { error: 'zajete' } });
  }
  zajete = true;
  try {
    await api(`/api/v1/categories/${id}`, { method: 'PATCH', body: JSON.stringify(pola) });
    track('Edycja kategorii', 'admin', { detail: Object.keys(pola).join(',') });
    await odswiez();
    toast('Zapisano.');
    return null;
  } catch (err) {
    if (err.message === 'auth') return err;
    if (!cicho) { toast('Nie zapisano: ' + opisBledu(err)); await odswiez(); }
    return err;
  } finally { zajete = false; }
}

// Archiwizacja korzenia z AKTYWNYMI podkategoriami chowała je po cichu razem z rodzicem
// („Czynsz" z setkami wpisów znikał z Wpisu, Historii i Paragonu). Serwer odmawia (409)
// i podaje ich liczbę — pytamy wprost i dopiero potem wysyłamy jawną kaskadę.
async function archiwizuj(c) {
  const err = await zapisz(c.id, { active: 0 }, true);
  if (!err) return;
  if (err.message === 'auth' || err.message === 'zajete') return;   // komunikat już poszedł
  if (err.data?.error !== 'has_active_children') {
    toast('Nie zapisano: ' + opisBledu(err));
    return odswiez();
  }
  const n = err.data.children;
  const pytanie = `„${c.name}" ma aktywne podkategorie: ${n}.\n`
    + 'Archiwizacja schowa je z list wyboru razem z kategorią (wpisy zostają nietknięte).\n\n'
    + `Archiwizować razem z podkategoriami (${n})?`;
  if (!confirm(pytanie)) return;
  await zapisz(c.id, { active: 0, cascade: true });
}

function pasekNarzedzi() {
  const pasek = el('div', { class: 'row wrap admin-tools' });
  const wybor = el('select', { title: 'Księga' });
  for (const id of state.me?.scope.ledgers || [1]) {
    wybor.append(el('option', { value: String(id) }, KSIEGI[id] || `Księga ${id}`));
  }
  wybor.value = String(ksiega);
  wybor.onchange = () => { ksiega = parseInt(wybor.value, 10); rozwiniete = new Set(); odswiez(); };

  const arch = el('input', { type: 'checkbox' });
  arch.checked = zArchiwalnymi;
  arch.onchange = () => { zArchiwalnymi = arch.checked; odswiez(); };
  const etykieta = el('label', {}, '');
  etykieta.append(arch, el('span', {}, 'Pokaż archiwalne'));

  const auto = el('button', { class: 'btn', type: 'button' }, '🎨 Przydziel automatycznie');
  auto.onclick = () => przydzielKolory(auto);

  pasek.append(wybor, etykieta, auto);
  return pasek;
}

// Kolor kategorii przy nazwie (K7). Wartość z bazy trafia do stylu, więc wchodzi
// wyłącznie po walidacji #rrggbb — inaczej pole zostaje puste.
function kropka(color) {
  const s = el('span', { class: 'catdot' });
  if (isHex(color)) s.style.background = color;
  else s.classList.add('pusta');
  return s;
}

function wyborRodzica(c, pod) {
  const s = el('select', { class: 'catparent', title: 'Kategoria nadrzędna' });
  s.append(el('option', { value: '' }, '— główna —'));
  for (const k of drzewo) {
    if (k.id !== c.id) s.append(el('option', { value: String(k.id) }, k.name));
  }
  s.value = pod ? String(c.parent_id) : '';
  if (!pod && (c.children || []).length) {
    s.disabled = true;                       // drzewo ma dwa poziomy — serwer i tak by odmówił
    s.title = 'Kategoria z podkategoriami nie może stać się podkategorią';
  }
  s.onchange = () => zapisz(c.id, { parent_id: s.value || null });
  return s;
}

function wiersz(c, pod) {
  const w = el('div', { class: `cat-row${pod ? ' pod' : ''}${c.active === 0 ? ' arch' : ''}` });

  const kolor = el('input', { type: 'color', class: 'catcolor', title: 'Kolor kategorii',
    value: isHex(c.color) ? c.color.toLowerCase() : '#888888' });
  kolor.onchange = () => zapisz(c.id, { color: kolor.value });

  const nazwa = el('input', { type: 'text', class: 'catname', maxlength: '96', value: c.name });
  nazwa.onchange = () => {
    const n = nazwa.value.trim();
    if (!n || n === c.name) { nazwa.value = c.name; return; }
    zapisz(c.id, { name: n });
  };

  const arch = el('button', { class: `btn small${c.active === 0 ? ' primary' : ''}`, type: 'button' },
    c.active === 0 ? 'Przywróć' : 'Archiwizuj');
  arch.onclick = () => (c.active === 0 ? zapisz(c.id, { active: 1 }) : archiwizuj(c));

  // K2: liczba wpisów TEJ kategorii (bez potomków) — przychodzi gotowa z serwera (GROUP BY).
  const licznik = el('span', { class: 'catn', title: 'Liczba wpisów w tej kategorii' },
    typeof c.n === 'number' ? String(c.n) : '');

  w.append(kropka(c.color), kolor, nazwa, wyborRodzica(c, pod), licznik, arch);
  // Kategoria z zepsutym rodzicem (w archiwum / skasowanym / zapętlonym) wraca z serwera jako
  // główna z flagą `orphan` — nie znika z księgi, ale admin ma widzieć, że jest do naprawy.
  if (c.orphan) {
    w.classList.add('orphan');
    w.prepend(el('span', { class: 'catwarn',
      title: 'Kategoria nadrzędna jest w archiwum albo jej nie ma — pokazujemy tę pozycję jako główną, żeby nie zniknęła. Wybierz jej rodzica lub zostaw jako główną.' }, '⚠'));
  }
  return w;
}

/** Wygląd: ten sam wybór skóry, co w arkuszu „Więcej". Tam jest dla WSZYSTKICH
    (Bartuś nie widzi Administracji), tutaj — bo to naturalne miejsce na ustawienia.
    Stan podświetlenia i zapis prowadzi theme.js przez delegację na dokumencie. */
function blokWygladu() {
  const grupa = el('div', { class: 'skora', role: 'group', 'aria-label': 'Wygląd aplikacji' });
  const opcje = el('div', { class: 'skora__opcje' });
  for (const [id, nazwa] of [['sygnal', 'Sygnał'], ['tafla', 'Tafla']]) {
    opcje.append(el('button', { class: 'skora__opcja', type: 'button', 'data-skin-set': id }, nazwa));
  }
  // Bez `.skora__label`: nad blokiem stoi już `h2 „Wygląd"`, a to samo słowo dwa razy pod
  // sobą czytało się jak błąd. Nazwę dla czytnika ekranu nosi `aria-label` grupy. Wariant
  // w arkuszu „Więcej" etykietę ZACHOWUJE — tam nie ma nagłówka, który by ją zastąpił.
  grupa.append(opcje);
  return grupa;
}

function rysuj() {
  const box = $('#adminBox');
  box.innerHTML = '';
  box.append(el('h2', {}, 'Wygląd'), blokWygladu());
  box.append(el('h2', {}, 'Kategorie'), pasekNarzedzi());
  const lista = el('div', { class: 'cat-tree' });
  for (const k of drzewo) {
    const wRodzica = wiersz(k, false);
    const maDzieci = (k.children || []).length > 0;
    if (maDzieci) {
      // K1: domyślnie złożone — klik pokazuje/chowa WYŁĄCZNIE dzieci TEJ kategorii.
      const otwarte = rozwiniete.has(k.id);
      const strzalka = el('button', { class: 'btn small cat-toggle', type: 'button',
        title: otwarte ? 'Zwiń podkategorie' : 'Rozwiń podkategorie' }, otwarte ? '▾' : '▸');
      strzalka.onclick = () => {
        if (rozwiniete.has(k.id)) rozwiniete.delete(k.id); else rozwiniete.add(k.id);
        rysuj();
      };
      wRodzica.prepend(strzalka);
    }
    lista.append(wRodzica);
    if (maDzieci && rozwiniete.has(k.id)) for (const p of k.children) lista.append(wiersz(p, true));
  }
  if (!drzewo.length) lista.append(el('p', { class: 'msg' }, 'Ta księga nie ma jeszcze kategorii.'));
  box.append(lista);
  box.append(el('p', { class: 'msg' },
    'Archiwizacja nie kasuje kategorii ani wpisów — chowa z list wyboru samą kategorię, '
    + 'a jej aktywne podkategorie dopiero po Twoim potwierdzeniu. Przywrócisz je tutaj w każdej chwili.'));
}

// K6: kolory całego drzewa z jednej palety (OKLCH, stała jasność i chroma, odcienie
// równomiernie po kole). Motyw czytamy z systemu — jasny i ciemny mają własne parametry.
async function przydzielKolory(przycisk) {
  const ciemny = window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  let paleta;
  try {
    const mod = await import('./paleta.js');
    paleta = mod.paletaDrzewa(drzewo, ciemny);
  } catch (err) {
    return toast('Nie udało się wczytać palety kolorów: ' + (err.message || 'brak połączenia'));
  }
  if (!paleta.length) return toast('Nie ma czego kolorować.');
  // To N osobnych PATCH-ów (jeden na kategorię) przy puli 5 połączeń — przy 50 kategoriach
  // trwa chwilę, więc przycisk pokazuje postęp „12/50" zamiast martwej blokady. Zamknięcie
  // karty w połowie zostawia pokolorowaną część drzewa; resztę dokończy kolejne kliknięcie.
  const etykieta = przycisk.textContent;
  przycisk.disabled = true;
  let ok = 0, bledy = 0;
  try {
    for (const p of paleta) {
      przycisk.textContent = `🎨 ${ok + bledy + 1}/${paleta.length}…`;
      try {
        await api(`/api/v1/categories/${p.id}`, { method: 'PATCH', body: JSON.stringify({ color: p.color }) });
        ok++;
      } catch (err) {
        if (err.message === 'auth') return;  // przekierowano na login — nie ma po co dalej
        bledy++;
      }
    }
  } finally { przycisk.disabled = false; przycisk.textContent = etykieta; }
  track('Kolory kategorii', 'admin', { detail: `paleta ${ciemny ? 'ciemna' : 'jasna'}; ok=${ok}; błędy=${bledy}` });
  await odswiez();
  toast(bledy ? `Pokolorowano ${ok}, nie udało się ${bledy}.` : `Pokolorowano ${ok} kategorii.`);
}

export function initAdmin() {
  // Panel dostępu (Z12) żyje w OSOBNYM kontenerze (#adminDostepBox), nie w #adminBox —
  // odswiez() czyści #adminBox przy każdym przeładowaniu drzewa kategorii i skasowałby go.
  const odswiezDostep = initAdminDostep($('#adminDostepBox'));
  refreshers.admin = async () => {
    if (!ksiega) ksiega = state.me?.scope.ledgers[0] || 1;
    await odswiez();
    await odswiezDostep();
  };
}
