// Wspólny „pasek okresu" (audyt 2026-07-30: trzy niezależne implementacje wyboru okresu
// w Raportach/Analizach/Historii — pkt 14 od Szymona: ujednolicić). Jedno źródło markupu
// i logiki przesuwania; karta dostarcza tylko stan początkowy i reakcję na zmianę.
// Klasy CSS celowo neutralne (po-*), stylowane raz w styles.css (Z21).
import { el } from './core.js';

export const NAZWY_TYPU = { miesiac: 'Miesiąc', kwartal: 'Kwartał', rok: 'Rok' };

export function domyslnyOkres(typ, teraz = new Date()) {
  const r = teraz.getFullYear();
  const m = teraz.getMonth() + 1;
  if (typ === 'miesiac') return `${r}-${String(m).padStart(2, '0')}`;
  if (typ === 'kwartal') return `${r}-Q${Math.ceil(m / 3)}`;
  return String(r);
}

export function przesunOkres(typ, okres, kier) {
  if (typ === 'rok') return String(Number(okres) + kier);
  if (typ === 'kwartal') {
    const [r, q] = okres.split('-Q').map(Number);
    const nq = q + kier;
    if (nq < 1) return `${r - 1}-Q4`;
    if (nq > 4) return `${r + 1}-Q1`;
    return `${r}-Q${nq}`;
  }
  const [r, m] = okres.split('-').map(Number);
  const mm = m + kier;
  if (mm < 1) return `${r - 1}-12`;
  if (mm > 12) return `${r + 1}-01`;
  return `${r}-${String(mm).padStart(2, '0')}`;
}

// Zakres dat okresu — wspólne z backendem co do konwencji (patrz src/analizy.js#zakresOkresu).
export function zakresOkresu(typ, okres) {
  if (typ === 'miesiac') {
    const [r, m] = okres.split('-').map(Number);
    return { od: `${okres}-01`, do: `${r}-${String(m).padStart(2, '0')}-${new Date(r, m, 0).getDate()}` };
  }
  if (typ === 'kwartal') {
    const [r, q] = okres.split('-Q').map(Number);
    const m0 = (q - 1) * 3 + 1;
    return { od: `${r}-${String(m0).padStart(2, '0')}-01`, do: `${r}-${String(m0 + 2).padStart(2, '0')}-${new Date(r, m0 + 2, 0).getDate()}` };
  }
  return { od: `${okres}-01-01`, do: `${okres}-12-31` };
}

/**
 * Buduje pasek: chipsy typów + strzałki ◀ okres ▶.
 * opts: { typ, okres, typy? (domyślnie wszystkie 3), onChange(typ, okres) }
 * Zwraca { element, ustaw(typ, okres) } — ustaw() odświeża pasek bez przebudowy przez kartę.
 */
export function pasekOkresu(opts) {
  let { typ, okres } = opts;
  const typy = opts.typy || ['miesiac', 'kwartal', 'rok'];
  const pasek = el('div', { class: 'po-pasek' });
  const chips = el('div', { class: 'chips po-typy', role: 'group', 'aria-label': 'Typ okresu' });
  const strzalki = el('div', { class: 'row po-strzalki' });
  const etykieta = el('span', { class: 'po-okres-label' });

  const rysuj = () => {
    chips.innerHTML = '';
    for (const t of typy) {
      const b = el('button', { type: 'button', class: t === typ ? 'active' : '' }, NAZWY_TYPU[t]);
      b.onclick = () => { typ = t; okres = domyslnyOkres(t); rysuj(); opts.onChange(typ, okres); };
      chips.append(b);
    }
    etykieta.textContent = okres;
  };
  const przesun = (kier) => { okres = przesunOkres(typ, okres, kier); rysuj(); opts.onChange(typ, okres); };
  const wstecz = el('button', { class: 'btn small', type: 'button', 'aria-label': 'Poprzedni okres' }, '◀');
  const wprzod = el('button', { class: 'btn small', type: 'button', 'aria-label': 'Następny okres' }, '▶');
  wstecz.onclick = () => przesun(-1);
  wprzod.onclick = () => przesun(1);
  strzalki.append(wstecz, etykieta, wprzod);
  pasek.append(chips, strzalki);
  rysuj();
  return { element: pasek, ustaw(t, o) { typ = t; okres = o; rysuj(); } };
}
