// Filtry programowe Historii (Z8/#25): select kategorii i pasek zawężenia nad listą.
// Wydzielone z historia.js (limit 300 linii, konwencja repo) — ten moduł zna tylko DOM
// i to, KIEDY wywołać odświeżenie listy; kategorie/cache trzyma nadal historia.js.
import { $, el, track } from './core.js';

// `pobierzOpcje(ledger)` to catOptions() z historia.js (async, [{id,label}]) — moduł
// filtrów nie duplikuje cache'u kategorii, tylko go czyta przez tę funkcję.
export function initFiltrKategorii(pobierzOpcje) {
  if ($('#fCategory')) return;
  const sel = el('select', { id: 'fCategory', title: 'Kategoria' });
  sel.append(el('option', { value: '' }, 'Kategoria: wszystkie'));
  $('#fType')?.after(sel);
  const odswiez = async () => {
    const biezaca = sel.value;
    sel.querySelectorAll('option:not(:first-child)').forEach((o) => o.remove());
    try { for (const c of await pobierzOpcje($('#fLedger')?.value || 1)) sel.append(el('option', { value: c.id }, c.label)); }
    catch { /* filtr kategorii nie jest krytyczny — lista wpisów i tak zadziała bez niego */ }
    if ([...sel.options].some((o) => o.value === biezaca)) sel.value = biezaca;
  };
  $('#fLedger')?.addEventListener('change', odswiez);
  sel._odswiez = odswiez;          // pokazHistorie() woła to wprost przy zmianie księgi z raportu
  odswiez();
}

// Kategoria z raportu bywa RODZICEM (kliknięto kafel nadrzędny) — wtedy `categoryIds` niesie
// też podkategorie: <option> dostaje wartość „id,id,id" (transactions.js od Z8 przyjmuje listę
// po przecinku). Taka opcja jest tymczasowa — znika przy kolejnym wejściu z raportu.
export function ustawFiltrKategorii(categoryIds, label) {
  const sel = $('#fCategory');
  if (!sel) return;
  sel.querySelectorAll('option[data-tymczasowa]').forEach((o) => o.remove());
  if (!categoryIds || !categoryIds.length) { sel.value = ''; return; }
  if (categoryIds.length === 1 && sel.querySelector(`option[value="${categoryIds[0]}"]`)) {
    sel.value = String(categoryIds[0]);
    return;
  }
  const opt = el('option', { value: categoryIds.join(','), 'data-tymczasowa': '1' }, label || 'wybrane');
  sel.append(opt);
  sel.value = opt.getAttribute('value');
}

// Pasek nad listą: mówi wprost, że to WYCINEK raportu, nie cała Historia — jedno dotknięcie
// „✕ wyczyść" (aria-label opisuje cel) wraca do pełnego widoku przez `onWyczysc`.
export function pokazZwezenie(opis, onWyczysc) {
  let box = document.getElementById('zwezenie');
  if (!box) {
    box = el('div', { id: 'zwezenie', class: 'zwezenie card', role: 'status' });
    $('.hist-filtry')?.after(box);
  }
  box.innerHTML = '';
  box.append(el('span', {}, `Wpisy: ${opis}`));
  const x = el('button', { class: 'btn small', type: 'button',
    'aria-label': 'Wyczyść zawężenie i wróć do pełnej Historii' }, '✕ wyczyść');
  x.onclick = onWyczysc;
  box.append(x);
  box.hidden = false;
}

export function ukryjZwezenie() {
  const box = document.getElementById('zwezenie');
  if (box) box.hidden = true;
}

// Data czytelna dla człowieka: DD.MM.RRRR–DD.MM.RRRR (bez nazw miesięcy — bez ryzyka
// odmiany w niepasującym przypadku).
export function opisOkresu(from, to) {
  const pl = (d) => (d ? d.split('-').reverse().join('.') : '');
  return from && to ? `${pl(from)}–${pl(to)}` : '';
}

// Wejście z Raportu (Z8/#25): ustawia WIDOCZNE filtry i ładuje wycinek. `load` to loadHist()
// z historia.js — ten moduł nie zna warstwy sieciowej, tylko DOM i kiedy go odświeżyć.
// Nawigację (`show('historia')`) robi wołający z raporty-klik.js — wchodzimy już na ekranie.
export async function pokazHistorie(filtry = {}, load) {
  if (filtry.ledger && $('#fLedger')) { $('#fLedger').value = String(filtry.ledger); await $('#fCategory')?._odswiez?.(); }
  $('#fFrom').value = filtry.from || ''; $('#fTo').value = filtry.to || ''; $('#fType').value = '';
  ustawFiltrKategorii(filtry.categoryIds, filtry.categoryLabel);
  const opis = [filtry.categoryLabel, opisOkresu(filtry.from, filtry.to)].filter(Boolean).join(' · ');
  pokazZwezenie(opis, () => {
    $('#fFrom').value = ''; $('#fTo').value = ''; $('#fType').value = '';
    ustawFiltrKategorii(null); ukryjZwezenie();
    track('Wyczyszczenie zawężenia', 'historia');
    load(true);
  });
  track('Wejście z raportu', 'historia', { detail: opis });
  await load(true);
}
