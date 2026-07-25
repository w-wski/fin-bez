// Scenariusze z ODRZUCONYCH przebiegów reorganizacji (weryfikacja 2026-07-24) + idempotencja
// + arytmetyka „Konta Bartusia" (§7.5) + zlecenie Z5: rozdzielone „Inne" (K1), brak UPDATE na
// transakcjach (K2) i propozycje wraz z ich idempotencją (K4, K5). Osobny plik, bo
// test-reorganize.js dobił do limitu 300 linii z preflighta; uruchamiany z tamtego pliku,
// więc `npm test` zostaje bez zmian w package.json.
// Harness (t/old/tx/target/cats) dostajemy z pliku głównego — jeden licznik błędów, jeden przebieg.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { RULES, TREE, F, P, ruleFor, kandydat, decyzja, planKategorii, propozycja } = require('./reorganize-plan');
const { kubelBartusia, miesiaceBartusia } = require('../src/routes/reports');
// Przyjęcie propozycji (K7) i walidacja celu (K8) — w pliku obok, żeby oba zmieściły się
// w limicie 300 linii. Zwraca obietnicę: tamte testy są asynchroniczne (atrapa puli).
const testyPropozycji = require('./test-reorganize-prop');

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

  // ---------- Z5: „Inne" rozdzielone (K1) ----------
  t('Z5/K1: każda księga ma osobne „Inne" (wydatki) i „Inne przychody"', () => {
    for (const led of [F, P]) {
      assert.ok('Inne' in TREE[led], 'brak „Inne" w księdze ' + led);
      assert.ok('Inne przychody' in TREE[led], 'brak „Inne przychody" w księdze ' + led);
    }
    assert.strictEqual(RULES.find((r) => r.id === 'A29').to, 'Inne');
    assert.strictEqual(RULES.find((r) => r.id === 'C8').to, 'Inne przychody');
    assert.strictEqual(RULES.find((r) => r.id === 'CP4').to, 'Inne przychody');
  });
  t('Z5/K1: przychód nie wpada do „Inne" wydatkowego, a wydatek do przychodowego', () => {
    const zle = RULES.filter((r) => (r.to === 'Inne' && r.flow === 'in')
      || (r.to === 'Inne przychody' && r.flow === 'out')).map((r) => r.id);
    assert.deepStrictEqual(zle, [], 'reguły mieszające oba „Inne": ' + zle.join(', '));
    const c = old('Dom');
    assert.strictEqual(ruleFor(tx('WYDATEK', c), c).to, 'Dom i media');
    assert.strictEqual(ruleFor(tx('PRZYCHÓD', c), c).to, 'Inne przychody');
  });

  // ---------- Z5: skrypt tylko PROPONUJE (K2) ----------
  const zrodlo = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');
  t('Z5/K2: skrypt reorganizacji nie ma ani jednego UPDATE/DELETE na transakcjach', () => {
    for (const n of ['reorganize-categories.js', 'reorganize-plan.js', 'reorganize-raport.js']) {
      assert.ok(!/UPDATE\s+transactions/i.test(zrodlo(n)), n + ': UPDATE na transakcjach');
      assert.ok(!/DELETE\s+FROM\s+transactions/i.test(zrodlo(n)), n + ': DELETE na transakcjach');
    }
    assert.ok(/INSERT INTO category_proposals/.test(zrodlo('reorganize-categories.js')),
      'skrypt nie zapisuje propozycji');
  });
  t('Z5: skrypt nie proponuje wpisom z Kosza ani wpisom z otwartą propozycją', () => {
    // Kosz: reszta aplikacji wyklucza usunięte z każdej edycji, a przydział zmieniał im kategorię
    // (przy regule D także księgę i typ), więc po „Przywróć" wpis wracał zmieniony.
    // Otwarta propozycja: druga dla tego samego wpisu podwajała licznik „do przydziału",
    // a przyjęcie starszej grupy cofało ręczne przepięcie w Historii.
    const src = zrodlo('reorganize-categories.js');
    assert.ok(/FROM transactions WHERE deleted_at IS NULL/.test(src), 'skrypt czyta też wpisy z Kosza');
    assert.ok(/FROM category_proposals WHERE status='NOWA'/.test(src), 'brak odsiewu otwartych propozycji');
    assert.ok(/otwarte\.has\(Number\(tx\.id\)\)/.test(src), 'odsiew otwartych propozycji nie jest używany w pętli');
  });
  t('Z5/K2: komentarz przy bramce skryptu nie obiecuje więcej, niż bramka umie', () => {
    // Kubełki to księga × typ × kosz — przepięcie samej kategorii w obrębie tej samej księgi
    // i typu przechodzi przez nie bez śladu. Komentarz musi mówić to wprost, a jako gwarancję
    // K2 wskazywać test grepujący źródło (ten obok). Inaczej ktoś zaufa bramce zamiast testu.
    const src = zrodlo('reorganize-categories.js');
    assert.ok(/NIE ŁAPIE/.test(src), 'komentarz bramki nie nazywa jej ograniczenia');
    assert.ok(/jedyna realna gwarancja K2|gwarancją K2/.test(src), 'komentarz nie wskazuje testu jako gwarancji K2');
  });
  t('Z5/K2: transakcje przepina WYŁĄCZNIE przyjęcie propozycji, zawsze z WHERE', () => {
    const src = zrodlo('..', 'src', 'routes', 'proposals.js');
    const zapisy = src.match(/UPDATE transactions[^\n]*/g) || [];
    assert.strictEqual(zapisy.length, 1, 'liczba UPDATE-ów na transakcjach: ' + zapisy.length);
    assert.ok(/WHERE id IN \(\?\)/.test(zapisy[0]), 'UPDATE bez WHERE: ' + zapisy[0]);
    assert.ok(!/DELETE\s+FROM/i.test(src), 'trasa propozycji nic nie kasuje');
  });

  // ---------- Z5: propozycje i ich idempotencja (K4, K5) ----------
  const cel = (to, l) => target({ to, l });
  const prop = (typ, stara, opis, istniejace) => {
    const c = old(stara);
    return propozycja(tx(typ, c, opis), c, warianty(c), cel, istniejace || new Set());
  };
  t('Z5/K5: propozycja niesie cel, wiersz reguły i pochodzenie wpisu', () => {
    const p = prop('WYDATEK', '1000 Czynsz');
    assert.strictEqual(p.rule_id, 'A3');
    assert.strictEqual(p.to_category_id, cel('Dom i media>Czynsz', 1).id);
    assert.strictEqual(p.from_category_id, old('1000 Czynsz').id);
    assert.deepStrictEqual([p.to_ledger_id, p.to_type, p.tag], [null, null, null]);
  });
  t('Z5/K5: propozycja niesie księgę (D2), typ (B4) i tag (A30), gdy reguła je zmienia', () => {
    assert.strictEqual(prop('WYDATEK', 'PERSEVERA Paliwo').to_ledger_id, 2);
    assert.strictEqual(prop('WYDATEK', 'Poduszka').to_type, 'TRANSFER');
    assert.strictEqual(prop('WYDATEK', 'Wakacje > Nocleg').tag, 'wyjazd-2026-06');
  });
  t('Z5/K5: wpis bez reguły dla swojego przepływu NIE dostaje propozycji', () => {
    assert.strictEqual(prop('WYDATEK', 'PZU', 'składka OC'), null);
    assert.strictEqual(prop('WYDATEK', 'Zwroty', 'zwrot za bilet'), null);
  });
  t('Z5/K5: propozycja po opisie jest oznaczona jako słabo umocowana (tryb reczna)', () => {
    const p = prop('PRZYCHÓD', 'Zwrot', 'przelew od Kamila za czynsz');
    assert.strictEqual(p.rule_id, 'C7');
    assert.strictEqual(p.tryb, 'reczna');
  });
  t('Z5/K4: wpis leżący już w celu nie dostaje propozycji (2. i 3. przebieg)', () => {
    for (const [typ, cel2] of [['PRZYCHÓD', 'Film'], ['TRANSFER', 'Cele>Poduszka'], ['WYDATEK', 'Dom i media>Czynsz']]) {
      const k = cats.find((x) => x.id === cel('' + cel2, 1).id);
      const p = propozycja(tx(typ, k), k, warianty(k), cel, new Set());
      assert.ok(!p || p.nic, `${cel2} (${typ}) dostało propozycję: ` + JSON.stringify(p));
    }
  });
  t('Z5/K4: propozycja raz ODRZUCONA nie wraca (para wpis+cel już w tabeli)', () => {
    const docelu = cel('Dom i media>Czynsz', 1).id;
    const p = prop('WYDATEK', '1000 Czynsz', '', new Set([`1|${docelu}`]));
    assert.strictEqual(p.jest, true);
    assert.strictEqual(p.to_category_id, docelu);   // ten sam cel, więc na pewno ta sama para
  });

  return testyPropozycji(t);
};
