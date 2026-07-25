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
  sprzeczne_propozycje: 'ten sam wpis ma w żądaniu dwie propozycje — przyjmij je pojedynczo, '
    + 'bo dwa sprzeczne przepięcia jednego wpisu dałyby wynik zależny od kolejności',
  busy: 'ktoś (drugie okno albo skrypt) rusza te same wpisy w tej chwili — spróbuj jeszcze raz',
  ksiega_sie_nie_zgadza: 'PRZERWANO I WYCOFANO: ruch w kubełkach księga × typ nie zgadzał się '
    + 'z tym, co wynika z propozycji (albo zmieniła się kwota/data wpisu)',
};
// Serwer dopowiada, KTÓRA propozycja albo KTÓRY wpis blokuje — bez tego 400/409 na całą grupę
// nie dawał się rozplątać: Szymon widział „kategoria z innej księgi" i nie wiedział, dla którego wpisu.
function szczegol(d) {
  const cz = [];
  if (d?.proposal) cz.push('propozycja #' + d.proposal);
  if (d?.transaction) cz.push('wpis #' + d.transaction);
  if (d?.transactions?.length) cz.push('wpisy: ' + d.transactions.join(', '));
  if (d?.rozbieznosci?.length) cz.push(d.rozbieznosci.join(' · '));
  return cz.length ? ` (${cz.join('; ')})` : '';
}
// fetch przy zerwanej sieci rzuca TypeError „Failed to fetch" — to nie komunikat dla człowieka
const opisBledu = (err) => (err instanceof TypeError || !navigator.onLine)
  ? 'brak połączenia z internetem'
  : (BLEDY[err?.data?.error] || err?.data?.error || err?.message || 'błąd') + szczegol(err?.data);

let ksiega = 0;          // wybrana księga
let grupy = [], razem = 0;
let limit = 500;         // ile wpisów najwyżej pokaże serwer w rozwinięciu grupy
let otwarta = null;      // key rozwiniętej grupy
let wpisy = [], wpisowWGrupie = 0;   // wpisy rozwiniętej grupy i ILE ICH JEST NAPRAWDĘ
let celujemy = null;     // key grupy, dla której wybieramy inny cel
let kategorie = null;    // spłaszczona lista kategorii księgi (do „Zmień cel…")
let zajete = false;      // trwa zapis — jedna decyzja naraz

async function pobierz() {
  const r = await api(`/api/v1/proposals?ledger=${ksiega}`);
  grupy = r.groups || [];
  razem = r.total || 0;
  limit = Number(r.limit) || limit;
}

async function odswiez() {
  try {
    await pobierz();
    if (otwarta && !grupy.some((g) => g.key === otwarta)) { otwarta = null; wpisy = []; wpisowWGrupie = 0; }
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
    // Serwer POMIJA propozycje nieaktualne (wpis przeniesiony ręcznie w Historii po ich
    // powstaniu) i wpisy z Kosza. Milczenie o tym byłoby gorsze niż odmowa: Szymon myślałby,
    // że przepiął całą grupę. Mówimy ile pominięto i dlaczego.
    const pom = [w.nieaktualne ? `${w.nieaktualne} pominięto jako nieaktualne (wpis nie leży już `
      + 'w kategorii z propozycji — przenieśliście go ręcznie)' : '',
      w.w_koszu ? `${w.w_koszu} pominięto, bo wpis jest w Koszu (przydział go nie dotyczy)` : ''].filter(Boolean);
    toast(`${opis}: ${ile}.${pom.length ? ' ' + pom.join('. ') + '.' : ''}`);
    otwarta = null;
    wpisy = [];
    wpisowWGrupie = 0;
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
  if (otwarta === g.key) { otwarta = null; wpisy = []; wpisowWGrupie = 0; return rysuj(); }
  try {
    const r = await api(`/api/v1/proposals/${g.key}/items?ledger=${ksiega}`);
    wpisy = r.items || [];
    limit = Number(r.limit) || limit;
    wpisowWGrupie = Number(r.total) || wpisy.length;
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
  // Grupa mieszana: część wpisów ląduje w innej księdze niż reszta, więc JEDEN cel nie może być
  // poprawny dla wszystkich. Serwer odmówi i wskaże winną propozycję — mówimy to zawczasu.
  if (g.ksiag > 1) {
    box.append(el('span', { class: 'msg err' }, 'Ta grupa jest mieszana (propozycje o różnych księgach '
      + 'docelowych) — jeden cel nie zadziała dla całej grupy. Rozwiń ją i zmieniaj cel po wpisie.'));
  }
  return box;
}

// „1000 Czynsz → Dom i media > Czynsz · 23 wpisy · 4 600,00 zł · A3"
function naglowekGrupy(g) {
  const w = el('div', { class: 'row wrap prz-head' });
  const przelacz = el('button', { class: 'btn small prz-para', type: 'button', title: 'Pokaż wpisy grupy' },
    `${otwarta === g.key ? '▾' : '▸'} ${g.from} → ${g.to}`);
  przelacz.onclick = () => rozwin(g);
  const ile = g.n === 1 ? '1 wpis' : `${g.n} wpisy`;
  // Grupa MIESZANA: różne reguły, księgi, typy albo tagi. Pigułki pokazujemy tylko wtedy, gdy
  // wartość jest jedna dla całej grupy — inaczej nagłówek obiecywał „→ księga PERSEVERA" dla
  // wpisów, które zostają w RODZINIE (MIN pomija NULL-e i pokazywał wartość mniejszości).
  w.append(przelacz, el('span', { class: 'prz-meta' },
    `· ${ile} · ${zl(g.kwota)} · ${g.rule_id || `${g.regul} różne reguły`}`));
  if (g.to_ledger_id) w.append(el('span', { class: 'pill' }, '→ księga ' + (KSIEGI[g.to_ledger_id] || g.to_ledger_id)));
  else if (g.ksiag > 1) w.append(el('span', { class: 'pill' }, '→ księgi MIESZANE — decyduj per wpis'));
  if (g.to_type) w.append(el('span', { class: 'pill' }, '→ typ ' + g.to_type));
  if (g.tag) w.append(el('span', { class: 'pill' }, '# ' + g.tag));
  return w;
}

// Grupa większa niż `limit`: lista wpisów jest OBCIĘTA, a decyzja grupowa dotyczy wszystkich.
// Bez tego ostrzeżenia Szymon przewijał 500 z 700 wpisów, uznawał że przejrzał całość i przyjmował
// też 200 niewidzianych — wśród nich propozycje słabo umocowane, złapane po opisie.
const potwierdzGrupe = (g, co) => g.n <= limit || confirm(`${co} dla CAŁEJ grupy: ${g.n} wpis(ów).\n\n`
  + `Lista pokazuje najwyżej ${limit} wpisów, więc ${g.n - limit} z nich NIE WIDZIAŁEŚ.\n`
  + 'Chcesz objąć decyzją wszystkie?');

function przyciskiGrupy(g) {
  const w = el('div', { class: 'row wrap prz-akcje' });
  const przyjmij = el('button', { class: 'btn primary small', type: 'button' }, 'Przyjmij');
  przyjmij.onclick = () => {
    if (potwierdzGrupe(g, 'Przyjęcie propozycji')) decyzja('accept', cialo(g), `Przydzielono do „${g.to}"`);
  };
  const cel = el('button', { class: 'btn small', type: 'button' }, 'Zmień cel…');
  cel.onclick = () => pokazWyborCelu(g);
  const odrzuc = el('button', { class: 'btn small', type: 'button' }, 'Odrzuć');
  odrzuc.onclick = () => {
    if (!potwierdzGrupe(g, 'Odrzucenie propozycji')) return;
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
    el('span', { class: 'msg' }, `${it.type} · ${it.user_name}`));   // wpisów z Kosza tu nie ma
  // W grupie mieszanej nagłówek nie może pokazać jednej księgi docelowej — pokazujemy ją
  // przy wpisie, bo to tu Szymon podejmuje decyzję.
  if (it.to_ledger_id) w.append(el('span', { class: 'pill' }, '→ księga ' + (KSIEGI[it.to_ledger_id] || it.to_ledger_id)));
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
    otwarta = null; wpisy = []; wpisowWGrupie = 0; celujemy = null; kategorie = null;
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
      // Obcięcie listy MUSI być widoczne — inaczej „przewinąłem wszystko" znaczyło co innego
      // dla Szymona i co innego dla serwera.
      if (wpisowWGrupie > wpisy.length) {
        w.append(el('p', { class: 'msg err prz-obciete' }, `Pokazano ${wpisy.length} z ${wpisowWGrupie} wpisów `
          + '— resztę zobaczysz dopiero po przydzieleniu tych. Decyzja grupowa obejmuje WSZYSTKIE.'));
      }
      wpisy.forEach((it) => w.append(wierszWpisu(it)));
      if (!wpisy.length) w.append(el('p', { class: 'msg' }, 'Brak wpisów w tej grupie — odśwież widok.'));
      karta.append(w);
    }
    lista.append(karta);
  }
  box.append(lista);
  box.append(el('p', { class: 'msg' },
    'Przyjęcie przepina wpisy (kategoria, a gdy propozycja tak mówi — księga, typ i tag) w jednej '
    + 'transakcji. Bramka porównuje kubełki księga × typ z ruchem wynikającym z propozycji, a kwota '
    + 'i data nie zmieniają się nigdy. Wpisy z Kosza nie biorą udziału w przydziale. Propozycja dla '
    + 'wpisu przeniesionego ręcznie w Historii jest pomijana jako nieaktualna — Twoja decyzja wygrywa. '
    + 'Stare kategorie zostają aktywne: schowasz je w panelu Admin, gdy nic w nich nie zostanie.'));
}

export function initPrzydzial() {
  refreshers.przydzial = async () => {
    if (!ksiega) ksiega = state.me?.scope.ledgers[0] || 1;
    await odswiez();
  };
}
