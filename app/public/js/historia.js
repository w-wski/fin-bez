// Historia: lista wpisów z filtrami, edycja w miejscu, miękkie usuwanie z cofnięciem i Kosz.
import { $, el, zl, api, track, toast, refreshers, KSIEGI } from './core.js';
import { parseKwota } from './kwota.js';   // jedyne miejsce, gdzie napis staje się kwotą
import { selectPlatnosci, zmienionaPlatnosc } from './historia-platnosc.js';
import { initFiltrKategorii, pokazHistorie as _pokazHistorie, ukryjZwezenie } from './historia-filtr.js';

const TYPY = ['WYDATEK', 'PRZYCHÓD', 'TRANSFER'];
const ZNAK = { WYDATEK: '−', PRZYCHÓD: '+', TRANSFER: '⇄' };
const SLOWO = { WYDATEK: 'Wydatek', PRZYCHÓD: 'Przychód', TRANSFER: 'Transfer' };
const KLASA = { WYDATEK: 'exp', PRZYCHÓD: 'inc', TRANSFER: 'trf' };
const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;

let histOffset = 0;
let histTotal = 0;                 // ile wpisów ma cała lista (sterownik przycisku „Pokaż więcej")
let kosz = false;                  // widok „Kosz": pokazuje wpisy usunięte miękko
let wersjaListy = 0;               // rośnie przy każdym przerysowaniu listy (patrz removeTx)
let catsCache = {};                // płaska lista kategorii per księga (lista wyboru w edycji)

// filter(Boolean): pola formularza bywają null (np. selectPlatnosci przy TRANSFER) — bez
// odsiania null trafiłby do append() jako tekst "null", widoczny w wierszu edycji.
const wiersz = (...n) => { const d = el('div', { class: 'row wrap' }); d.append(...n.filter(Boolean)); return d; };
const dzien = (v) => String(v).slice(0, 10);       // tx_date przychodzi jako 'RRRR-MM-DD' (db.js: dateStrings)

// Błąd API pokazujemy w toaście — bez tego akcja „nic nie robi" i wygląda na zawieszoną.
function blad(tekst, err) {
  if (err.message === 'auth') return;              // api() przerzuciło już na ekran logowania
  toast(`${tekst}: ${err.data?.error || err.message}`);
}

// Lista skróciła się albo wydłużyła poza pobieraniem (usunięcie, cofnięcie) — offset i licznik
// muszą iść za nią, inaczej „Pokaż więcej" pobiera od złego miejsca albo znika za wcześnie.
function policzWiersze(delta) {
  histOffset = Math.max(0, histOffset + delta);
  histTotal = Math.max(0, histTotal + delta);
  $('#more').hidden = histOffset >= histTotal;
}

// Kategorie księgi spłaszczone do jednej listy: „Rodzic" i „Rodzic > Dziecko".
async function catOptions(ledger) {
  if (!catsCache[ledger]) {
    const { categories } = await api('/api/v1/categories?ledger=' + ledger);
    const flat = [];
    for (const c of categories) {
      flat.push({ id: c.id, name: c.name, label: c.name, color: c.color || null });
      // podkategoria bez własnego koloru dziedziczy kolor rodzica (życzenie 07-26)
      for (const k of c.children) flat.push({ id: k.id, name: k.name, label: `${c.name} > ${k.name}`, color: k.color || c.color || null });
    }
    catsCache[ledger] = flat;
  }
  return catsCache[ledger];
}

// Komórka akcji: w Koszu „Przywróć", w Historii edycja i usunięcie.
function akcje(tr, r) {
  const td = el('td', { 'data-label': 'Akcje', class: 'akcje' });
  if (kosz) {
    const wroc = el('button', { class: 'btn small', title: 'Przywróć wpis' }, '↩ Przywróć');
    wroc.onclick = () => restoreTx(tr, r, wroc);
    td.append(wroc);
    return td;
  }
  const ed = el('button', { class: 'btn small', title: 'Edytuj wpis' }, 'Edytuj');
  ed.onclick = () => openEdit(tr, r);
  const del = el('button', { class: 'btn small', title: 'Usuń wpis' }, 'Usuń');
  del.onclick = () => removeTx(tr, r);
  td.append(ed, del);
  return td;
}

// Kolor kategorii wpisu (z cache kategorii księgi — pobierzHist grzeje go przed rysowaniem).
const kolorKat = (r) => (catsCache[r.ledger_id] || []).find((c) => c.id === Number(r.category_id))?.color || null;

// Wiersz w trybie odczytu. data-label jest obowiązkowe: na mobile CSS robi z komórek karty.
function fillRow(tr, r) {
  tr.innerHTML = '';
  tr.classList.toggle('del', kosz);
  // Cały wpis łapie mgiełkę koloru swojej kategorii (nadanego w Admin) + kropkę przy nazwie.
  const kolor = kolorKat(r);
  if (kolor) tr.style.setProperty('--cat-c', kolor); else tr.style.removeProperty('--cat-c');
  const kat = el('td', { 'data-label': 'Kategoria' });
  if (kolor) kat.append(el('i', { class: 'catdot', 'aria-hidden': 'true' }));
  kat.append(r.category || '—');
  // Wpis uzgodniony z wierszem wyciągu — widać to od razu, bo zmiana kwoty/daty rozjedzie uzgodnienie.
  if (r.bank_tx_id) kat.append(el('span', { class: 'pill bank', title: 'Uzgodniony z wyciągiem bankowym' }, '✓ uzgodniony'));
  // Gotówka jest wyjątkiem, więc dostaje znaczek; elektroniczna to norma (nic), a NULL to
  // brak wiedzy (stary wpis sprzed migracji 015) — też nic, bo nie zgadujemy.
  if (r.payment_method === 'GOTÓWKA') kat.append(el('span', { class: 'pill', title: 'Gotówka' }, '💵'));
  // Typ niesie ZNAK i SŁOWO — barwa tylko je wzmacnia (§5 briefu: kolor nigdy sam).
  const typ = el('td', { 'data-label': 'Typ', class: KLASA[r.type] || '' });
  typ.append(el('span', { class: 'typ' }, `${ZNAK[r.type] || '·'} ${SLOWO[r.type] || r.type}`));
  tr.append(
    el('td', { 'data-label': 'Data' }, dzien(r.tx_date)),
    typ,
    kat,
    el('td', { 'data-label': 'Kwota', class: 'num ' + (KLASA[r.type] || '') }, `${ZNAK[r.type] || ''} ${zl(r.amount)}`.trim()),
    el('td', { 'data-label': 'Opis', class: 'opis' }, r.description || ''),
    el('td', { 'data-label': 'Kto' }, `${r.user_name} · ${KSIEGI[r.ledger_id] || ''}`.replace(/ · $/, '')),
    akcje(tr, r));
  tr.onclick = (e) => { if (!kosz && !e.target.closest('button')) openEdit(tr, r); };
}

// Kosz → „Przywróć": wpis wraca do Historii, więc znika z listy usuniętych.
async function restoreTx(tr, r, btn) {
  btn.disabled = true;                             // drugie tapnięcie dałoby 404 zamiast sukcesu
  try {
    await api(`/api/v1/transactions/${r.id}/restore`, { method: 'POST' });
  } catch (err) { btn.disabled = false; return blad('Nie udało się przywrócić', err); }
  track('Przywrócenie transakcji', 'historia');
  tr.remove();
  policzWiersze(-1);
  toast('Wpis wrócił do Historii.');
}

// Usunięcie jest miękkie, ale dotyczy pieniędzy: pytamy przed skasowaniem, bo na telefonie „✕"
// jest dużym przyciskiem tuż obok „✎". Toast „Cofnij" (12 s, core.js) zostaje wygodą, Kosz —
// trwałą ścieżką odzysku, gdy drugie usunięcie podmieni toast pierwszego.
async function removeTx(tr, r) {
  if (!confirm('Usunąć ten wpis?')) return;
  try {
    await api('/api/v1/transactions/' + r.id, { method: 'DELETE' });
  } catch (err) { return blad('Nie udało się usunąć', err); }
  track('Usunięcie transakcji', 'historia');
  const dalej = tr.nextSibling, lista = tr.parentNode, wersja = wersjaListy;
  tr.remove();
  policzWiersze(-1);
  toast(`Usunięto wpis ${zl(r.amount)}.`, {
    label: 'Cofnij',
    onClick: async () => {
      try {
        await api(`/api/v1/transactions/${r.id}/restore`, { method: 'POST' });
      } catch (err) {
        // 404 = ktoś (np. admin w Koszu) już go przywrócił. To nie błąd, tylko nieaktualny widok.
        if (err.data?.error !== 'not_found') return blad('Nie udało się cofnąć', err);
        toast('Ten wpis był już przywrócony.');
        return loadHist(true);
      }
      track('Cofnięcie usunięcia', 'historia');
      toast('Przywrócono wpis.');
      // lista mogła się w międzyczasie przerysować (filtr, Kosz) — wtedy prościej ją odświeżyć
      if (wersja !== wersjaListy) return loadHist(true);
      lista.insertBefore(tr, dalej);                 // wraca dokładnie na swoje miejsce
      fillRow(tr, r);
      policzWiersze(1);
    },
  });
}

// Lista wyboru kategorii dla księgi wpisu; wartość wpisu zostaje nawet, gdy kategoria jest wyłączona.
async function selectKategorii(r) {
  const kat = el('select', { title: 'Kategoria' });
  kat.append(el('option', { value: '' }, '— bez kategorii —'));
  try {
    for (const c of await catOptions(r.ledger_id)) kat.append(el('option', { value: c.id }, c.label));
  } catch (err) { blad('Nie pobrałem kategorii', err); }
  if (r.category_id && !kat.querySelector(`option[value="${r.category_id}"]`)) {
    kat.append(el('option', { value: r.category_id }, r.category || `kategoria #${r.category_id}`));
  }
  kat.value = r.category_id || '';
  return kat;
}

// Edycja w miejscu: wiersz zamienia się w formularz wypełniony aktualnymi wartościami wpisu.
async function openEdit(tr, r) {
  if (tr.dataset.edit) return;
  tr.dataset.edit = '1';
  const wersja = wersjaListy;
  const kat = await selectKategorii(r);
  // Pobranie kategorii trwa: w tym czasie wiersz mógł zniknąć (usunięcie, odświeżenie listy).
  // Bez zwolnienia blokady taki wiersz zostałby na stałe nieedytowalny.
  if (wersja !== wersjaListy || !tr.isConnected) { delete tr.dataset.edit; return; }
  const data = el('input', { type: 'date', value: dzien(r.tx_date) });
  const typ = el('select', { title: 'Typ' });
  // TRANSFER (migracja 006) trafia na listę tylko wtedy, gdy wpis już nim jest — nie gubimy typu.
  for (const t of (TYPY.includes(r.type) ? TYPY : [...TYPY, r.type])) typ.append(el('option', { value: t }, t));
  typ.value = r.type;
  const kwota = el('input', { type: 'text', inputmode: 'decimal', title: 'Kwota', value: Number(r.amount).toFixed(2).replace('.', ',') });
  const platnosc = selectPlatnosci(r);              // null dla TRANSFER (K6b) — patrz historia-platnosc.js
  const opis = el('input', { type: 'text', placeholder: 'Opis', value: r.description || '' });
  const zapisz = el('button', { class: 'btn primary', type: 'button' }, 'Zapisz');
  const anuluj = el('button', { class: 'btn', type: 'button' }, 'Anuluj');
  zapisz.onclick = () => zapiszEdycje(tr, r, { data, typ, kwota, kat, opis, platnosc });
  anuluj.onclick = () => { delete tr.dataset.edit; fillRow(tr, r); };
  // Klasa `field` zapala blask edytowanego wiersza (styles.css §6) — animowana jest
  // wyłącznie opacity warstwy, więc lista pozostaje płynna nawet przy 300 wierszach.
  const td = el('td', { colspan: '7', class: 'edycja field' });
  td.append(wiersz(data, typ, kwota), wiersz(kat, platnosc), wiersz(opis), wiersz(zapisz, anuluj));
  tr.innerHTML = '';
  tr.onclick = null;
  tr.append(td);
  kwota.focus();
}

// Które pola formularza różnią się od wpisu. Wysyłamy WYŁĄCZNIE zmienione: poprawka opisu nie
// może przy okazji przepisywać daty ani kwoty (to jedyna ochrona przed przesunięciem daty
// niezależna od strefy czasowej serwera i od formatu, w jakim baza zwróciła datę).
function zmienionePola(r, p, kwota) {
  const body = {};
  const katId = p.kat.value ? Number(p.kat.value) : null;
  if (p.data.value !== dzien(r.tx_date)) body.tx_date = p.data.value;
  if (p.typ.value !== r.type) body.type = p.typ.value;
  if (kwota.toFixed(2) !== Number(r.amount).toFixed(2)) body.amount = kwota;
  if (katId !== (r.category_id == null ? null : Number(r.category_id))) body.category_id = katId;
  if (p.opis.value !== (r.description || '')) body.description = p.opis.value;
  const platnosc = zmienionaPlatnosc(r, p.platnosc);
  if (platnosc !== undefined) body.payment_method = platnosc;
  return body;
}

// Zapis edycji: PATCH i odświeżenie samego wiersza — bez przeładowania listy.
async function zapiszEdycje(tr, r, p) {
  if (!ISO_DATA.test(p.data.value)) return toast('Popraw datę.');
  const kwota = parseKwota(p.kwota.value);
  if (kwota === null || kwota <= 0) return toast('Popraw kwotę — np. 1 234,56.');
  const body = zmienionePola(r, p, kwota);
  if (!Object.keys(body).length) { delete tr.dataset.edit; fillRow(tr, r); return toast('Nic się nie zmieniło.'); }
  // Wpis uzgodniony z wyciągiem: zmiana kwoty lub daty rozjeżdża uzgodnienie. Ostrzegamy, nie blokujemy.
  if (r.bank_tx_id && (body.amount !== undefined || body.tx_date !== undefined)
      && !confirm('Ten wpis jest uzgodniony z wyciągiem bankowym. Zmiana kwoty lub daty rozjedzie to uzgodnienie. Zapisać mimo to?')) return;
  try {
    await api('/api/v1/transactions/' + r.id, { method: 'PATCH', body: JSON.stringify(body) });
  } catch (err) { return blad('Nie zapisałem zmian', err); }
  // 200 znaczy, że serwer przyjął KAŻDE wysłane pole (odrzucone daje 400) — dopiero teraz
  // przepisujemy je do wiersza w pamięci.
  const wybrana = (catsCache[r.ledger_id] || []).find((c) => c.id === body.category_id);
  Object.assign(r, body);
  if (body.category_id !== undefined) r.category = wybrana ? wybrana.name : null;
  delete tr.dataset.edit;
  fillRow(tr, r);
  track('Edycja transakcji', 'historia');
  toast('Zapisano zmiany.');
}

// Pobranie listy. Rzuca przy błędzie — przełącznik „Kosz" musi wiedzieć, że pobranie się nie udało,
// i nie może przełączyć widoku na dane, których nie ma.
async function pobierzHist(reset, widokKosza) {
  const p = new URLSearchParams({ limit: 50, offset: reset ? 0 : histOffset });
  if ($('#fLedger').value) p.set('ledger', $('#fLedger').value);
  if ($('#fFrom').value) p.set('from', $('#fFrom').value);
  if ($('#fTo').value) p.set('to', $('#fTo').value);
  if ($('#fType').value) p.set('type', $('#fType').value);
  if ($('#fCategory')?.value) p.set('category', $('#fCategory').value); // Z8: id albo lista id,id
  if (widokKosza) p.set('deleted', '1');           // domyślnie wpisy usunięte są niewidoczne
  const { rows, total } = await api('/api/v1/transactions?' + p);
  // Cache kategorii ksiąg z listy MUSI być ciepły przed rysowaniem — fillRow czyta z niego
  // kolory synchronicznie. Błąd pobrania kategorii nie blokuje listy (wpisy bez kropek).
  await Promise.all([...new Set(rows.map((r) => r.ledger_id))]
    .map((l) => catOptions(l).catch(() => {})));
  kosz = widokKosza;                               // stan widoku zmieniamy dopiero po udanym pobraniu
  const tytul = document.getElementById('viewTitle');
  if (tytul) tytul.textContent = kosz ? 'Historia · Kosz' : 'Historia';
  const tb = $('#txTable tbody');
  if (reset) { tb.innerHTML = ''; histOffset = 0; wersjaListy += 1; }
  for (const r of rows) {
    const tr = el('tr');
    fillRow(tr, r);
    tb.append(tr);
  }
  histOffset += rows.length;
  histTotal = total;
  $('#more').hidden = histOffset >= histTotal;
  // Przycisk mówi, ILE jeszcze zostało — „Pokaż więcej" nie odpowiadało na to pytanie.
  $('#more').textContent = `Wczytaj następne ${Math.min(50, histTotal - histOffset)} (z ${histTotal})`;
}

// Wejście na Historię i odświeżenia z UI. Błąd ma trafić do toastu, a nie zostać nieobsłużoną
// obietnicą (main.js woła to bez .catch). Przy pełnym odświeżeniu czyścimy cache kategorii —
// kategoria dodana w tej samej sesji ma się pojawić na liście wyboru w edycji.
export async function loadHist(reset = true) {
  if (reset) catsCache = {};
  try {
    await pobierzHist(reset, kosz);
  } catch (err) { blad('Nie udało się pobrać listy', err); }
}

// Kontrolka „Kosz" dorenderowana do #histTools — index.html jest cudzy, nie ruszamy go.
function initTools() {
  const box = $('#histTools');
  if (!box || box.dataset.gotowe) return;
  box.dataset.gotowe = '1';
  const chk = el('input', { type: 'checkbox', id: 'fKosz' });
  chk.onchange = () => {
    const chce = chk.checked;
    ukryjZwezenie();          // ręczny przełącznik Kosza kończy zawężenie z raportu (#1)
    pobierzHist(true, chce)  // widok przełącza się dopiero po udanym pobraniu
      .then(() => track(chce ? 'Otwarcie kosza' : 'Powrót z kosza', 'historia'))
      .catch((err) => { chk.checked = kosz; blad('Nie udało się pobrać listy', err); });
  };
  const lab = el('label', { class: 'kosz-filtr', title: 'Pokaż wpisy usunięte' });
  lab.append(chk, el('span', {}, '🗑 Kosz'));
  box.append(lab); initFiltrKategorii(catOptions); // Z8: select #fCategory, obok Typu
}
export const pokazHistorie = (filtry) => _pokazHistorie(filtry, loadHist); // #25: nawigację robi raporty-klik.js
export function initHistoria() {
  initTools();
  $('#fGo').onclick = () => { ukryjZwezenie(); track('Filtrowanie', 'historia'); loadHist(true); };
  $('#fLedger')?.addEventListener('change', () => ukryjZwezenie()); // ręczna zmiana księgi (#1)
  $('#more').onclick = () => loadHist(false);
  refreshers.historia = () => loadHist(true);
}
