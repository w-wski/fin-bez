// Lista paragonów w karcie „Paragon" — DROGA POWROTU do odczytu, którego nie dokończono.
// Bez niej edytor istniał tylko tuż po uploadzie: zgaszony ekran telefonu albo przeładowana
// karta zostawiały paragon w bazie ze statusem NOWY i bez żadnego wejścia (ponowny upload
// odbijał się o 409 „duplikat"). To był najkrótszy sposób na utratę całej ręcznej pracy.
import { $, el, zl, api, track, refreshers } from './core.js';

let onOpen = null;      // callback z paragon.js: pokaż edytor dla pobranego paragonu
let box = null;

// Lista dociąga się przy WEJŚCIU na kartę (klik w nawigacji), nie przy starcie aplikacji —
// przy starcie sesja może jeszcze nie być wczytana, a offline nie ma po co pukać do sieci.
export function initLista(opts) {
  onOpen = opts.onOpen;
  box = el('div', { class: 'rc-lista-paragonow' });
  const start = $('#rc-start');
  if (!start) return;
  start.append(el('h3', { class: 'rc-lista-tytul' }, 'Twoje paragony'), box);
  // Zaczep bez prefiksu `nav button`: zakładka Paragonu może mieszkać w pasku u dołu
  // albo w arkuszu „Więcej" — oba miejsca niosą to samo [data-view].
  document.querySelector('[data-view="paragon"]')?.addEventListener('click', odswiezListe);
  refreshers.paragon = odswiezListe;
}

export async function odswiezListe() {
  if (!box) return;
  let dane;
  try {
    dane = await api('/api/v1/receipts');
  } catch (err) {
    if (err.message === 'auth') return;
    box.innerHTML = '';
    box.append(el('p', { class: 'msg' }, navigator.onLine
      ? 'Nie udało się pobrać listy paragonów — spróbuj odświeżyć kartę.'
      : 'Jesteś offline — listy paragonów nie pokażę, ale zapisane paragony czekają na serwerze.'));
    return;
  }
  // niedokończone na górze: to one czekają na człowieka
  const rows = [...(dane.receipts || [])].sort((a, b) => (a.status === 'POTWIERDZONY') - (b.status === 'POTWIERDZONY'));
  box.innerHTML = '';
  if (!rows.length) { box.append(el('p', { class: 'msg' }, 'Nie masz jeszcze żadnego paragonu.')); return; }
  const doDokonczenia = rows.filter((r) => r.status !== 'POTWIERDZONY').length;
  box.append(el('p', { class: 'msg' }, doDokonczenia
    ? `Do dokończenia: ${doDokonczenia}. Kliknij paragon, żeby wrócić do poprawiania.`
    : 'Wszystkie paragony są zaksięgowane.'));
  for (const r of rows) box.append(wiersz(r));
}

function wiersz(r) {
  const b = el('button', { class: 'btn rc-wiersz', type: 'button' });
  b.append(
    el('span', { class: 'rc-w-data' }, r.receipt_date || 'bez daty'),
    el('span', { class: 'rc-w-sklep' }, r.shop_name || 'bez nazwy sklepu'),
    el('span', { class: 'rc-w-suma' }, r.total === null ? 'bez sumy' : zl(r.total)),
    el('span', { class: 'pill rc-w-status' + (r.status === 'POTWIERDZONY' ? ' ok' : '') },
      r.status === 'POTWIERDZONY' ? 'w księdze' : `do dokończenia · ${r.items_count} poz.`),
  );
  b.onclick = () => otworz(r.id);
  return b;
}

// Otwiera zapisany paragon w edytorze (używa tego też obsługa duplikatu przy uploadzie).
export async function otworz(id) {
  let dane;
  try {
    dane = await api(`/api/v1/receipts/${id}`);
  } catch (err) {
    if (err.message === 'auth') return;
    box?.append(el('p', { class: 'msg err' }, `Nie udało się otworzyć paragonu #${id}.`));
    return;
  }
  track('Paragon: powrót do zapisanego', 'paragon');
  onOpen(dane);
}
