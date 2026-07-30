// Klik z Raportu do Historii (Z8/#25): wycinek „Wydatki wg kategorii" prowadzi do listy
// wpisów, które się na niego składają, zawężonej do OKRESU raportu. Wydzielone z raporty.js
// (limit 300 linii, konwencja repo) — ten moduł zna tylko DOM raportu i indeks kategorii;
// samą nawigację i wypełnienie filtrów w Historii robią core.js/historia.js.
import { show, api, toast } from './core.js';
import { pokazHistorie } from './historia.js';
import { trybUkladania } from './raporty-uklad.js';

// Płaski indeks kategorii z /api/v1/categories: id rodzica -> [id dzieci] (klik w RODZICA
// ma zabrać też jego podkategorie — inaczej wycinek wykresu i lista wpisów by się rozjechały).
export function indeksKategorii(categories) {
  const dzieci = new Map();
  for (const c of categories || []) {
    const ids = (c.children || []).map((k) => k.id);
    if (ids.length) dzieci.set(c.id, ids);
  }
  return { dzieci };
}

// Data czytelna dla człowieka: DD.MM.RRRR–DD.MM.RRRR, bez nazw miesięcy (bez ryzyka
// odmiany w niepasującym przypadku).
export function opisOkres(from, to) {
  const pl = (d) => (d ? d.split('-').reverse().join('.') : '');
  return from && to ? `${pl(from)}–${pl(to)}` : '';
}

// Węzeł staje się klikalny i dostępny z klawiatury (Enter/Spacja), z aria-label opisującym
// dokąd prowadzi — dostępność jak w reszcie aplikacji (klasa `.klikalny` w raporty.css).
function uklikalnij(n, aria, onKlik) {
  n.classList.add('klikalny');
  n.tabIndex = 0;
  n.setAttribute('role', 'button');
  n.setAttribute('aria-label', aria);
  n.addEventListener('click', onKlik);
  n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onKlik(); } });
}

// Przejście do Historii: nawigacja (`show`) tu na miejscu, wypełnienie filtrów i pobranie
// listy robi pokazHistorie() z historia.js — ten moduł nie zna warstwy sieciowej Historii.
async function idzDoHistorii(filtry) {
  show('historia');
  await pokazHistorie(filtry);
}

// Podpina klik pod wiersz „Wydatki wg kategorii" — ma category_id wprost z /api/v1/summary.
// `id === null` (wpisy „bez kategorii") zostaje nieklikalny: nie ma czym filtrować w Historii.
export function klikKategoria(row, ledger, okres, id, label, idx) {
  if (id == null) return;
  const ids = [id, ...(idx.dzieci.get(id) || [])];
  uklikalnij(row, `Pokaż wpisy: ${label} · ${okres.opis}`,
    () => idzDoHistorii({ ledger, from: okres.from, to: okres.to, categoryIds: ids, categoryLabel: label }));
}

// Guzik „Ułóż"/„Gotowe" nad kaflami: przełącza tryb ręcznego układania z raporty-uklad.js
// (Z9). Zapis leci od razu po wyłączeniu trybu — bez osobnego przycisku „Zapisz".
export function initUkladBtn(box, btn) {
  if (!btn) return;
  const tryb = trybUkladania(box, (layout) => api('/api/v1/uklad', { method: 'PUT', body: JSON.stringify({ layout }) }));
  btn.onclick = async () => {
    if (btn.dataset.aktywny) {
      // Zapis leci przez PUT /uklad — offline/błąd rzuca, i wtedy przycisk MUSI zostać w trybie
      // edycji (nie udawać sukcesu), inaczej układ ginie po cichu bez śladu (Z14 #4).
      try {
        await tryb.wylacz();
        btn.textContent = 'Ułóż';
        delete btn.dataset.aktywny;
      } catch {
        toast('Nie zapisałem układu — spróbuj ponownie z siecią.');
      }
    } else { tryb.wlacz(); btn.textContent = 'Gotowe'; btn.dataset.aktywny = '1'; }
  };
}
