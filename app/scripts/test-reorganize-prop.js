// Testy przyjęcia i zmiany celu propozycji przydziału (zlecenie Z5, K7 i K8) — BEZ bazy:
// atrapa puli połączeń zapisuje kolejność instrukcji SQL i podaje umówione wiersze. Osobny
// plik, bo test-reorganize-scen.js dobił do limitu 300 linii z preflighta; wołany z tamtego
// pliku, na tym samym liczniku błędów, więc `npm test` zostaje bez zmian w package.json.
// Runda poprawek: bramka na kubełkach księga × typ (a nie tautologiczne COUNT/SUM po id),
// pomijanie propozycji nieaktualnych i wpisów z Kosza, jeden wpis = jeden UPDATE.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { przyjmij, AKTUALNE } = require('../src/routes/proposals');
const { bladRetarget, grupujCele, parsujKlucz, parsujIds, kluczGrupy, groszeZ,
  dubleWpisow, nieaktualna, kubelki, oczekiwanaDelta, rozbieznosci, tkniete } = require('../src/proposals-core');

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
// `po` = wiersze transakcji, które atrapa pokaże PO przepięciu (tu podrzucamy szkody).
function atrapa({ props, kats, po, blad }) {
  const log = [];
  const query = async (sql, parms) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    log.push(s);
    if (blad && /^UPDATE transactions/.test(s)) throw Object.assign(new Error('blokada'), { code: blad });
    if (/^SELECT id, ledger_id, type, amount, tx_date FROM transactions/.test(s)) return [po || []];
    if (/FROM category_proposals p JOIN transactions/.test(s)) return [props];
    if (/FROM categories WHERE id IN/.test(s)) return [kats];
    return [{ affectedRows: (parms && parms[1] && parms[1].length) || 1 }];
  };
  const conn = { query, beginTransaction: async () => log.push('BEGIN'), commit: async () => log.push('COMMIT'),
    rollback: async () => log.push('ROLLBACK'), release: () => log.push('RELEASE') };
  return { pula: { getConnection: async () => conn }, log };
}
const PROP = (o = {}) => ({ id: 11, transaction_id: 501, status: 'NOWA', from_category_id: 5, to_category_id: 77,
  to_ledger_id: null, to_type: null, tag: null, category_id: 5, ledger_id: 1, type: 'WYDATEK', tx_tag: null,
  amount: '150.00', tx_date: '2026-06-14', deleted_at: null, ...o });
const KAT = (o = {}) => ({ id: 77, ledger_id: 1, active: 1, ...o });
// Wiersze „po", gdy baza zrobiła DOKŁADNIE to, co mówią propozycje — bramka ma je przepuścić.
const wzorowe = (props) => props.map((p) => ({ id: p.transaction_id, ledger_id: p.to_ledger_id || p.ledger_id,
  type: p.to_type || p.type, amount: p.amount, tx_date: p.tx_date }));
const zapisyZ = (log) => log.filter((s) => s.startsWith('UPDATE'));
const zrodlo = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');

module.exports = async function testyPropozycji(t) {
  await ta(t, 'Z5/K7: przyjęcie = BEGIN → FOR UPDATE → UPDATE wpisów → propozycje → COMMIT', async () => {
    const props = [PROP(), PROP({ id: 12, transaction_id: 502 })];
    const { pula, log } = atrapa({ props, kats: [KAT()], po: wzorowe(props) });
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

  // ---------- bramka: kubełki księga × typ, fakt vs propozycje ----------
  // Dawna bramka liczyła COUNT/SUM po `id IN (txIds)` przed i po, a UPDATE nie dotyka ani `id`,
  // ani `amount` — różnica była arytmetycznie niemożliwa, czyli komunikat „ksiega_sie_nie_zgadza"
  // obiecywał ochronę, której nie było. Poniższe przypadki dawna bramka przepuszczała.
  const SZKODY = [
    ['błędne to_ledger_id: 23 wpisy wyszły z RODZINY do PERSEVERY, choć propozycja tego nie mówi',
      [PROP()], [{ id: 501, ledger_id: 2, type: 'WYDATEK', amount: '150.00', tx_date: '2026-06-14' }]],
    ['propozycja przenosi do księgi 2, a wpis został w księdze 1 (UPDATE nie zadziałał)',
      [PROP({ to_ledger_id: 2 })], [{ id: 501, ledger_id: 1, type: 'WYDATEK', amount: '150.00', tx_date: '2026-06-14' }]],
    ['typ zmieniony na TRANSFER bez podstawy w propozycji (wpis wypada z income/trendu)',
      [PROP()], [{ id: 501, ledger_id: 1, type: 'TRANSFER', amount: '150.00', tx_date: '2026-06-14' }]],
    ['kwota wpisu inna po przepięciu — w księdze rachunkowej to najgorszy możliwy błąd',
      [PROP()], [{ id: 501, ledger_id: 1, type: 'WYDATEK', amount: '140.00', tx_date: '2026-06-14' }]],
    ['data wpisu inna po przepięciu (wpis wskakuje do innego miesiąca)',
      [PROP()], [{ id: 501, ledger_id: 1, type: 'WYDATEK', amount: '150.00', tx_date: '2026-07-01' }]],
    ['wpis zniknął ze zbioru dotkniętych', [PROP()], []],
  ];
  for (const [nazwa, props, po] of SZKODY) {
    await ta(t, 'Z5/K7 bramka: ' + nazwa + ' = ROLLBACK', async () => {
      const kats = [KAT({ ledger_id: props[0].to_ledger_id || 1 })];
      const { pula, log } = atrapa({ props, kats, po });
      const w = await przyjmij([11], 9, pula);
      assert.strictEqual(w.status, 500, JSON.stringify(w.body));
      assert.strictEqual(w.body.error, 'ksiega_sie_nie_zgadza');
      assert.ok(w.body.rozbieznosci.length, 'brak opisu rozbieżności');
      assert.ok(log.includes('ROLLBACK') && !log.includes('COMMIT'), log.join(' | '));
    });
  }
  await ta(t, 'Z5/K7: zmiana księgi ZGODNA z propozycją przechodzi (bramka nie blokuje przydziału)', async () => {
    const props = [PROP({ to_ledger_id: 2, to_type: 'TRANSFER' })];
    const { pula, log } = atrapa({ props, kats: [KAT({ ledger_id: 2 })], po: wzorowe(props) });
    const w = await przyjmij([11], 9, pula);
    assert.strictEqual(w.status, 200, JSON.stringify(w.body));
    assert.ok(log.includes('COMMIT'));
  });

  // ---------- jeden wpis, jeden UPDATE + propozycje nieaktualne i Kosz ----------
  await ta(t, 'Z5: dwie propozycje TEGO SAMEGO wpisu w żądaniu = 400 i zero zapisów', async () => {
    const props = [PROP(), PROP({ id: 12, to_category_id: 88 })];   // ten sam transaction_id 501
    const { pula, log } = atrapa({ props, kats: [KAT()], po: [] });
    const w = await przyjmij([11, 12], 9, pula);
    assert.strictEqual(w.status, 400);
    assert.strictEqual(w.body.error, 'sprzeczne_propozycje');
    assert.deepStrictEqual(w.body.transactions, [501]);
    assert.strictEqual(zapisyZ(log).length, 0, zapisyZ(log).join(' | '));
    assert.ok(log.includes('ROLLBACK') && !log.includes('COMMIT'));
  });
  await ta(t, 'Z5: propozycja NIEAKTUALNA (wpis przeniesiony ręcznie) nie przepina niczego', async () => {
    // #501 leży dziś w kategorii 6, a propozycja opisuje go w kategorii 5 — Szymon przeniósł go
    // ręcznie w Historii. Przyjęcie cofnęłoby jego decyzję bez śladu.
    const { pula, log } = atrapa({ props: [PROP({ category_id: 6 })], kats: [], po: [] });
    const w = await przyjmij([11], 9, pula);
    assert.deepStrictEqual([w.status, w.body.przyjete, w.body.nieaktualne], [200, 0, 1]);
    assert.ok(!zapisyZ(log).some((s) => s.startsWith('UPDATE transactions')), zapisyZ(log).join(' | '));
    // Migracja 009: własny status, data BEZ decided_by — to nie decyzja człowieka.
    assert.ok(zapisyZ(log).some((s) => /UPDATE category_proposals SET status='NIEAKTUALNA', decided_at=NOW\(\)/.test(s)),
      'brak znacznika nieaktualności');
    assert.ok(!zapisyZ(log).some((s) => /status='NIEAKTUALNA'[^|]*decided_by/.test(s)),
      'nieaktualna nie może dostać decided_by — nikt tej decyzji nie podjął');
    assert.ok(log.includes('COMMIT'));
  });
  await ta(t, 'Z5: wpis z KOSZA nie bierze udziału w przydziale (pomijany, nie przepinany)', async () => {
    const { pula, log } = atrapa({ props: [PROP({ deleted_at: '2026-07-01 10:00:00' })], kats: [], po: [] });
    const w = await przyjmij([11], 9, pula);
    assert.deepStrictEqual([w.status, w.body.przyjete, w.body.w_koszu], [200, 0, 1]);
    assert.strictEqual(zapisyZ(log).length, 0, zapisyZ(log).join(' | '));
  });
  await ta(t, 'Z5: nieaktualna obok dobrej — przepina się TYLKO dobra', async () => {
    const dobra = PROP({ id: 12, transaction_id: 502 });
    const { pula, log } = atrapa({ props: [PROP({ category_id: 6 }), dobra], kats: [KAT()], po: wzorowe([dobra]) });
    const w = await przyjmij([11, 12], 9, pula);
    assert.deepStrictEqual([w.status, w.body.przyjete, w.body.nieaktualne], [200, 1, 1]);
    assert.ok(log.includes('COMMIT'));
  });

  // ---------- odmowy ----------
  await ta(t, 'Z5/K7: ponowne przyjęcie tej samej grupy nic nie robi (idempotencja)', async () => {
    const { pula, log } = atrapa({ props: [PROP({ status: 'PRZYJETA' })], kats: [], po: [] });
    const w = await przyjmij([11], 9, pula);
    assert.deepStrictEqual([w.status, w.body.przyjete, w.body.pominiete], [200, 0, 1]);
    assert.strictEqual(zapisyZ(log).length, 0, 'coś zapisano: ' + zapisyZ(log).join(' | '));
    assert.ok(!log.includes('COMMIT'));
  });
  await ta(t, 'Z5/K7: cel z innej księgi niż docelowa = 400 i zero zapisów', async () => {
    const { pula, log } = atrapa({ props: [PROP({ to_ledger_id: 2 })], kats: [KAT({ ledger_id: 1 })], po: [] });
    const w = await przyjmij([11], 9, pula);
    assert.strictEqual(w.status, 400);
    assert.strictEqual(w.body.error, 'bad_category');
    assert.strictEqual(zapisyZ(log).length, 0);
    assert.ok(log.includes('ROLLBACK') && !log.includes('COMMIT'));
  });
  await ta(t, 'Z5: cel w ARCHIWUM = odmowa, a nie ciche `active=1` za plecami właściciela', async () => {
    const { pula, log } = atrapa({ props: [PROP()], kats: [KAT({ active: 0 })], po: [] });
    const w = await przyjmij([11], 9, pula);
    assert.deepStrictEqual([w.status, w.body.error, w.body.category], [400, 'category_archived', 77]);
    assert.strictEqual(zapisyZ(log).length, 0, zapisyZ(log).join(' | '));
    assert.ok(!/UPDATE categories/.test(zrodlo('..', 'src', 'routes', 'proposals.js')),
      'accept nadal pisze do `categories` — przywracanie celu z archiwum odwraca decyzję właściciela');
  });
  await ta(t, 'Z5: zakleszczenie blokady = 409 „busy", nie 500 z surowym komunikatem MySQL-a', async () => {
    for (const code of ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']) {
      const props = [PROP()];
      const { pula, log } = atrapa({ props, kats: [KAT()], po: wzorowe(props), blad: code });
      const w = await przyjmij([11], 9, pula);
      assert.deepStrictEqual([w.status, w.body.error], [409, 'busy'], code);
      assert.ok(log.includes('ROLLBACK') && !log.includes('COMMIT'), code);
    }
  });
  await ta(t, 'Z5/K7: puste żądanie nie otwiera nawet transakcji', async () => {
    const w = await przyjmij([], 9, { getConnection: () => { throw new Error('nie wolno brać połączenia'); } });
    assert.deepStrictEqual([w.status, w.body.przyjete], [200, 0]);
  });

  // ---------- czyste pomocniki (src/proposals-core.js) ----------
  t('Z5/K7: brak zmiany typu/tagu = wartość wpisu, nie ciche wyczyszczenie', () => {
    const jeden = (o) => [...grupujCele([PROP(o)]).values()][0];
    assert.strictEqual(jeden({ tx_tag: 'wyjazd-2026-06' }).g, 'wyjazd-2026-06');
    assert.strictEqual(jeden({ tag: 'wyjazd-2026-07', tx_tag: 'wyjazd-2026-06' }).g, 'wyjazd-2026-07');
    assert.strictEqual(jeden({}).t, 'WYDATEK');
    assert.deepStrictEqual([jeden({ to_type: 'TRANSFER', to_ledger_id: 2 }).t, jeden({ to_ledger_id: 2 }).l], ['TRANSFER', 2]);
    assert.strictEqual(grupujCele([PROP(), PROP({ id: 12, transaction_id: 502 })]).size, 1); // ten sam cel = jeden UPDATE
  });
  t('Z5: duble wpisów i nieaktualność liczą NULL jak SQL-owe `<=>`', () => {
    assert.deepStrictEqual(dubleWpisow([PROP(), PROP({ id: 12 })]), [501]);
    assert.deepStrictEqual(dubleWpisow([PROP(), PROP({ id: 12, transaction_id: 502 })]), []);
    assert.strictEqual(nieaktualna(PROP()), false);
    assert.strictEqual(nieaktualna(PROP({ category_id: null, from_category_id: null })), false);  // oba bez kategorii
    assert.strictEqual(nieaktualna(PROP({ category_id: null })), true);                            // wpis stracił kategorię
    assert.strictEqual(nieaktualna(PROP({ from_category_id: null })), true);                       // wpis ją zyskał
  });
  t('Z5: kubełki księga × typ i oczekiwana delta z propozycji', () => {
    const k = kubelki([PROP(), PROP({ transaction_id: 502, amount: '50.00' })]);
    assert.deepStrictEqual(k.get('1|WYDATEK'), { n: 2, gr: 20000 });
    const d = oczekiwanaDelta([PROP({ to_ledger_id: 2, to_type: 'TRANSFER' })]);
    assert.deepStrictEqual(d.get('1|WYDATEK'), { n: -1, gr: -15000 });
    assert.deepStrictEqual(d.get('2|TRANSFER'), { n: 1, gr: 15000 });
    // przydział bez zmiany księgi i typu nie rusza kubełków — delta się zeruje
    const zero = oczekiwanaDelta([PROP()]);
    assert.deepStrictEqual(zero.get('1|WYDATEK'), { n: 0, gr: 0 });
    assert.deepStrictEqual(rozbieznosci(k, k, zero), []);
    assert.strictEqual(rozbieznosci(k, new Map(), zero).length, 1);
    assert.deepStrictEqual(tkniete([PROP()], wzorowe([PROP()])), []);
  });
  t('Z5/K8: nowy cel musi istnieć, być aktywny i leżeć we właściwej księdze', () => {
    const p1 = [{ id: 11, to_ledger_id: null, ledger_id: 1 }];
    assert.strictEqual(bladRetarget(p1, { id: 5, ledger_id: 1, active: 1 }), null);
    assert.strictEqual(bladRetarget(p1, null).error, 'category_not_found');
    assert.strictEqual(bladRetarget(p1, { id: 5, ledger_id: 1, active: 0 }).error, 'category_archived');
    assert.strictEqual(bladRetarget(p1, { id: 5, ledger_id: 2, active: 1 }).error, 'category_other_ledger');
    assert.strictEqual(bladRetarget([], { id: 5, ledger_id: 1, active: 1 }).error, 'nothing_to_update');
    // propozycja przenosi wpis do księgi 2 — cel musi być z księgi 2, nie z tej, w której wpis leży dziś
    const p2 = [{ id: 12, to_ledger_id: 2, ledger_id: 1 }];
    assert.strictEqual(bladRetarget(p2, { id: 5, ledger_id: 1, active: 1 }).error, 'category_other_ledger');
    assert.strictEqual(bladRetarget(p2, { id: 5, ledger_id: 2, active: 1 }), null);
    // grupa MIESZANA: 400 musi wskazać WINNĄ propozycję, inaczej nie da się jej znaleźć w UI
    const blad = bladRetarget([...p1, ...p2], { id: 5, ledger_id: 1, active: 1 });
    assert.deepStrictEqual([blad.error, blad.proposal, blad.ksiega], ['category_other_ledger', 12, 2]);
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
    // Number(true) === 1 i Number([7]) === 7: rzutowanie wszystkiego przez Number() wpuszczało
    // `[true, [7]]` jako `[1, 7]`, czyli decyzję na wpisach, których nikt nie wskazał.
    for (const zle of [['5 OR 1=1'], [0], [-2], [1.5], 'ids', null, [{}], [true], [[7]], [true, [7]], [null], ['']]) {
      assert.strictEqual(parsujIds(zle), null, 'przeszło: ' + JSON.stringify(zle));
    }
  });
  t('Z5: SUM(amount) z MySQL to NAPIS — grosze liczy parseKwota, nie parseFloat', () => {
    assert.strictEqual(groszeZ('4600.00'), 460000);
    assert.strictEqual(groszeZ(null), 0);          // pusta grupa: SUM zwraca NULL
    assert.strictEqual(groszeZ('0.00'), 0);
    assert.strictEqual(groszeZ('1234567.89'), 123456789);
  });
  t('Z5: KAŻDE zapytanie listujące propozycje pomija Kosz i propozycje nieaktualne', () => {
    // Nagłówek grupy liczący wpisy z Kosza nie dawał się uzgodnić z /summary, a propozycja
    // opisująca wpis w kategorii, w której już nie leży, liczyła go w liczniku dwa razy.
    assert.ok(/t\.deleted_at IS NULL/.test(AKTUALNE), AKTUALNE);
    assert.ok(/t\.category_id <=> p\.from_category_id/.test(AKTUALNE), AKTUALNE);
    const src = zrodlo('..', 'src', 'routes', 'proposals.js');
    const zAktualne = (src.match(/\$\{AKTUALNE\}/g) || []).length;
    assert.ok(zAktualne >= 4, `zapytania z filtrem: ${zAktualne} (GET, items, rozwinięcie grupy, retarget)`);
    // Warunek `status = 'NOWA'` na gołym SQL-u znaczy zapytanie, które obeszło AKTUALNE i widzi
    // Kosz albo propozycje nieaktualne. Jedno dopuszczalne wystąpienie: definicja AKTUALNE.
    const naGolo = (src.match(/p\.status = 'NOWA'/g) || []).length;
    assert.strictEqual(naGolo, 1, 'status NOWA sprawdzany poza AKTUALNE — takie zapytanie widzi Kosz');
  });
};
