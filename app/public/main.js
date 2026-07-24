// Finansowa — punkt startowy frontendu (bez build stepu; ES modules).
// Ten plik TYLKO spina moduły widoków. Logika widoku należy do js/<widok>.js.
import { $, api, show, track, state, cacheMe, cachedMe, fillLedgerSelects,
         updateNetBadge, syncQueue, flushTelemetry, refreshers } from './js/core.js';
import { loadCats, onCatMain } from './js/kategorie.js';
import { initWpis } from './js/wpis.js';
import { initHistoria, loadHist } from './js/historia.js';
import { initImport, loadImports, loadUnmatched } from './js/import.js';
import { initRaporty, loadReport } from './js/raporty.js';
import { initParagon } from './js/paragon.js';
import { initAdmin } from './js/admin.js';

const OPEN = {
  historia: () => loadHist(true),
  import: () => { loadImports(); loadUnmatched(); },
  raporty: () => loadReport(),
  admin: () => refreshers.admin?.(),
  // 'paragon' celowo nie ma wpisu: js/paragon-lista.js sam nasłuchuje kliknięcia w kartę.
  // Wpis tutaj powodowałby drugie, identyczne pobranie listy przy każdym wejściu.
};

async function init() {
  document.querySelectorAll('nav button').forEach((b) => {
    b.onclick = () => { show(b.dataset.view); OPEN[b.dataset.view]?.(); };
  });
  initWpis();
  initHistoria();
  initImport();
  initRaporty();
  initAdmin();
  $('#catMain').onchange = onCatMain;
  initParagon();

  // PWA: service worker (offline app shell)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  updateNetBadge();

  try {
    state.me = await api('/api/v1/me');
    cacheMe(state.me);
    $('#who').textContent = `${state.me.name} (${state.me.role})`;
    document.querySelectorAll('nav button[data-admin]').forEach((b) => { b.hidden = state.me.role !== 'admin'; });
    fillLedgerSelects();
    await loadCats();
    show('wpis');
    track('Start aplikacji', 'wpis', { detail: 'online' });
    syncQueue(); // wyślij zaległą kolejkę offline od razu po starcie online
    flushTelemetry();
  } catch (err) {
    // OFFLINE start (np. Bartuś bez internetu): jedziemy na cache — Wpis działa, reszta po sieci
    if (!navigator.onLine || err instanceof TypeError) {
      state.me = cachedMe();
      if (state.me) {
        $('#who').textContent = `${state.me.name} (offline)`;
        fillLedgerSelects();
        await loadCats(); // spadnie na cache kategorii
        show('wpis');
        track('Start aplikacji', 'wpis', { detail: 'offline-cache', offline: true });
        updateNetBadge();
        return;
      }
    }
    /* w innych przypadkach show('login') już wywołane przez api() */
  }
}
init();
