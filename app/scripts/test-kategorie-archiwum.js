#!/usr/bin/env node
// Testy Z16: archiwizacja kategorii NULL-uje category_id wyłącznie wpisom tej kategorii (K3),
// bez ruszania kwot (zakaz zlecenia), w JEDNEJ transakcji z archiwizacją; odmowa przy aktywnych
// dzieciach (K5); licznik wpisów bez potomków i lista „bez kategorii" respektująca zasięg (K2/K4).
// Bez bazy: atrapa puli zapisuje kolejność instrukcji (wzorzec test-kategorie.js/test-reorganize-prop.js).
const assert = require('assert');
const { zapiszPatch, polaPatcha, mapaLicznikow, dolaczLiczniki, ledgeryZadania } = require('../src/routes/categories');

let failures = 0;
function t(name, fn) { try { fn(); console.log('OK  ', name); } catch (e) { failures++; console.error('FAIL', name, '—', e.message); } }
async function ta(name, fn) { try { await fn(); console.log('OK  ', name); } catch (e) { failures++; console.error('FAIL', name, '—', e.message); } }

// Atrapa puli: FOR UPDATE zwraca `rows`, każdy inny UPDATE „przechodzi" z affectedRows=1.
function atrapaPuli(rows) {
  const log = [];
  const execute = async (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    log.push(s);
    if (s.endsWith('FOR UPDATE')) return [rows];
    return [{ affectedRows: 1 }];
  };
  const conn = { execute, beginTransaction: async () => log.push('BEGIN'), commit: async () => log.push('COMMIT'),
    rollback: async () => log.push('ROLLBACK'), release: () => log.push('RELEASE') };
  return { pula: { getConnection: async () => conn }, log };
}
// Statement, który NULL-uje category_id — czy to zwykły UPDATE categories, czy (K3) multi-table
// UPDATE ... LEFT JOIN transactions ... SET ..., transactions.category_id = NULL.
const zapisyArch = (log) => log.filter((s) => /transactions\.category_id = NULL/.test(s));

// Dom(1) > Czynsz(2), Jedzenie(3) bez dzieci — wszystko aktywne, księga 1.
const DOM = [
  { id: 1, ledger_id: 1, parent_id: null, active: 1 },
  { id: 2, ledger_id: 1, parent_id: 1, active: 1 },
  { id: 3, ledger_id: 1, parent_id: null, active: 1 },
];

(async () => {
  await ta('K3: archiwizacja leafa NULL-uje category_id TYLKO tej kategorii, w tej samej instrukcji SQL', async () => {
    const { pula, log } = atrapaPuli(DOM);
    const w = await zapiszPatch(3, 1, polaPatcha({ active: 0 }), pula);
    assert.strictEqual(w.status, 200, JSON.stringify(w.body));
    const arch = zapisyArch(log);
    assert.strictEqual(arch.length, 1, 'dokładnie jedna instrukcja nulująca category_id');
    assert.ok(/WHERE categories\.id = \?/.test(arch[0]), 'musi celować w id=3, nie w cudze kategorie: ' + arch[0]);
    // BEGIN...COMMIT obejmuje archiwizację i odpięcie wpisów RAZEM (jedna transakcja SQL)
    assert.ok(log.indexOf('BEGIN') < log.indexOf(arch[0]) && log.indexOf(arch[0]) < log.indexOf('COMMIT'));
  });

  await ta('K3: kwota/data/opis nie wchodzą do zapytania — jedyne, co się rusza, to category_id', async () => {
    const { pula, log } = atrapaPuli(DOM);
    await zapiszPatch(3, 1, polaPatcha({ active: 0 }), pula);
    const arch = zapisyArch(log);
    assert.ok(!/\bamount\b|\btx_date\b|\bdescription\b/.test(arch[0]), 'nie wolno dotykać kwoty/daty/opisu: ' + arch[0]);
  });

  await ta('K3: archiwizacja z kaskadą NULL-uje wpisy rodzica I dzieci — po jednej instrukcji na każdy', async () => {
    const { pula, log } = atrapaPuli(DOM);
    const w = await zapiszPatch(1, 1, polaPatcha({ active: 0, cascade: true }), pula);
    assert.strictEqual(w.status, 200, JSON.stringify(w.body));
    const arch = zapisyArch(log);
    assert.strictEqual(arch.length, 2, 'rodzic i dzieci: jedna instrukcja na każdą kategorię archiwizowaną');
    assert.ok(/WHERE categories\.id = \?/.test(arch[0]), arch[0]);
    assert.ok(/WHERE parent_id = \? AND active = 1/.test(arch[1]), arch[1]);
  });

  await ta('K5: kategoria z AKTYWNYMI dziećmi bez cascade — odmowa, żaden wpis nie traci kategorii', async () => {
    const { pula, log } = atrapaPuli(DOM);
    const w = await zapiszPatch(1, 1, polaPatcha({ active: 0 }), pula);
    assert.strictEqual(w.status, 409);
    assert.strictEqual(w.body.error, 'has_active_children');
    assert.strictEqual(zapisyArch(log).length, 0, 'odmowa nie może niczego odpiąć');
    assert.ok(log.includes('ROLLBACK') && !log.includes('COMMIT'));
  });

  t('K2: licznik wpisów per kategoria liczy się BEZ potomków (rodzic i dziecko mają osobne sumy)', () => {
    const rows = [{ category_id: 1, n: 5 }, { category_id: 2, n: 3 }, { category_id: null, n: 9 }];
    const mapa = mapaLicznikow(rows);
    const drzewo = [{ id: 1, name: 'Dom', children: [{ id: 2, name: 'Czynsz' }] }, { id: 3, name: 'Jedzenie', children: [] }];
    const z = dolaczLiczniki(drzewo, mapa);
    assert.strictEqual(z[0].n, 5);              // Dom — tylko jego własne wpisy, nie +dziecko
    assert.strictEqual(z[0].children[0].n, 3);   // Czynsz — osobno
    assert.strictEqual(z[1].n, 0);               // Jedzenie bez wpisów = 0, nie undefined
  });

  t('K4: lista „bez kategorii" respektuje zasięg ksiąg — cudza księga w ?ledger= jest odmówiona', () => {
    const scope = { ledgers: [1, 2], ownOnly: false };
    assert.deepStrictEqual(ledgeryZadania(scope, null), { ledgery: [1, 2] });
    assert.deepStrictEqual(ledgeryZadania(scope, 1), { ledgery: [1] });
    assert.deepStrictEqual(ledgeryZadania(scope, 3), { error: 'ledger_forbidden' });
    assert.deepStrictEqual(ledgeryZadania({ ledgers: [1], ownOnly: true }, 2), { error: 'ledger_forbidden' });
  });

  if (failures) { console.error(`\n${failures} test(ów) NIE przeszło`); process.exit(1); }
  console.log('\nWszystkie testy archiwizacji kategorii przeszły.');
})();
