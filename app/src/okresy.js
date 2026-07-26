/* okresy.js — arytmetyka okresów raportu: bieżący, POPRZEDNI (do porównań m/m)
 * i koniec okresu (do salda narastającego). Wydzielone z routes/reports.js, bo to
 * czysta funkcja, a daty już raz nas ugryzły: „2026-02-31" przechodzi regex, ale
 * BETWEEN z pseudo-datą kończy się w MySQL 8 błędem 500. Testy: scripts/test-okresy.js.
 */

const ISO_D = /^\d{4}-\d{2}-\d{2}$/;
const ISO_M = /^\d{4}-\d{2}$/;

/** Data musi ISTNIEĆ, nie tylko wyglądać. JS normalizuje 31 lutego na 3 marca —
 *  porównanie po normalizacji łapie różnicę. */
function dataOK(s) {
  if (!ISO_D.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const dni = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const przesun = (s, d) => new Date(Date.parse(`${s}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10);

/** Okres raportu: ?month=RRRR-MM albo ?from=&to= (kwartał, rok, własny zakres).
 *  Zwraca warunek SQL + parametry + miesiąc-kotwicę dla trendu. */
function okres(query = {}) {
  const { from, to } = query;
  if (dataOK(from) && dataOK(to) && from <= to) {
    return { from, to, m: to.slice(0, 7), sql: 't.tx_date BETWEEN :d1 AND :d2', p: { d1: from, d2: to } };
  }
  const m = ISO_M.test(query.month || '') ? query.month : new Date().toISOString().slice(0, 7);
  return { month: m, m, sql: "DATE_FORMAT(t.tx_date,'%Y-%m') = :m2", p: { m2: m } };
}

const ostatniDzien = (r, m) => new Date(Date.UTC(m === 12 ? r + 1 : r, m === 12 ? 0 : m, 1) - 86400000)
  .toISOString().slice(0, 10);
const oMiesiace = (s, k) => {
  const [r, m] = s.split('-').map(Number);
  const t = (r * 12 + (m - 1)) + k;
  return [Math.floor(t / 12), (t % 12) + 1];
};

/** Okres POPRZEDNI — baza porównania „m/m".
 *  Tryb miesiąca: poprzedni miesiąc kalendarzowy (z przeskokiem roku).
 *  Tryb zakresu: jeśli zakres obejmuje CAŁE miesiące (1. dnia do ostatniego), cofamy
 *  się o tyle samo MIESIĘCY — II kwartał porównuje się z I, rok z rokiem. Równe okna
 *  DNI dałyby tu bzdurę: II kwartał ma 91 dni, I ma 90, więc „91 dni wcześniej" zaczyna
 *  się 31 grudnia. Zakres nierówny (np. 20–26 lipca) porównujemy oknem tej samej
 *  długości bezpośrednio przed nim — tam nie ma kalendarzowego odpowiednika. */
function poprzedniOkres(o) {
  if (o.from && o.to) {
    const [rf, mf] = o.from.split('-').map(Number);
    const [rt, mt] = o.to.split('-').map(Number);
    const caleMiesiace = o.from.slice(8) === '01' && o.to === ostatniDzien(rt, mt);
    if (caleMiesiace) {
      const ile = (rt * 12 + mt) - (rf * 12 + mf) + 1;
      const [pr, pm] = oMiesiace(o.from, -ile);
      const [qr, qm] = oMiesiace(o.to, -ile);
      const pFrom = `${pr}-${String(pm).padStart(2, '0')}-01`;
      const pTo = ostatniDzien(qr, qm);
      return { from: pFrom, to: pTo, sql: 't.tx_date BETWEEN :pd1 AND :pd2', p: { pd1: pFrom, pd2: pTo } };
    }
    const dlugosc = dni(o.from, o.to) + 1;               // zakres jest domknięty z obu stron
    const pTo = przesun(o.from, -1);
    const pFrom = przesun(pTo, -(dlugosc - 1));
    return { from: pFrom, to: pTo, sql: 't.tx_date BETWEEN :pd1 AND :pd2', p: { pd1: pFrom, pd2: pTo } };
  }
  const [r, mm] = o.m.split('-').map(Number);
  const pm = mm === 1 ? `${r - 1}-12` : `${r}-${String(mm - 1).padStart(2, '0')}`;
  return { month: pm, sql: "DATE_FORMAT(t.tx_date,'%Y-%m') = :pm2", p: { pm2: pm } };
}

/** Ostatni dzień okresu — granica salda NARASTAJĄCEGO (od zawsze do końca okresu).
 *  W trybie miesiąca liczymy go w JS, żeby nie wołać LAST_DAY() w SQL-u i nie mieć
 *  dwóch źródeł prawdy o długości lutego. */
function koniecOkresu(o) {
  if (o.to) return o.to;
  const [r, mm] = o.m.split('-').map(Number);
  return new Date(Date.UTC(mm === 12 ? r + 1 : r, mm === 12 ? 0 : mm, 1) - 86400000).toISOString().slice(0, 10);
}

/** Zmiana procentowa względem bazy. `null` przy bazie 0 — „+∞ %" nie jest informacją,
 *  a interfejs musi umieć pokazać, że porównania NIE MA (pierwszy miesiąc w bazie). */
function delta(teraz, baza) {
  const b = Number(baza) || 0;
  if (!b) return null;
  return Math.round(((Number(teraz) || 0) - b) / b * 1000) / 10;
}

module.exports = { dataOK, okres, poprzedniOkres, koniecOkresu, delta };
