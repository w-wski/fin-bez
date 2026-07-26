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
  // WAF hostingu (ModSecurity) odrzuca 400-tką żądania mutujące BEZ treści — tak jak
  // przy „Wyloguj" (07-25) i „Przywróć" z Kosza (07-26). Każdy POST/PATCH/DELETE
  // bez body dostaje jawne, puste '{}' — treść jest, WAF przepuszcza, API ignoruje.
  if (opts.method && opts.method !== 'GET' && opts.body === undefined) opts = { ...opts, body: '{}' };
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { show('login'); throw new Error('auth'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.status), { data });
  return data;
}

// Czas na karcie liczymy WYŁĄCZNIE, gdy aplikacja jest na ekranie. Karta w tle
// (przełączenie na inną aplikację, zablokowany telefon, inna zakładka) nie nabija
// licznika — inaczej „minuty na karcie" mierzyły czas otwartej zakładki, nie użycia.
let widoczneOd = document.visibilityState === 'visible' ? Date.now() : null;
let widoczneMs = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (widoczneOd !== null) { widoczneMs += Date.now() - widoczneOd; widoczneOd = null; }
    // Zejście do tła bywa OSTATNIM momentem życia strony (telefon: schowana aplikacja
    // ginie bez ostrzeżenia) — wysyłamy nabity czas od razu (sendBeacon działa i tutaj)
    // i zerujemy. Bez tego karta odwiedzona raz i schowana nie zostawiała ani minuty.
    if (state.me && widoczneMs >= 1000) {
      track('Zamknięcie karty', state.view, { duration_s: Math.round(widoczneMs / 100) / 10 });
      widoczneMs = 0;
    }
  } else if (widoczneOd === null) widoczneOd = Date.now();
});
function czasNaEkranie() {
  return widoczneMs + (widoczneOd !== null ? Date.now() - widoczneOd : 0);
}
function zerujCzas() {
  widoczneMs = 0;
  if (widoczneOd !== null) widoczneOd = Date.now();
}

// Tytuł widoku niesie nagłówek (nawigacja zeszła na dół, pod kciuk) — nie ma go
// już w treści sekcji, więc jedno miejsce prawdy o tym, „gdzie jestem".
const TYTULY = {
  login: 'Finansowa', wpis: 'Nowy wpis', historia: 'Historia', raporty: 'Raporty',
  import: 'Import z banku', paragon: 'Paragon', przydzial: 'Przydział', admin: 'Administracja',
};
const W_ARKUSZU = ['import', 'przydzial', 'admin'];    // widoki spod zakładki „Więcej"

export function otworzArkusz() {
  const a = document.getElementById('sheet');
  if (!a) return;
  a.hidden = false;
  document.getElementById('navMore')?.setAttribute('aria-expanded', 'true');
  a.querySelector('.sheet-item:not([hidden])')?.focus();
}

export function zamknijArkusz() {
  const a = document.getElementById('sheet');
  if (a) a.hidden = true;
  document.getElementById('navMore')?.setAttribute('aria-expanded', 'false');
}

export function show(view) {
  // telemetria czasu na karcie (odpowiednik LOGI ze starej aplikacji, ale poza księgą)
  if (state.me && state.view !== view) {
    const dur = czasNaEkranie() / 1000;
    track('Zamknięcie karty', state.view, { duration_s: Math.round(dur * 10) / 10 });
    track('Otwarcie karty', view);
    state.openedAt = Date.now();
    zerujCzas();
  }
  state.view = view;
  // Wnętrze stoi na tafli, logowanie na „papierze" — styles.css rozróżnia je po tym atrybucie.
  document.body.dataset.view = view;
  const tytul = document.getElementById('viewTitle');
  if (tytul) tytul.textContent = TYTULY[view] || 'Finansowa';
  document.querySelectorAll('main > section').forEach((s) => { s.hidden = s.id !== `view-${view}`; });
  // Zaczepy [data-view] są w dwóch miejscach: pasek zakładek i arkusz „Więcej".
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('navMore')?.classList.toggle('active', W_ARKUSZU.includes(view));
  zamknijArkusz();
  $('#nav').hidden = view === 'login';
  // Na ekranie logowania nie ma z czego się wylogowywać — inaczej przycisk zostaje po wygaśnięciu sesji.
  const wyl = document.getElementById('logout');
  if (wyl) wyl.hidden = view === 'login';
}

export const KSIEGI = { 1: 'RODZINA', 2: 'PERSEVERA' };

// Segment ksiąg we Wpisie buduje js/wpis.js (initKsiegi) — tam mieszka jego zachowanie.
export function fillLedgerSelects() {
  const ids = state.me.scope.ledgers;
  const opts = ids.map((id) => `<option value="${id}">${KSIEGI[id] || 'Księga ' + id}</option>`).join('');
  ['#fLedger', '#impLedger', '#rLedger'].forEach((sel) => { const n = $(sel); if (n) n.innerHTML = opts; });
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

// ---------- WYLOGOWANIE ----------
// Dwa scenariusze: (a) chcę wejść jako ktoś inny, (b) siedzę na cudzym telefonie i chcę po sobie
// posprzątać. W obu wypadkach nie wystarczy skasować ciasteczka: na urządzeniu zostaje cache
// tożsamości i kategorii, a w localStorage może wisieć kolejka wpisów dodanych offline.
//
// Kolejka jest tu najważniejsza i dlatego NIE kasujemy jej po cichu. Gdyby została, po
// zalogowaniu następnej osoby wysłałaby się jako JEJ wpisy (serwer bierze użytkownika z sesji) —
// czyli cudze pieniądze w cudzej historii. Gdyby zniknęła bez słowa, przepadłyby wpisy, których
// nikt jeszcze nie widział w księdze. Więc: mówimy wprost i pytamy.
// Polska liczba mnoga: 1 wpis · 2-4 wpisy · 5+ wpisów, z wyjątkiem 12-14 („12 wpisów").
export function odmien(n, jeden, kilka, wiele) {
  const d = n % 10, s = n % 100;
  if (n === 1) return jeden;
  if (d >= 2 && d <= 4 && !(s >= 12 && s <= 14)) return kilka;
  return wiele;
}

export async function wyloguj() {
  const n = getQueue().length;
  if (n) {
    const co = odmien(n, 'wpis', 'wpisy', 'wpisów');
    const dodane = odmien(n, 'dodany', 'dodane', 'dodanych');
    const wyslane = odmien(n, 'wysłany', 'wysłane', 'wysłanych');
    const pytanie = `Masz ${n} ${co} ${dodane} bez internetu i jeszcze nie ${wyslane}.\n\n`
      + 'Najlepiej połącz się z internetem i poczekaj, aż kolejka się opróżni (odznaka w nagłówku '
      + 'zniknie), a potem się wyloguj.\n\n'
      + `Wylogować teraz i PORZUCIĆ ${odmien(n, 'ten wpis', 'te wpisy', 'te wpisy')}? Nie da się ${odmien(n, 'go', 'ich', 'ich')} odzyskać.`;
    if (!confirm(pytanie)) return false;
  }
  track('Wylogowanie', state.view, { detail: n ? `porzucona kolejka: ${n}` : 'kolejka pusta' });
  await flushTelemetry();                        // póki sesja żyje — inaczej zdarzenia przepadną
  try {
    // Jawny Content-Type i puste ciało JSON: POST bez ciała i bez typu bywa ucinany
    // przez WAF hostingu (ModSecurity/LiteSpeed) błędem 400, zanim dotrze do aplikacji.
    let res = await fetch('/auth/logout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    // Zapasowe wyjście: gdy WAF mimo to utnie POST, ta sama trasa istnieje jako GET
    // (app.js) — GET-a filtry przepuszczają. Service worker nie cachuje ścieżek /auth/.
    if (!res.ok) res = await fetch('/auth/logout?fallback=1');
    // Serwer odpowiedział, ale sesji nie zakończył (np. stary proces bez tej trasy — 404).
    // Czyszczenie urządzenia i przeładowanie NIC by nie dało: ciasteczko httpOnly zostaje
    // i strona zalogowałaby się z powrotem, udając, że przycisk nie działa. Mówimy wprost.
    if (!res.ok) {
      toast(`Serwer nie zakończył sesji (błąd ${res.status}). Spróbuj za chwilę — jeśli to się powtarza, aplikacja na serwerze wymaga restartu.`);
      return false;
    }
  } catch { /* brak sieci: ciasteczko zostaje po stronie serwera, ale urządzenie czyścimy tak samo */ }
  // Czyścimy WSZYSTKO nasze: tożsamość, kategorie per księga, telemetrię i kolejkę.
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('f_')) localStorage.removeItem(k);
  } catch { /* prywatny tryb przeglądarki — nie ma czego czyścić */ }
  // Przeładowanie zeruje stan wszystkich modułów naraz (kategorie, historia, paragony).
  // Bez sesji `/api/v1/me` odpowie 401, więc aplikacja pokaże ekran logowania.
  location.reload();
  return true;
}
