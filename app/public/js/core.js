// Rdzeń frontendu: pomocniki DOM, wywołania API, przełączanie widoków, telemetria,
// kolejka offline. Moduły widoków (historia/kategorie/wpis/import/raporty/paragon)
// importują stąd i NIE duplikują tych funkcji.

export const $ = (s) => document.querySelector(s);

export const el = (tag, attrs = {}, text) => {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  if (text !== undefined) n.textContent = text;
  return n;
};

export const zl = (v) => (Number(v) || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';

// Wspólny stan (obiekt, nie zmienne — moduły trzymają referencję).
export const state = { me: null, view: 'wpis', openedAt: Date.now() };

// Moduły widoków rejestrują tu swoje funkcje odświeżania: refreshers.historia = loadHist
export const refreshers = {};

export const CATS_CACHE_KEY = 'f_cats';
const QUEUE_KEY = 'f_queue';
const ME_CACHE_KEY = 'f_me';
export const QUEUE_LIMIT = 999;

export const getQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; } };
export const setQueue = (q) => { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); updateNetBadge(); };

export function updateNetBadge() {
  const n = getQueue().length;
  const badge = document.getElementById('netBadge');
  if (!badge) return;
  if (!navigator.onLine) { badge.hidden = false; badge.textContent = n ? `⚡ offline · w kolejce: ${n}` : '⚡ offline'; badge.className = 'pill net off'; }
  else if (n) { badge.hidden = false; badge.textContent = `⇅ wysyłam: ${n}`; badge.className = 'pill net'; }
  else badge.hidden = true;
}

let syncing = false;
export async function syncQueue() {
  if (syncing || !navigator.onLine) return;
  const q = getQueue();
  if (!q.length) return;
  syncing = true;
  try {
    while (getQueue().length) {
      const item = getQueue()[0];
      const res = await fetch('/api/v1/transactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item),
      });
      if (res.status === 401) break;                     // sesja wygasła — kolejka czeka na login
      if (!res.ok && res.status !== 409) {
        if (res.status >= 500) break;                    // serwer leży — spróbujemy później
        // 4xx = wpis nie do przyjęcia; odłóż na koniec z flagą błędu, nie blokuj reszty
        const rest = getQueue().slice(1);
        rest.push({ ...item, _error: res.status });
        setQueue(rest);
        if (rest.every((x) => x._error)) break;          // same błędne — stop, nie kręć się w kółko
        continue;
      }
      setQueue(getQueue().slice(1));                     // sukces (lub duplikat) — zdejmij z kolejki
    }
  } catch { /* sieć padła w trakcie — dokończymy przy następnym online */ }
  syncing = false;
  updateNetBadge();
  if (q.length !== getQueue().length) track('Sync kolejki offline', state.view, { detail: `wysłano=${q.length - getQueue().length}; zostało=${getQueue().length}` });
  if (!getQueue().length && state.me) {                  // wszystko wysłane — odśwież widoki
    refreshers[state.view]?.();
  }
}
window.addEventListener('online', () => { updateNetBadge(); syncQueue(); });
window.addEventListener('offline', updateNetBadge);

// ---------- TELEMETRIA (następca LOGI z prototypu; nie blokuje UI, offline -> kolejka) ----------
const TQUEUE_KEY = 'f_tqueue';
export function track(action, view, extra = {}) {
  const ev = { view: view || state.view, action, ts: new Date().toISOString(),
    offline: !navigator.onLine, ...extra };
  if (!navigator.onLine) {
    try {
      const tq = JSON.parse(localStorage.getItem(TQUEUE_KEY) || '[]');
      tq.push(ev); if (tq.length > 500) tq.shift();
      localStorage.setItem(TQUEUE_KEY, JSON.stringify(tq));
    } catch { /* telemetria nigdy nie przeszkadza */ }
    return;
  }
  try {
    navigator.sendBeacon?.('/api/v1/telemetry', new Blob([JSON.stringify(ev)], { type: 'application/json' }));
  } catch { /* jw. */ }
}

export async function flushTelemetry() {
  if (!navigator.onLine) return;
  let tq = [];
  try { tq = JSON.parse(localStorage.getItem(TQUEUE_KEY) || '[]'); } catch { /* uszkodzona kolejka = brak zdarzeń do wysłania */ }
  if (!tq.length) return;
  try {
    const res = await fetch('/api/v1/telemetry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: tq }),
    });
    if (res.ok) localStorage.removeItem(TQUEUE_KEY);
  } catch { /* następnym razem */ }
}
window.addEventListener('online', flushTelemetry);

export async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { show('login'); throw new Error('auth'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.status), { data });
  return data;
}

export function show(view) {
  // telemetria czasu na karcie (odpowiednik LOGI ze starej aplikacji, ale poza księgą)
  if (state.me && state.view !== view) {
    const dur = (Date.now() - state.openedAt) / 1000;
    track('Zamknięcie karty', state.view, { duration_s: Math.round(dur * 10) / 10 });
    track('Otwarcie karty', view);
    state.openedAt = Date.now();
  }
  state.view = view;
  document.querySelectorAll('main > section').forEach((s) => { s.hidden = s.id !== `view-${view}`; });
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#nav').hidden = view === 'login';
}

export function fillLedgerSelects() {
  const opts = state.me.scope.ledgers.map((id) =>
    `<option value="${id}">${id === 1 ? 'RODZINA' : 'PERSEVERA'}</option>`).join('');
  ['#ledger', '#fLedger', '#impLedger', '#rLedger'].forEach((sel) => { const n = $(sel); if (n) n.innerHTML = opts; });
}

export function cacheMe(me) { try { localStorage.setItem(ME_CACHE_KEY, JSON.stringify(me)); } catch { } }
export function cachedMe() { try { return JSON.parse(localStorage.getItem(ME_CACHE_KEY)); } catch { return null; } }

// Krótki komunikat u dołu ekranu, opcjonalnie z akcją (np. „Cofnij").
// Jeden toast naraz — kolejny zastępuje poprzedni.
let toastTimer = null;
export function toast(text, action) {
  let box = document.getElementById('toast');
  if (!box) { box = el('div', { id: 'toast', class: 'toast', role: 'status' }); document.body.append(box); }
  box.innerHTML = '';
  box.append(el('span', {}, text));
  if (action) {
    const b = el('button', { class: 'btn small' }, action.label);
    b.onclick = () => { box.hidden = true; action.onClick(); };
    box.append(b);
  }
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, action ? 12000 : 4000);
}
