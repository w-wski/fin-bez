// analizy.js — logika analiz okresowych (21d, Z12): policzenie liczb z księgi, złożenie
// promptu dla modelu (bez danych osobowych) i zapis migawki (UPSERT). Warstwa modelu jest
// wymienialna i mieszka WYŁĄCZNIE w src/model/dostawca.js — ten plik zna tylko `narracja()`.
const { q } = require('./db');
const { narracja } = require('./model/dostawca');

const OKRESY_TYP = ['miesiac', 'kwartal', 'rok'];
const pad2 = (n) => String(n).padStart(2, '0');

// Ostatni dzień miesiąca `mies` (1-12) roku `rok` — bez LAST_DAY() w SQL-u, ten sam
// wzorzec co src/okresy.js#koniecOkresu (jedno źródło prawdy o długości lutego, w JS).
function ostatniDzienMiesiaca(rok, mies) {
  return new Date(Date.UTC(mies === 12 ? rok + 1 : rok, mies === 12 ? 0 : mies, 1) - 86400000)
    .toISOString().slice(0, 10);
}

/** okres_typ + okres → { from, to } (dni ISO) albo null, gdy okres nie istnieje w kalendarzu
 *  ('2026-13' miesiąc, '2026-Q5' kwartał) — walidacja formatu I zakresu naraz. */
function zakresOkresu(typ, okres) {
  if (typ === 'miesiac') {
    const m = /^(\d{4})-(\d{2})$/.exec(okres || '');
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
    const r = Number(m[1]), mi = Number(m[2]);
    return { from: `${okres}-01`, to: ostatniDzienMiesiaca(r, mi) };
  }
  if (typ === 'kwartal') {
    const m = /^(\d{4})-Q(\d)$/.exec(okres || '');
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 4) return null;
    const r = Number(m[1]), kw = Number(m[2]);
    const startM = (kw - 1) * 3 + 1;
    return { from: `${r}-${pad2(startM)}-01`, to: ostatniDzienMiesiaca(r, startM + 2) };
  }
  if (typ === 'rok') {
    if (!/^\d{4}$/.test(okres || '')) return null;
    return { from: `${okres}-01-01`, to: `${okres}-12-31` };
  }
  return null;
}

/** Okres BEZPOŚREDNIO poprzedzający (do porównania „ze zmianą") — kalendarzowy odpowiednik,
 *  nie okno tej samej długości cofnięte o dni: kwartał ma porównywać się z kwartałem. */
function poprzedniOkres(typ, okres) {
  if (typ === 'miesiac') {
    const [r, m] = okres.split('-').map(Number);
    return m === 1 ? `${r - 1}-12` : `${r}-${pad2(m - 1)}`;
  }
  if (typ === 'kwartal') {
    const r = Number(okres.slice(0, 4)), kw = Number(okres.slice(6));
    return kw === 1 ? `${r - 1}-Q4` : `${r}-Q${kw - 1}`;
  }
  if (typ === 'rok') return String(Number(okres) - 1);
  return null;
}

function bladOkresu() {
  return Object.assign(new Error('okres nieprawidłowy'), { code: 'bad_okres' });
}

const suma = (rows, typ) => Number(rows.find((r) => r.type === typ)?.total) || 0;

// Sumy przychodów/wydatków/transferów per KAŻDA księga z `ledgers` (nie zsumowane razem —
// admin porównuje RODZINA i PERSEVERA obok siebie, nie jedną liczbą, która by je zlała).
async function sumyPerKsiega(ledgers, od, doD) {
  // Promise.all, nie pętla z await: przy dwóch księgach zapytania idą RÓWNOLEGLE (jak w
  // routes/reports.js#family-vs-persevera), a nie jedna po drugiej.
  return Promise.all(ledgers.map(async (l) => {
    const rows = await q(
      `SELECT type, ROUND(SUM(amount),2) AS total FROM transactions
        WHERE ledger_id=:l AND deleted_at IS NULL AND tx_date BETWEEN :od AND :do
        GROUP BY type`, { l, od, do: doD });
    return { ledger_id: l, przychody: suma(rows, 'PRZYCHÓD'), wydatki: suma(rows, 'WYDATEK'), transfery: suma(rows, 'TRANSFER') };
  }));
}

// Top 5 kategorii wydatków (przez wszystkie `ledgers` naraz) ze zmianą % vs poprzedni okres.
// Wzorzec zapytania z routes/reports.js#byCategory (ścieżka „Rodzic > Dziecko" po id, nie nazwie).
// Poprzedni okres dociągamy PO JEDNEJ kategorii (max 5 dodatkowych zapytań, LIMIT 5 wyżej) —
// prostsze i bezpieczniejsze niż budowanie `IN (...)` z możliwym NULL-em wśród category_id
// (IN nigdy nie dopasuje NULL-a — trzeba by osobnej gałęzi OR i tak, więc lepiej wprost).
async function topKategorie(ledgers, zakres, zakresPoprz) {
  const inC = ledgers.map((_, i) => `:l${i}`).join(',');
  const p = Object.fromEntries(ledgers.map((l, i) => [`l${i}`, l]));
  const rows = await q(
    `SELECT t.category_id,
            COALESCE(CONCAT(COALESCE(CONCAT(p.name,' > '),''), c.name),'(bez kategorii)') AS kategoria,
            ROUND(SUM(t.amount),2) AS total
       FROM transactions t
       LEFT JOIN categories c ON c.id=t.category_id AND c.ledger_id=t.ledger_id
       LEFT JOIN categories p ON p.id=c.parent_id
      WHERE t.ledger_id IN (${inC}) AND t.deleted_at IS NULL AND t.type='WYDATEK'
        AND t.tx_date BETWEEN :od AND :do
      GROUP BY t.category_id, kategoria ORDER BY total DESC LIMIT 5`,
    { ...p, od: zakres.from, do: zakres.to });
  if (!zakresPoprz) return rows.map((r) => ({ kategoria: r.kategoria, total: Number(r.total), poprzednio: null }));
  const wynik = [];
  for (const r of rows) {
    const cond = r.category_id === null ? 't.category_id IS NULL' : 't.category_id = :cid';
    const [poprz] = await q(
      `SELECT ROUND(SUM(t.amount),2) AS total FROM transactions t
        WHERE t.ledger_id IN (${inC}) AND t.deleted_at IS NULL AND t.type='WYDATEK'
          AND ${cond} AND t.tx_date BETWEEN :od AND :do`,
      { ...p, cid: r.category_id, od: zakresPoprz.from, do: zakresPoprz.to });
    wynik.push({ kategoria: r.kategoria, total: Number(r.total), poprzednio: Number(poprz?.total) || 0 });
  }
  return wynik;
}

// Paragony: suma z nagłówków (suma_paragonowa), top 5 produktów koszyka (wzorzec
// routes/products.js#koszyk, tylko LIMIT 5) i rabaty łącznie (discount_total — WSZYSTKIE
// opusty razem, migracja 013 — nie liczymy osobno pozycji i bonów, żeby nie podwoić).
async function danePragony(ledgers, od, doD) {
  const inC = ledgers.map((_, i) => `:l${i}`).join(',');
  const p = Object.fromEntries(ledgers.map((l, i) => [`l${i}`, l]));
  // ODRZUCONY = paragon uznany za błędny/nieaktualny (np. duplikat, zły skan) — nie ma wpływu
  // na wydatki, więc analiza nie ma go liczyć (Z14 #9).
  const [naglowek] = await q(
    `SELECT ROUND(SUM(total),2) AS suma, ROUND(SUM(discount_total),2) AS rabaty
       FROM receipts WHERE ledger_id IN (${inC}) AND receipt_date BETWEEN :od AND :do AND status <> 'ODRZUCONY'`,
    { ...p, od, do: doD });
  const koszyk = await q(
    `SELECT pr.name, ROUND(SUM(i.value),2) AS wydano
       FROM receipt_items i JOIN receipts r ON r.id=i.receipt_id JOIN products pr ON pr.id=i.product_id
      WHERE r.ledger_id IN (${inC}) AND r.receipt_date BETWEEN :od AND :do AND r.status <> 'ODRZUCONY'
      GROUP BY pr.id ORDER BY wydano DESC LIMIT 5`, { ...p, od, do: doD });
  return {
    suma_paragonowa: Number(naglowek?.suma) || 0,
    rabaty_lacznie: Number(naglowek?.rabaty) || 0,
    koszyk_top5: koszyk.map((k) => ({ name: k.name, wydano: Number(k.wydano) })),
  };
}

/** Policz liczby okresu (bez narracji) — czysta funkcja zapytań, wywoływana zarówno przy
 *  UPSERT-cie (wykonajAnalize) jak i w testach na podstawionej bazie. */
async function policzOkres(okresTyp, okres, ledgerId) {
  if (!OKRESY_TYP.includes(okresTyp)) throw bladOkresu();
  const zakres = zakresOkresu(okresTyp, okres);
  if (!zakres) throw bladOkresu();
  const poprzedni = poprzedniOkres(okresTyp, okres);
  const zakresPoprz = poprzedni ? zakresOkresu(okresTyp, poprzedni) : null;
  const ledgers = ledgerId ? [ledgerId] : [1, 2];

  const [ksiegi, topKat, paragony] = await Promise.all([
    sumyPerKsiega(ledgers, zakres.from, zakres.to),
    topKategorie(ledgers, zakres, zakresPoprz),
    danePragony(ledgers, zakres.from, zakres.to),
  ]);
  return { okres_typ: okresTyp, okres, od: zakres.from, do: zakres.to, ksiegi, top_kategorie: topKat, ...paragony };
}

// Zmiana procentowa jednej pozycji top kategorii — helper promptu, nie API (baza=0 → null).
function zmianaProc(total, poprzednio) {
  if (!poprzednio) return null;
  return Math.round(((total - poprzednio) / poprzednio) * 1000) / 10;
}

/** Prompt po polsku, WYŁĄCZNIE z whitelisty pól `dane` — nawet gdyby ktoś kiedyś dorzucił
 *  do `dane` coś więcej (np. imię usera), ta funkcja i tak nie ma jak tego przepisać do
 *  tekstu, bo czyta tylko znane, bezosobowe klucze (kategorie, kwoty, okres). ZAKAZ danych
 *  osobowych w prompcie (Z12, pkt 3) egzekwowany strukturą kodu, nie samą deklaracją. */
function zbudujPrompt(dane) {
  const linie = [`Analiza finansów rodziny za okres ${dane.okres_typ} ${dane.okres} (${dane.od}–${dane.do}).`];
  for (const k of dane.ksiegi) {
    linie.push(`Księga ${k.ledger_id}: przychody ${k.przychody} zł, wydatki ${k.wydatki} zł, transfery ${k.transfery} zł.`);
  }
  linie.push('Top 5 kategorii wydatków:');
  for (const t of dane.top_kategorie) {
    const zm = zmianaProc(t.total, t.poprzednio);
    linie.push(`- ${t.kategoria}: ${t.total} zł${zm === null ? '' : ` (${zm > 0 ? '+' : ''}${zm}% vs poprzedni okres)`}`);
  }
  linie.push(`Suma paragonowa: ${dane.suma_paragonowa} zł. Rabaty łącznie: ${dane.rabaty_lacznie} zł.`);
  if (dane.koszyk_top5.length) {
    linie.push('Najwięcej wydano na: ' + dane.koszyk_top5.map((k) => `${k.name} (${k.wydano} zł)`).join(', ') + '.');
  }
  linie.push('Napisz krótkie (4-6 zdań), rzeczowe podsumowanie po polsku: co się zmieniło, co warto zauważyć. Bez zwrotów grzecznościowych.');
  return linie.join('\n');
}

/** Policz + (opcjonalna) narracja + UPSERT migawki. `ledgerId` puste/0 = obie księgi
 *  (API: null; w tabeli: sentinel 0 — patrz komentarz w migracji 020). */
async function wykonajAnalize(okresTyp, okres, ledgerId) {
  const dane = await policzOkres(okresTyp, okres, ledgerId);
  let wynikModelu = null;
  try {
    // Bez jawnego limitu — dostawca bierze DOMYSLNY_LIMIT (env MODEL_MAX_TOKENS).
    // Twarde 700 ucinało omówienie w połowie zdania.
    wynikModelu = await narracja(zbudujPrompt(dane));
  } catch (e) {
    console.error('analizy.wykonajAnalize: narracja pominięta —', e.message);
  }
  const ledgerCol = ledgerId || 0;
  await q(
    `INSERT INTO analizy (okres_typ, okres, ledger_id, dane, narracja, model)
     VALUES (:t, :o, :l, :d, :n, :m)
     ON DUPLICATE KEY UPDATE dane=VALUES(dane), narracja=VALUES(narracja), model=VALUES(model),
                             created_at=CURRENT_TIMESTAMP`,
    { t: okresTyp, o: okres, l: ledgerCol, d: JSON.stringify(dane), n: wynikModelu?.tekst ?? null, m: wynikModelu?.model ?? null });
  return { dane, narracja: wynikModelu?.tekst ?? null, model: wynikModelu?.model ?? null };
}

module.exports = { policzOkres, zbudujPrompt, wykonajAnalize, zakresOkresu, poprzedniOkres, OKRESY_TYP };
