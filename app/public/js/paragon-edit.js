// Edytor odczytanego paragonu: nagłówek, lista pozycji, sumy, potwierdzenie.
// Karta pojedynczej pozycji i pomocniki pól siedzą w paragon-poz.js (limit 300 linii na plik).
//
// Miara sukcesu (Szymon): „Kiedy OCR popełni błąd, a popełnia, musi być możliwość edycji
// ręcznej wszystkiego". Stąd: każde pole to zwykły input, zapis idzie polem-po-polu przy
// wyjściu z pola (change) — bez guzika „Zapisz wszystko"; podpowiedź ze słownika wchodzi
// dopiero po kliknięciu „Użyj"; niezgodności tylko ostrzegają, nigdy nie blokują zapisu.
// Poprawić da się TAKŻE paragon zaksięgowany — wtedy zmiana SUMY/daty rusza też wpis
// w księdze i człowiek dostaje o tym jasne pytanie PRZED zapisem.
import { $, el, zl, api, track, toast } from './core.js';
import { getCats } from './kategorie.js';
import { parseKwota } from './kwota.js';
import { JEDNOSTKI, pozycja, pole, inp, poleNum, przecinek, bladPola, mrugnij, blad } from './paragon-poz.js';

const TOL_SUMA = 0.05;                    // zgodne z src/ocr/pola.js (K7)

let rc = null;                            // aktualny paragon (nagłówek + pozycje)
let listaBox = null, sumaBox = null, btnOK = null, poPotwierdzeniu = null, poPowrocie = null;

const zaksiegowany = () => rc.status === 'POTWIERDZONY' && !!rc.transaction_id;

// Paragon jest już w księdze: poprawka SUMY albo daty zmienia TAKŻE wpis rachunkowy.
// Człowiek musi o tym wiedzieć PRZED zapisem — księgi nie zmienia się po cichu.
const potwierdzKsiege = (co, zStanu, naStan) => confirm(
  `Ten paragon jest już zaksięgowany (wpis #${rc.transaction_id}).\n`
  + `Zmiana pola „${co}" z ${zStanu} na ${naStan} poprawi TAKŻE ten wpis w Historii.\n\nZapisać?`);

// ---------- NAGŁÓWEK (K1) ----------
function naglowek() {
  const g = el('div', { class: 'rc-naglowek' });
  const sklep = inp('rc-sklep', rc.shop_name || '', { placeholder: 'nazwa sklepu', maxlength: '128' });
  const data = el('input', { type: 'date', class: 'rc-data', value: (rc.receipt_date || '').slice(0, 10) });
  const suma = poleNum('rc-suma', przecinek(rc.total), 'suma z paragonu');
  sklep.onchange = () => zapiszNaglowek({ shop_name: sklep.value }, sklep);
  data.onchange = () => {
    const nowa = data.value || null;
    if (zaksiegowany() && !potwierdzKsiege('Data', rc.receipt_date || '—', nowa || '—')) {
      data.value = (rc.receipt_date || '').slice(0, 10); return undefined;
    }
    return zapiszNaglowek({ receipt_date: nowa }, data);
  };
  suma.onchange = () => {
    const surowe = suma.value.trim();
    const t = surowe === '' ? null : parseKwota(surowe);
    if (surowe !== '' && (t === null || t <= 0)) {
      // kwota nie do odczytania — nie wysyłamy jej i nie udajemy, że zapisana
      return bladPola(suma, `Nie rozumiem kwoty „${surowe}" — wpisz np. 1234,56. NIE zapisałem.`);
    }
    if (zaksiegowany() && !potwierdzKsiege('SUMA', zl(rc.total), t === null ? '—' : zl(t))) {
      suma.value = przecinek(rc.total); return undefined;
    }
    return zapiszNaglowek({ total: t }, suma);
  };
  g.append(pole('Sklep', sklep), pole('Data', data), pole('SUMA z paragonu', suma));
  return g;
}

const POLA_NAGL = { shop_name: '.rc-sklep', receipt_date: '.rc-data', total: '.rc-suma' };

async function zapiszNaglowek(patch, node) {
  let r;
  try {
    r = await api(`/api/v1/receipts/${rc.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  } catch (err) { return blad('Nie zapisałem nagłówka', err, node); }
  Object.assign(rc, r.zapisane || patch);              // stan Z BAZY, nie z palca
  for (const [k, sel] of Object.entries(POLA_NAGL)) {
    const n = $('#rcResult ' + sel);
    if (!n || n === document.activeElement || !(k in (r.zapisane || {}))) continue;
    n.value = k === 'total' ? przecinek(rc.total) : (k === 'receipt_date' ? (rc.receipt_date || '') : (rc[k] || ''));
  }
  bladPola(node, '');
  mrugnij(node);
  odswiezSumy();
  if (r.ksiega === 'zaktualizowany') toast(`Poprawiłem też wpis w księdze (#${r.transaction_id}).`);
  if (r.ksiega === 'w koszu') toast(`Paragon poprawiony, ale wpis w księdze (#${r.transaction_id}) jest w koszu — jego nie zmieniłem.`);
  return track('Paragon: korekta nagłówka', 'paragon');
}

// K7: suma pozycji vs SUMA z paragonu — ostrzeżenie tuż przy przycisku potwierdzenia.
function odswiezSumy() {
  if (!sumaBox) return;
  const s = rc.items.reduce((a, it) => a + (parseKwota(it.value) || 0), 0);
  const t = parseKwota(rc.total);
  sumaBox.innerHTML = '';
  sumaBox.append(el('span', {}, `Pozycje (${rc.items.length}): ${zl(s)}`));
  if (t !== null) sumaBox.append(el('span', {}, `SUMA z paragonu: ${zl(t)}`));
  const d = t === null ? 0 : Math.round((s - t) * 100) / 100;
  if (Math.abs(d) > TOL_SUMA) sumaBox.append(el('span', { class: 'rc-roznica' }, `różnica ${d > 0 ? '+' : ''}${zl(d)} — sprawdź pozycje`));
  if (btnOK) btnOK.textContent = zaksiegowany() ? 'Ten paragon jest w księdze' : `Potwierdź → wpis ${t !== null ? zl(t) : '—'} w księdze`;
}

const kontekst = () => ({
  rcId: rc.id, kategorie: getCats, poZmianie: odswiezSumy, onUsun: usunPozycje,
});

function przeladujPozycje(items) {
  if (items) rc.items = items;
  listaBox.innerHTML = '';
  for (const it of rc.items) listaBox.append(pozycja(it, kontekst()));
  odswiezSumy();
}

// K2: usunięcie z możliwością cofnięcia (wzorzec miękkiego usuwania z Historii).
async function usunPozycje(it) {
  let out;
  try {
    out = await api(`/api/v1/receipts/${rc.id}/items/${it.id}`, { method: 'DELETE' });
  } catch (err) { return blad('Nie usunąłem pozycji', err); }
  track('Paragon: usunięcie pozycji', 'paragon');
  przeladujPozycje(out.items);
  return toast(`Usunięto „${it.name || it.code || it.ocr_name || 'pozycję'}".`, {
    label: 'Cofnij',
    onClick: async () => {
      const { ocr_name, code, name, quantity, unit, unit_price, value, category_id } = it;
      try {
        const r = await api(`/api/v1/receipts/${rc.id}/items`,
          { method: 'POST', body: JSON.stringify({ ocr_name, code, name, quantity, unit, unit_price, value, category_id }) });
        rc.items.push({ ...r.item, suggestion: r.suggestion });
      } catch (err) { return blad('Nie cofnąłem usunięcia', err); }
      przeladujPozycje();
      return toast('Pozycja wróciła — jest na końcu listy.');
    },
  });
}

// K2: dopisanie pozycji ręcznie — działa też, gdy OCR nie odczytał ani jednej linii.
async function dodajPozycje() {
  let r;
  try {
    r = await api(`/api/v1/receipts/${rc.id}/items`, { method: 'POST', body: JSON.stringify({ unit: 'szt.', quantity: 1 }) });
  } catch (err) { return blad('Nie dodałem pozycji', err); }
  rc.items.push({ ...r.item, suggestion: r.suggestion });
  const node = pozycja(rc.items[rc.items.length - 1], kontekst());
  listaBox.append(node);
  node.querySelector('.rc-kod').focus();
  odswiezSumy();
  return track('Paragon: pozycja dopisana ręcznie', 'paragon');
}

async function potwierdz(btn) {
  btn.disabled = true;
  let r;
  try {
    r = await api(`/api/v1/receipts/${rc.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });
  } catch (err) {
    btn.disabled = false;
    // brak daty/kwoty: serwer NIE księguje „czymkolwiek" — pokazujemy, które pole uzupełnić
    const pole1 = { no_date: '.rc-data', bad_total: '.rc-suma' }[err.data?.error];
    if (pole1) $('#rcResult ' + pole1)?.focus();
    return blad('Nie zaksięgowałem paragonu', err, pole1 ? $('#rcResult ' + pole1) : null);
  }
  track('Paragon: potwierdzony', 'paragon');
  const box = $('#rcResult');
  box.innerHTML = '';
  box.append(el('p', { class: 'msg ok' }, r.already_confirmed
    ? `Ten paragon jest już w księdze (wpis #${r.transaction_id}) — drugiego wpisu nie zakładam.`
    : `Zapisano w księdze (wpis #${r.transaction_id}). Pozycje produktowe zostają w bazie paragonów.`));
  return poPotwierdzeniu ? poPotwierdzeniu() : undefined;
}

function stopka() {
  const row = el('div', { class: 'row wrap rc-akcje' });
  const dodaj = el('button', { class: 'btn', type: 'button' }, '+ Dodaj pozycję');
  dodaj.onclick = dodajPozycje;
  row.append(dodaj);
  if (rc.ai_available && !zaksiegowany()) {
    // PRYWATNOŚĆ: zdjęcie trafia do modelu wizyjnego WYŁĄCZNIE po tym kliknięciu.
    // Serwer odmówi (409), jeśli w paragonie jest już ręczna praca — ponowny odczyt by ją skasował.
    const ai = el('button', { class: 'btn', type: 'button' }, '✨ Popraw AI (nieczytelny?)');
    ai.onclick = async () => {
      if (!confirm('Ponowny odczyt AI zastąpi wszystkie odczytane pozycje nowym odczytem zdjęcia. Robimy to tylko na paragonie, w którym nie ma jeszcze Twoich poprawek. Kontynuować?')) return;
      ai.disabled = true; ai.textContent = 'AI czyta…';
      try {
        const lepszy = await api(`/api/v1/receipts/${rc.id}/ai-fix`, { method: 'POST' });
        track('Paragon: ai-fix', 'paragon', { detail: `pozycje=${lepszy.items.length}` });
        renderReceipt({ ...lepszy, ai_available: true }, {});
      } catch (err) {
        ai.disabled = false; ai.textContent = '✨ Popraw AI (nieczytelny?)';
        blad('AI nie poprawiło odczytu', err);
      }
    };
    row.append(ai);
  }
  btnOK = el('button', { class: 'btn primary', type: 'button' }, 'Potwierdź');
  btnOK.disabled = zaksiegowany();
  btnOK.onclick = () => potwierdz(btnOK);
  row.append(btnOK);
  return row;
}

// Wejście modułu: rysuje cały edytor w #rcResult (kontener z index.html — pliku cudzego).
// opts.onBack — powrót do listy paragonów; opts.onDone — po zaksięgowaniu.
export function renderReceipt(dane, opts = {}) {
  rc = { ...dane, items: (dane.items || []).map((i) => ({ ...i })) };
  if (opts.onDone) poPotwierdzeniu = opts.onDone;
  if (opts.onBack) poPowrocie = opts.onBack;     // zapamiętane, żeby przeżyć przerysowanie po ai-fix
  const box = $('#rcResult');
  box.innerHTML = '';
  const lista = el('datalist', { id: 'rcJednostki' });
  for (const j of JEDNOSTKI) lista.append(el('option', { value: j }));
  box.append(lista);
  if (poPowrocie) {
    const wroc = el('button', { class: 'btn small rc-wroc', type: 'button' }, '← Lista paragonów');
    wroc.onclick = poPowrocie;
    box.append(wroc);
  }
  if (zaksiegowany()) {
    box.append(el('p', { class: 'msg ok rc-status' },
      `Ten paragon jest w księdze (wpis #${rc.transaction_id}). Poprawki SUMY i daty zmienią także ten wpis — zapytam przed zapisem.`));
  }
  box.append(naglowek());
  for (const w of rc.warnings || []) box.append(el('p', { class: 'msg err' }, w));
  if (!rc.items.length) box.append(el('p', { class: 'msg' }, 'OCR nie rozpoznał żadnej pozycji — dopisz je ręcznie przyciskiem „+ Dodaj pozycję".'));
  listaBox = el('div', { class: 'rc-lista' });
  sumaBox = el('div', { class: 'rc-sumy' });
  btnOK = null;
  box.append(listaBox, sumaBox, stopka());
  przeladujPozycje();
}
