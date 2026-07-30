// Wpis: rdzeń aplikacji — transakcja w ≤3 kliknięcia, działa offline (kolejka localStorage).
import { $, el, zl, api, track, getQueue, setQueue, QUEUE_LIMIT, KSIEGI } from './core.js';
import { loadCats, onCatMain, getCats } from './kategorie.js';
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
  // TRANSFER nie jest płatnością (segment ukryty) — pole pomijamy, serwer i tak zapisze
  // domyślną ELEKTRONICZNA, tak samo jak przy każdym innym ręcznym wpisie bez wyboru.
  const segPay = $('#segPayment');
  if (segPay && !segPay.hidden) body.payment_method = segPay.querySelector('.active')?.dataset.payment;
  // Segment płatności MUSI wrócić do domyślnej: bez resetu jedno kliknięcie „Gotówka" zostaje
  // aktywne wizualnie i zaraża wszystkie kolejne wpisy tej sesji, choć użytkownik o tym nie wie.
  const resetSegPlatnosci = () => {
    const s = $('#segPayment'); if (!s) return;
    s.querySelector('.active')?.classList.remove('active');
    s.querySelector('[data-payment="ELEKTRONICZNA"]')?.classList.add('active');
  };
  const clearForm = () => {
    $('#amount').value = ''; $('#desc').value = ''; odswiezLicznik(); resetSegPlatnosci(); $('#amount').focus();
  };
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

// Księga we Wpisie to segment, nie lista: dwie pozycje, jeden ruch kciuka, wybór widoczny
// bez rozwijania. Wartość trzyma ukryte #ledger (kontrakt z js/wpis.js i js/kategorie.js),
// a klik wysyła `change` — dokładnie to samo zdarzenie, które wysyłała lista wyboru.
export function initKsiegi(ids) {
  const box = $('#ledgerSeg'), pole = $('#ledger');
  if (!box || !pole) return;
  box.innerHTML = '';
  for (const id of ids) {
    const b = el('button', { type: 'button', 'data-ledger': String(id) }, KSIEGI[id] || `Księga ${id}`);
    b.classList.toggle('active', String(id) === String(ids[0]));
    b.onclick = () => {
      box.querySelector('.active')?.classList.remove('active');
      b.classList.add('active');
      pole.value = String(id);
      pole.dispatchEvent(new Event('change'));
    };
    box.append(b);
  }
  pole.value = String(ids[0]);
  box.className = `seg seg-${Math.min(ids.length, 3)}`;
  box.hidden = ids.length < 2;             // jedna księga w zasięgu — segment nic nie wnosi
  renderSkroty();                          // initKsiegi biegnie DOPIERO po zalogowaniu (main.js)
}

// Opis bywa długi (0–120 znaków, §7 briefu) — licznik siedzi w linii etykiety,
// więc nie zabiera wiersza i mówi, ile jeszcze zostało.
const odswiezLicznik = () => {
  const opis = $('#desc'), licz = $('#descCount');
  if (opis && licz) licz.textContent = `${opis.value.length}/120`;
};

// TRANSFER to przesunięcie własnych pieniędzy, nie konsumpcja. Mówimy to w miejscu
// wyboru, a nie w atrybucie title, którego na telefonie nikt nie zobaczy.
const notaTransferu = (typ) => { const n = $('#transferNote'); if (n) n.hidden = typ !== 'TRANSFER'; };

// Forma płatności nie ma sensu przy TRANSFER (przesunięcie między własnymi kontami, nie
// zapłata za nic) — segment znika, dokładnie jak transferNote wyżej.
const odswiezSegPlatnosci = (typ) => { const s = $('#segPayment'); if (s) s.hidden = typ === 'TRANSFER'; };

// Bez sieci przycisk nie może obiecywać zapisu, którego nie będzie — wpis idzie do kolejki.
export function odswiezPrzyciskZapisu() {
  const b = $('#txSave');
  if (!b) return;
  const off = !navigator.onLine;
  b.textContent = off ? 'Zapiszę po powrocie sieci' : 'Zapisz wpis';
  b.classList.toggle('offline', off);
}
window.addEventListener('online', odswiezPrzyciskZapisu);
window.addEventListener('offline', odswiezPrzyciskZapisu);

// Z22: rząd max 5 przycisków „kategoria · kwota" nad formularzem — najczęstsza czynność
// (ostatnie 90 dni żywych wydatków) ma kosztować jedno kliknięcie zamiast wypełniania od zera.
// Klik TYLKO wypełnia — zatwierdza i tak człowiek (zakaz auto-zapisu z brief-u).
async function renderSkroty() {
  const form = $('#txForm');
  if (!form) return;
  $('#skrotyWpis')?.remove();                // odświeżenie nie ma duplikować rzędu
  if (!navigator.onLine) return;              // offline nie ma z czego liczyć — cisza, nie błąd
  let dane;
  try { dane = await api('/api/v1/transactions/skroty'); } catch { return; }
  const wiersze = (dane.rows || []).filter((r) => r.category_id);
  if (!wiersze.length) return;                // K3: brak historii = brak sekcji, nie pusta ramka
  const box = el('div', { class: 'skroty-wpis', id: 'skrotyWpis' });
  for (const w of wiersze) {
    const b = el('button', { type: 'button', class: 'chip' }, `${w.category_name || '—'} · ${zl(w.kwota)}`);
    b.onclick = () => wypelnijZeSkrotu(w);
    box.append(b);
  }
  form.parentNode.insertBefore(box, form);
}

function wypelnijZeSkrotu(w) {
  $('#segType .active')?.classList.remove('active');
  $('#segType [data-type="WYDATEK"]')?.classList.add('active');
  notaTransferu('WYDATEK'); odswiezSegPlatnosci('WYDATEK');
  $('#amount').value = String(w.kwota).replace('.', ',');
  const cats = getCats();
  const main = cats.find((c) => c.id === w.category_id);
  if (main) { $('#catMain').value = String(w.category_id); onCatMain(); } else {
    const rodzic = cats.find((c) => (c.children || []).some((k) => k.id === w.category_id));
    if (rodzic) { $('#catMain').value = String(rodzic.id); onCatMain(); $('#catSub').value = String(w.category_id); }
  }
  track('Skrót Wpisu', 'wpis', { detail: `kategoria=${w.category_id}` });
  $('#amount').focus();
}

export function initWpis() {
  $('#txDate').value = new Date().toISOString().slice(0, 10);
  $('#segType').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      $('#segType .active').classList.remove('active');
      b.classList.add('active');
      notaTransferu(b.dataset.type);
      odswiezSegPlatnosci(b.dataset.type);
    };
  });
  $('#segPayment')?.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      $('#segPayment .active').classList.remove('active');
      b.classList.add('active');
    };
  });
  $('#txForm').onsubmit = submitTx;
  $('#ledger').onchange = loadCats;
  $('#desc').addEventListener('input', odswiezLicznik);
  odswiezLicznik();
  odswiezPrzyciskZapisu();
}
