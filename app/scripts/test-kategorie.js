#!/usr/bin/env node
// Testy czystej logiki kategorii (zlecenie Z3): reguły rodzica, odporność drzewa na uszkodzone
// dane, ścisła walidacja PATCH-a, kolejność instrukcji w transakcji i paleta OKLCH.
// Bez bazy i bez DOM — dlatego obie warstwy trzymają logikę w funkcjach bezstanowych:
// src/routes/categories.js (backend) i public/js/paleta.js (frontend).
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { bladRodzica, isHex, budujDrzewo, polaPatcha, idCalkowite,
  zapiszPatch } = require('../src/routes/categories');

let failures = 0;
const zleSzlo = (name, e) => { failures++; console.error('FAIL', name, '—', e.message); };
function t(name, fn) { try { fn(); console.log('OK  ', name); } catch (e) { zleSzlo(name, e); } }
async function ta(name, fn) { try { await fn(); console.log('OK  ', name); } catch (e) { zleSzlo(name, e); } }

// Odcień HSL — niezależny od implementacji palety sposób na sprawdzenie „ten sam kolor bazowy".
function odcienHsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const roznicaOdcieni = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// ---------- reguły rodzica (K5) ----------

const KSIEGA = [
  { id: 1, parent_id: null, ledger_id: 1 },   // Dom
  { id: 2, parent_id: 1, ledger_id: 1 },      // Dom > Czynsz
  { id: 3, parent_id: null, ledger_id: 1 },   // Jedzenie (bez podkategorii)
  { id: 9, parent_id: null, ledger_id: 2 },   // PERSEVERA > Biuro
];

t('rodzic: null i przeniesienie pod inny korzeń tej samej księgi dozwolone', () => {
  assert.strictEqual(bladRodzica(KSIEGA, 2, null), null);
  assert.strictEqual(bladRodzica(KSIEGA, 2, undefined), null);
  assert.strictEqual(bladRodzica(KSIEGA, 2, 3), null);
  assert.strictEqual(bladRodzica(KSIEGA, 2, '3'), null);     // id z formularza bywa napisem
});

t('rodzic: self, brak, obca księga, drugi poziom i korzeń z dziećmi odrzucone', () => {
  assert.strictEqual(bladRodzica(KSIEGA, 1, 1), 'parent_self');
  assert.strictEqual(bladRodzica(KSIEGA, 1, 999), 'parent_not_found');
  assert.strictEqual(bladRodzica(KSIEGA, 999, 1), 'not_found');
  assert.strictEqual(bladRodzica(KSIEGA, 1, 9), 'parent_other_ledger');
  assert.strictEqual(bladRodzica(KSIEGA, 3, 2), 'parent_not_root');       // drzewo ma dwa poziomy
  assert.strictEqual(bladRodzica(KSIEGA, 1, 3), 'parent_has_children');
});

t('rodzic: zapętlenie wykryte, a dane już zapętlone nie zawieszają walidacji', () => {
  const glebokie = [
    { id: 1, parent_id: null, ledger_id: 1 },
    { id: 2, parent_id: 1, ledger_id: 1 },
    { id: 3, parent_id: 2, ledger_id: 1 },
  ];
  assert.strictEqual(bladRodzica(glebokie, 1, 2), 'parent_cycle');
  assert.strictEqual(bladRodzica(glebokie, 1, 3), 'parent_cycle');   // potomek przez dwa poziomy
  const zepsute = [                                                  // A->B->A (np. ręczny SQL)
    { id: 1, parent_id: 2, ledger_id: 1 },
    { id: 2, parent_id: 1, ledger_id: 1 },
    { id: 5, parent_id: null, ledger_id: 1 },
  ];
  assert.strictEqual(bladRodzica(zepsute, 5, 1), 'parent_not_root'); // kończy się, nie wisi
});

// ---------- budowanie drzewa: KSIĘGA NIE GUBI KATEGORII ----------
// Pusta (albo niepełna) odpowiedź przy niepustej tabeli = kategorie znikają naraz z Wpisu,
// Historii, Paragonu i z Admina, czyli księgi nie da się naprawić z UI. Każdy uszkodzony
// rodzic — brak, archiwum, zapętlenie — ma dać korzeń z flagą `orphan`, nigdy zniknięcie.
const policz = (drzewo) => drzewo.reduce((n, k) => n + 1 + (k.children || []).length, 0);

// [nazwa, wiersze z bazy, ile pozycji ma wrócić łącznie, które id z flagą orphan]
const USZKODZONE = [
  ['rodzic nie istnieje', [{ id: 1, parent_id: null }, { id: 2, parent_id: 1 }, { id: 7, parent_id: 99 }], 3, [7]],
  ['cykl 3→4→3 po dwóch równoległych PATCH-ach', [{ id: 3, parent_id: 4 }, { id: 4, parent_id: 3 }], 2, [3, 4]],
  ['trzeci poziom Auto > Paliwo > Autostrady', [{ id: 1, parent_id: null }, { id: 2, parent_id: 1 }, { id: 3, parent_id: 2 }], 3, [3]],
  ['kategoria jest własnym rodzicem', [{ id: 5, parent_id: 5 }], 1, [5]],
  ['rodzic w archiwum (odfiltrowany z zapytania)', [{ id: 2, parent_id: 1, name: 'Czynsz' }], 1, [2]],
];

t('drzewo: zdrowy korzeń z dzieckiem, a uszkodzony rodzic wraca jako korzeń z flagą', () => {
  const zdrowe = budujDrzewo([{ id: 1, parent_id: null, name: 'Dom' }, { id: 2, parent_id: 1, name: 'Czynsz' }]);
  assert.ok(zdrowe.length === 1 && zdrowe[0].children[0].name === 'Czynsz' && zdrowe[0].orphan === undefined);
  for (const [nazwa, rows, ile, sieroty] of USZKODZONE) {
    const d = budujDrzewo(rows);
    assert.ok(d.length > 0, `${nazwa}: pusta lista przy niepustej tabeli`);
    assert.strictEqual(policz(d), ile, nazwa);
    assert.deepStrictEqual(d.filter((k) => k.orphan).map((k) => k.id), sieroty, nazwa);
  }
});

// ---------- walidacja koloru (K6) i ścisłe parsowanie wejścia PATCH-a ----------

t('kolor: przechodzi tylko #rrggbb', () => {
  for (const ok of ['#1f6f43', '#000000', '#FFFFFF', '#a4262c']) assert.strictEqual(isHex(ok), true, ok);
  for (const zle of ['#fff', 'red', 'rgb(1,2,3)', '#12345g', ' #000000', '#0000000',
    'url(x)', '', null, undefined, 42, {}]) assert.strictEqual(isHex(zle), false, String(zle));
});

t('id: żadnych cichych rzutowań — „3abc" nie jest trójką', () => {
  for (const dobre of ['3', ' 3 ', 3]) assert.strictEqual(idCalkowite(dobre), 3, String(dobre));
  for (const zle of ['3abc', [3], 3.7, '', ' ', '-3', '0', 0, '1e3', '9999999999',
    null, undefined, true, {}, NaN, Infinity]) assert.strictEqual(idCalkowite(zle), null, String(zle));
});

t('active: napis "0" ARCHIWIZUJE (nie przywraca), a śmieć to błąd, nie domyślna jedynka', () => {
  for (const v of ['0', 0, false, 'false']) assert.strictEqual(polaPatcha({ active: v }).active, 0, String(v));
  for (const v of ['1', 1, true, 'true']) assert.strictEqual(polaPatcha({ active: v }).active, 1, String(v));
  assert.deepStrictEqual(polaPatcha({ active: '0' }).values, [0]);
  for (const zle of ['tak', '', 2, null, [], {}, 'on'])
    assert.strictEqual(polaPatcha({ active: zle }).error, 'bad_active', String(zle));
});

t('parent_id: tylko czyste id albo null — literówka daje błąd, nie przypadkowego rodzica', () => {
  assert.strictEqual(polaPatcha({ parent_id: '3' }).parent, 3);
  assert.strictEqual(polaPatcha({ parent_id: 3 }).parent, 3);
  assert.strictEqual(polaPatcha({ parent_id: null }).parent, null);
  for (const zle of ['3abc', [3], 3.7, '', 0, '0', {}, true, 'null'])
    assert.strictEqual(polaPatcha({ parent_id: zle }).error, 'bad_parent', String(zle));
});

t('kolor: null = auto (świadomie, wg migracji 006), reszta poza #rrggbb odrzucona', () => {
  assert.deepStrictEqual(polaPatcha({ color: null }).values, [null]);
  assert.deepStrictEqual(polaPatcha({ color: '#ABCDEF' }).values, ['#abcdef']);
  for (const zle of ['red', '#fff', '', 0, [], {}, true, 'rgb(0,0,0)', '#12345g'])
    assert.strictEqual(polaPatcha({ color: zle }).error, 'bad_color', String(zle));
});

t('sort_order i name: ścisłe zakresy i typy', () => {
  assert.deepStrictEqual(polaPatcha({ sort_order: '0' }).values, [0]);
  assert.deepStrictEqual(polaPatcha({ sort_order: 12 }).values, [12]);
  for (const zle of ['5x', -1, 32768, 3.7, [5], null, true])
    assert.strictEqual(polaPatcha({ sort_order: zle }).error, 'bad_sort_order', String(zle));
  assert.deepStrictEqual(polaPatcha({ name: '  Dom  ' }).values, ['Dom']);
  assert.strictEqual(polaPatcha({ name: 'x'.repeat(200) }).values[0].length, 96);
  for (const zle of ['', '   ', 42, null, ['Dom'], {}])
    assert.strictEqual(polaPatcha({ name: zle }).error, 'bad_name', String(zle));
});

t('kaskada archiwizacji tylko na jawne cascade:true; puste ciało = błąd', () => {
  assert.strictEqual(polaPatcha({ active: 0 }).kaskada, false);
  assert.strictEqual(polaPatcha({ active: 0, cascade: true }).kaskada, true);
  assert.strictEqual(polaPatcha({ active: 0, cascade: '1' }).kaskada, false);  // fail-closed: 409, nie kaskada
  assert.strictEqual(polaPatcha({}).error, 'nothing_to_update');
  assert.strictEqual(polaPatcha({ cascade: true }).error, 'nothing_to_update');
});

t('kilka pól naraz: kolejność values zgadza się z sets', () => {
  const plan = polaPatcha({ name: 'Dom', color: '#112233', sort_order: 4 });
  assert.deepStrictEqual(plan.sets, ['name = ?', 'color = ?', 'sort_order = ?']);
  assert.deepStrictEqual(plan.values, ['Dom', '#112233', 4]);
});

// ---------- zapis PATCH-a pod blokadą (wyścig dwóch równoległych PATCH-ów) ----------
// Bez bazy: atrapa puli zapisuje kolejność instrukcji. Blokada wierszy MUSI paść przed
// walidacją, a każda odmowa kończyć się ROLLBACK-iem, nigdy połowicznym zapisem.

function atrapaPuli(rows, blad) {
  const log = [];
  const execute = async (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    log.push(s);
    if (s.endsWith('FOR UPDATE')) return [rows];
    if (blad) throw blad;
    return [{ affectedRows: 1 }];
  };
  const conn = { execute, beginTransaction: async () => log.push('BEGIN'), commit: async () => log.push('COMMIT'),
    rollback: async () => log.push('ROLLBACK'), release: () => log.push('RELEASE') };
  return { pula: { getConnection: async () => conn }, log };
}
const zapisy = (log) => log.filter((s) => s.startsWith('UPDATE'));
const DOM = [                                       // Dom > Czynsz + Jedzenie, wszystko aktywne
  { id: 1, ledger_id: 1, parent_id: null, active: 1 },
  { id: 2, ledger_id: 1, parent_id: 1, active: 1 },
  { id: 3, ledger_id: 1, parent_id: null, active: 1 },
];

const CYKL = [                                      // stan po pierwszym z równoległych PATCH-ów
  { id: 3, ledger_id: 1, parent_id: 4, active: 1 },
  { id: 4, ledger_id: 1, parent_id: null, active: 1 },
];

// [nazwa, wiersze pod blokadą, id, ciało PATCH-a, oczekiwany status, sprawdzenie(log, wynik)]
const ZAPIS = [
  ['zmiana rodzica: BEGIN → FOR UPDATE → UPDATE → COMMIT (walidacja pod blokadą)', DOM, 2, { parent_id: 3 }, 200, (l) => {
    assert.deepStrictEqual([l[0], l[3], l[4]], ['BEGIN', 'COMMIT', 'RELEASE']);
    assert.ok(l[1].endsWith('FOR UPDATE'), 'blokada musi paść przed walidacją: ' + l[1]);
    assert.ok(l[2].startsWith('UPDATE categories SET parent_id'), l[2]);
  }],
  ['cykl wykryty na ZABLOKOWANYCH danych: 400 i ROLLBACK, żadnego zapisu', CYKL, 4, { parent_id: 3 }, 400, (l, w) => {
    assert.strictEqual(w.body.error, 'parent_cycle');
    assert.strictEqual(zapisy(l).length, 0);
    assert.ok(l.includes('ROLLBACK') && l.includes('RELEASE'));
  }],
  ['archiwizacja korzenia z aktywną podkategorią: 409 z liczbą, bez zapisu', DOM, 1, { active: 0 }, 409, (l, w) => {
    assert.deepStrictEqual(w.body, { error: 'has_active_children', children: 1 });
    assert.strictEqual(zapisy(l).length, 0);
    assert.ok(l.includes('ROLLBACK'));
  }],
  ['archiwizacja z jawną kaskadą: rodzic i dziecko w jednej transakcji', DOM, 1, { active: 0, cascade: true }, 200, (l, w) => {
    assert.strictEqual(w.body.archived_children, 1);
    assert.strictEqual(zapisy(l).length, 2);
    assert.ok(/WHERE parent_id = \? AND active = 1/.test(zapisy(l)[1]), zapisy(l)[1]);
    assert.deepStrictEqual(l.slice(-2), ['COMMIT', 'RELEASE']);
  }],
  ['archiwizacja podkategorii nie wymaga potwierdzeń', DOM, 2, { active: 0 }, 200, () => {}],
  ['kategoria zniknęła przed blokadą: 404 zamiast zapisu w próżnię', DOM, 77, { name: 'X' }, 404,
    (l) => assert.strictEqual(zapisy(l).length, 0)],
];

async function testyZapisu() {
  for (const [nazwa, rows, id, cialo, status, sprawdz] of ZAPIS) {
    await ta(nazwa, async () => {
      const { pula, log } = atrapaPuli(rows);
      const w = await zapiszPatch(id, 1, polaPatcha(cialo), pula);
      assert.strictEqual(w.status, status, JSON.stringify(w.body));
      sprawdz(log, w);
    });
  }
  await ta('zakleszczenie blokad: 409 „busy" zamiast 500 i połowicznego drzewa', async () => {
    const { pula, log } = atrapaPuli(DOM, Object.assign(new Error('x'), { code: 'ER_LOCK_DEADLOCK' }));
    const w = await zapiszPatch(3, 1, polaPatcha({ name: 'Jedzonko' }), pula);
    assert.strictEqual(w.status, 409);
    assert.strictEqual(w.body.error, 'busy');
    assert.ok(log.includes('ROLLBACK') && !log.includes('COMMIT'));
  });
}

// ---------- paleta OKLCH (K6) ----------

(async () => {
  const { oklchHex, odcienie, paletaDrzewa, HEX } = await import(
    pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'paleta.js')).href);

  t('OKLCH -> sRGB: znane punkty odniesienia, a poza gamutem kolor zamiast NaN', () => {
    for (const [L, C, H, hex] of [[1, 0, 0, '#ffffff'], [0, 0, 0, '#000000'],
      [0.62796, 0.25768, 29.234, '#ff0000'], [0.86644, 0.29483, 142.495, '#00ff00'],
      [0.45201, 0.31321, 264.052, '#0000ff']]) assert.strictEqual(oklchHex(L, C, H), hex);
    for (const c of [oklchHex(0.62, 0.9, 29), oklchHex(0.05, 0.4, 200), oklchHex(1.5, 0.2, 90)]) {
      assert.ok(HEX.test(c), 'nie jest #rrggbb: ' + c);
    }
  });

  t('odcienie: równomiernie po kole, zawsze co najmniej jeden', () => {
    assert.deepStrictEqual(odcienie(4), [25, 115, 205, 295]);
    assert.strictEqual(odcienie(0).length, 1);        // pusta księga nie dzieli przez zero
    assert.ok(odcienie(7).every((h) => h >= 0 && h < 360));
  });

  const drzewo = [
    { id: 1, children: [{ id: 11 }, { id: 12 }] },
    { id: 2, children: [] },
    { id: 3, children: [{ id: 31 }] },
  ];

  t('paleta: po jednym kolorze na każdy węzeł (#rrggbb), motywy dają różne kolory', () => {
    for (const ciemny of [false, true]) {
      const p = paletaDrzewa(drzewo, ciemny);
      assert.deepStrictEqual(p.map((x) => x.id), [1, 11, 12, 2, 3, 31]);
      assert.ok(p.every((x) => HEX.test(x.color)), 'zły format w palecie');
    }
    assert.notStrictEqual(paletaDrzewa(drzewo, false).map((x) => x.color).join(),
      paletaDrzewa(drzewo, true).map((x) => x.color).join());
  });

  t('paleta: kategorie główne mają wyraźnie różne odcienie', () => {
    const p = paletaDrzewa(drzewo, false);
    const h = [1, 2, 3].map((id) => odcienHsl(p.find((x) => x.id === id).color));
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      assert.ok(roznicaOdcieni(h[a], h[b]) > 30, `odcienie ${h[a]} i ${h[b]} zbyt blisko`);
    }
  });

  t('paleta: podkategoria dziedziczy odcień rodzica, ale ma inną jasność', () => {
    for (const ciemny of [false, true]) {
      const p = paletaDrzewa(drzewo, ciemny);
      const kolor = (id) => p.find((x) => x.id === id).color;
      for (const [rodzic, dziecko] of [[1, 11], [1, 12], [3, 31]]) {
        assert.ok(roznicaOdcieni(odcienHsl(kolor(rodzic)), odcienHsl(kolor(dziecko))) < 8,
          `odcień ${rodzic} vs ${dziecko} się rozjechał`);
        assert.notStrictEqual(kolor(dziecko), kolor(rodzic));
      }
      assert.notStrictEqual(kolor(11), kolor(12));   // rodzeństwo też się różni
    }
  });

  await testyZapisu();

  if (failures) { console.error(`\n${failures} test(ów) NIE przeszło`); process.exit(1); }
  console.log('\nWszystkie testy kategorii przeszły.');
})();
