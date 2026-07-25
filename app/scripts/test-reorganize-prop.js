// Testy przyjęcia i zmiany celu propozycji przydziału (zlecenie Z5, K7 i K8) — BEZ bazy:
// atrapa puli połączeń zapisuje kolejność instrukcji SQL i podaje umówione wiersze. Osobny
// plik, bo test-reorganize-scen.js dobił do limitu 300 linii z preflighta; wołany z tamtego
// pliku, na tym samym liczniku błędów, więc `npm test` zostaje bez zmian w package.json.
const assert = require('assert');
const { przyjmij, bladRetarget, grupujCele, parsujKlucz, parsujIds, kluczGrupy,
  groszeZ } = require('../src/routes/proposals');

// Test asynchroniczny na wspólnym (synchronicznym) liczniku błędów: najpierw wykonujemy
// ciało, a dopiero wynik zgłaszamy przez `t` z pliku głównego.
async function ta(t, nazwa, fn) {
  let blad = null;
  try { await fn(); } catch (e) { blad = e; }
  t(nazwa, () => { if (blad) throw blad; });
}

// ---------- Z5/K7, K8: przyjęcie i zmiana celu bez bazy ----------
// Atrapa puli zapisuje kolejność instrukcji i podaje umówione wiersze. Blokada (FOR UPDATE)
// musi paść przed walidacją, a każda odmowa kończyć się ROLLBACK-iem, nigdy połowicznym zapisem.
function atrapa({ props, kats, migawki }) {
  const log = [];
  const query = async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    log.push(s);
    if (/^SELECT COUNT\(\*\) n, SUM\(amount\)/.test(s)) return [[migawki.shift()]];
    if (/FROM category_proposals p JOIN transactions/.test(s)) return [props];
    if (/FROM categories WHERE id IN/.test(s)) return [kats];
    return [{ affectedRows: 1 }];
  };
  const conn = { query, beginTransaction: async () => log.push('BEGIN'), commit: async () => log.push('COMMIT'),
    rollback: async () => log.push('ROLLBACK'), release: () => log.push('RELEASE') };
  return { pula: { getConnection: async () => conn }, log };
}
const PROP = (o = {}) => ({ id: 11, transaction_id: 501, status: 'NOWA', to_category_id: 77, to_ledger_id: null,
  to_type: null, tag: null, ledger_id: 1, type: 'WYDATEK', tx_tag: null, ...o });
const KAT = (o = {}) => ({ id: 77, ledger_id: 1, active: 1, ...o });
const RONE = { n: 2, suma: '150.00' };
const zapisyZ = (log) => log.filter((s) => s.startsWith('UPDATE'));

module.exports = async function testyPropozycji(t) {
  await ta(t, 'Z5/K7: przyjęcie = BEGIN → FOR UPDATE → UPDATE wpisów → propozycje → COMMIT', async () => {
    const { pula, log } = atrapa({ props: [PROP(), PROP({ id: 12, transaction_id: 502 })], kats: [KAT()],
      migawki: [{ ...RONE }, { ...RONE }] });
    const w = await przyjmij([11, 12], 9, pula);
    assert.strictEqual(w.status, 200, JSON.stringify(w.body));
    assert.strictEqual(w.body.przyjete, 2);
    assert.strictEqual(log[0], 'BEGIN');
    assert.ok(log[1].endsWith('FOR UPDATE'), 'blokada przed walidacją: ' + log[1]);
    const z = zapisyZ(log);
    assert.strictEqual(z.length, 2, z.join(' | '));
    assert.ok(/^UPDATE transactions SET category_id=\?, ledger_id=\?, type=\?, tag=\? WHERE id IN \(\?\)$/.test(z[0]), z[0]);
    assert.ok(/UPDATE category_proposals SET status='PRZYJETA'.*decided_by/.test(z[1]), z[1]);
    assert.deepStrictEqual(log.slice(-2), ['COMMIT', 'RELEASE']);
  });
  await ta(t, 'Z5/K7: inna SUMA kwot po przepięciu = ROLLBACK, nie COMMIT', async () => {
    const { pula, log } = atrapa({ props: [PROP()], kats: [KAT()], migawki: [{ ...RONE }, { n: 2, suma: '140.00' }] });
    const w = await przyjmij([11], 9, pula);
    assert.strictEqual(w.status, 500);
    assert.strictEqual(w.body.error, 'ksiega_sie_nie_zgadza');
    assert.ok(log.includes('ROLLBACK') && !log.includes('COMMIT'), log.join(' | '));
  });
  await ta(t, 'Z5/K7: inna LICZBA wpisów po przepięciu = ROLLBACK', async () => {
    const { pula, log } = atrapa({ props: [PROP()], kats: [KAT()], migawki: [{ ...RONE }, { n: 1, suma: '150.00' }] });
    const w = await przyjmij([11], 9, pula);
    assert.strictEqual(w.status, 500);
    assert.ok(log.includes('ROLLBACK') && !log.includes('COMMIT'));
  });
  await ta(t, 'Z5/K7: ponowne przyjęcie tej samej grupy nic nie robi (idempotencja)', async () => {
    const { pula, log } = atrapa({ props: [PROP({ status: 'PRZYJETA' })], kats: [], migawki: [] });
    const w = await przyjmij([11], 9, pula);
    assert.deepStrictEqual([w.status, w.body.przyjete, w.body.pominiete], [200, 0, 1]);
    assert.strictEqual(zapisyZ(log).length, 0, 'coś zapisano: ' + zapisyZ(log).join(' | '));
    assert.ok(!log.includes('COMMIT'));
  });
  await ta(t, 'Z5/K7: cel z innej księgi niż docelowa = 400 i zero zapisów', async () => {
    const { pula, log } = atrapa({ props: [PROP({ to_ledger_id: 2 })], kats: [KAT({ ledger_id: 1 })], migawki: [] });
    const w = await przyjmij([11], 9, pula);
    assert.strictEqual(w.status, 400);
    assert.strictEqual(w.body.error, 'bad_category');
    assert.strictEqual(zapisyZ(log).length, 0);
    assert.ok(log.includes('ROLLBACK') && !log.includes('COMMIT'));
  });
  await ta(t, 'Z5/K7: wpisy nie wiszą na kategorii z archiwum — cel wraca do aktywnych', async () => {
    const { pula, log } = atrapa({ props: [PROP()], kats: [KAT({ active: 0 })], migawki: [{ ...RONE }, { ...RONE }] });
    const w = await przyjmij([11], 9, pula);
    assert.strictEqual(w.body.przywrocone_kategorie, 1);
    assert.ok(zapisyZ(log).some((s) => /UPDATE categories SET active=1/.test(s)), zapisyZ(log).join(' | '));
    assert.ok(log.includes('COMMIT'));
  });
  await ta(t, 'Z5/K7: puste żądanie nie otwiera nawet transakcji', async () => {
    const w = await przyjmij([], 9, { getConnection: () => { throw new Error('nie wolno brać połączenia'); } });
    assert.deepStrictEqual([w.status, w.body.przyjete], [200, 0]);
  });
  t('Z5/K7: brak zmiany typu/tagu = wartość wpisu, nie ciche wyczyszczenie', () => {
    const jeden = (o) => [...grupujCele([PROP(o)]).values()][0];
    assert.strictEqual(jeden({ tx_tag: 'wyjazd-2026-06' }).g, 'wyjazd-2026-06');
    assert.strictEqual(jeden({ tag: 'wyjazd-2026-07', tx_tag: 'wyjazd-2026-06' }).g, 'wyjazd-2026-07');
    assert.strictEqual(jeden({}).t, 'WYDATEK');
    assert.deepStrictEqual([jeden({ to_type: 'TRANSFER', to_ledger_id: 2 }).t, jeden({ to_ledger_id: 2 }).l], ['TRANSFER', 2]);
    assert.strictEqual(grupujCele([PROP(), PROP({ id: 12, transaction_id: 502 })]).size, 1); // ten sam cel = jeden UPDATE
  });
  t('Z5/K8: nowy cel musi istnieć, być aktywny i leżeć we właściwej księdze', () => {
    const p1 = [{ id: 11, to_ledger_id: null, ledger_id: 1 }];
    assert.strictEqual(bladRetarget(p1, { id: 5, ledger_id: 1, active: 1 }), null);
    assert.strictEqual(bladRetarget(p1, null), 'category_not_found');
    assert.strictEqual(bladRetarget(p1, { id: 5, ledger_id: 1, active: 0 }), 'category_archived');
    assert.strictEqual(bladRetarget(p1, { id: 5, ledger_id: 2, active: 1 }), 'category_other_ledger');
    assert.strictEqual(bladRetarget([], { id: 5, ledger_id: 1, active: 1 }), 'nothing_to_update');
    // propozycja przenosi wpis do księgi 2 — cel musi być z księgi 2, nie z tej, w której wpis leży dziś
    const p2 = [{ id: 12, to_ledger_id: 2, ledger_id: 1 }];
    assert.strictEqual(bladRetarget(p2, { id: 5, ledger_id: 1, active: 1 }), 'category_other_ledger');
    assert.strictEqual(bladRetarget(p2, { id: 5, ledger_id: 2, active: 1 }), null);
  });
  t('Z5/K6: klucz grupy i lista identyfikatorów odsiewają wszystko, co nie jest liczbą', () => {
    assert.strictEqual(kluczGrupy(null, 45), '0-45');
    assert.deepStrictEqual(parsujKlucz('12-45'), { from: 12, to: 45 });
    assert.deepStrictEqual(parsujKlucz('0-45'), { from: null, to: 45 });
    for (const zly of ['12-0', '12', 'a-b', '1-2; DROP TABLE transactions', '', null, '-1-2']) {
      assert.strictEqual(parsujKlucz(zly), null, 'przeszło: ' + zly);
    }
    assert.deepStrictEqual(parsujIds(['3', 4, 3]), [3, 4]);
    assert.deepStrictEqual(parsujIds([]), []);
    for (const zle of [['5 OR 1=1'], [0], [-2], [1.5], 'ids', null, [{}]]) assert.strictEqual(parsujIds(zle), null);
  });
  t('Z5: SUM(amount) z MySQL to NAPIS — grosze liczy parseKwota, nie parseFloat', () => {
    assert.strictEqual(groszeZ('4600.00'), 460000);
    assert.strictEqual(groszeZ(null), 0);          // pusta grupa: SUM zwraca NULL
    assert.strictEqual(groszeZ('0.00'), 0);
    assert.strictEqual(groszeZ('1234567.89'), 123456789);
  });
};
