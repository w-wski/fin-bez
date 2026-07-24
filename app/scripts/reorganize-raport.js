// Raport z przebiegu reorganizacji taksonomii — CZYSTY tekst, zero SQL. Wydzielony z
// scripts/reorganize-categories.js, żeby wykonawca zmieścił się w limicie 300 linii
// z preflighta (AGENTS.md: „przekroczenie = podziel moduł"). Wołany raz, po bramce
// księgowej, tym samym kodem w --dry-run i w przebiegu właściwym.
const { RULES, hits, zlot } = require('./reorganize-plan');

// Jedna linia na wiersz tabeli akceptacyjnej (A1…D4): ile kategorii i transakcji ruszyło,
// a jeśli zero — czy reguła w ogóle miała co łapać (kategorie na miejscu / w archiwum / BRAK).
function wierszeTabeli(cats, perRule, log) {
  log('== RAPORT PER WIERSZ TABELI AKCEPTACYJNEJ ==');
  for (const id of [...new Set(RULES.map((r) => r.id))]) {
    const p = perRule.get(id) || { cats: new Set(), tx: 0 };
    const moje = RULES.filter((r) => r.id === id);
    const froms = [...new Set(moje.flatMap((r) => r.from).filter((f) => f !== '*'))];
    const pas = cats.filter((c) => moje.some((r) => (!r.sl || r.sl === c.ledger_id) && r.from.some((f) => f !== '*' && hits(f, c))));
    const zyw = pas.filter((c) => c.active).length;
    const uwaga = p.cats.size || p.tx ? '' : pas.length
      ? `   (bez zmian: ${zyw} kat. na miejscu, ${pas.length - zyw} w archiwum)`
      : `   BRAK: nie znalazłem ${froms.map((f) => `„${f}"`).join(', ') || '(reguła po opisie / łapacz „*")'}`;
    log(`${id.padEnd(4)} kategorie: ${String(p.cats.size).padEnd(3)} transakcje: ${String(p.tx).padEnd(4)}`
      + ` → ${[...new Set(moje.map((r) => r.to || '(tylko archiwizacja)'))].join(' / ')}${uwaga}`);
  }
}

// Skrót wpisu do listy: „#12 2026-06-14 100.00 zł WYDATEK [kosz] · teraz: Bartuś".
const wpis = (tx, teraz) => `  #${tx.id} ${tx.tx_date} ${Number(tx.amount).toFixed(2)} zł ${tx.type}`
  + `${tx.deleted_at ? ' [kosz]' : ''} · teraz: ${teraz}`;
const opis = (tx) => `„${(tx.description || '').slice(0, 60)}"`;

// x = { cats, perRule, delta, opisowe, kand, zostaje, kolizje, notes, stat, plan, targets, wiszaceA, wiszaceB }
function raport(x, log = console.log) {
  wierszeTabeli(x.cats, x.perRule, log);
  log('\n== RUCH MIĘDZY KSIĘGAMI I TYPAMI (plan porównany z faktem) ==');
  const ruch = [...x.delta].filter(([, d]) => d.n || d.gr).sort();
  if (!ruch.length) log('  brak — żadna kwota nie zmienia księgi ani typu');
  for (const [k, d] of ruch) {
    const [led, typ, zywy] = k.split('|');
    log(`  księga ${led} · ${typ} · ${zywy === '1' ? 'żywe' : 'kosz'}: ${d.n > 0 ? '+' : ''}${d.n} wp. · ${d.gr > 0 ? '+' : ''}${zlot(d.gr)} zł`);
  }
  if (x.opisowe.length) {
    log(`\n== PRZEPIĘTE PO OPISIE (${x.opisowe.length}) — pojedyncze wpisy, poza category_map ==`);
    for (const o of x.opisowe) log(`${wpis(o.tx, o.teraz)} → ${o.rule.to} (${o.rule.id}) · ${opis(o.tx)}`);
  }
  if (x.kand.length) {
    log(`\n== DO RĘCZNEGO ROZSTRZYGNIĘCIA (${x.kand.length}) — skrypt tych wpisów NIE rusza ==`);
    log('  Zostają w kategorii z kolumny „teraz" (dlatego ich stare kategorie nie idą do archiwum).\n'
      + '  Dopóki nie przepniesz ich w UI, raporty przychodów i para najmu (K9) będą o nie uboższe.');
    for (const c of x.kand) log(`${wpis(c.tx, c.teraz)} · ${opis(c.tx)} → propozycja ${c.k.id}: ${c.k.to}`);
  }
  if (x.zostaje.size) {
    log(`\n== BEZ REGUŁY DLA SWOJEGO PRZEPŁYWU (${[...x.zostaje.values()].reduce((s, n) => s + n, 0)}) — zostają na miejscu ==`);
    for (const [k, n] of x.zostaje) log(`  ${k.split('|')[0]} · ${k.split('|')[1]}: ${n} wpis(ów) — kategoria się przenosi,`
      + ' ten przepływ nie ma reguły; wpis NIE dziedziczy ani księgi, ani kategorii');
  }
  if (x.kolizje.length) { log(`\n== KOLIZJE SŁOWNIKA (${x.kolizje.length}) — nic nie połknięte ==`); x.kolizje.forEach((k) => log('  ' + k)); }
  x.cats.filter((c) => c.active && !x.plan.has(c.id) && !x.targets.has(c.id) && /^PERSEVERA\b/i.test(c.name))
    .forEach((c) => x.notes.push(`„${c.path}" (księga ${c.ledger_id}) nie pasuje do żadnej reguły D — zostaje bez zmian`));
  const s = x.stat;
  log(`\n== PODSUMOWANIE ==\nnowe kategorie: ${s.cats} (dzieci przeniesione 1:1: ${s.kids}) · transakcje przepięte: ${s.tx} (w tym z kosza: ${s.txKosz})`);
  log(`kategorie zarchiwizowane: ${s.arch} · przywrócone (mają wpisy): ${s.ozyw} · category_map: +${s.map} nowych / ${s.mapUpd} przestawionych`
    + `\nmapping_cache: ${s.cache} przestawionych, ${s.cacheNull} wyczyszczonych (kategoria zmienia księgę)`
    + `\nwpisy na kategoriach active=0: ${x.wiszaceA} → ${x.wiszaceB} · kandydaci do ręcznej decyzji: ${x.kand.length}`);
  x.notes.forEach((n) => log('UWAGA: ' + n));
  // „0 zmian" (K2) liczymy ze WSZYSTKICH liczników ZAPISU — inaczej raport potrafił ogłosić
  // brak zmian, mając za sobą UPDATE w category_map albo w mapping_cache. `txKosz` i `kids`
  // to podzbiory `tx`/`cats`, więc nie wchodzą do testu.
  if (!['cats', 'tx', 'arch', 'map', 'mapUpd', 'cache', 'cacheNull', 'ozyw'].some((k) => s[k])) {
    log('0 zmian — baza jest już zreorganizowana.');
  }
}

module.exports = { raport, wierszeTabeli };
