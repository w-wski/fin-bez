// Diagnostyka stanu reorganizacji kategorii na ŻYWEJ bazie — punkt 10 planu wdrożenia.
// Odpowiada na dwa pytania naraz: czy `reorganize-categories.js` przeszedł na produkcji
// i czy karta „Przydział" ma co pokazywać.
//
// TYLKO ODCZYT: wyłącznie SELECT-y, zero INSERT/UPDATE/DELETE, zero transakcji. Można
// uruchamiać przy działającej aplikacji, w dowolnym momencie, dowolną liczbę razy.
// (Odpowiednikiem „co by się stało" jest `reorganize-categories.js --dry-run`, ale tamten
// robi CAŁĄ pracę w transakcji i trzyma migawkę REPEATABLE READ — tu nie ma takiego kosztu.)
//
// Użycie: node scripts/stan-przydzialu.js
const { q, pool } = require('../src/db');
const { F, P, TREE } = require('./reorganize-plan');

const KSIEGI = { [F]: 'RODZINA', [P]: 'PERSEVERA' };

// Ten sam warunek, którym liczy kartę „Przydział" (src/routes/proposals.js). Propozycja opisuje
// wpis w miejscu, w którym leżał przy jej powstaniu — jeśli wpis od tamtej pory przeniesiono
// ręcznie, propozycja jest nieaktualna i UI jej nie pokazuje. Liczenie tu innym warunkiem
// dałoby liczbę, której Szymon nie zobaczy na ekranie, czyli diagnostykę mylącą.
const AKTUALNE = "p.status = 'NOWA' AND t.deleted_at IS NULL AND (t.category_id <=> p.from_category_id)";

const zl = (v) => (Number(v || 0)).toFixed(2).replace('.', ',') + ' zł';

// Baza porównuje nazwy kolacją `utf8mb4_polish_ci` — NIECZULE na wielkość liter. Reorganizacja
// pyta `WHERE name=?` i trafia w istniejący wiersz zapisany inaczej („Bar Mleczny" dla planowego
// „Bar mleczny"), więc słusznie go nie dubluje. Porównywanie tych samych nazw w JavaScripcie
// przez `===` jest CZULE, więc pokazywało widmowe braki i kazało powtarzać udany przebieg.
// Diakrytyki zostają nietknięte: w polskiej kolacji „ą" to osobna litera, nie wariant „a".
const klucz = (n) => String(n == null ? '' : n).trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl');

async function tabelaJest(nazwa) {
  const r = await q('SELECT COUNT(*) n FROM information_schema.tables'
    + ' WHERE table_schema = DATABASE() AND table_name = :t', { t: nazwa });
  return Number(r[0].n) > 0;
}

async function main() {
  console.log('STAN REORGANIZACJI KATEGORII (tylko odczyt)\n' + '='.repeat(60));

  // 1) Czy migracja 008 w ogóle jest wgrana. Bez tej tabeli reorganizacja nie mogła się wykonać.
  if (!await tabelaJest('category_proposals')) {
    console.log('\nBRAK tabeli `category_proposals` → migracja 008 nie została wgrana.');
    console.log('Reorganizacja NIE przeszła. Kolejność: npm run migrate, potem'
      + ' node scripts/reorganize-categories.js --dry-run, na końcu przebieg właściwy.');
    return;
  }

  // 2) Drzewo docelowe: czy korzenie i dzieci z planu istnieją w bazie.
  const kat = await q('SELECT id, ledger_id, parent_id, name, active FROM categories', {});
  const wgKsiegi = new Map();
  for (const c of kat) {
    if (!wgKsiegi.has(c.ledger_id)) wgKsiegi.set(c.ledger_id, []);
    wgKsiegi.get(c.ledger_id).push(c);
  }
  console.log('\nDRZEWO KATEGORII');
  let brakiRazem = 0;
  for (const led of [F, P]) {
    const moje = wgKsiegi.get(led) || [];
    const nazwy = new Set(moje.map((c) => `${c.parent_id == null ? 0 : c.parent_id}|${klucz(c.name)}`));
    const korzenie = new Map(moje.filter((c) => c.parent_id == null).map((c) => [klucz(c.name), c.id]));
    const braki = [];
    for (const [root, kids] of Object.entries(TREE[led] || {})) {
      const rid = korzenie.get(klucz(root));
      if (rid === undefined) { braki.push(root); continue; }
      for (const kid of kids) if (!nazwy.has(`${rid}|${klucz(kid)}`)) braki.push(`${root} > ${kid}`);
    }
    brakiRazem += braki.length;
    const zywe = moje.filter((c) => c.active).length;
    console.log(`  ${KSIEGI[led]}: ${moje.length} kategorii (${zywe} aktywnych)`
      + ` · brakuje z planu: ${braki.length}`);
    for (const b of braki.slice(0, 10)) console.log(`      – ${b}`);
    if (braki.length > 10) console.log(`      … i jeszcze ${braki.length - 10}`);
  }

  // 3) Propozycje wg statusu — czy skrypt cokolwiek zapisał i ile już rozstrzygnięto.
  const wgStatusu = await q('SELECT status, COUNT(*) n FROM category_proposals GROUP BY status', {});
  const razem = wgStatusu.reduce((a, r) => a + Number(r.n), 0);
  console.log('\nPROPOZYCJE (wszystkie, niezależnie od aktualności)');
  if (!razem) console.log('  0 — skrypt reorganizacji NIE został uruchomiony na tej bazie.');
  for (const r of wgStatusu) console.log(`  ${r.status}: ${r.n}`);

  // 4) To, co faktycznie zobaczy człowiek w karcie „Przydział".
  const doPrzydzialu = await q(
    `SELECT t.ledger_id led, COUNT(*) n, COUNT(DISTINCT CONCAT(COALESCE(p.from_category_id, 'x'),
            '>', p.to_category_id)) grup, SUM(t.amount) suma
       FROM category_proposals p JOIN transactions t ON t.id = p.transaction_id
      WHERE ${AKTUALNE}
      GROUP BY t.ledger_id ORDER BY t.ledger_id`, {});
  console.log('\nDO PRZYDZIAŁU (to widzi karta „Przydział")');
  if (!doPrzydzialu.length) {
    console.log('  0 — Przydział będzie pusty.');
    if (razem) {
      console.log('  Propozycje istnieją, ale żadna nie jest aktualna: albo wszystkie już'
        + ' rozstrzygnięte, albo wpisy przeniesiono ręcznie po ich powstaniu.');
    }
  }
  for (const r of doPrzydzialu) {
    console.log(`  ${KSIEGI[r.led] || `księga ${r.led}`}: ${r.n} wpisów`
      + ` w ${r.grup} grupach · ${zl(r.suma)}`);
  }

  // 5) mapping_cache (E3): wzorce importu, którym reorganizacja wyczyściła wskaźnik kategorii,
  //    bo kategoria przeszła do drugiej księgi. Same wzorce zostają — podpowiedź wróci po
  //    pierwszym ręcznym przypisaniu. Liczba > 0 jest normalna, nie jest usterką.
  if (await tabelaJest('mapping_cache')) {
    const [mc] = await q('SELECT COUNT(*) razem, SUM(category_id IS NULL) puste FROM mapping_cache', {});
    console.log(`\nMAPPING_CACHE: ${mc.razem} wzorców, w tym ${mc.puste || 0} bez kategorii`);
  }

  // 6) Werdykt — jedno zdanie, żeby nie trzeba było interpretować liczb powyżej.
  console.log('\n' + '='.repeat(60));
  const doPrz = doPrzydzialu.reduce((a, r) => a + Number(r.n), 0);
  // Kolejność ma znaczenie: ISTNIENIE PROPOZYCJI jest mocniejszym dowodem, że przebieg
  // doszedł do końca, niż kompletność drzewa. Propozycje zapisują się na SAMYM KOŃCU tej samej
  // transakcji, co zakładanie kategorii — więc skoro są, commit przeszedł w całości. Wcześniej
  // brak jednej gałęzi przebijał ten fakt i kazał powtarzać udany przebieg.
  if (!razem) {
    console.log('WERDYKT: reorganizacja NIE przeszła — uruchom --dry-run, potem przebieg właściwy.');
  } else if (doPrz) {
    console.log(`WERDYKT: reorganizacja przeszła, Przydział ma ${doPrz} wpisów do decyzji.`);
  } else {
    console.log('WERDYKT: reorganizacja przeszła i nie ma nic do przydziału (wszystko rozstrzygnięte).');
  }
  if (brakiRazem) {
    console.log(`UWAGA: ${brakiRazem} gałęzi z planu nie widać w bazie. Przy istniejących`
      + ' propozycjach to NIE jest przerwany przebieg — najczęściej kategoria stoi pod inną'
      + ' nazwą, a plan i baza rozjechały się nazewniczo. Sprawdź, zanim cokolwiek powtórzysz.');
  }
}

main()
  .catch((e) => { console.error('BŁĄD:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
