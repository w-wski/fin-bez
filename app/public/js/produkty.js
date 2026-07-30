// Karta „Produkty" — katalog + szczegół z historią cen (Etap 1 pkt 8).
//
// Po co ta karta istnieje: paragony wiedzą o jednym dniu i jednej kasie; dopiero produkt
// spina zakupy w czas („jak zmieniała się cena przez miesiące") i w miejsca („gdzie taniej").
// Tu też przypisuje się KATEGORIĘ PRODUKTOWĄ (żywność itd.) — osobną oś od budżetu
// (decyzja Szymona 2026-07-28: budżet opisuje przelew, ta oś opisuje towar).
import { $, el, zl, api, track, toast } from './core.js';
import { wykresCen } from './produkty-wykres.js';

let box = null, kategorie = [];         // kategorie produktowe (płaskie drzewo z migracji 014)
const dataPL = (d) => (d ? String(d).slice(0, 10) : '—');

function selectKategorii(prod, poZmianie) {
  const sel = el('select', { class: 'pr-kat', 'aria-label': 'Kategoria produktowa' });
  sel.append(el('option', { value: '' }, '— kategoria produktowa —'));
  for (const k of kategorie) sel.append(el('option', { value: k.id }, k.name));
  sel.value = prod.product_category_id || '';
  sel.onchange = async () => {
    try {
      const r = await api(`/api/v1/products/${prod.id}`, {
        method: 'PATCH', body: JSON.stringify({ product_category_id: sel.value || null }),
      });
      Object.assign(prod, r.product);
      track('Produkty: kategoria produktowa', 'produkty');
      poZmianie?.();
    } catch (e) {
      sel.value = prod.product_category_id || '';
      toast('Nie zapisałem kategorii produktowej.');
    }
  };
  return sel;
}

// ---------- SZCZEGÓŁ: historia cen jednego produktu ----------
async function szczegol(prod) {
  box.innerHTML = '';
  const wroc = el('button', { class: 'btn small', type: 'button' }, '← Katalog');
  wroc.onclick = () => lista();
  box.append(wroc);

  const naglowek = el('div', { class: 'pr-naglowek' });
  const nazwa = el('input', { class: 'pr-nazwa', value: prod.name, maxlength: '160', 'aria-label': 'Nazwa produktu' });
  nazwa.onchange = async () => {
    try {
      const r = await api(`/api/v1/products/${prod.id}`, { method: 'PATCH', body: JSON.stringify({ name: nazwa.value }) });
      Object.assign(prod, r.product);
      nazwa.value = prod.name;
      track('Produkty: zmiana nazwy', 'produkty');
    } catch (e) { nazwa.value = prod.name; toast('Nie zapisałem nazwy.'); }
  };
  naglowek.append(nazwa, selectKategorii(prod));
  box.append(naglowek);

  let dane;
  try { dane = await api(`/api/v1/products/${prod.id}/ceny`); }
  catch (e) { box.append(el('p', { class: 'msg err' }, 'Nie wczytałem historii cen.')); return; }

  if (!dane.zakupy.length) {
    box.append(el('p', { class: 'msg' }, 'Ten produkt nie ma jeszcze żadnego zakupu w zasięgu'
      + ' Twoich ksiąg — historia pojawi się po pierwszym paragonie.'));
    return;
  }

  // Wykres: obie ceny naraz. Jedna kłamie w obie strony (komentarz w routes/products.js).
  box.append(wykresCen(dane.miesiace, prod.unit));

  // el() z core przyjmuje wyłącznie TEKST jako trzeci argument (element stałby się
  // napisem "[object HTMLElement]") — wiersze składamy przez append.
  const wiersz = (tag, komorki) => {
    const tr = el('tr');
    for (const k of komorki) tr.append(el(tag, {}, k));
    return tr;
  };
  const tab = el('table', { class: 'pr-tabela' });
  tab.append(wiersz('th', ['Data', 'Sklep', 'Ilość', 'Cena półkowa', 'Zapłacono/jedn.', 'Razem']));
  for (const x of dane.zakupy.slice(0, 60)) {
    tab.append(wiersz('td', [
      dataPL(x.data),
      x.sklep || '—',
      x.ilosc === null ? '—' : `${x.ilosc} ${prod.unit || ''}`,
      x.cena_katalogowa === null ? '—' : zl(x.cena_katalogowa),
      x.cena_zaplacona === null ? '—' : zl(x.cena_zaplacona),
      x.wartosc === null ? '—' : zl(x.wartosc),
    ]));
  }
  box.append(tab);
  if (dane.zakupy.length > 60) {
    box.append(el('p', { class: 'msg' }, `…i jeszcze ${dane.zakupy.length - 60} starszych zakupów.`));
  }
}

// Plakietka „N pozycji czeka" (Z18): pusta karta Produkty przestaje wyglądać jak awaria —
// OCR celowo NIGDY nie zakłada produktów (patrz produkt-baza.js), więc czekające pozycje
// są normalnym stanem. Plakietka mówi, ile ich jest i GDZIE podjąć decyzję (poprawka opisu
// pozycji w paragonie), zamiast milczeć.
async function plakietkaCzekajace() {
  let n = 0;
  try { ({ n } = await api('/api/v1/products/nieprzypisane-licznik')); } catch (e) { return null; }
  if (!n) return null;
  const przejdz = el('button', { class: 'btn small', type: 'button' }, 'Przejdź do Paragonów');
  przejdz.onclick = () => document.querySelector('[data-view="paragon"]')?.click();
  const box2 = el('div', { class: 'pr-czekaja' });
  box2.append(
    el('span', { class: 'pill' }, `${n} ${n === 1 ? 'pozycja czeka' : 'pozycji czeka'} na przypisanie`),
    el('p', { class: 'msg' }, 'Popraw opis pozycji w paragonie i wskaż jej produkt —'
      + ' katalog uzupełnia się wyłącznie tak, ręcznie.'),
    przejdz);
  return box2;
}

// ---------- KATALOG ----------
async function lista() {
  box.innerHTML = '';
  const czekajace = await plakietkaCzekajace();
  if (czekajace) box.append(czekajace);
  const szukaj = el('input', { type: 'search', class: 'pr-szukaj',
    placeholder: 'szukaj produktu…', 'aria-label': 'Szukaj produktu' });
  const wyniki = el('div', { class: 'pr-lista' });
  box.append(szukaj, wyniki);

  async function zaladuj(fraza) {
    wyniki.innerHTML = '';
    wyniki.append(el('p', { class: 'msg' }, 'Wczytuję…'));
    let items = [];
    try {
      ({ items } = await api(`/api/v1/products?limit=200${fraza ? `&szukaj=${encodeURIComponent(fraza)}` : ''}`));
    } catch (e) { wyniki.innerHTML = ''; wyniki.append(el('p', { class: 'msg err' }, 'Nie wczytałem katalogu.')); return; }
    wyniki.innerHTML = '';
    if (!items.length) {
      wyniki.append(el('p', { class: 'msg' }, fraza
        ? `Nic dla „${fraza}".`
        : 'Katalog jest pusty. Produkty powstają przy poprawianiu pozycji paragonu —'
          + ' nadaj pozycji opis po ludzku, a produkt i jego alias założą się same.'));
      return;
    }
    for (const p of items) {
      const karta = el('div', { class: 'pr-karta' });
      const głowna = el('button', { class: 'pr-glowna', type: 'button' });
      głowna.append(
        el('span', { class: 'pr-tytul' }, p.name),
        el('span', { class: 'pr-meta' },
          `${p.zakupow ? `${p.zakupow}× · ${zl(p.wydano || 0)}` : 'bez zakupów'}`
          + `${p.ostatni_zakup ? ` · ostatnio ${dataPL(p.ostatni_zakup)}` : ''}`));
      głowna.onclick = () => szczegol(p);
      karta.append(głowna, selectKategorii(p));
      wyniki.append(karta);
    }
  }

  let t = null;
  szukaj.oninput = () => { clearTimeout(t); t = setTimeout(() => zaladuj(szukaj.value.trim()), 250); };
  await zaladuj('');
}

export function initProdukty() {
  box = $('#produktyBox');
}

export async function loadProdukty() {
  if (!kategorie.length) {
    try { ({ items: kategorie } = await api('/api/v1/products/kategorie')); } catch (e) { kategorie = []; }
  }
  return lista();
}
