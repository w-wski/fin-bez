// Wpis: rdzeń aplikacji — transakcja w ≤3 kliknięcia, działa offline (kolejka localStorage).
import { $, zl, api, track, getQueue, setQueue, QUEUE_LIMIT } from './core.js';
import { loadCats } from './kategorie.js';
import { parseKwota } from './kwota.js';

export async function submitTx(e) {
  e.preventDefault();
  const msg = $('#txMsg'); msg.className = 'msg';
  const type = $('#segType .active').dataset.type;
  const catSub = $('#catSub').value, catMain = $('#catMain').value;
  // Kwotę parsujemy TU, przed kolejką offline: wpis z niejednoznaczną kwotą („12,345")
  // odrzucamy od razu, zamiast trzymać go w kolejce do odrzucenia przez serwer za tydzień.
  const kwota = parseKwota($('#amount').value);
  if (kwota === null || kwota <= 0) {
    msg.textContent = 'Nie umiem odczytać kwoty. Wpisz np. 12,50 albo 1 234,56.';
    msg.className = 'msg err';
    return;
  }
  const body = {
    ledger_id: $('#ledger').value, tx_date: $('#txDate').value, type,
    amount: kwota, description: $('#desc').value,
    category_id: catSub || catMain || null,
    // idempotencja: unikalny znacznik klienta — serwer nie zdubluje wpisu przy ponownej wysyłce
    client_ref: 'off:' + Date.now() + '-' + Math.random().toString(36).slice(2, 9),
  };
  const clearForm = () => { $('#amount').value = ''; $('#desc').value = ''; $('#amount').focus(); };
  const queueIt = () => {
    const q = getQueue();
    if (q.length >= QUEUE_LIMIT) { msg.textContent = `Kolejka offline pełna (${QUEUE_LIMIT}) — połącz się z internetem.`; msg.className = 'msg err'; return; }
    q.push(body); setQueue(q);
    track('Dodanie transakcji', 'wpis', { detail: `${type} offline; kolejka=${q.length}`, offline: true });
    msg.textContent = `Zapisano OFFLINE (w kolejce: ${q.length}) — wyśle się po połączeniu.`;
    msg.className = 'msg ok';
    clearForm();
  };
  if (!navigator.onLine) return queueIt();
  try {
    await api('/api/v1/transactions', { method: 'POST', body: JSON.stringify(body) });
    msg.textContent = `Zapisano: ${type.toLowerCase()} ${zl(kwota)}`;
    msg.className = 'msg ok';
    track('Dodanie transakcji', 'wpis', { detail: type });
    clearForm();
  } catch (err) {
    if (err.message === 'auth') return;                  // przekierowano na login
    if (err instanceof TypeError || !navigator.onLine) return queueIt(); // sieć padła w locie
    track('Błąd zapisu', 'wpis', { detail: String(err.data?.error || err.message).slice(0, 80) });
    msg.textContent = 'Błąd zapisu: ' + (err.data?.error || err.message);
    msg.className = 'msg err';
  }
}

export function initWpis() {
  $('#txDate').value = new Date().toISOString().slice(0, 10);
  $('#segType').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      $('#segType .active').classList.remove('active');
      b.classList.add('active');
    };
  });
  $('#txForm').onsubmit = submitTx;
  $('#ledger').onchange = loadCats;
}
