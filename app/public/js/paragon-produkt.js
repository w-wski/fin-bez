// Scalanie pozycji paragonu z produktem z katalogu — „to jest ten sam produkt co…".
//
// DECYZJA SZYMONA 2026-07-28 (wariant C). Dwie drogi wiązania, celowo nierównoprawne:
//
//   tożsamość  — ta sama para (sieć sklepu, kod z kasy) wiąże się SAMA, po stronie serwera
//                (`produkt.przypiszPozycje`). To nie jest zgadywanie: ta sama kasa drukuje ten
//                sam numer towaru, więc raz potwierdzone mleko rozpoznaje się dalej bez pytania.
//   podobieństwo nazw — WYŁĄCZNIE propozycja, nigdy cichy zapis. Tu, w tym pliku.
//
// Dlaczego tak: „MLEKO UHT 3,2%" i „MLEKO UHT 0,5%" różnią się trzema znakami, a to dwa różne
// towary. Automatyczne scalenie takiej pary truje historię cen po cichu — wykres pokazuje
// „spadek ceny", który jest w rzeczywistości innym produktem, i nikt tego potem nie zauważa.
// Dlatego każdy kandydat z podobieństwa wymaga kliknięcia, a jego pewność jest widoczna.
//
// Praca jest jednorazowa per produkt per sklep: alias zapisuje się przy kodzie, nie przy
// nazwie, więc następny paragon z tej samej sieci trafia już sam.
import { el, api, toast } from './core.js';

const PROC = (w) => `${Math.round(Number(w) * 100)}%`;

/** Nazwa, po której szukamy kandydatów: opis człowieka jest lepszy niż surowy odczyt kasy,
 *  ale gdy go jeszcze nie ma, zostaje kod z paragonu. */
const szukanaNazwa = (it) => String(it.name || it.code || it.ocr_name || '').trim();

function przycisk(p, wybierz, opis) {
  const b = el('button', { class: 'btn small rc-prod-kand', type: 'button' });
  b.append(el('span', { class: 'rc-prod-nazwa' }, p.name));
  if (opis) b.append(el('span', { class: 'rc-prod-pewnosc' }, opis));
  b.onclick = () => wybierz(p);
  return b;
}

/** Element pokazujący i zmieniający produkt pozycji.
 *  `zapisz(patch, node)` to ta sama funkcja, która zapisuje pozostałe pola pozycji —
 *  dzięki temu scalenie idzie tą samą drogą (PATCH pozycji) co każda inna ręczna poprawka,
 *  a serwer przy okazji zapamiętuje alias (kod → produkt w tym sklepie). */
export function produktPozycji(it, { zapisz }) {
  const box = el('div', { class: 'rc-prod' });
  const stan = el('span', { class: 'rc-prod-stan' });
  const dzialaj = el('button', { class: 'btn small', type: 'button' });
  const panel = el('div', { class: 'rc-prod-panel', hidden: '' });
  let nazwaProduktu = it.product_name || null;
  let otwarty = false;

  function odswiez() {
    stan.innerHTML = '';
    if (it.product_id) {
      stan.append(el('span', { class: 'rc-prod-ok' }, '● '),
        el('span', {}, nazwaProduktu || `produkt #${it.product_id}`));
      dzialaj.textContent = 'Zmień';
    } else {
      stan.append(el('span', { class: 'rc-prod-brak' }, '○ '), el('span', {}, 'produkt nieprzypisany'));
      dzialaj.textContent = 'Wskaż produkt';
    }
  }

  async function zwiaz(p) {
    try {
      await zapisz({ product_id: p ? p.id : null }, dzialaj);
    } catch (e) { return undefined; }        // zapisz() sam pokazuje błąd przy polu
    nazwaProduktu = p ? p.name : null;
    odswiez();
    zamknij();
    return toast(p ? `Pozycja połączona z „${p.name}". Następny paragon z tego sklepu`
      + ' rozpozna ją sam.' : 'Odłączono od produktu.');
  }

  function zamknij() { otwarty = false; panel.hidden = true; panel.innerHTML = ''; }

  async function otworz() {
    otwarty = true; panel.hidden = false; panel.innerHTML = '';
    panel.append(el('p', { class: 'rc-prod-info' }, 'Wybierz produkt, którym ta pozycja jest'
      + ' w rzeczywistości. Kolejne paragony z tego sklepu rozpoznają ją już same.'));

    const nazwa = szukanaNazwa(it);
    const lista = el('div', { class: 'rc-prod-lista' });
    panel.append(lista);
    lista.append(el('p', { class: 'rc-prod-czekaj' }, 'Szukam podobnych…'));

    const szukaj = el('input', { type: 'search', class: 'rc-prod-szukaj',
      placeholder: 'szukaj w katalogu produktów', 'aria-label': 'Szukaj produktu' });
    let timer = null;
    szukaj.oninput = () => { clearTimeout(timer); timer = setTimeout(() => pokazSzukane(szukaj.value), 250); };
    panel.append(szukaj);

    if (it.product_id) {
      const odlacz = el('button', { class: 'btn small rc-prod-odlacz', type: 'button' }, 'Odłącz od produktu');
      odlacz.onclick = () => zwiaz(null);
      panel.append(odlacz);
    }
    const anuluj = el('button', { class: 'btn small', type: 'button' }, 'Anuluj');
    anuluj.onclick = zamknij;
    panel.append(anuluj);

    // Propozycje po podobieństwie nazw. Pewność pokazujemy zawsze — człowiek ma widzieć,
    // czy potwierdza pewniaka, czy strzał na granicy progu.
    let kand = [];
    try {
      ({ kandydaci: kand } = await api(`/api/v1/products/propozycje?nazwa=${encodeURIComponent(nazwa)}`));
    } catch (e) { kand = []; }
    if (!otwarty) return undefined;
    lista.innerHTML = '';
    if (!kand.length) {
      lista.append(el('p', { class: 'rc-prod-info' },
        'Nie znalazłem podobnego produktu. Poszukaj w katalogu poniżej.'));
    }
    for (const p of kand) lista.append(przycisk(p, zwiaz, `podobne w ${PROC(p.wynik)}`));
    return undefined;
  }

  async function pokazSzukane(fraza) {
    const f = String(fraza || '').trim();
    const lista = panel.querySelector('.rc-prod-lista');
    if (!lista) return;
    if (f.length < 2) return otworz();          // pusta fraza wraca do propozycji
    lista.innerHTML = '';
    lista.append(el('p', { class: 'rc-prod-czekaj' }, 'Szukam…'));
    let items = [];
    try { ({ items } = await api(`/api/v1/products?szukaj=${encodeURIComponent(f)}&limit=20`)); }
    catch (e) { items = []; }
    if (!otwarty) return;
    lista.innerHTML = '';
    if (!items.length) lista.append(el('p', { class: 'rc-prod-info' }, `Nic dla „${f}".`));
    for (const p of items) lista.append(przycisk(p, zwiaz, p.zakupow ? `kupione ${p.zakupow}×` : ''));
  }

  dzialaj.onclick = () => (otwarty ? zamknij() : otworz());
  odswiez();
  box.append(stan, dzialaj, panel);
  return box;
}
