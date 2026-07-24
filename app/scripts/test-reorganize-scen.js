// Scenariusze z ODRZUCONYCH przebiegów reorganizacji (weryfikacja 2026-07-24) + idempotencja
// (K2) + arytmetyka „Konta Bartusia" (K8, §7.5). Osobny plik, bo test-reorganize.js dobił do
// limitu 300 linii z preflighta; uruchamiany z tamtego pliku, więc `npm test` zostaje bez zmian.
// Harness (t/old/tx/target/cats) dostajemy z pliku głównego — jeden licznik błędów, jeden przebieg.
const assert = require('assert');
const { RULES, ruleFor, kandydat, decyzja, planKategorii } = require('./reorganize-plan');
const { kubelBartusia, miesiaceBartusia } = require('../src/routes/reports');

module.exports = function scenariusze({ t, old, tx, target, cats }) {
  // Warianty planu kategorii dokładnie jak w kroku 3 wykonawcy (cel z syntetycznego drzewa).
  const warianty = (c) => planKategorii(c).map((v) => ({ ...v, dst: v.r.to ? target(v.r) : null }));

  // ---------- co skrypt ROBI z wpisem: automat / lista ręczna / nic ----------
  const SCEN = [
    // [nazwa, typ wpisu, stara kategoria, opis, oczekiwany tryb, oczekiwany wiersz tabeli]
    ['#2 WYDATEK w „PZU" nie dziedziczy księgi spółki ani kategorii przychodowej', 'WYDATEK', 'PZU', 'składka OC', null, null],
    ['#2 WYDATEK w przychodowych „Zwroty" zostaje na miejscu', 'WYDATEK', 'Zwroty', 'zwrot za bilet', null, null],
    ['#3 „Alimenty za maj od Anny" idą TYLKO na listę (C8 ich nie zabiera)', 'PRZYCHÓD', 'Zakupy spożywcze', 'Alimenty za maj od Anny', 'reczna', 'C4'],
    ['#3 3 000 zł od Kamila idzie TYLKO na listę', 'PRZYCHÓD', 'Zwrot', 'przelew od Kamila za czynsz', 'reczna', 'C7'],
    ['#3 „Misja Centrum" idzie TYLKO na listę (A20, 1 wpis ręcznie)', 'WYDATEK', 'Prezenty', 'Misja Centrum — darowizna', 'reczna', 'A20'],
    ['#4 PRZYCHÓD w drzewie „Bartuś" zostaje (łapacz C8 go nie wymiata)', 'PRZYCHÓD', 'Bartuś > Kieszonkowe', 'kieszonkowe lipiec', null, null],
    ['#4 PRZYCHÓD w kategorii docelowej „Spożywcze" zostaje', 'PRZYCHÓD', 'Spożywcze', 'zwrot ze sklepu', null, null],
    ['#5 „wypłata z oszczędności" nie staje się TRANSFEREM automatem', 'PRZYCHÓD', 'Oszczędności 1', 'wypłata z oszczędności', 'reczna', 'B7'],
    ['#5 uruchomienie kredytu w „Bank Handlowy" — na listę, nie w transfery', 'PRZYCHÓD', 'Bank Handlowy', 'uruchomienie kredytu 50 000', 'reczna', 'B1'],
    ['#5 sprzedaż działki („Działka", PRZYCHÓD) — na listę', 'PRZYCHÓD', 'Działka', 'sprzedaż działki', 'reczna', 'B6'],
    ['#5 wpłata NA cel nadal idzie automatem', 'WYDATEK', 'Działka', 'przelew na działkę', 'automat', 'B6'],
    ['#7 „PERSEVERA > Telefony" idzie do spółki (D3 bije nazwową A5)', 'WYDATEK', 'PERSEVERA > Telefony', '', 'automat', 'D3'],
    ['#7 „PERSEVERA > Czynsz" ma regułę (D1), nie zostaje bez zmian', 'WYDATEK', 'PERSEVERA > Czynsz', '', 'automat', 'D1'],
    ['#7 „PERSEVERA > Paliwo" nie jest paliwem rodziny (D2 bije A9)', 'WYDATEK', 'PERSEVERA > Paliwo', '', 'automat', 'D2'],
    ['#7 korzeń „PERSEVERA Telefony" działa jak dawniej', 'WYDATEK', 'PERSEVERA Telefony', '', 'automat', 'D3'],
  ];
  for (const [nazwa, typ, stara, opis, tryb, wiersz] of SCEN) t(nazwa, () => {
    const c = old(stara);
    const d = decyzja(tx(typ, c, opis), c, warianty(c));
    assert.strictEqual(d ? d.tryb : null, tryb, 'tryb dla „' + stara + '"');
    if (wiersz) assert.strictEqual(d.r.id, wiersz);
  });
  t('#2/#5 wpis bez reguły dla swojego przepływu nie zmienia księgi (K5)', () => {
    for (const [stara, typ] of [['PZU', 'WYDATEK'], ['Zwroty', 'WYDATEK'], ['Film', 'WYDATEK'], ['Oszczędności 1', 'PRZYCHÓD']]) {
      const c = old(stara);
      const d = decyzja(tx(typ, c, ''), c, warianty(c));
      assert.ok(!d || d.tryb === 'reczna' || (d.dst || target(d.r)).ledger_id === c.ledger_id, `${stara}/${typ} zmienia księgę`);
    }
  });
  t('#5 żadna reguła automatyczna nie zamienia PRZYCHODU na TRANSFER', () => {
    const zle = RULES.filter((r) => r.t === 'TRANSFER' && r.flow !== 'out' && !r.m).map((r) => r.id);
    assert.deepStrictEqual(zle, [], 'reguły łapiące wpływy automatem: ' + zle.join(', '));
  });
  t('#8 reguła po opisie nie dotyka wpisu typu TRANSFER (łapie go reguła nazwowa)', () => {
    // Spłata z „mandat" w tytule nie jest wydatkiem na parkingi, a TRANSFER z „CIT 8" nie
    // jest podatkiem spółki. Zostaje przy regule nazwowej, która nie rusza typu ani księgi.
    for (const [stara, opis, zamiast] of [['Lexus', 'Mandat UFG', 'A13'], ['Podatek', 'CIT 8', 'A22'], ['Prezenty', 'Misja Centrum', 'A20']]) {
      const c = old(stara), wpis = tx('TRANSFER', c, opis);
      const r = ruleFor(wpis, c);
      assert.ok(!r || !r.d, `${stara}: reguła po opisie ${r && r.id} złapała TRANSFER`);
      assert.strictEqual(r ? r.id : null, zamiast, stara);
      assert.strictEqual(kandydat(wpis, c), null, stara + ' (kandydat)');
    }
  });

  // ---------- idempotencja (K2) ----------
  // Niezmiennik: wpis, który reguła już przeniosła, przy kolejnym przebiegu albo nie pasuje do
  // żadnej reguły, albo pasuje do reguły wskazującej TĘ SAMĄ kategorię.
  const PROBKI = { '\\bcit\\b': 'CIT 8', '\\bufg\\b|\\bmandat': 'Mandat UFG', 'misja centrum': 'Misja Centrum',
    '\\bzasp\\b|\\btantiem': 'ZASP', '\\baliment': 'Alimenty', '\\bkamil': 'Kamil czynsz' };
  const typDla = (r) => (r.flow === 'in' ? 'PRZYCHÓD' : r.t || 'WYDATEK');
  t('K2: powtórny przebieg nie rusza wpisu leżącego już w kategorii docelowej', () => {
    const zle = [];
    for (const r of RULES.filter((x) => x.to)) {
      if (r.d) assert.ok(PROBKI[r.d], 'brak próbki opisu dla reguły ' + r.id);
      const cel = target(r);
      const drugi = ruleFor(tx(typDla(r), cel, r.d ? PROBKI[r.d] : ''), cel);
      if (drugi && drugi.to && target(drugi).id !== cel.id) zle.push(`${r.id}: ${cel.path} → ${drugi.id}:${drugi.to}`);
    }
    assert.deepStrictEqual(zle, [], 'drift przy 2. przebiegu:\n  ' + zle.join('\n  '));
  });
  t('K2: kategoria docelowa nie ucieka w ŻADNYM przepływie (także przychód na kategorii wydatkowej)', () => {
    // Stary test sprawdzał wyłącznie przepływ zadeklarowany w regule, więc dryf przychodów
    // (łapacz C8 wymiatał je co przebieg z „Bartuś > *" i „Spożywcze" do korzenia „Inne") był
    // niewidoczny. Teraz przez każdą kategorię docelową przechodzą wszystkie trzy typy wpisu.
    const zle = [];
    for (const cel of new Set(RULES.filter((r) => r.to).map((r) => target(r).id))) {
      const c = cats.find((x) => x.id === cel);
      for (const typ of ['WYDATEK', 'PRZYCHÓD', 'TRANSFER']) {
        for (const [skad, r] of [['automat', ruleFor(tx(typ, c), c)], ['kandydat', kandydat(tx(typ, c), c)]]) {
          if (r && r.to && target(r).id !== cel) zle.push(`${c.path} (${typ}, ${skad}) → ${r.id}:${r.to}`);
        }
      }
    }
    assert.deepStrictEqual(zle, [], 'drift przy 2. przebiegu:\n  ' + zle.join('\n  '));
  });
  t('C8/CP4: łapacz sierot działa wyłącznie na przychodach — wydatek zostaje na miejscu', () => {
    const c = old('Kategoria spoza tabeli');
    assert.strictEqual(ruleFor(tx('WYDATEK', c), c), null);
    assert.strictEqual(ruleFor(tx('PRZYCHÓD', c), c).id, 'C8');
    const p = old('Kategoria spoza tabeli', 2);
    assert.strictEqual(ruleFor(tx('PRZYCHÓD', p), p).id, 'CP4');
  });
  t('K3/K6: reguły zmieniają wyłącznie kategorię, księgę, typ i tag', () => {
    const dozwolone = new Set(['id', 'flow', 'from', 'to', 'l', 'sl', 't', 'd', 'tag', 'm', 'pr']);
    const zle = RULES.flatMap((r) => Object.keys(r).filter((k) => !dozwolone.has(k)));
    assert.deepStrictEqual(zle, [], 'reguła rusza coś spoza kontraktu: ' + zle.join(', '));
  });

  // ---------- Konto Bartusia (K8, §7.5) ----------
  // Przebieg weryfikatora: rodzice dają 100 zł kieszonkowego, płacą 120 zł za wyprawkę i 46 zł
  // za bilet (oba w drzewie „Bartuś"), Bartek wydaje 25 zł. Ma wyjść +75,00, nie −291,00.
  const R = (typ, kieszonkowa, junior, wdrzewie, total, month = '2026-07') => ({ month, typ, kieszonkowa, junior, wdrzewie, total });
  const LIPIEC = [R('WYDATEK', 1, 0, 1, '100.00'), R('WYDATEK', 0, 0, 1, '120.00'),
    R('WYDATEK', 0, 0, 1, '46.00'), R('WYDATEK', 0, 1, 0, '25.00')];
  t('K8/§7.5: kieszonkowe = wydatek rodzica, saldo = 100 − 25 = +75 (było −291)', () => {
    const [m] = miesiaceBartusia(LIPIEC);
    assert.deepStrictEqual([m.kieszonkowe, m.wydatki, m.rodzice, m.saldo], [100, 25, 166, 75]);
  });
  t('K8: kubełki §7.5 — wydatek rodzica na dziecko nie obciąża konta Bartka', () => {
    assert.strictEqual(kubelBartusia(R('WYDATEK', 1, 0, 1, '100.00')), 'kieszonkowe');
    assert.strictEqual(kubelBartusia(R('WYDATEK', 0, 0, 1, '120.00')), 'rodzice');
    assert.strictEqual(kubelBartusia(R('WYDATEK', 0, 1, 0, '25.00')), 'wydatki');   // Bartek poza drzewem
    assert.strictEqual(kubelBartusia(R('WYDATEK', 0, 1, 1, '5.00')), 'wydatki');    // Bartek w drzewie
    assert.strictEqual(kubelBartusia(R('PRZYCHÓD', 0, 0, 1, '30.00')), 'wplywy');   // „Inne wpływy" (#4)
    assert.strictEqual(kubelBartusia(R('PRZYCHÓD', 0, 0, 0, '3000.00')), null);     // przychód rodziny — nie jego
  });
  t('K8: saldo narasta przez miesiące, inne wpływy na plus', () => {
    const ms = miesiaceBartusia([...LIPIEC, R('PRZYCHÓD', 0, 0, 1, '30.00', '2026-08'), R('WYDATEK', 0, 1, 1, '5.00', '2026-08')]);
    assert.deepStrictEqual(ms.map((m) => [m.month, m.saldo]), [['2026-07', 75], ['2026-08', 100]]);
  });
  t('K8: kieszonkowe zaksięgowane jako PRZYCHÓD też zasila konto (nie ginie)', () => {
    const [m] = miesiaceBartusia([R('PRZYCHÓD', 1, 0, 1, '150.00')]);
    assert.deepStrictEqual([m.kieszonkowe, m.wydatki, m.saldo], [150, 0, 150]);
  });
};
