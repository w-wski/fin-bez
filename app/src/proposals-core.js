// Czysta logika przydziału propozycji (zlecenie Z5, runda poprawek po odrzuceniu): walidacja
// wejścia, grupowanie celów i BRAMKA KSIĘGOWA przyjęcia. Zero SQL i zero Express — dzięki temu
// całość testuje się bez bazy (scripts/test-reorganize-prop.js), a trasa src/routes/proposals.js
// mieści się w limicie 300 linii z preflighta.
const { parseKwota } = require('./kwota');

// Klucz grupy = para (kategoria obecna → proponowana). „0" na pierwszej pozycji = wpis bez
// kategorii (from_category_id IS NULL), bo w URL-u nie ma sensownego zapisu NULL-a.
const kluczGrupy = (from, to) => `${Number(from) || 0}-${Number(to)}`;
function parsujKlucz(k) {
  const m = /^(\d+)-(\d+)$/.exec(String(k == null ? '' : k));
  if (!m) return null;
  const to = Number(m[2]);
  return to > 0 ? { from: Number(m[1]) || null, to } : null;
}
// Identyfikatory propozycji z ciała żądania. Przyjmujemy WYŁĄCZNIE liczbę całkowitą dodatnią
// albo napis samych cyfr. Number(true) === 1 i Number([7]) === 7, więc rzutowanie wszystkiego
// przez Number() wpuszczało `[true, [7]]` jako `[1, 7]` — decyzję o cudzych pieniądzach
// podejmowaną na wpisie, którego nikt nie wskazał. Pusta lista jest poprawna (nic nie robi).
function parsujIds(v) {
  if (!Array.isArray(v) || v.length > 5000) return null;
  const ok = (x) => (typeof x === 'number' && Number.isInteger(x) && x > 0)
    || (typeof x === 'string' && /^\s*[1-9]\d*\s*$/.test(x));
  return v.every(ok) ? [...new Set(v.map(Number))] : null;
}
// Księga, w której wpis wyląduje: z propozycji, a gdy ta księgi nie zmienia — obecna księga wpisu.
const docelowaKsiega = (p) => Number(p.to_ledger_id || p.ledger_id);
// Suma kwot w groszach — przez parseKwota, bo SUM(amount) i DECIMAL wracają z MySQL jako NAPIS.
const groszeZ = (suma) => Math.round((parseKwota(suma) || 0) * 100);

// K8: nowy cel musi istnieć, być AKTYWNY i leżeć w księdze, w której wpis wyląduje.
// Zwraca null (wszystko w porządku) albo { error, proposal } — numer propozycji, która
// blokuje. Bez niego grupa mieszana (część wpisów zostaje w RODZINIE, część idzie do
// PERSEVERY) dawała 400 „category_other_ledger" bez wskazania, o który wpis chodzi.
function bladRetarget(props, cel) {
  if (!props.length) return { error: 'nothing_to_update' };
  if (!cel) return { error: 'category_not_found' };
  if (!Number(cel.active)) return { error: 'category_archived' };
  const zla = props.find((p) => docelowaKsiega(p) !== Number(cel.ledger_id));
  if (zla) return { error: 'category_other_ledger', proposal: Number(zla.id), ksiega: docelowaKsiega(zla) };
  return null;
}

// Wpisy o tym samym celu idą jednym UPDATE-em. `tag: null` w propozycji = bez zmiany tagu,
// więc bierzemy tag, który wpis ma dziś (nie czyścimy go po cichu).
function grupujCele(nowe) {
  const grupy = new Map();
  for (const p of nowe) {
    const cel = { c: Number(p.to_category_id), l: docelowaKsiega(p), t: p.to_type || p.type,
      g: p.tag == null ? (p.tx_tag == null ? null : p.tx_tag) : p.tag };
    const k = `${cel.c}|${cel.l}|${cel.t}|${cel.g == null ? '' : cel.g}`;
    if (!grupy.has(k)) grupy.set(k, { ...cel, ids: [] });
    grupy.get(k).ids.push(Number(p.transaction_id));
  }
  return grupy;
}

// JEDEN wpis, JEDEN UPDATE. Dwie propozycje tego samego wpisu w jednym żądaniu to dwa
// sprzeczne UPDATE-y na tym samym wierszu: wynik zależy od kolejności iteracji Map, a obie
// propozycje kończą jako PRZYJETA. Takie żądanie odrzucamy (400), nie zgadujemy zwycięzcy.
function dubleWpisow(props) {
  const ile = new Map();
  for (const p of props) {
    const id = Number(p.transaction_id);
    ile.set(id, (ile.get(id) || 0) + 1);
  }
  return [...ile].filter(([, n]) => n > 1).map(([id]) => id);
}

// Propozycja jest NIEAKTUALNA, gdy wpis nie leży już tam, gdzie leżał przy jej powstaniu:
// Szymon przeniósł go ręcznie w Historii. Przyjęcie takiej propozycji cofa jego decyzję bez
// śladu, więc jej NIE stosujemy. NULL-a porównujemy jak SQL-owe `<=>` (0 === brak kategorii).
const nieaktualna = (p) => Number(p.category_id || 0) !== Number(p.from_category_id || 0);

// --- bramka księgowa przyjęcia: kubełki księga × typ ---
// COUNT/SUM po `id IN (txIds)` przed i po było TAUTOLOGIĄ: UPDATE nie dotyka `id` ani
// `amount`, więc różnica była arytmetycznie niemożliwa i komunikat „ksiega_sie_nie_zgadza"
// obiecywał ochronę, której nie było. Prawdziwy ruch widać dopiero w kubełkach księga × typ:
// przeniesienie 23 wpisów na 4 600 zł z RODZINY do PERSEVERY zmienia je, choć suma globalna
// zostaje. Porównujemy FAKT z ruchem WYNIKAJĄCYM Z PRZYJMOWANYCH PROPOZYCJI — nie z zerem,
// bo przydział ma prawo ruszać księgę i typ, ale tylko dokładnie tam, gdzie tak mówi decyzja.
const kubel = (led, typ) => `${led}|${typ}`;
const PUSTY = { n: 0, gr: 0 };
const przesun = (m, k, n, gr) => { const v = m.get(k) || PUSTY; m.set(k, { n: v.n + n, gr: v.gr + gr }); };
function kubelki(rows) {
  const m = new Map();
  for (const r of rows) przesun(m, kubel(Number(r.ledger_id), r.type), 1, groszeZ(r.amount));
  return m;
}
// Oczekiwana zmiana kubełków: każdy wpis wychodzi ze swojego kubełka i wchodzi do tego,
// który wynika z propozycji (księga docelowa, typ docelowy albo obecny).
function oczekiwanaDelta(props) {
  const d = new Map();
  for (const p of props) {
    const gr = groszeZ(p.amount);
    przesun(d, kubel(Number(p.ledger_id), p.type), -1, -gr);
    przesun(d, kubel(docelowaKsiega(p), p.to_type || p.type), 1, gr);
  }
  return d;
}
const zl = (gr) => (gr / 100).toFixed(2);
// Każda rozbieżność między „przed + oczekiwane" a „po" = ROLLBACK.
function rozbieznosci(przed, po, delta) {
  const zle = [];
  for (const k of new Set([...przed.keys(), ...po.keys(), ...delta.keys()])) {
    const b = przed.get(k) || PUSTY, a = po.get(k) || PUSTY, d = delta.get(k) || PUSTY;
    if (a.n !== b.n + d.n || a.gr !== b.gr + d.gr) {
      zle.push(`kubełek ${k}: przed ${b.n} wp./${zl(b.gr)} zł, oczekiwane ${d.n >= 0 ? '+' : ''}${d.n} wp./`
        + `${d.gr >= 0 ? '+' : ''}${zl(d.gr)} zł, jest ${a.n} wp./${zl(a.gr)} zł`);
    }
  }
  return zle;
}
// Kwota i data nie zmieniają się NIGDY — przydział dotyczy kategorii, księgi, typu i tagu.
// Zniknięcie albo dojście wpisu w zbiorze dotkniętych też jest błędem.
function tkniete(przed, po) {
  const zle = [];
  const byId = new Map(po.map((r) => [Number(r.id), r]));
  for (const r of przed) {
    const a = byId.get(Number(r.transaction_id == null ? r.id : r.transaction_id));
    if (!a) { zle.push(`wpis #${r.transaction_id || r.id} zniknął ze zbioru dotkniętych`); continue; }
    if (groszeZ(a.amount) !== groszeZ(r.amount)) zle.push(`wpis #${a.id}: kwota ${zl(groszeZ(r.amount))} → ${zl(groszeZ(a.amount))}`);
    if (String(a.tx_date) !== String(r.tx_date)) zle.push(`wpis #${a.id}: data ${r.tx_date} → ${a.tx_date}`);
  }
  if (po.length !== przed.length) zle.push(`liczba dotkniętych wpisów: ${przed.length} → ${po.length}`);
  return zle;
}

module.exports = { kluczGrupy, parsujKlucz, parsujIds, docelowaKsiega, groszeZ, bladRetarget,
  grupujCele, dubleWpisow, nieaktualna, kubel, kubelki, oczekiwanaDelta, rozbieznosci, tkniete };
