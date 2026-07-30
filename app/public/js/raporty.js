// Raporty: KPI miesiąca, wydatki wg kategorii, trend 6 miesięcy, widoki admina.
import { $, el, zl, api, state, refreshers } from './core.js';
import { zastosujUklad, potrzebnyKafelSumy } from './raporty-uklad.js';
import {
  indeksKategorii, klikKategoria, klikKpi, uklikalnij, opisOkres, initUkladBtn,
  wypelnijBezKategorii, odswiezZwijanie, tabela, loadTelemetry,
} from './raporty-klik.js';

// Okres z kontrolek: miesiąc (parametr month) albo zakres dat (from/to) wyliczony
// z pola miesiąca (kwartał/rok, w którym ten miesiąc leży) lub wpisany ręcznie.
// null = zakres niekompletny/odwrócony — nie strzelamy do API z bezsensownym okresem.
export function okresRaportu(tryb, month, from, to) {
  if (tryb === 'miesiac') return { month, qs: 'month=' + month };
  if (tryb === 'wlasny') {
    if (!from || !to || from > to) return null;
    return { from, to, qs: `from=${from}&to=${to}` };
  }
  const [r, m] = month.split('-').map(Number);
  const p = (n) => String(n).padStart(2, '0');
  const start = tryb === 'rok' ? 1 : m - ((m - 1) % 3);
  const kon = tryb === 'rok' ? 12 : start + 2;
  // ostatni dzień miesiąca `kon`: dzień 0 miesiąca następnego
  const f = `${r}-${p(start)}-01`, t = `${r}-${p(kon)}-${p(new Date(r, kon, 0).getDate())}`;
  return { from: f, to: t, qs: `from=${f}&to=${t}` };
}

// Okres wybiera się pigułkami (#rZakres), nie listą — cztery pozycje mieszczą się
// w jednym rzędzie i widać wybór bez rozwijania.
const trybOkresu = () => $('#rZakres')?.querySelector('.active')?.dataset.zakres || 'miesiac';

// Kafel KPI. DOM zawsze w kolejności „wartość, etykieta, drugi wiersz" — czytnik
// ekranu czyta liczbę pierwszą, a obie skóry układają to wizualnie po swojemu.
// `ton` barwi TYLKO liczbę (wydatek/przychód/ostrzeżenie), `pod` to drugi wiersz.
function kafel(label, wartosc, pod, ton) {
  const t = el('div', { class: ton ? 'tile tile--' + ton : 'tile' });
  t.append(el('b', {}, wartosc), el('span', {}, label));
  if (pod) t.append(el('small', {}, pod));
  return t;
}

// Baza porównania zależy od trybu: miesiąc do miesiąca, kwartał do kwartału.
// Własny zakres nie ma kalendarzowego odpowiednika — mówimy wprost „vs poprz.".
const SUFIKS = { miesiac: 'm/m', kwartal: 'k/k', rok: 'r/r', wlasny: 'vs poprz.' };

// `null` z API znaczy „nie ma z czym porównać" (pierwszy okres w bazie) — pokazujemy
// to jako „—", nie jako 0 % i nie jako +∞ %.
function zmiana(pct, tryb) {
  if (pct === null || pct === undefined) return '— brak bazy';
  const znak = pct > 0 ? '+' : (pct < 0 ? '−' : '');
  return `${znak}${Math.abs(pct).toFixed(1).replace('.', ',')} % ${SUFIKS[tryb] || ''}`.trim();
}

export async function loadReport() {
  const ledger = $('#rLedger').value || state.me.scope.ledgers[0];
  const month = $('#rMonth').value || new Date().toISOString().slice(0, 7);
  const tryb = trybOkresu();
  const o = okresRaportu(tryb, month, $('#rFrom')?.value, $('#rTo')?.value);
  if (!o) return;                                  // własny zakres jeszcze niekompletny
  const s = await api(`/api/v1/summary?ledger=${ledger}&${o.qs}`);
  $('#kpi').innerHTML = '';
  const d = s.delta || {};
  // Okres od–do dla kliku w kafel/kategorię: przy trybie „miesiąc" `o` nie ma from/to.
  // Liczony PRZED kaflami (K2/K5) — kafle KPI i wiersz „(bez kategorii)" go potrzebują.
  const [rM, mM] = month.split('-').map(Number);
  const okresOd = o.from || `${month}-01`, okresDo = o.to || `${month}-${String(new Date(rM, mM, 0).getDate()).padStart(2, '0')}`;
  const okres = { from: okresOd, to: okresDo, opis: opisOkres(okresOd, okresDo) };
  const tiles = [
    [kafel('Wydatki okresu', zl(s.expenses), zmiana(d.expenses_pct, tryb), 'minus'), 'Wydatki okresu'],
    [kafel('Przychody okresu', zl(s.income), zmiana(d.income_pct, tryb), 'plus'), 'Przychody okresu'],
    // Przy bilansie druga linia mówi coś WIĘCEJ niż procent: saldo od zawsze do końca
    // okresu. Procent bilansu bywa bez sensu (baza blisko zera), narastające nie.
    [kafel('Bilans', zl(s.balance), 'narast. ' + zl(s.cumulative_balance), Number(s.balance) < 0 ? 'minus' : null), 'Bilans'],
    [kafel('Wpisy', String(s.tx_count), null), 'Wpisy'],
  ];
  if (s.unmatched_bank_rows !== null) {
    // „Bankowe do uzgodnienia" celowo BEZ kliku (raporty-klik.js): to zestawienie z wyciągu
    // bankowego, nie z księgi wpisów — nie ma czym zawęzić Historii.
    tiles.push([kafel('Bankowe do uzgodnienia', String(s.unmatched_bank_rows), null,
      Number(s.unmatched_bank_rows) ? 'warn' : null), null]);
  }
  // K1: siatka KPI ma zawsze parzystą liczbę kafli — nieparzysta dostaje dopełniający
  // „Suma okresu" (bilans przychody−wydatki, ta sama wartość co kafel „Bilans" wyżej,
  // ale bez narastającego — decyzja Szymona 2026-07-30 pkt 1a).
  if (potrzebnyKafelSumy(tiles.length)) {
    tiles.push([kafel('Suma okresu', zl(s.balance), null, Number(s.balance) < 0 ? 'minus' : null), 'Suma okresu']);
  }
  for (const [t, label] of tiles) {
    $('#kpi').append(t);
    if (label) klikKpi(t, ledger, okres, label);
  }
  // Kolory (dziedziczone z rodzica) barwią słupki; `categories` służy TAKŻE do kliku (Z8).
  const kolory = {}; let categories = [];
  try {
    ({ categories } = await api('/api/v1/categories?ledger=' + ledger));
    for (const c of categories) {
      if (c.color) kolory[c.id] = c.color;
      for (const k of c.children) if (k.color || c.color) kolory[k.id] = k.color || c.color;
    }
  } catch { /* raport ważniejszy niż barwy i klik */ }
  sekcja('bez-kategorii');                         // K5: reset przy zmianie okresu/księgi
  const idxKat = indeksKategorii(categories);
  // Słupek skalujemy do NAJWIĘKSZEJ pozycji (widać proporcje), a udział liczymy
  // od sumy okresu (mówi, ile procent wydatków to ta kategoria).
  const max = Math.max(...s.by_category.map((c) => Number(c.total)), 1);
  const suma = s.by_category.reduce((a, c) => a + Number(c.total), 0) || 1;
  const box = $('#byCat'); box.innerHTML = '';
  for (const c of s.by_category) {
    const r = el('div', { class: 'barrow' });
    const kolor = kolory[c.category_id];
    if (kolor) r.style.setProperty('--cat-c', kolor);
    const nazwa = el('span', { class: 'bname' });
    nazwa.append(el('i', { class: kolor ? 'catdot' : 'catdot pusta', 'aria-hidden': 'true' }), c.category);
    const tor = el('span', { class: 'btrack' });
    const bar = el('i', { class: 'bar' });
    bar.style.width = (100 * Number(c.total) / max).toFixed(1) + '%';
    tor.append(bar);
    const pct = (100 * Number(c.total) / suma).toFixed(1).replace('.', ',') + ' %';
    r.append(nazwa, el('span', { class: 'bval' }, zl(c.total)), tor, el('span', { class: 'bpct' }, pct));
    box.append(r);
    // K5: „(bez kategorii)" dostaje INNY klik niż reszta — otwiera listę do nadania
    // kategorii wpisom, nie pełną Historię (klikKategoria je pomija, id === null).
    if (c.category_id == null) uklikalnij(r, `Pokaż wpisy bez kategorii · ${okres.opis}`,
      () => wypelnijBezKategorii(sekcja('bez-kategorii'), ledger, okres, categories));
    else klikKategoria(r, ledger, okres, c.category_id, c.category, idxKat);
  }
  const months = [...new Set(s.trend.map((t) => t.month))];
  const tb = $('#trend tbody'); tb.innerHTML = '';
  for (const m of months) {
    const inc = Number(s.trend.find((t) => t.month === m && t.type === 'PRZYCHÓD')?.total || 0);
    const exp = Number(s.trend.find((t) => t.month === m && t.type === 'WYDATEK')?.total || 0);
    const tr = el('tr');
    // Ujemny bilans miesiąca dostaje barwę wydatku — znak minus i tak stoi przy liczbie.
    tr.append(el('td', {}, m), el('td', { class: 'num inc' }, zl(inc)),
      el('td', { class: 'num exp' }, zl(exp)),
      el('td', { class: 'num' + (inc - exp < 0 ? ' exp' : '') }, zl(inc - exp)));
    tb.append(tr);
  }
  await loadTransfery(s);
  // Konto Bartusia i najem są zakotwiczone w miesiącu (saldo narastająco „do miesiąca X",
  // czynsz płacony miesięcznie) — przy kwartale/roku/zakresie te sekcje się chowają.
  if (String(ledger) === '1' && tryb === 'miesiac') { await loadBartus(month); await loadNajem(month); }
  else { sekcja('bartus'); sekcja('najem'); }
  // Zestawienie obu ksiąg widzi ten, kto ma obie w zasięgu (admin i dorosły współprowadzący).
  // Telemetria to osobna sprawa — zostaje wyłącznie przy adminie.
  const obieKsiegi = state.me.scope.ledgers.includes(1) && state.me.scope.ledgers.includes(2);
  if (obieKsiegi) {
    const { rows } = await api('/api/v1/reports/family-vs-persevera?' + o.qs);
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
    t.append(tb2);
    const w = el('div', { class: 'overflow' }); w.append(t); f.append(w);
  } else $('#fvp').innerHTML = '';
  if (state.me.role === 'admin') loadTelemetry($('#telemetria'));
  else $('#telemetria').innerHTML = '';
  zastosujUklad($('#view-raporty .stack'), (await api('/api/v1/uklad')).layout); // Z9: układ per użytkownik, null = bez zmian
  await odswiezZwijanie($('#view-raporty .stack'));   // K3: nagłówki-przyciski zwijania, po KAŻDYM przerysowaniu
}

// Sekcje z JS przed #fvp: transfery → Bartuś → najem. `data-kafel` (Z9): jak kafle statyczne.
function sekcja(id) {
  let n = document.getElementById(id);
  if (!n) {
    n = el('div', { id, 'data-kafel': id });
    const f = $('#fvp');                       // kotwica; gdyby zniknęła — dokładamy na koniec karty
    if (f && f.parentNode) f.parentNode.insertBefore(n, f);
    else ($('#view-raporty .stack') || document.body).append(n);
  }
  n.innerHTML = '';
  return n;
}

// K7/E4: „Zobowiązania i cele" — TRANSFER poza konsumpcją (nie wchodzi w wydatki ani bilans).
function loadTransfery(s) {
  const box = sekcja('transfery');
  if (!s.transfers || !s.transfers.length) return;
  box.append(el('h2', {}, 'Zobowiązania i cele'));
  box.append(tabela(['Grupa', 'Pozycja', 'Kwota', 'Wpisy'],
    s.transfers.map((r) => [r.grupa, r.category, zl(r.total), r.n])
      .concat([['Razem', '', zl(s.transfers_total), '']])));
  box.append(el('p', { class: 'msg' }, 'Transfery to przesunięcia własnych pieniędzy (spłaty, cele) — nie liczą się jako wydatki.'));
}

// K8 (§7.5): Konto Bartusia — otrzymane kieszonkowe (wydatek rodzica) vs wydatki
// zaksięgowane przez Bartka, saldo narastająco. Wydatki rodziców na dziecko: poza saldem.
async function loadBartus(month) {
  const box = sekcja('bartus');
  let b;
  try { b = await api('/api/v1/reports/bartus?month=' + month); } catch { return; } // brak dostępu = brak sekcji
  if (b.brak_kategorii) return;
  box.append(el('h2', {}, 'Konto Bartusia'));
  const kpi = el('div', { class: 'kpi' });
  // §7.5: kieszonkowe (WYDATEK rodzica w „Bartuś > Kieszonkowe") minus wydatki zaksięgowane
  // przez Bartka. „Inne wpływy" = przychody w drzewie Bartusia poza kieszonkowym (np. zwrot),
  // też na plus. Wydatki rodziców na dziecko są POZA saldem — kafel niżej mówi to wprost.
  const kafle = [['Kieszonkowe', zl(b.kieszonkowe)]];
  if (b.wplywy) kafle.push(['Inne wpływy', zl(b.wplywy)]);
  kafle.push(['Wydatki Bartka', zl(b.wydatki)], ['Saldo narastająco', zl(b.saldo)]);
  for (const [label, val] of kafle) kpi.append(kafel(label, val, null));
  box.append(kpi);
  if (b.months.length) {
    const maWpl = b.months.some((m) => m.wplywy);
    box.append(tabela(['Miesiąc', 'Kieszonkowe'].concat(maWpl ? ['Inne wpływy'] : [], ['Wydatki Bartka', 'Rodzice (poza saldem)', 'Saldo']),
      b.months.slice(-6).map((m) => [m.month, zl(m.kieszonkowe)]
        .concat(maWpl ? [zl(m.wplywy)] : [], [zl(m.wydatki), zl(m.rodzice), zl(m.saldo)]))));
  }
  box.append(el('p', { class: 'msg' }, b.rodzice
    ? `Wydatki rodziców na Bartusia w tym miesiącu: ${zl(b.rodzice)} — poza saldem konta (§7.5: `
      + 'saldo to kieszonkowe minus wydatki zaksięgowane przez Bartka).'
    : 'Saldo to kieszonkowe (wydatek rodzica) minus wydatki zaksięgowane przez Bartka — §7.5.'));
}

// K9 (§7.3): para najmu — wpływ od Kamila i czynsz do Darka obok siebie, z różnicą.
async function loadNajem(month) {
  const box = sekcja('najem');
  let n;
  try { n = await api('/api/v1/reports/najem?month=' + month); } catch { return; }
  if (!n.od_kamila.n && !n.do_darka.n) return;
  box.append(el('h2', {}, 'Najem: Kamil → Szymon → Darek'));
  box.append(tabela(['Strona', 'Kwota', 'Wpisy'], [
    ['Najem (od Kamila)', zl(n.od_kamila.total), n.od_kamila.n],
    ['Czynsz do Darka', zl(n.do_darka.total), n.do_darka.n],
    ['Różnica', zl(n.roznica), ''],
  ]));
  box.append(el('p', { class: 'msg' }, 'To przepływ (pass-through), nie dochód — liczy się różnica.'));
}

// „Zakres" podmienia pole miesiąca na parę dat od–do. Puste daty przy wejściu w ten
// tryb wypełniamy bieżącym miesiącem — inaczej na ekranie zostawał raport poprzedniego
// trybu pod etykietą, która obiecywała co innego.
function ustawOkres(tryb) {
  const wlasny = tryb === 'wlasny';
  $('#rMonth').hidden = wlasny;
  $('#rFrom').hidden = $('#rTo').hidden = !wlasny;
  if (wlasny && (!$('#rFrom').value || !$('#rTo').value)) {
    const m = $('#rMonth').value || new Date().toISOString().slice(0, 7);
    const [r, mies] = m.split('-').map(Number);
    if (!$('#rFrom').value) $('#rFrom').value = m + '-01';
    if (!$('#rTo').value) $('#rTo').value = `${m}-${String(new Date(r, mies, 0).getDate()).padStart(2, '0')}`;
  }
  loadReport();
}

export function initRaporty() {
  $('#rMonth').value = new Date().toISOString().slice(0, 7);
  initUkladBtn($('#view-raporty .stack'), $('#rUklad'));
  $('#rLedger').onchange = loadReport;
  $('#rMonth').onchange = loadReport;
  const zakres = $('#rZakres');
  if (zakres) {
    zakres.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        zakres.querySelector('.active')?.classList.remove('active');
        b.classList.add('active');
        ustawOkres(b.dataset.zakres);
      };
    });
    $('#rFrom').onchange = loadReport;
    $('#rTo').onchange = loadReport;
  }
  refreshers.raporty = loadReport;
}
