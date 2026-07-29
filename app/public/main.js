// Finansowa — punkt startowy frontendu (bez build stepu; ES modules).
// Ten plik TYLKO spina moduły widoków. Logika widoku należy do js/<widok>.js.
import { $, api, show, track, state, cacheMe, cachedMe, fillLedgerSelects,
         updateNetBadge, syncQueue, flushTelemetry, refreshers, wyloguj,
         otworzArkusz, zamknijArkusz, swiezeLogowanie, imieDoPowitania } from './js/core.js';
import { loadCats, onCatMain } from './js/kategorie.js';
import { initWpis, initKsiegi } from './js/wpis.js';
import { initHistoria, loadHist } from './js/historia.js';
import { initImport, loadImports, loadUnmatched } from './js/import.js';
import { initRaporty, loadReport } from './js/raporty.js';
import { initParagon } from './js/paragon.js';
import { initAdmin } from './js/admin.js';
import { initPrzydzial } from './js/przydzial.js';
import { initProdukty, loadProdukty } from './js/produkty.js';

const OPEN = {
  historia: () => loadHist(true),
  import: () => { loadImports(); loadUnmatched(); },
  raporty: () => loadReport(),
  admin: () => refreshers.admin?.(),
  przydzial: () => refreshers.przydzial?.(),
  produkty: () => loadProdukty(),
  // 'paragon' celowo nie ma wpisu: js/paragon-lista.js sam nasłuchuje kliknięcia w kartę.
  // Wpis tutaj powodowałby drugie, identyczne pobranie listy przy każdym wejściu.
};

// Zakładki są w dwóch miejscach: pasek u dołu (cztery pierwsze) i arkusz „Więcej"
// (Paragon, Przydział, Administracja). Oba niosą data-view, więc wiążemy je jednym
// zapytaniem — arkusz zamyka się sam w show().
function podepnijNawigacje() {
  document.querySelectorAll('[data-view]').forEach((b) => {
    b.onclick = () => { show(b.dataset.view); OPEN[b.dataset.view]?.(); };
  });
  $('#navMore').onclick = otworzArkusz;
  $('#sheetClose').onclick = zamknijArkusz;
  $('#sheetLogout').onclick = () => wyloguj();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') zamknijArkusz(); });
}

async function init() {
  podepnijNawigacje();
  $('#logout').onclick = () => wyloguj();
  initWpis();
  initHistoria();
  initImport();
  initRaporty();
  initAdmin();
  initPrzydzial();
  initProdukty();
  $('#catMain').onchange = onCatMain;
  initParagon();

  // PWA: service worker (offline app shell)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  updateNetBadge();

  try {
    state.me = await api('/api/v1/me');
    cacheMe(state.me);
    $('#who').textContent = `${state.me.name} · ${state.me.role}`;
    $('#logout').hidden = false;
    document.querySelectorAll('[data-view][data-admin]').forEach((b) => { b.hidden = state.me.role !== 'admin'; });
    fillLedgerSelects();
    initKsiegi(state.me.scope.ledgers);
    await loadCats();
    show('wpis');
    // Plansza powitalna: TYLKO po świeżym logowaniu Google i tylko wtedy, gdy znamy
    // imię. Import dynamiczny — kto planszy nie dostaje, nie ściąga nawet kodu.
    // Bez `await`: aplikacja doczytuje się pod zasłoną, a plansza sama ją gasi.
    const imie = imieDoPowitania(state.me);
    if (imie && swiezeLogowanie()) {
      import('./witaj.js').then((w) => w.zagraj(imie)).catch(() => {});
    }
    track('Start aplikacji', 'wpis', { detail: 'online' });
    syncQueue(); // wyślij zaległą kolejkę offline od razu po starcie online
    flushTelemetry();
  } catch (err) {
    // OFFLINE start (np. Bartuś bez internetu): jedziemy na cache — Wpis działa, reszta po sieci
    if (!navigator.onLine || err instanceof TypeError) {
      state.me = cachedMe();
      if (state.me) {
        $('#who').textContent = `${state.me.name} · offline`;
        $('#logout').hidden = false;
        fillLedgerSelects();
        initKsiegi(state.me.scope.ledgers);
        await loadCats(); // spadnie na cache kategorii
        show('wpis');
        track('Start aplikacji', 'wpis', { detail: 'offline-cache', offline: true });
        updateNetBadge();
        return;
      }
    }
    // Zostaje ekran logowania. api() woła show('login') samo tylko przy 401 — przy padniętej
    // sieci (TypeError) nikt tego nie zrobi, a bez tego użytkownik zobaczyłby pustą stronę
    // (ścieżka realna po wylogowaniu się bez internetu: cache tożsamości jest już wyczyszczony).
    show('login');
  }
}
init();
