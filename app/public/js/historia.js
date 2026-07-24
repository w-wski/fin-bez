// Historia: lista wpisów z filtrami, edycja i usuwanie (soft delete).
import { $, el, zl, api, track, refreshers } from './core.js';

let histOffset = 0;

export async function loadHist(reset = true) {
  if (reset) histOffset = 0;
  const p = new URLSearchParams({ limit: 50, offset: histOffset });
  if ($('#fLedger').value) p.set('ledger', $('#fLedger').value);
  if ($('#fFrom').value) p.set('from', $('#fFrom').value);
  if ($('#fTo').value) p.set('to', $('#fTo').value);
  if ($('#fType').value) p.set('type', $('#fType').value);
  const { rows, total } = await api('/api/v1/transactions?' + p);
  const tb = $('#txTable tbody');
  if (reset) tb.innerHTML = '';
  for (const r of rows) {
    const tr = el('tr');
    tr.append(
      el('td', {}, r.tx_date.slice(0, 10)),
      el('td', { class: r.type === 'WYDATEK' ? 'exp' : 'inc' }, r.type === 'WYDATEK' ? '−' : '+'),
      el('td', {}, r.category || '—'),
      el('td', { class: 'num ' + (r.type === 'WYDATEK' ? 'exp' : 'inc') }, zl(r.amount)),
      el('td', {}, r.description || ''),
      el('td', {}, r.user_name));
    const act = el('td');
    const del = el('button', { class: 'btn small', title: 'Usuń' }, '✕');
    del.onclick = async () => {
      if (!confirm('Usunąć ten wpis?')) return;
      await api('/api/v1/transactions/' + r.id, { method: 'DELETE' });
      track('Usunięcie transakcji', 'historia');
      tr.remove();
    };
    act.append(del); tr.append(act); tb.append(tr);
  }
  histOffset += rows.length;
  $('#more').hidden = histOffset >= total;
}

export function initHistoria() {
  $('#fGo').onclick = () => { track('Filtrowanie', 'historia'); loadHist(true); };
  $('#more').onclick = () => loadHist(false);
  refreshers.historia = () => loadHist(true);
}
