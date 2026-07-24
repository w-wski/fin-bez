// Raporty: KPI miesiąca, wydatki wg kategorii, trend 6 miesięcy, widoki admina.
import { $, el, zl, api, state, refreshers } from './core.js';

export async function loadReport() {
  const ledger = $('#rLedger').value || state.me.scope.ledgers[0];
  const month = $('#rMonth').value || new Date().toISOString().slice(0, 7);
  const s = await api(`/api/v1/summary?ledger=${ledger}&month=${month}`);
  $('#kpi').innerHTML = '';
  const tiles = [
    ['Przychody', zl(s.income)], ['Wydatki', zl(s.expenses)],
    ['Bilans', zl(s.balance)], ['Wpisy', String(s.tx_count)],
  ];
  if (s.unmatched_bank_rows !== null) tiles.push(['Bankowe do uzgodnienia', String(s.unmatched_bank_rows)]);
  for (const [label, val] of tiles) {
    const t = el('div', { class: 'tile' });
    t.append(el('b', {}, val), el('span', {}, label));
    $('#kpi').append(t);
  }
  const max = Math.max(...s.by_category.map((c) => Number(c.total)), 1);
  const box = $('#byCat'); box.innerHTML = '';
  for (const c of s.by_category) {
    const r = el('div', { class: 'barrow' });
    const bar = el('div', { class: 'bar' });
    bar.style.width = (100 * Number(c.total) / max).toFixed(1) + '%';
    r.append(el('span', {}, c.category), bar, el('span', { class: 'val' }, zl(c.total)));
    box.append(r);
  }
  const months = [...new Set(s.trend.map((t) => t.month))];
  const tb = $('#trend tbody'); tb.innerHTML = '';
  for (const m of months) {
    const inc = Number(s.trend.find((t) => t.month === m && t.type === 'PRZYCHÓD')?.total || 0);
    const exp = Number(s.trend.find((t) => t.month === m && t.type === 'WYDATEK')?.total || 0);
    const tr = el('tr');
    tr.append(el('td', {}, m), el('td', { class: 'num inc' }, zl(inc)),
      el('td', { class: 'num exp' }, zl(exp)), el('td', { class: 'num' }, zl(inc - exp)));
    tb.append(tr);
  }
  // admin: rodzina vs spółka + telemetria
  if (state.me.role === 'admin') {
    const { rows } = await api('/api/v1/reports/family-vs-persevera?month=' + month);
    const f = $('#fvp'); f.innerHTML = '<h2>Rodzina vs PERSEVERA</h2>';
    const t = el('table');
    t.innerHTML = '<thead><tr><th>Księga</th><th>Typ</th><th class="num">Suma</th><th class="num">Wpisy</th></tr></thead>';
    const tb2 = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      tr.append(el('td', {}, r.ledger), el('td', {}, r.type),
        el('td', { class: 'num' }, zl(r.total)), el('td', { class: 'num' }, String(r.n)));
      tb2.append(tr);
    }
    t.append(tb2); f.append(t);
    loadTelemetry();
  } else $('#telemetria').innerHTML = '';
}

async function loadTelemetry() {
  const box = $('#telemetria');
  try {
    const t = await api('/api/v1/reports/telemetry?days=30');
    box.innerHTML = '';
    const mk = (headers, rows) => {
      const tb = el('table');
      tb.innerHTML = '<thead><tr>' + headers.map((h, i) =>
        `<th${i > 0 && typeof rows[0]?.[i] === 'number' ? ' class="num"' : ''}>${h}</th>`).join('') + '</tr></thead>';
      const body = el('tbody');
      for (const r of rows) {
        const tr = el('tr');
        r.forEach((v) => tr.append(el('td', { class: typeof v === 'number' ? 'num' : '' },
          typeof v === 'number' ? String(v) : (v ?? '—'))));
        body.append(tr);
      }
      tb.append(body); return tb;
    };
    box.append(el('h2', {}, 'Czas na kartach [min] wg osoby'));
    box.append(mk(['Karta', 'Kto', 'Minuty', 'Zdarzenia'],
      t.by_view.map((r) => [r.view_name, r.user_name, Number(r.minutes), Number(r.events)])));
    box.append(el('h2', {}, 'Akcje (w tym offline)'));
    box.append(mk(['Akcja', 'Kto', 'Razem', 'Offline'],
      t.by_action.map((r) => [r.action, r.user_name, Number(r.n), Number(r.offline_n) || 0])));
  } catch { box.innerHTML = ''; }
}

export function initRaporty() {
  $('#rMonth').value = new Date().toISOString().slice(0, 7);
  $('#rLedger').onchange = loadReport;
  $('#rMonth').onchange = loadReport;
  refreshers.raporty = loadReport;
}
