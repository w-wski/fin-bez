// Import wyciągów CSV + uzgadnianie wierszy bankowych z księgą.
import { $, el, zl, api, track, state } from './core.js';

export async function submitImport(e) {
  e.preventDefault();
  const msg = $('#impMsg'); msg.className = 'msg'; msg.textContent = 'Importuję…';
  const fd = new FormData();
  fd.append('file', $('#impFile').files[0]);
  fd.append('ledger_id', $('#impLedger').value);
  if ($('#impBank').value) fd.append('bank', $('#impBank').value);
  try {
    const res = await fetch('/api/v1/imports/csv', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    msg.textContent = `Bank: ${data.bank} — dodane ${data.added}, duplikaty ${data.duplicates}, odrzucone ${data.rejected}`;
    msg.className = 'msg ok';
    track('Import CSV', 'import', { detail: `${data.bank}; +${data.added}/dup${data.duplicates}/err${data.rejected}` });
    loadImports(); loadUnmatched();
  } catch (err) {
    track('Błąd importu', 'import', { detail: String(err.message).slice(0, 80) });
    msg.textContent = 'Błąd importu: ' + err.message; msg.className = 'msg err';
  }
}

export async function loadImports() {
  const { imports } = await api('/api/v1/imports');
  const tb = $('#impTable tbody'); tb.innerHTML = '';
  for (const i of imports) {
    const tr = el('tr');
    tr.append(el('td', {}, (i.imported_at || '').toString().slice(0, 10)), el('td', {}, i.bank_name),
      el('td', {}, i.filename), el('td', { class: 'num' }, String(i.rows_ok)),
      el('td', { class: 'num' }, String(i.rows_dup)), el('td', { class: 'num' }, String(i.rows_err)),
      el('td', {}, i.imported_by));
    tb.append(tr);
  }
}

export async function loadUnmatched() {
  if (state.me.scope.ownOnly) { $('#unmatched').textContent = ''; return; }
  const ledger = $('#impLedger').value || state.me.scope.ledgers[0];
  const { unmatched } = await api('/api/v1/imports/unmatched?ledger=' + ledger);
  $('#unCount').textContent = unmatched.length;
  const box = $('#unmatched'); box.innerHTML = '';
  for (const bt of unmatched.slice(0, 30)) {
    const d = el('div', { class: 'un' });
    d.append(el('span', {}, bt.transaction_date.slice(0, 10)),
      // Znak stoi przy kwocie: barwa nie może być jedynym nośnikiem kierunku przepływu (§5).
      el('b', { class: bt.amount < 0 ? 'exp' : 'inc' }, `${bt.amount < 0 ? '−' : '+'} ${zl(Math.abs(bt.amount))}`),
      el('span', { class: 'grow' }, [bt.counterparty, bt.title].filter(Boolean).join(' — ').slice(0, 90)));
    if (bt.suggestion) d.append(el('span', { class: 'pill', title: `nauczony wzorzec (${bt.suggestion.hits}× potwierdzony)` },
      '→ ' + bt.suggestion.name));
    if (bt.candidates.length) {
      const c = bt.candidates[0];
      const btn = el('button', { class: 'btn small' }, `Połącz z: ${c.tx_date.slice(0, 10)} ${zl(c.amount)} (${c.user_name})`);
      btn.onclick = async () => {
        await api('/api/v1/imports/match', { method: 'POST', body: JSON.stringify({ bank_tx_id: bt.id, transaction_id: c.id }) });
        track('Uzgodnienie match', 'import');
        loadUnmatched();
      };
      d.append(btn);
    }
    const book = el('button', { class: 'btn small primary' }, 'Zaksięguj jako nowy wpis');
    book.onclick = async () => {
      await api('/api/v1/imports/book', { method: 'POST', body: JSON.stringify({ bank_tx_id: bt.id }) });
      track('Uzgodnienie book', 'import');
      loadUnmatched();
    };
    d.append(book);
    box.append(d);
  }
}

export function initImport() {
  $('#impForm').onsubmit = submitImport;
}
