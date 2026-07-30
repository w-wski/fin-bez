// Układ kafli/widgetów raportu (Z9): kolejność i widoczność sekcji raportu, zapisane per
// użytkownik w bazie (GET/PUT /api/v1/uklad — src/routes/uklad.js). Moduł jest CZYSTO
// prezentacyjny — nie zna API; wołanie zapisu dostaje jako callback (`onZapisz`), żeby dało
// się testować `uporzadkuj` bez DOM-u i bez sieci (scripts/test-uklad.js).
//
// Moduł CELOWO nic nie importuje z core.js (ten dotyka `window` na starcie) — dzięki temu
// `uporzadkuj` da się wywołać w gołym Node-ie (scripts/test-uklad.js), tak jak paleta.js.
// Elementy paska budujemy przez document.createElement, nie przez `el()` z core.js.
function bud(tag, attrs = {}, text) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  if (text !== undefined) n.textContent = text;
  return n;
}

// Czysta funkcja: z listy dostępnych kafli (`data-kafel` obecne w DOM-ie) i zapisanego
// layoutu wylicza KOLEJNOŚĆ i ZNACZNIK UKRYCIA każdego z nich — bez dotykania DOM-u, więc
// da się to przetestować bez przeglądarki. Kafle spoza `layout.kolejnosc` (np. nowy widget
// dołożony po tym, jak Szymon ułożył swój układ) lądują NA KOŃCU, w kolejności z DOM-u —
// żeby nowy widget się nie zgubił, tylko doszedł na dół listy do ewentualnego poukładania.
export function uporzadkuj(idsDostepne, layout) {
  const kolejnosc = layout && Array.isArray(layout.kolejnosc) ? layout.kolejnosc : [];
  const ukryte = new Set(layout && Array.isArray(layout.ukryte) ? layout.ukryte : []);
  const znane = new Set(idsDostepne);
  const wynik = kolejnosc.filter((id) => znane.has(id));
  for (const id of idsDostepne) if (!wynik.includes(id)) wynik.push(id);
  return wynik.map((id) => ({ id, ukryty: ukryte.has(id) }));
}

// Przestawia i chowa kafle w `box` (kontener bezpośrednich dzieci z atrybutem [data-kafel])
// wg `layout` z bazy. `layout === null` (nikt jeszcze nie zapisał własnego układu) — nic
// nie ruszamy, zostaje kolejność z HTML-a/orkiestratora.
export function zastosujUklad(box, layout) {
  if (!box || !layout) return;
  const kafle = [...box.querySelectorAll(':scope > [data-kafel]')];
  const byId = new Map(kafle.map((n) => [n.dataset.kafel, n]));
  const plan = uporzadkuj(kafle.map((n) => n.dataset.kafel), layout);
  for (const { id, ukryty } of plan) {
    const n = byId.get(id);
    if (!n) continue;
    n.hidden = ukryty;
    box.append(n); // węzeł już jest w DOM-ie — append tylko przenosi go na koniec w kolejności planu
  }
}

// Tryb ręcznego układania: strzałki góra/dół per kafel (bez drag&drop — na dotyku, zwłaszcza
// jedną ręką na iPhonie, strzałki trafiają się pewniej i są dostępne dla czytnika ekranu) +
// przełącznik widoczności. Zwraca { wlacz, wylacz } do podpięcia pod przyciski „Ułóż"/„Gotowe".
export function trybUkladania(box, onZapisz) {
  let aktywny = false;

  function przesun(id, kierunek) {
    const w = [...box.querySelectorAll(':scope > [data-kafel]')];
    const i = w.findIndex((n) => n.dataset.kafel === id);
    const j = i + kierunek;
    if (i < 0 || j < 0 || j >= w.length) return;
    if (kierunek < 0) box.insertBefore(w[i], w[j]);
    else box.insertBefore(w[j], w[i]);
  }

  function pasek(n) {
    const p = bud('div', { class: 'kafel-pasek' });
    const gora = bud('button', { type: 'button', class: 'btn-min', title: 'Przenieś wyżej' }, '↑');
    const dol = bud('button', { type: 'button', class: 'btn-min', title: 'Przenieś niżej' }, '↓');
    const etykieta = bud('label', { class: 'kafel-widocznosc' });
    const widocz = bud('input', { type: 'checkbox' });
    // Kafel realnie ukryty (bylUkryty='1' z wlacz()) ma być odznaczony, mimo że w trybie
    // edycji jest chwilowo pokazany (n.hidden===false) — patrz komentarz w wylacz().
    widocz.checked = !(n.dataset.bylUkryty === '1' || n.hidden);
    gora.onclick = () => przesun(n.dataset.kafel, -1);
    dol.onclick = () => przesun(n.dataset.kafel, 1);
    // Ręczne przełączenie w edycji ma naprawdę zmienić stan — czyścimy/ustawiamy bylUkryty
    // razem z hidden, inaczej odznaczenie „widoczny" u kafla, który wszedł do trybu jako
    // ukryty, nie skasowałoby starej flagi i wylacz() dalej uznałby go za ukryty.
    widocz.onchange = () => { n.hidden = !widocz.checked; n.dataset.bylUkryty = widocz.checked ? '0' : '1'; };
    etykieta.append(widocz, ' widoczny');
    p.append(gora, dol, etykieta);
    return p;
  }

  function wlacz() {
    if (aktywny) return;
    aktywny = true;
    box.classList.add('uklad-tryb');
    // hidden=true chowa kafel na co dzień, ale w trybie układania musi być widoczny
    // (inaczej nie da się go z powrotem odznaczyć) — chowamy TREŚĆ, nie sam kafel.
    for (const n of box.querySelectorAll(':scope > [data-kafel]')) {
      if (n.hidden) { n.hidden = false; n.dataset.bylUkryty = '1'; }
      n.prepend(pasek(n));
    }
  }

  async function wylacz() {
    if (!aktywny) return;
    aktywny = false;
    box.classList.remove('uklad-tryb');
    const w = [...box.querySelectorAll(':scope > [data-kafel]')];
    // Widoczność czytamy z `hidden`, które ustawia checkbox.onchange — usuwamy paski PO
    // odczycie stanu, żeby nic po drodze nie zniknęło z DOM-u przed policzeniem layoutu.
    // n.hidden jest zawsze false w trybie edycji dla kafli, które WESZŁY do niego ukryte
    // (wlacz() je chwilowo odkrywa) — bez sprawdzenia bylUkryty ta ukrycie ginie przy Gotowe.
    const layout = {
      kolejnosc: w.map((n) => n.dataset.kafel),
      ukryte: w.filter((n) => n.dataset.bylUkryty === '1' || n.hidden).map((n) => n.dataset.kafel),
    };
    box.querySelectorAll('.kafel-pasek').forEach((p) => p.remove());
    for (const n of w) delete n.dataset.bylUkryty;
    await onZapisz(layout);
  }

  return { wlacz, wylacz };
}
