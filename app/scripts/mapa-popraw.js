// Korekta pojedynczego wpisu w `category_map` — słowniku „stara nazwa → kategoria docelowa",
// z którego import CSV bierze podpowiedzi.
//
// Po co osobne narzędzie. Reorganizacja zapisuje mapę RAZ i przy powtórce niczego nie
// przestawia (raport: „0 przestawionych") — świadomie, żeby nie deptać ręcznych decyzji.
// Gdy więc kolizja rozstrzygnie się źle, poprawka musi przyjść z zewnątrz.
//
// Powód powstania (2026-07-28): nazwa „Dodatkowe" trafiła w kolizję dwóch reguł — A29 kieruje
// ją do wydatkowego „Inne", C6 do przychodowego „PERSEVERA (wypłaty)". Skrypt wybrał wariant
// wydatkowy, bo w bazie był 1 wydatek i 0 przychodów o tej nazwie. Szymon rozstrzygnął odwrotnie:
// „Dodatkowe" to PRZYCHODY, „Inne" to WYDATKI. Bez tej poprawki import CSV podpowiadałby
// przychodom kategorię wydatkową — cicho, bo podpowiedź nie jest przypisaniem.
//
// DOMYŚLNIE NIC NIE ZAPISUJE. Pokazuje, co by zrobił; zapis dopiero z flagą --zapisz.
//
// Użycie:
//   node scripts/mapa-popraw.js --ksiega=1 --nazwa="Dodatkowe" --cel="PERSEVERA (wypłaty)"
//   node scripts/mapa-popraw.js --ksiega=1 --nazwa="Dodatkowe" --cel="…" --zapisz
//   `--cel` przyjmuje też ścieżkę z rodzicem: --cel="Dom i media > Prąd"
const { q, pool } = require('../src/db');

const arg = (n) => {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p === undefined ? null : p.slice(n.length + 3);
};
const ZAPISZ = process.argv.includes('--zapisz');

/** Kategoria po nazwie albo ścieżce „Rodzic > Dziecko" w danej księdze.
 *  Porównanie zostawiamy BAZIE (kolacja `utf8mb4_polish_ci`), zamiast robić je w JavaScripcie —
 *  ta sama pomyłka kosztowała już fałszywy alarm w `stan-przydzialu.js`. */
async function znajdzKategorie(ledger, sciezka) {
  const czesci = String(sciezka).split('>').map((s) => s.trim()).filter(Boolean);
  if (!czesci.length) return { blad: 'pusta nazwa kategorii' };
  if (czesci.length === 1) {
    const r = await q('SELECT id, name, active FROM categories WHERE ledger_id = :l AND name = :n',
      { l: ledger, n: czesci[0] });
    if (!r.length) return { blad: `nie ma kategorii „${czesci[0]}" w księdze ${ledger}` };
    if (r.length > 1) return { blad: `„${czesci[0]}" występuje ${r.length}× — podaj ścieżkę z rodzicem` };
    return { kat: r[0] };
  }
  const [rodzic] = czesci;
  const dziecko = czesci[czesci.length - 1];
  const r = await q(
    `SELECT c.id, c.name, c.active FROM categories c JOIN categories p ON p.id = c.parent_id
      WHERE c.ledger_id = :l AND p.name = :r AND c.name = :d`, { l: ledger, r: rodzic, d: dziecko });
  if (!r.length) return { blad: `nie ma kategorii „${rodzic} > ${dziecko}" w księdze ${ledger}` };
  if (r.length > 1) return { blad: `„${rodzic} > ${dziecko}" występuje ${r.length}×` };
  return { kat: r[0] };
}

/** Pełna ścieżka kategorii do wypisania — sam identyfikator nic człowiekowi nie mówi. */
async function sciezkaKategorii(id) {
  if (id === null || id === undefined) return '(brak — celowo pominięte)';
  const [c] = await q('SELECT c.id, c.name, p.name AS rodzic FROM categories c'
    + ' LEFT JOIN categories p ON p.id = c.parent_id WHERE c.id = :id', { id });
  if (!c) return `kategoria #${id} (NIE ISTNIEJE)`;
  return (c.rodzic ? `${c.rodzic} > ${c.name}` : c.name) + ` (#${c.id})`;
}

async function main() {
  const ksiega = Number(arg('ksiega'));
  const nazwa = arg('nazwa');
  const cel = arg('cel');
  if (!Number.isInteger(ksiega) || !nazwa || !cel) {
    console.log('Użycie: node scripts/mapa-popraw.js --ksiega=1 --nazwa="Dodatkowe"'
      + ' --cel="PERSEVERA (wypłaty)" [--zapisz]');
    process.exitCode = 1;
    return;
  }

  const wiersze = await q('SELECT id, old_name, category_id, note FROM category_map'
    + ' WHERE ledger_id = :l AND old_name = :n', { l: ksiega, n: nazwa });
  if (!wiersze.length) {
    console.log(`W mapie księgi ${ksiega} nie ma wpisu „${nazwa}". Nic do poprawienia.`);
    return;
  }
  const w = wiersze[0];

  const { kat, blad } = await znajdzKategorie(ksiega, cel);
  if (blad) { console.error('BŁĄD:', blad); process.exitCode = 1; return; }
  if (!kat.active) {
    console.error(`BŁĄD: kategoria „${cel}" jest w archiwum. Przywróć ją najpierw w panelu Admin —`
      + ' mapa wskazująca archiwum podpowiadałaby kategorię, której nie da się wybrać.');
    process.exitCode = 1;
    return;
  }

  console.log(`Wpis mapy: księga ${ksiega} · „${w.old_name}"`);
  console.log(`  teraz  → ${await sciezkaKategorii(w.category_id)}`);
  console.log(`  cel    → ${await sciezkaKategorii(kat.id)}`);

  if (Number(w.category_id) === Number(kat.id)) {
    console.log('\nJuż wskazuje cel — nic do zrobienia.');
    return;
  }
  if (!ZAPISZ) {
    console.log('\nPODGLĄD. Nic nie zapisałem. Powtórz z --zapisz, jeśli to jest to, czego chcesz.');
    return;
  }
  await q('UPDATE category_map SET category_id = :c, note = :note WHERE id = :id',
    { c: kat.id, id: w.id, note: String(w.note || '').slice(0, 100) + ' [poprawione ręcznie]' });
  console.log('\nZAPISANE. Mapa wskazuje teraz nowy cel.');
  console.log('Uwaga: to zmienia WYŁĄCZNIE podpowiedzi przy imporcie. Wpisy, które już leżą'
    + ' w bazie, zostają tam, gdzie są — mapa nigdy niczego nie przepina.');
}

main()
  .catch((e) => { console.error('BŁĄD:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
