/* theme.js — przełącznik motywu w trzech stanach: JASNY / CIEMNY / AUTO.
 *
 * AUTO działa wg PORY DNIA (polecenie Szymona), nie wg ustawienia systemu:
 * 07:00–18:59 → jasny, 19:00–06:59 → ciemny, czas lokalny urządzenia.
 * Gdy aplikacja jest otwarta przez granicę godziny, motyw przełącza się sam —
 * przez jeden `setTimeout` do najbliższej pełnej godziny, bez pollingu.
 *
 * Pierwsze ustawienie robi skrypt inline w <head> (przed pierwszym malowaniem, zero FOUC).
 * Ten plik dokłada kontrolkę i reakcję na zmiany. Spec: docs/design/DESIGN-SPEC-GLASS.md §3.
 */

const KEY = 'fin-theme';
const MODES = ['light', 'dark', 'auto'];
const LABEL = { light: 'Jasny', dark: 'Ciemny', auto: 'Auto' };
const DAY_FROM = 7;   // włącznie — od 07:00 jasny
const DAY_TO = 19;    // wyłącznie — od 19:00 ciemny

let hourTimer = 0;

export function daylightTheme(now = new Date()) {
  const h = now.getHours();
  return h >= DAY_FROM && h < DAY_TO ? 'light' : 'dark';
}

export function readMode() {
  try {
    const v = localStorage.getItem(KEY);
    return MODES.includes(v) ? v : 'auto';
  } catch { return 'auto'; }
}

function resolve(mode) { return mode === 'auto' ? daylightTheme() : mode; }

/** Przy AUTO: jedno przebudzenie na najbliższą pełną godzinę, potem przeliczenie. */
function scheduleHourFlip(mode) {
  clearTimeout(hourTimer);
  if (mode !== 'auto') return;
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(now.getHours() + 1);
  hourTimer = setTimeout(() => {
    const m = readMode();
    if (m === 'auto') {
      document.documentElement.dataset.theme = daylightTheme();
      sync();
    }
    scheduleHourFlip(m);
  }, Math.max(1000, next - now));
}

export function applyMode(mode, announce = false) {
  const m = MODES.includes(mode) ? mode : 'auto';
  try { localStorage.setItem(KEY, m); } catch { /* tryb prywatny — zostaje na tę sesję */ }
  const root = document.documentElement;
  root.dataset.themeMode = m;
  root.dataset.theme = resolve(m);
  scheduleHourFlip(m);
  sync(announce);
}

/** Pełny opis stanu — dla czytnika ekranu i dla ulotnej etykiety po kliknięciu. */
function describe(mode) {
  return mode === 'auto' ? `Auto — teraz ${LABEL[daylightTheme()].toLowerCase()}` : LABEL[mode];
}

const hideTimers = new WeakMap();

function sync(announce = false) {
  const mode = document.documentElement.dataset.themeMode || 'auto';
  document.querySelectorAll('.theme-switch').forEach((group) => {
    const dot = group.querySelector('.theme-dot');
    if (dot) dot.setAttribute('aria-label', `Motyw: ${describe(mode).toLowerCase()}. Kliknij, aby zmienić.`);
    const hint = group.querySelector('.theme-switch__now');
    if (!hint) return;
    hint.textContent = describe(mode);
    if (!announce) return;
    // Etykieta pokazuje się tylko na chwilę po kliknięciu — to nie jest funkcja do eksponowania.
    group.classList.add('is-showing');
    clearTimeout(hideTimers.get(group));
    hideTimers.set(group, setTimeout(() => group.classList.remove('is-showing'), 1900));
  });
}

/** Jeden guzik-kropka, cyklicznie: jasny → ciemny → auto → jasny. */
function buildSwitch(group) {
  group.removeAttribute('role');
  group.innerHTML =
    '<button class="theme-dot" type="button"><span class="theme-dot__i" aria-hidden="true"></span></button>' +
    '<span class="theme-switch__now" role="status" aria-live="polite"></span>';

  group.querySelector('.theme-dot').addEventListener('click', (e) => {
    e.stopPropagation();
    applyMode(MODES[(MODES.indexOf(readMode()) + 1) % MODES.length], true);
  });
}

function boot() {
  document.querySelectorAll('.theme-switch').forEach(buildSwitch);
  applyMode(readMode());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
