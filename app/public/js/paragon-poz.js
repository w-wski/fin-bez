// Pozycja paragonu jako karta + wspólne pomocniki pól formularza edytora.
// Wydzielone z paragon-edit.js (limit 300 linii na plik); zależność jest jednokierunkowa:
// paragon-edit.js → paragon-poz.js (ten plik nie wie nic o nagłówku ani o potwierdzaniu).
//
// Zasada nadrzędna (audyt Z4): pole pokazuje TO, CO JEST W BAZIE. Po zapisie przepisujemy je
// wartością zwróconą przez serwer, a wartość, której serwer NIE przyjął, dostaje czerwony
// komunikat przy polu — nigdy zielone mrugnięcie „zapisane".
import { el, zl, api, track, toast } from './core.js';
import { parseKwota } from './kwota.js';         // jedyne miejsce, gdzie napis staje się kwotą

export const JEDNOSTKI = ['szt.', 'kg', 'g', 'l', 'ml', 'm', 'opak.'];
const TOL_POZYCJA = 0.02;                        // zgodne z src/ocr/pola.js (K6)

export const przecinek = (v) => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));
export const ilosc = (v) => przecinek(v === null || v === undefined ? '' : String(v).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));

// ILOŚĆ TO NIE KWOTA — „0,345" (waga) jest normalna, a parseKwota przeczytałoby „0.345" jako 345.
// Ciało funkcji musi być IDENTYCZNE z parseIlosc w src/ocr/pola.js (rozjazd wyłapuje
// scripts/test-receipt-parser.js) — inaczej przeglądarka i serwer liczyłyby wagę inaczej.
export function parseIlosc(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  // spacja W ŚRODKU liczby („1 000") to niejednoznaczny zapis — odmawiamy, nie zgadujemy
  const s = String(v === null || v === undefined ? '' : v).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  return Number(s);
}

export const inp = (klasa, wartosc, extra = {}) => el('input', { type: 'text', class: klasa, value: wartosc ?? '', ...extra });
// pole na liczbę (kwota/ilość) — nazwa `poleNum`, żeby nie mylić się z parserami liczb
export const poleNum = (klasa, wartosc, etykieta) => inp(klasa, wartosc, { inputmode: 'decimal', 'aria-label': etykieta, placeholder: etykieta });
export const pole = (etykieta, node) => { const l = el('label', { class: 'rc-pole' }); l.append(el('span', {}, etykieta), node); return l; };

export function mrugnij(node) {                  // zielone mrugnięcie = „zapisane na serwerze"
  if (!node) return;
  node.classList.remove('zapisane'); void node.offsetWidth; node.classList.add('zapisane');
}

// Błąd MUSI być widoczny PRZY POLU: to jedyne miejsce, w którym widać, że kwota nie weszła
// do bazy. Puste `tekst` = kasujemy błąd (wartość przyjęta).
export function bladPola(node, tekst) {
  if (!node) return;
  node.classList.toggle('nie-zapisane', !!tekst);
  if (tekst) node.setAttribute('aria-invalid', 'true'); else node.removeAttribute('aria-invalid');
  const l = node.closest('.rc-pole');
  if (!l) return;
  let s = l.querySelector('.rc-blad-pola');
  if (!s) { s = el('span', { class: 'rc-blad-pola' }); l.append(s); }
  s.textContent = tekst || '';
}

// Zapis się nie udał — mówimy po polsku CO się stało i że poprawka NIE została zapisana.
// Brak err.data = fetch w ogóle nie doszedł (offline albo serwer milczy), nie błąd walidacji.
export function blad(tekst, err, node) {
  if (err.message === 'auth') return;             // api() przerzuciło już na ekran logowania
  const powod = err.data
    ? (err.data.hint || err.data.error || err.message)
    : (navigator.onLine ? 'serwer nie odpowiedział' : 'jesteś offline');
  bladPola(node, `${tekst}: ${powod}`);
  return toast(`${tekst} — ${powod}. Poprawka NIE została zapisana; spróbuj jeszcze raz, gdy wróci połączenie.`);
}

// K3: podpowiedź ze słownika + oryginalny odczyt OCR zawsze pod ręką (ślad audytowy).
// „✓ ze słownika" pojawia się WYŁĄCZNIE wtedy, gdy opis faktycznie jest tym ze słownika —
// wcześniej serwer uczył słownik przed pobraniem podpowiedzi i potwierdzał na zielono
// wpis, którego nikt nie zatwierdził.
function odswiezHint(it, hint, p) {
  hint.innerHTML = '';
  const kodTeraz = (it.code ?? it.ocr_name ?? '').trim();
  if (it.ocr_name && it.ocr_name.trim() !== kodTeraz) {
    const wroc = el('button', { class: 'btn small', type: 'button', title: 'Wróć do odczytu OCR' }, `↩ OCR: ${it.ocr_name}`);
    wroc.onclick = () => { p.kod.value = it.ocr_name; p.zapisz({ code: it.ocr_name }, p.kod); };
    hint.append(wroc);
  }
  if (it.nauczone) { hint.append(el('span', { class: 'rc-znak' }, 'zapamiętane w słowniku')); return; }
  const s = it.suggestion;
  if (!s) return;
  if (it.name && String(it.name).trim() === s.name) { hint.append(el('span', { class: 'rc-znak' }, `✓ ze słownika (${s.hits}×)`)); return; }
  // PROPOZYCJA, nie fakt: nic nie wchodzi do pól, dopóki człowiek nie kliknie „Użyj".
  const uzyj = el('button', { class: 'btn small rc-uzyj', type: 'button' },
    `Użyj: ${[s.name, s.unit, s.category_name].filter(Boolean).join(' · ')}`);
  uzyj.onclick = () => {
    const patch = { name: s.name };
    if (s.unit) patch.unit = s.unit;
    // kategoria tylko wtedy, gdy jest z księgi tego paragonu i nadal aktywna (category_name z JOIN-a)
    if (s.category_id && s.category_name) patch.category_id = s.category_id;
    p.zapisz(patch, p.opis);
    track('Paragon: podpowiedź ze słownika przyjęta', 'paragon');
  };
  hint.append(el('span', { class: 'rc-znak' }, 'Podpowiedź:'), uzyj);
}

// K6: ostrzeżenie, nie blokada. Jednym kliknięciem można przyjąć wyliczoną wartość.
function odswiezOstrzezenie(it, box, ostrz, wart) {
  const q = parseIlosc(it.quantity), c = parseKwota(it.unit_price), v = parseKwota(it.value);
  const zle = q !== null && c !== null && v !== null && Math.abs(q * c - v) > TOL_POZYCJA + 1e-9;
  box.classList.toggle('lowconf', zle);
  ostrz.hidden = !zle;
  ostrz.innerHTML = '';
  if (!zle) return;
  const wyliczona = Math.round(q * c * 100) / 100;
  const popraw = el('button', { class: 'btn small', type: 'button' }, `Ustaw ${zl(wyliczona)}`);
  popraw.onclick = () => {
    wart.value = przecinek(wyliczona.toFixed(2));
    wart.dispatchEvent(new Event('input'));
    wart.dispatchEvent(new Event('change'));
  };
  ostrz.append(el('span', {}, `ilość × cena = ${zl(wyliczona)}, a wartość to ${zl(v)}`), popraw);
}

function kategorie(it, listaKat) {
  const sel = el('select', { class: 'rc-kat', 'aria-label': 'Kategoria' });
  sel.append(el('option', { value: '' }, '— kategoria —'));
  for (const c of listaKat) {
    sel.append(el('option', { value: c.id }, c.name));
    for (const k of c.children || []) sel.append(el('option', { value: k.id }, `${c.name} > ${k.name}`));
  }
  if (it.category_id && !sel.querySelector(`option[value="${it.category_id}"]`)) {
    sel.append(el('option', { value: it.category_id }, `kategoria #${it.category_id}`));   // np. kategoria wyłączona
  }
  sel.value = it.category_id || '';
  return sel;
}

// ctx: { rcId, kategorie(), poZmianie(), onUsun(it) }
export function pozycja(it, ctx) {
  const box = el('div', { class: 'rc-poz' + (Number(it.low_confidence) ? ' lowconf' : '') });
  const kod = inp('rc-kod', it.code ?? it.ocr_name ?? '', { placeholder: 'kod z paragonu (np. CHL TOST 500G)', maxlength: '255', 'aria-label': 'Kod z paragonu' });
  const opis = inp('rc-opis', it.name ?? '', { placeholder: 'opis po ludzku (np. chleb tostowy)', maxlength: '255', 'aria-label': 'Opis pozycji' });
  const hint = el('div', { class: 'rc-hint' });
  const il = poleNum('rc-il', ilosc(it.quantity), 'ilość');
  // K5: lista podpowiadana (datalist) + wpis własny do 8 znaków; puste jest dozwolone
  const jedn = inp('rc-jedn', it.unit ?? '', { list: 'rcJednostki', maxlength: '8', placeholder: 'jedn.', 'aria-label': 'Jednostka' });
  const cena = poleNum('rc-cena', przecinek(it.unit_price), 'cena');
  const wart = poleNum('rc-wart', przecinek(it.value), 'wartość');
  const kat = kategorie(it, ctx.kategorie());
  const ostrz = el('div', { class: 'rc-blad' });
  const POLA = { code: [kod, (v) => v ?? ''], name: [opis, (v) => v ?? ''], unit: [jedn, (v) => v ?? ''],
    quantity: [il, ilosc], unit_price: [cena, przecinek], value: [wart, przecinek],
    category_id: [kat, (v) => (v ? String(v) : '')] };
  let baza = { quantity: it.quantity, unit_price: it.unit_price, value: it.value };   // ostatni stan Z BAZY

  const zapisz = async (patch, node) => {
    try {
      const r = await api(`/api/v1/receipts/${ctx.rcId}/items/${it.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      Object.assign(it, r.item, { suggestion: r.suggestion, nauczone: r.nauczone });
      baza = { quantity: it.quantity, unit_price: it.unit_price, value: it.value };
      // pole pokazuje wartość Z BAZY (nie to, co wpisał palec); pola, w którym ktoś właśnie pisze, nie ruszamy
      for (const k of Object.keys(patch)) {
        const p = POLA[k];
        if (p && p[0] !== document.activeElement) p[0].value = p[1](it[k]);
      }
      bladPola(node, '');
      mrugnij(node);
    } catch (err) { return blad('Nie zapisałem poprawki', err, node); }
    odswiezHint(it, hint, { kod, opis, jedn, kat, zapisz });
    odswiezOstrzezenie(it, box, ostrz, wart);
    ctx.poZmianie();
    return track('Paragon: korekta pozycji', 'paragon');
  };

  const kosz = el('button', { class: 'btn small btn--kolo rc-kosz', type: 'button', title: 'Usuń pozycję', 'aria-label': 'Usuń pozycję' }, '✕');
  kosz.onclick = () => ctx.onUsun(it);
  const l1 = el('div', { class: 'rc-l1' });
  l1.append(el('span', { class: 'rc-nr' }, String(it.line_no)), kod, kosz);

  kod.onchange = () => zapisz({ code: kod.value }, kod);
  opis.onchange = () => zapisz({ name: opis.value }, opis);
  jedn.onchange = () => zapisz({ unit: jedn.value }, jedn);      // puste = świadome wyczyszczenie (K5)
  kat.onchange = () => zapisz({ category_id: kat.value || null }, kat);
  for (const [node, klucz] of [[il, 'quantity'], [cena, 'unit_price'], [wart, 'value']]) {
    // liczenie na żywo bez ruchu do serwera — ostrzeżenie i sumy nadążają za palcem
    node.oninput = () => { it[klucz] = node.value; odswiezOstrzezenie(it, box, ostrz, wart); ctx.poZmianie(); };
    node.onchange = () => {
      const surowe = node.value.trim();
      const czytaj = klucz === 'quantity' ? parseIlosc : parseKwota;
      if (surowe !== '' && czytaj(surowe) === null) {
        // wartość nie do odczytania („l2,50") — NIE wysyłamy jej i NIE udajemy, że zapisana
        it[klucz] = baza[klucz];
        odswiezOstrzezenie(it, box, ostrz, wart); ctx.poZmianie();
        return bladPola(node, klucz === 'quantity'
          ? `Nie rozumiem ilości „${surowe}" — wpisz np. 2 albo 0,345. NIE zapisałem.`
          : `Nie rozumiem kwoty „${surowe}" — wpisz np. 12,50. NIE zapisałem.`);
      }
      const patch = { [klucz]: surowe };
      const q = parseIlosc(il.value), c = parseKwota(cena.value);
      // pusta wartość przy znanej ilości i cenie = najczęstszy przypadek dopisywania ręcznego
      if (klucz !== 'value' && wart.value.trim() === '' && q !== null && c !== null) {
        patch.value = (Math.round(q * c * 100) / 100).toFixed(2);
      }
      return zapisz(patch, node);
    };
  }

  const siatka = el('div', { class: 'rc-siatka' });
  siatka.append(pole('Ilość', il), pole('Jedn.', jedn), pole('Cena', cena), pole('Wartość', wart));
  box.append(l1, opis, hint, siatka, kat, ostrz);
  odswiezHint(it, hint, { kod, opis, jedn, kat, zapisz });
  odswiezOstrzezenie(it, box, ostrz, wart);
  return box;
}
