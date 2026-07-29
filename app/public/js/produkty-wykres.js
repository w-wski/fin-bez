// Wykres historii cen produktu — czysty SVG, bez bibliotek (frontend nie ma build stepu).
//
// DWIE LINIE ZAWSZE RAZEM: cena półkowa (katalogowa) i faktycznie zapłacona za jednostkę.
// Jedna z nich osobno kłamie w obie strony — po katalogowej „drożeje!", choć płacimy mniej
// (rabaty), po zapłaconej „taniej!", choć to była jednorazowa promocja. Odstęp między liniami
// to wprost „ile średnio urywamy rabatami".
import { el, zl } from './core.js';

const W = 640, H = 220, PAD = { l: 44, r: 10, t: 12, b: 24 };

const n = (v) => (v === null || v === undefined ? null : Number(v));

/** dane: wiersze `miesiace` z GET /products/:id/ceny (miesiac, srednia_katalogowa, srednia_zaplacona). */
export function wykresCen(miesiace, jednostka) {
  const box = el('div', { class: 'pr-wykres' });
  const pkt = (miesiace || []).map((m) => ({
    m: m.miesiac, kat: n(m.srednia_katalogowa), zap: n(m.srednia_zaplacona),
  })).filter((p) => p.kat !== null || p.zap !== null);

  if (pkt.length < 2) {
    box.append(el('p', { class: 'msg' }, pkt.length === 1
      ? `Na razie jeden miesiąc z zakupami (${pkt[0].m}) — trend pojawi się od drugiego.`
      : 'Za mało danych na wykres.'));
    return box;
  }

  const wart = pkt.flatMap((p) => [p.kat, p.zap]).filter((v) => v !== null);
  // Skala od zera byłaby „uczciwa", ale przy cenach 22–25 zł spłaszcza trend do kreski;
  // skala od minimum wyolbrzymia szum. Kompromis: od 90% minimum, z osią podpisaną liczbami.
  const min = Math.min(...wart) * 0.9, max = Math.max(...wart) * 1.02 || 1;
  const x = (i) => PAD.l + (i * (W - PAD.l - PAD.r)) / (pkt.length - 1);
  const y = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - min) / (max - min || 1));
  const linia = (klucz) => pkt.map((p, i) => (p[klucz] === null ? null : `${x(i)},${y(p[klucz])}`))
    .filter(Boolean).join(' ');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Wykres średnich cen miesięcznych: półkowa i zapłacona');
  const s = (tag, attrs, text) => {
    const e2 = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) e2.setAttribute(k, v);
    if (text) e2.textContent = text;
    return e2;
  };

  // oś Y: trzy podpisane poziomy wystarczą do odczytu rzędu wielkości
  for (const v of [min, (min + max) / 2, max]) {
    svg.append(s('line', { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: 'pr-siatka' }));
    svg.append(s('text', { x: PAD.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'pr-os' },
      v.toFixed(v >= 100 ? 0 : 2).replace('.', ',')));
  }
  // oś X: pierwszy, środkowy i ostatni miesiąc — więcej etykiet zlewa się na telefonie
  for (const i of [0, Math.floor((pkt.length - 1) / 2), pkt.length - 1]) {
    svg.append(s('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', class: 'pr-os' }, pkt[i].m));
  }

  svg.append(s('polyline', { points: linia('kat'), class: 'pr-linia pr-linia--kat' }));
  svg.append(s('polyline', { points: linia('zap'), class: 'pr-linia pr-linia--zap' }));
  for (const [i, p] of pkt.entries()) {
    if (p.kat !== null) svg.append(s('circle', { cx: x(i), cy: y(p.kat), r: 3, class: 'pr-kropka--kat' }));
    if (p.zap !== null) svg.append(s('circle', { cx: x(i), cy: y(p.zap), r: 3, class: 'pr-kropka--zap' }));
  }
  box.append(svg);

  const ost = pkt[pkt.length - 1];
  const legenda = el('p', { class: 'pr-legenda' });
  legenda.append(
    el('span', { class: 'pr-leg pr-leg--kat' }, `— półkowa${ost.kat !== null ? ` (${zl(ost.kat)}${jednostka ? '/' + jednostka : ''})` : ''}`),
    el('span', { class: 'pr-leg pr-leg--zap' }, `— zapłacona${ost.zap !== null ? ` (${zl(ost.zap)}${jednostka ? '/' + jednostka : ''})` : ''}`));
  box.append(legenda);
  return box;
}
