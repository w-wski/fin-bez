// Raporty: KPI miesiąca, wydatki wg kategorii, trend 6 miesięcy, widoki admina.
import { $, el, zl, api, state, refreshers } from './core.js';

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

export async function loadReport() {
  const ledger = $('#rLedger').value || state.me.scope.ledgers[0];
  const month = $('#rMonth').value || new Date().toISOString().slice(0, 7);
  const tryb = trybOkresu();
  const o = okresRaportu(tryb, month, $('#rFrom')?.value, $('#rTo')?.value);
  if (!o) return;                                  // własny zakres jeszcze niekompletny
  const s = await api(`/api/v1/summary?ledger=${ledger}&${o.qs}`);
  $('#kpi').innerHTML = '';
  const tiles = [
    ['Przychody', zl(s.income)], ['Wydatki', zl(s.expenses)],
    ['Bilans', zl(s.balance)], ['Wpisy', String(s.tx_count)],
  ];
  if (s.unmatched_bank_rows !== null) tiles.push(['Bankowe do uzgodnienia', String(s.unmatched_bank_rows)]);
  for (const [label, val] of tiles) {
    const t = el('div', { class: 'tile' });
    t.append(el('b', {}, val), el('span', {}, label));
    $('#kpi').append(t);
  }
  // Kolory kategorii (nadane w Admin) barwią słupki raportu; podkategoria bez
  // własnego koloru dziedziczy kolor rodzica. Bez koloru — słupek w szałwii.
  const kolory = {};
  try {
    const { categories } = await api('/api/v1/categories?ledger=' + ledger);
    for (const c of categories) {
      if (c.color) kolory[c.id] = c.color;
      for (const k of c.children) if (k.color || c.color) kolory[k.id] = k.color || c.color;
    }
  } catch { /* raport ważniejszy niż barwy */ }
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
    t.append(tb2); f.append(t);
  } else $('#fvp').innerHTML = '';
  if (state.me.role === 'admin') loadTelemetry();
  else $('#telemetria').innerHTML = '';
}

// Sekcje raportu dokładane z JS (index.html trzyma tylko kotwice).
// Wstawiane przed #fvp (blok admina), w kolejności wywołań: transfery → Bartuś → najem.
function sekcja(id) {
  let n = document.getElementById(id);
  if (!n) {
    n = el('div', { id });
    const f = $('#fvp');                       // kotwica; gdyby zniknęła — dokładamy na koniec karty
    if (f && f.parentNode) f.parentNode.insertBefore(n, f);
    else ($('#view-raporty .stack') || document.body).append(n);
  }
  n.innerHTML = '';
  return n;
}

// Tabela z nagłówkami; `rows` to tablice komórek [{v, num}] lub gołych wartości.
function tabela(headers, rows) {
  const t = el('table');
  t.innerHTML = '<thead><tr>' + headers.map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('') + '</tr></thead>';
  const tb = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    r.forEach((v, i) => tr.append(el('td', { class: i ? 'num' : '' }, String(v))));
    tb.append(tr);
  }
  t.append(tb);
  return t;
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
  for (const [label, val] of kafle) {
    const t = el('div', { class: 'tile' });
    t.append(el('b', {}, val), el('span', {}, label));
    kpi.append(t);
  }
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

async function loadTelemetry() {
  const box = $('#telemetria');
  try {
    const t = await api('/api/v1/reports/telemetry?days=30');
    box.innerHTML = '';
    const mk = (headers, rows) => {
      const tb = el('table');
      tb.innerHTML = '<thead><tr>' + headers.map((h, i) =>
        `<th${i > 0 && typeof rows[0]?.[i] === 'number' ? ' class="num"' : ''}>${h}</th>`).join('') + '</tr></thead>';
      const body = el('tbody');
      for (const r of rows) {
        const tr = el('tr');
        r.forEach((v) => tr.append(el('td', { class: typeof v === 'number' ? 'num' : '' },
          typeof v === 'number' ? String(v) : (v ?? '—'))));
        body.append(tr);
      }
      tb.append(body); return tb;
    };
    box.append(el('h2', {}, 'Czas na kartach [min] wg osoby'));
    box.append(mk(['Karta', 'Kto', 'Minuty', 'Zdarzenia'],
      t.by_view.map((r) => [r.view_name, r.user_name, Number(r.minutes), Number(r.events)])));
    box.append(el('h2', {}, 'Akcje (w tym offline)'));
    box.append(mk(['Akcja', 'Kto', 'Razem', 'Offline'],
      t.by_action.map((r) => [r.action, r.user_name, Number(r.n), Number(r.offline_n) || 0])));
  } catch { box.innerHTML = ''; }
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
