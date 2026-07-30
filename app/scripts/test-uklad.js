#!/usr/bin/env node
// Testy układu kafli raportu (Z9): walidacja PUT /api/v1/uklad (src/routes/uklad.js) i czysta
// logika porządkowania/ukrywania kafli (public/js/raporty-uklad.js). Bez bazy i bez DOM-u —
// dlatego obie warstwy trzymają logikę w funkcjach bezstanowych (ten sam wzorzec co
// scripts/test-kategorie.js dla src/routes/categories.js + public/js/paleta.js).
const assert = require('assert');
const path = require('path');
const Module = require('module');
const { pathToFileURL } = require('url');
const { walidujLayout } = require('../src/routes/uklad');

let bledy = 0;
function t(opis, fn) {
  try { fn(); console.log('OK  ', opis); }
  catch (e) { bledy++; console.error('BŁĄD', opis, '—', e.message); }
}

// ---------- walidacja PUT (bez bazy — walidujLayout to czysta funkcja) ----------

t('dobry layout przechodzi', () => {
  assert.strictEqual(walidujLayout({ kolejnosc: ['kpi', 'by-cat'], ukryte: [] }), true);
});

t('pusty layout (nic jeszcze nieukładane inaczej niż domyślnie) przechodzi', () => {
  assert.strictEqual(walidujLayout({ kolejnosc: [], ukryte: [] }), true);
});

t('nieznany klucz w body = odmowa', () => {
  assert.strictEqual(walidujLayout({ kolejnosc: [], ukryte: [], kolor: 'red' }), false);
});

t('brakujący klucz (tylko kolejnosc) = odmowa — wymagane DOKŁADNIE oba klucze', () => {
  assert.strictEqual(walidujLayout({ kolejnosc: ['kpi'] }), false);
});

t('element tablicy dłuższy niż 32 znaki = odmowa', () => {
  assert.strictEqual(walidujLayout({ kolejnosc: ['x'.repeat(33)], ukryte: [] }), false);
});

t('tablica z ponad 40 elementami = odmowa', () => {
  const dluga = Array.from({ length: 41 }, (_, i) => 'k' + i);
  assert.strictEqual(walidujLayout({ kolejnosc: dluga, ukryte: [] }), false);
});

t('element tablicy nie-napis (liczba) = odmowa', () => {
  assert.strictEqual(walidujLayout({ kolejnosc: [1, 2], ukryte: [] }), false);
});

t('kolejnosc nie-tablica (obiekt) = odmowa', () => {
  assert.strictEqual(walidujLayout({ kolejnosc: { a: 1 }, ukryte: [] }), false);
});

t('layout nie-obiekt (null/napis/tablica) = odmowa', () => {
  assert.strictEqual(walidujLayout(null), false);
  assert.strictEqual(walidujLayout('kpi,by-cat'), false);
  assert.strictEqual(walidujLayout(['kpi']), false);
});

// ---------- porządkowanie/ukrywanie kafli (public/js/raporty-uklad.js), bez DOM-u ----------

(async () => {
  // ---------- Z14 #7: test NEGATYWNY przez CAŁĄ TRASĘ — łapie sabotaż walidacji ----------
  // Wzorzec wywolajTrase/fakeRes z scripts/test-rejestry.js. Usunięcie `walidujLayout()` z
  // PUT /uklad (albo poluzowanie jej) ma wywalić TEN test (patrz artefakt oddania, sabotaż ręczny).
  await (async () => {
    const baza = { odpowiedzi: [] };
    const q = async () => (baza.odpowiedzi.shift() ?? []);
    function podstawDb() {
      require.cache[require.resolve('../src/db')] = new Module(require.resolve('../src/db'));
      require.cache[require.resolve('../src/db')].exports = { q, pool: null };
      require.cache[require.resolve('../src/db')].loaded = true;
    }
    function resetModuly() {
      for (const m of ['../src/db', '../src/routes/uklad']) delete require.cache[require.resolve(m)];
      podstawDb();
    }
    function fakeRes() {
      const res = { statusCode: 200, body: null, status(c) { res.statusCode = c; return res; }, json(b) { res.body = b; return res; } };
      return res;
    }
    function wywolajTrase(router, req, res) {
      return new Promise((resolve) => {
        res.json = (b) => { res.body = b; resolve(); return res; };
        router(req, res, resolve);
      });
    }

    resetModuly();
    const routerUklad = require('../src/routes/uklad');
    const req = { method: 'PUT', url: '/', query: {}, params: {},
      body: { layout: { kolejnosc: [], ukryte: [], kolor: 'x' } }, user: { uid: 1 } };
    const res = fakeRes();
    await wywolajTrase(routerUklad, req, res);
    t('NEGATYWNY: PUT /uklad z nadmiarowym kluczem "kolor" przez CAŁĄ trasę → 400', () => {
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body && res.body.error, 'bad_layout');
    });
  })();

  const { uporzadkuj } = await import(
    pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'raporty-uklad.js')).href);

  t('uporzadkuj: layout null → kolejność z DOM-u, nic nie ukryte', () => {
    const w = uporzadkuj(['kpi', 'by-cat', 'trend'], null);
    assert.deepStrictEqual(w, [
      { id: 'kpi', ukryty: false }, { id: 'by-cat', ukryty: false }, { id: 'trend', ukryty: false },
    ]);
  });

  t('uporzadkuj: respektuje zapisaną kolejność i ukrycie', () => {
    const w = uporzadkuj(['kpi', 'by-cat', 'trend'],
      { kolejnosc: ['trend', 'kpi', 'by-cat'], ukryte: ['by-cat'] });
    assert.deepStrictEqual(w, [
      { id: 'trend', ukryty: false }, { id: 'kpi', ukryty: false }, { id: 'by-cat', ukryty: true },
    ]);
  });

  t('uporzadkuj: kafel nieznany w layout.kolejnosc (skasowany/przemianowany) jest pomijany', () => {
    const w = uporzadkuj(['kpi', 'by-cat'], { kolejnosc: ['trend', 'kpi'], ukryte: [] });
    assert.deepStrictEqual(w, [{ id: 'kpi', ukryty: false }, { id: 'by-cat', ukryty: false }]);
  });

  t('uporzadkuj: nowy kafel spoza starego layoutu ląduje na końcu, widoczny', () => {
    const w = uporzadkuj(['kpi', 'by-cat', 'nowy-widget'],
      { kolejnosc: ['by-cat', 'kpi'], ukryte: [] });
    assert.deepStrictEqual(w, [
      { id: 'by-cat', ukryty: false }, { id: 'kpi', ukryty: false }, { id: 'nowy-widget', ukryty: false },
    ]);
  });

  // ---------- Z14 #3: trybUkladania — bylUkryty nie może zniknąć bez dotknięcia widoczności ----------
  // raporty-uklad.js celowo nie importuje core.js i woła document.createElement wprost — do testu
  // bez przeglądarki wystarczy minimalna atrapa DOM-u obsługująca dokładnie to, czego moduł używa
  // (querySelectorAll(':scope > [data-kafel]' | '.kafel-pasek'), append/prepend/insertBefore, classList).
  // append/prepend w prawdziwym DOM-ie przyjmują też gołe napisy (stają się węzłami tekstowymi) —
  // pasek() w raporty-uklad.js robi `etykieta.append(widocz, ' widoczny')`.
  const tekst = (s) => ({ tag: '#text', text: s, dataset: {}, attrs: {}, children: [], parent: null, classList: { zbior: new Set() } });
  function odepnij(n) { if (n.parent) n.parent.children = n.parent.children.filter((c) => c !== n); n.parent = null; }
  function wezel(tag) {
    return {
      tag, attrs: {}, dataset: {}, children: [], parent: null, hidden: false,
      classList: { zbior: new Set(), add(c) { this.zbior.add(c); }, remove(c) { this.zbior.delete(c); } },
      setAttribute(k, v) { this.attrs[k] = v; },
      remove() { odepnij(this); },
      append(...ns) { for (let n of ns) { if (typeof n === 'string') n = tekst(n); odepnij(n); n.parent = this; this.children.push(n); } },
      prepend(...ns) { for (let n of ns.reverse()) { if (typeof n === 'string') n = tekst(n); odepnij(n); n.parent = this; this.children.unshift(n); } },
      insertBefore(nowy, ref) {
        odepnij(nowy); nowy.parent = this;
        const i = this.children.indexOf(ref);
        if (i < 0) this.children.push(nowy); else this.children.splice(i, 0, nowy);
      },
      querySelectorAll(sel) {
        if (sel === ':scope > [data-kafel]') return this.children.filter((c) => c.dataset.kafel !== undefined);
        if (sel === '.kafel-pasek') {
          // bud() nadaje klasę przez setAttribute('class', ...), nie przez classList — sprawdzamy oba.
          const maKlase = (c) => c.classList.zbior.has('kafel-pasek') || (c.attrs.class || '').split(' ').includes('kafel-pasek');
          const wynik = [];
          (function szukaj(n) { for (const c of n.children) { if (maKlase(c)) wynik.push(c); szukaj(c); } })(this);
          return wynik;
        }
        return [];
      },
    };
  }
  global.document = { createElement: (tag) => wezel(tag) };
  const { trybUkladania } = await import(
    pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'raporty-uklad.js')).href);

  await (async () => {
    const box = wezel('div');
    const a = wezel('div'); a.dataset.kafel = 'a'; a.hidden = true;   // kafel UKRYTY przed wejściem w tryb
    const b = wezel('div'); b.dataset.kafel = 'b'; b.hidden = false;
    box.append(a, b);
    let zapisany = null;
    const { wlacz, wylacz } = trybUkladania(box, async (layout) => { zapisany = layout; });
    wlacz();
    t('wlacz(): kafel ukryty przed wejściem staje się chwilowo widoczny (n.hidden=false)', () => {
      assert.strictEqual(a.hidden, false);
      assert.strictEqual(a.dataset.bylUkryty, '1');
    });
    const checkboxA = a.querySelectorAll('.kafel-pasek')[0]?.children.find((c) => c.tag === 'label')
      ?.children.find((c) => c.tag === 'input');
    t('pasek(): checkbox „widoczny” kafla realnie ukrytego jest ODZNACZONY mimo n.hidden===false', () => {
      assert.strictEqual(checkboxA.checked, false);
    });
    // Brak dotknięcia widoczności — „Gotowe" od razu.
    await wylacz();
    t('wylacz() bez zmiany widoczności zwraca layout, w którym kafel nadal jest w ukryte (nie ginie)', () => {
      assert.deepStrictEqual(zapisany.kolejnosc, ['a', 'b']);
      assert.deepStrictEqual(zapisany.ukryte, ['a']);
    });
  })();

  console.log(bledy ? `\n${bledy} testów układu NIE przeszło.` : '\nWszystkie testy układu przeszły.');
  process.exit(bledy ? 1 : 0);
})();
