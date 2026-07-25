// Wykonawca reorganizacji taksonomii kategorii — drzewa i reguły siedzą w
// scripts/reorganize-plan.js (tabele A1–A30, B1–B8, C1–C8, CP1–CP4, D1–D4).
// Decyzja Szymona z 2026-07-24: „Wszystkie decyzje o przydziale do nowych kategorii zrobię
// ręcznie. Zaproponuj, a ja wybiorę w aplikacji, które jest które." Skrypt więc TYLKO PROPONUJE:
// zakłada docelowe drzewo, zapisuje category_map (E2), renormalizuje mapping_cache (E3) i wpisuje
// propozycje do `category_proposals` (migracja 008). ZERO UPDATE na `transactions` — kategorię,
// księgę, typ i tag zmienia wyłącznie przyjęcie propozycji w karcie „Przydział"
// (src/routes/proposals.js). Nic nie archiwizuje (K3): stare kategorie zostają aktywne, bo leżą
// w nich wszystkie wpisy; archiwizacja to ręczna czynność w panelu Admin PO przyjęciu propozycji.
// Użycie: node scripts/reorganize-categories.js [--dry-run] — --dry-run robi CAŁĄ pracę
// w transakcji i kończy ROLLBACK-iem, więc raport jest dokładnie tym, co zrobi przebieg
// właściwy (ten sam kod + COMMIT). Błąd = rollback. Idempotentny: 2. przebieg = „0 zmian".
// Połączenie z src/db.js (dateStrings: daty jako napisy — inaczej tag wyjazdu cofa się
// o miesiąc przy Europe/Warsaw; parametry podajemy tablicami, więc namedPlaceholders nie szkodzi).
const { pool } = require('../src/db');
const { F, P, TREE, RULES, zwin, pathOf, norm, propozycja, planKategorii,
  grosze, zlot, kubel, przesun } = require('./reorganize-plan');
const { raport } = require('./reorganize-raport');

const PACZKA = 500;   // ile wierszy propozycji w jednym INSERT-cie

if (require.main === module) main().catch((e) => { console.error('BŁĄD:', e.message); process.exit(1); });

async function main() {
  const DRY = process.argv.includes('--dry-run');
  const conn = await pool.getConnection();
  const stat = { cats: 0, kids: 0, prop: 0, reczne: 0, jest: 0, otwarte: 0, map: 0, mapUpd: 0, cache: 0, cacheNull: 0 };
  const perRule = new Map(), notes = [], kand = [], kolizje = [], opisowe = [], zostaje = new Map();
  const bump = (id) => { if (!perRule.has(id)) perRule.set(id, { cats: new Set(), tx: 0 }); return perRule.get(id); };
  try {
    await sprawdzSchemat(conn);
    console.log('UWAGA: pracuję na migawce transakcji (REPEATABLE READ). Wpis dodany przez aplikację\n'
      + 'W TRAKCIE przebiegu nie dostanie propozycji — uruchamiaj po backupie i przy zatrzymanej aplikacji.');
    console.log('ZAKRES BRAMKI KSIĘGOWEJ: liczba wpisów i suma kwot w kubełkach księga × typ × (żywe/kosz)\n'
      + 'MUSZĄ być identyczne przed i po. Bramka ŁAPIE ruch księgi, typu i kosza, NIE ŁAPIE\n'
      + 'przepięcia samej kategorii w obrębie tej samej księgi i typu. Że skrypt w ogóle nie pisze\n'
      + 'do `transactions`, pilnuje test grepujący źródło („Z5/K2") — to jedyna realna gwarancja K2.\n');
    await conn.beginTransaction();
    const przed = await migawka(conn);
    const wiszaceA = await naArchiwum(conn);

    // 1) drzewa docelowe (istniejące korzenie są reużywane, nie duplikowane)
    for (const led of [F, P]) {
      let i = 0;
      for (const [root, kids] of Object.entries(TREE[led])) {
        const rid = await ensure(conn, led, null, root, ++i, stat);
        let j = 0; for (const kid of kids) await ensure(conn, led, rid, kid, ++j, stat);
      }
    }
    // 2) indeks kategorii po utworzeniu drzew
    const load = async () => {
      const [rows] = await conn.query('SELECT id, ledger_id, parent_id, name, active FROM categories ORDER BY id', []);
      const byId = new Map(rows.map((c) => [c.id, c]));
      rows.forEach((c) => { c.path = pathOf(c, byId); });
      return { rows, byId, byKey: new Map(rows.map((c) => [`${c.ledger_id}|${c.parent_id || 0}|${norm(c.name)}`, c])) };
    };
    let cats = await load();
    const targetOf = (to, led) => {
      const [root, kid] = to.split('>');
      const r = cats.byKey.get(`${led}|0|${norm(root)}`);
      const k = r && kid ? cats.byKey.get(`${led}|${r.id}|${norm(kid)}`) : r;
      if (!k) throw new Error(`brak kategorii docelowej „${to}" w księdze ${led}`);
      return k;
    };
    const targets = new Set();
    for (const r of RULES) if (r.to) targets.add(targetOf(r.to, r.l).id);

    // 3) plan dla kategorii: stara kategoria -> warianty {przepływ, reguła, cel}. Zarchiwizowanych
    // NIE planujemy — już przeszły (albo właściciel je schował), a liczenie ich w raporcie dawało
    // „A1 kategorie: 1" obok „0 zmian" przy drugim przebiegu.
    const plan = new Map();
    for (const c of cats.rows) {
      if (!c.active || targets.has(c.id)) continue;
      const w = planKategorii(c).map((v) => ({ ...v, dst: v.r.to ? targetOf(v.r.to, v.r.l) : null }));
      if (!w.length || w.every((x) => x.dst && x.dst.id === c.id)) continue;
      plan.set(c.id, { r: w[0].r, dst: w[0].dst, w });
    }
    // 3a) dzieci starych korzeni bez własnej reguły idą pod nowy korzeń (A1: „dzieci 1:1").
    // Odpowiednik powstaje zawsze AKTYWNY, także dla zarchiwizowanego oryginału: przyjęcia do
    // kategorii z archiwum proposals.js ODMAWIA, więc cel musi być aktywny od razu.
    for (const c of cats.rows) {
      if (c.parent_id == null || plan.has(c.id) || targets.has(c.id)) continue;
      const pp = plan.get(c.parent_id);
      // Za rodzicem idziemy wyłącznie jego wariantem WYDATKOWYM: „PERSEVERA" (korzeń) ma wariant
      // przychodowy (C6 → „PERSEVERA (wypłaty)"), a wieszanie kosztów pod korzeniem przychodowym
      // to ten sam błąd, co dziedziczenie księgi po regule przeciwnego przepływu.
      const pv = pp && pp.w.find((x) => x.flow === 'out');
      if (!pv || !pv.dst || pv.dst.parent_id != null) continue; // rodzic musi trafiać w korzeń
      const bylo = stat.cats;
      const kid = await ensure(conn, pv.dst.ledger_id, pv.dst.id, c.name, 99, stat);
      if (kid === c.id) continue;
      const dst = { id: kid, ledger_id: pv.dst.ledger_id };
      plan.set(c.id, { r: pv.r, dst, w: [{ flow: 'out', r: pv.r, dst }] });
      // licznik = tylko NAPRAWDĘ utworzone dziecko: przy 2. przebiegu odpowiednik już istnieje,
      // a „dzieci przeniesione 1:1: 1" obok „0 zmian" byłoby raportem, który kłamie.
      if (stat.cats > bylo) stat.kids++;
    }
    if (stat.kids || stat.cats) cats = await load();          // odśwież po ewentualnych INSERT-ach

    // 4) propozycje przydziału per wpis. WPISY Z KOSZA POMIJAMY (deleted_at IS NULL): reszta
    // aplikacji wyklucza usunięte z każdej edycji, a przydział zmieniający im kategorię (przy
    // regule D też księgę i typ) oddawał po „Przywróć" wpis po zmianie, której Historia nigdy by
    // nie pozwoliła wykonać. Skrypt nic nie archiwizuje (K3), więc przywrócony wpis zostaje w
    // starej, NADAL AKTYWNEJ kategorii i człowiek przepnie go w Historii. Nie „naprawiaj" tego
    // z powrotem (to samo uzasadnienie w src/routes/proposals.js).
    const [txs] = await conn.query('SELECT id, ledger_id, type, amount, category_id, description, tx_date,'
      + ' tag, deleted_at FROM transactions WHERE deleted_at IS NULL', []);
    // K4: para (wpis, cel), która JUŻ jest w tabeli, nie powstaje po raz drugi — niezależnie od
    // statusu. ODRZUCONA nie wraca (decyzja „nie" jest trwała), PRZYJETA nie dubluje.
    const [byle] = await conn.query('SELECT transaction_id t, to_category_id c FROM category_proposals', []);
    const istniejace = new Set(byle.map((r) => `${r.t}|${r.c}`));
    // Wpis z OTWARTĄ propozycją (NOWA) nie dostaje drugiej — niezależnie od pary. Inaczej po
    // ręcznym przeniesieniu wpisu w Historii kolejny przebieg dokładał propozycję z nowej pary:
    // licznik liczył wpis dwa razy, a przyjęcie starszej grupy cofało ręczną decyzję właściciela.
    const [otw] = await conn.query("SELECT DISTINCT transaction_id t FROM category_proposals WHERE status='NOWA'", []);
    const otwarte = new Set(otw.map((r) => Number(r.t)));
    const wiersze = [], delta = new Map(), uzycie = new Map();
    for (const tx of txs) {
      const cat = tx.category_id ? cats.byId.get(tx.category_id) : null;
      if (cat) { const u = uzycie.get(cat.id) || { in: 0, out: 0 }; u[tx.type === 'PRZYCHÓD' ? 'in' : 'out']++; uzycie.set(cat.id, u); }
      if (otwarte.has(Number(tx.id))) { stat.otwarte++; continue; }
      const teraz = cat ? cat.path : '(bez kategorii)';
      const warianty = cat && plan.has(cat.id) ? plan.get(cat.id).w : null;
      const p = propozycja(tx, cat, warianty, targetOf, istniejace);
      if (!p) {
        // Brak reguły dla przepływu TEGO wpisu (K5): wpis NIE dostaje propozycji, idzie do
        // raportu. Bez dziedziczenia księgi ani kategorii przeciwnego przepływu.
        if (cat && plan.has(cat.id)) { const kk = `${teraz}|${tx.type}`; zostaje.set(kk, (zostaje.get(kk) || 0) + 1); }
        continue;
      }
      if (p.nic) continue;                          // wpis już leży w celu (K4) albo reguła bez celu (B8)
      if (p.jest) { stat.jest++; continue; }        // taka propozycja już istnieje (K4)
      wiersze.push(p);
      if (p.tryb === 'reczna') { stat.reczne++; kand.push({ tx, k: p.r, teraz }); }
      if (p.r.d) opisowe.push({ tx, rule: p.r, teraz });
      // Proponowany (NIE wykonany) ruch między księgami i typami — do raportu, nie do bramki.
      przesun(delta, kubel(tx.ledger_id, tx.type, tx.deleted_at), -1, -grosze(tx.amount));
      przesun(delta, kubel(p.to_ledger_id || tx.ledger_id, p.to_type || tx.type, tx.deleted_at), 1, grosze(tx.amount));
      bump(p.rule_id).tx++;
      stat.prop++;
    }
    await zapiszPropozycje(conn, wiersze);

    // 5) mapping_cache + category_map (E2, E3). Archiwizacji NIE MA (K3): wpisy leżą w starych
    // kategoriach do decyzji człowieka, a chowanie kategorii z wpisami wycinało je z list
    // wyboru. Kandydatów do ręcznej archiwizacji wypisuje raport.
    const zajete = new Map();
    if (plan.size) {
      const [z] = await conn.query('SELECT category_id id, COUNT(*) n FROM transactions WHERE category_id IN (?) GROUP BY category_id', [[...plan.keys()]]);
      z.forEach((r) => zajete.set(r.id, Number(r.n)));
    }
    const puste = [];
    for (const [oldId, p] of plan) {
      const c = cats.byId.get(oldId);
      const bylo = stat.map + stat.mapUpd;
      let ruszone = 0;
      if (p.dst) ruszone += await przestawCache(conn, c, p.dst, stat, notes);
      await zapiszMape(conn, c, p, uzycie.get(oldId), stat, kolizje);
      if (!zajete.get(oldId) && c.active) puste.push(`„${c.path}" (księga ${c.ledger_id})`);
      // licznik kategorii w raporcie = to, co NAPRAWDĘ ruszyło (mapa, cache). Sam plan nie
      // wystarcza: „B8 kategorie: 1" obok „0 zmian" to raport, który kłamie.
      if (ruszone || stat.map + stat.mapUpd > bylo) bump(p.r.id).cats.add(oldId);
    }

    // 6) bramka księgowa: kubełki księga × typ × (żywe/kosz) MUSZĄ być identyczne przed i po.
    // UCZCIWY ZAKRES: różnica znaczy, że ruszyła się KSIĘGA, TYP albo kosz — i wtedy rollback.
    // Przepięcie samej kategorii w obrębie tej samej księgi i typu PRZEJDZIE tu bez śladu, bo
    // kategoria w kubełkach nie występuje. Jedyną realną gwarancją K2 („zero UPDATE na
    // transactions") jest test grepujący źródło: „Z5/K2" w scripts/test-reorganize-scen.js.
    const po = await migawka(conn);
    const zle = [];
    for (const k of new Set([...przed.keys(), ...po.keys()])) {
      const b = przed.get(k) || { n: 0, gr: 0 }, a = po.get(k) || { n: 0, gr: 0 };
      if (a.n !== b.n || a.gr !== b.gr) zle.push(`${k}: było ${b.n} wp./${zlot(b.gr)} zł → jest ${a.n}/${zlot(a.gr)} zł`);
    }
    if (zle.length) throw new Error('bramka księgowa (księga×typ×kosz): skrypt ma tylko PROPONOWAĆ, a księga się zmieniła: '
      + zle.join(' · ') + ' — rollback');
    const wiszaceB = await naArchiwum(conn);
    if (wiszaceB !== wiszaceA) throw new Error(`wpisy wiszące na kategoriach active=0: ${wiszaceA} → ${wiszaceB} — rollback`);

    // 7) raport per wiersz tabeli akceptacyjnej + listy do decyzji człowieka (osobny moduł)
    raport({ cats: cats.rows, perRule, delta, opisowe, kand, zostaje, kolizje, notes, stat, plan, targets, wiszaceA, wiszaceB, puste });

    if (DRY) { await conn.rollback(); console.log('\n== DRY RUN — wszystko wycofane (ROLLBACK), baza nietknięta =='); }
    else { await conn.commit(); console.log('\n== WYKONANO (COMMIT) =='); }
  } catch (e) {
    try { await conn.rollback(); } catch (r) { console.error('UWAGA: rollback nie przeszedł:', r.message); }
    throw e;
  } finally { conn.release(); await pool.end(); }
}

// Zapis propozycji paczkami. `affectedRows` musi zgadzać się z liczbą wierszy: zderzenie z unikatem
// uq_prop (transaction_id, to_category_id) ma być błędem i rollbackiem, nie cichym INSERT IGNORE —
// pary już istniejące odsiewamy WCZEŚNIEJ (`istniejace`, `otwarte`).
async function zapiszPropozycje(conn, wiersze) {
  for (let i = 0; i < wiersze.length; i += PACZKA) {
    const cz = wiersze.slice(i, i + PACZKA);
    const [r] = await conn.query(
      'INSERT INTO category_proposals (transaction_id, from_category_id, to_category_id, to_ledger_id, to_type, tag, rule_id) VALUES ?',
      [cz.map((p) => [p.transaction_id, p.from_category_id, p.to_category_id, p.to_ledger_id, p.to_type, p.tag, p.rule_id])]);
    if (r.affectedRows !== cz.length) throw new Error(`propozycje: zapisano ${r.affectedRows} z ${cz.length} wierszy — rollback`);
  }
}

// Migawka księgi: liczba wpisów i suma groszy w rozbiciu księga × typ × (żywe/kosz).
async function migawka(conn) {
  const [rows] = await conn.query(
    `SELECT ledger_id, type, (deleted_at IS NULL) zywy, COUNT(*) n, ROUND(SUM(amount)*100) gr
       FROM transactions GROUP BY ledger_id, type, zywy`, []);
  return new Map(rows.map((r) => [kubel(r.ledger_id, r.type, !Number(r.zywy)), { n: Number(r.n), gr: Number(r.gr) }]));
}
// Ile wpisów (żywych i z kosza) wisi na kategoriach wyłączonych — po przebiegu musi być tyle samo.
async function naArchiwum(conn) {
  const [[r]] = await conn.query('SELECT COUNT(*) n FROM transactions t JOIN categories c ON c.id = t.category_id WHERE c.active = 0', []);
  return Number(r.n);
}
// Bez migracji 006 nie ma typu TRANSFER, kolumny `tag` ani category_map, bez 008 tabeli propozycji
// — przebieg wywaliłby się w połowie. Sprawdzamy schemat, nie schema_migrations (ALTER-y ręczne).
async function sprawdzSchemat(conn) {
  const [[k]] = await conn.query(
    `SELECT SUM(TABLE_NAME='transactions' AND COLUMN_NAME='tag') tag,
            SUM(TABLE_NAME='transactions' AND COLUMN_NAME='type' AND COLUMN_TYPE LIKE '%TRANSFER%') tr,
            SUM(TABLE_NAME='category_map') mapa,
            SUM(TABLE_NAME='category_proposals' AND COLUMN_NAME='rule_id') prop
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`, []);
  const brak = [!Number(k.tag) && 'kolumna transactions.tag (006)', !Number(k.tr) && 'typ TRANSFER (006)',
    !Number(k.mapa) && 'tabela category_map (006)', !Number(k.prop) && 'tabela category_proposals (008)'].filter(Boolean);
  if (brak.length) throw new Error(`brak migracji: ${brak.join(', ')} — uruchom najpierw: npm run migrate`
    + ' (jeśli migracje SĄ wykonane, sprawdź uprawnienia konta do information_schema)');
}
// Znajdź lub utwórz kategorię (ledger, parent, name). NIE przywraca active=1: kategoria schowana
// ręcznie ma taka zostać (przyjęcie propozycji też jej nie przywraca — odmawia z komunikatem).
async function ensure(conn, ledger, parentId, name, order, stat) {
  const [[f]] = await conn.query(
    'SELECT id, active FROM categories WHERE ledger_id=? AND (parent_id <=> ?) AND name=? LIMIT 1', [ledger, parentId, name]);
  if (f) return f.id;
  const [r] = await conn.query('INSERT INTO categories (ledger_id, parent_id, name, sort_order, active) VALUES (?,?,?,?,1)',
    [ledger, parentId, name, order]);
  stat.cats++;
  return r.insertId;
}
// category_map (E2): klucz to ZWINIĘTA nazwa — „Zakupy spożywcze  > Pieczywo" z podwójną
// spacją nigdy nie powstanie przy odczycie. Księga = ta, w której leży kategoria docelowa
// (reguły D przenoszą F→P; wiersz „księga 1 → kategoria z księgi 2" byłby sprzeczny sam ze
// sobą). Kolizji nie połykamy jak dawne INSERT IGNORE — idą do raportu.
async function zapiszMape(conn, c, p, uz, stat, kolizje) {
  const u = uz || { in: 0, out: 0 };
  let w = p.w[0];
  const inny = p.w[1];
  // Jedna nazwa, dwa cele: „Dodatkowe" jako WYDATEK → Inne, jako PRZYCHÓD → PERSEVERA
  // (wypłaty). Klucz w mapie jest jeden, więc bierzemy przepływ, który realnie wystąpił.
  if (inny && inny.dst && (!w.dst || w.dst.id !== inny.dst.id)) {
    if (u.in > u.out) w = inny;
    kolizje.push(`„${c.path}": ${p.w[0].r.id} (wydatki) → ${p.w[0].r.to || '(brak celu)'} vs ${inny.r.id} (przychody) → ${inny.r.to}`
      + ` · w mapie zapisuję wariant ${w.r.id} (wpisy: ${u.out} wyd. / ${u.in} przych.)`);
  }
  const led = w.dst ? w.dst.ledger_id : c.ledger_id;
  const note = (w.r.id + (w.dst && w.dst.ledger_id !== c.ledger_id ? ` (nazwa z księgi ${c.ledger_id})` : '')).slice(0, 160);
  const cel = w.dst ? w.dst.id : null;
  for (const nm of new Set([zwin(c.path).slice(0, 160), zwin(c.name).slice(0, 160)])) {
    const [[ist]] = await conn.query('SELECT m.id, m.category_id, m.note, k.active, k.name FROM category_map m'
      + ' LEFT JOIN categories k ON k.id = m.category_id WHERE m.ledger_id=? AND m.old_name=? LIMIT 1', [led, nm]);
    if (ist && Number(ist.category_id || 0) === Number(cel || 0)) continue;   // już zapisane
    if (ist && ist.category_id != null && !Number(ist.active)) {
      // Wskaźnik na kategorię ARCHIWALNĄ: właściciel zmienił nazwę kategorii docelowej, więc
      // przy tym przebiegu powstała nowa, a stara poszła do archiwum. Słownik z K4 ma prowadzić
      // do ŻYWEJ kategorii, inaczej import odtwarza bałagan i „nic nie ginie" znaczy „nic nie działa".
      await conn.query('UPDATE category_map SET category_id=?, note=? WHERE id=?', [cel, note, ist.id]);
      stat.mapUpd++;
      kolizje.push(`category_map „${nm}" (księga ${led}) wskazywał zarchiwizowaną kat. ${ist.category_id} („${ist.name || '?'}")`
        + ` — przestawiam na ${cel == null ? 'NULL' : cel} (${note})`);
      continue;
    }
    if (ist) {
      kolizje.push(`category_map „${nm}" (księga ${led}): jest → kat. ${ist.category_id == null ? 'NULL' : ist.category_id} (${ist.note || '?'}),`
        + ` a ${note} chce → kat. ${cel == null ? 'NULL' : cel} — zostawiam pierwszy wpis, rozstrzygnij ręcznie`);
      continue;
    }
    await conn.query('INSERT INTO category_map (ledger_id, old_name, category_id, note) VALUES (?,?,?,?)', [led, nm, cel, note]);
    stat.map++;
  }
}
// mapping_cache (E3) jest WSPÓLNY dla obu ksiąg — nie ma w nim kolumny księgi, a unikat leży na
// samym wzorcu. Przestawienie wzorca na kategorię z innej księgi tworzy wskaźnik międzyksięgowy:
// import rodzinnego CSV podpowiadałby kategorię spółki, wpis zapisywał się z ledger_id=1
// i kategorią z księgi 2, a w raporcie lądował w „(bez kategorii)". Wtedy CZYŚCIMY sam wskaźnik
// (category_id=NULL) — wzorzec, hits i confidence zostają, więc człowiek nauczy go od nowa.
async function przestawCache(conn, c, dst, stat, notes) {
  const miedzyKsiegami = dst.ledger_id !== c.ledger_id;
  const [r] = await conn.query(`UPDATE mapping_cache SET category_id=${miedzyKsiegami ? 'NULL' : '?'} WHERE category_id=?`,
    miedzyKsiegami ? [c.id] : [dst.id, c.id]);
  const n = r.affectedRows;
  if (n && miedzyKsiegami) {
    stat.cacheNull += n;
    notes.push(`mapping_cache: ${n} wzorzec(ów) wskazywało „${c.path}" (księga ${c.ledger_id}), a kategoria przechodzi`
      + ` do księgi ${dst.ledger_id} — czyszczę wskaźnik (wzorce zostają), żeby import rodzinny nie podpowiadał kategorii spółki`);
  } else stat.cache += n;
  return n;
}
