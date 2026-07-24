// Scala zduplikowane kategorie (skutek dwukrotnego uruchomienia migracji: unikat
// z parent_id NULL nie łapie duplikatów kategorii głównych w MySQL).
// Kanoniczne = najniższe id w grupie (ledger_id, IFNULL(parent_id,0), name).
// Przepina transactions.category_id i categories.parent_id na kanoniczne, usuwa
// duplikaty. W pełni idempotentny (drugie uruchomienie = 0 zmian).
// Użycie:  node scripts/fix-categories.js [--dry-run]
const mysql = require('mysql2/promise');
require('../src/config');

const DRY = process.argv.includes('--dry-run');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASS, database: process.env.DB_NAME, charset: 'utf8mb4',
  });

  const [cats] = await conn.query('SELECT id, ledger_id, parent_id, name FROM categories ORDER BY id');
  const total = cats.length;

  // remap: id-duplikatu -> id-kanoniczne. Rozwiązywane iteracyjnie w 2 warstwach
  // (najpierw korzenie, potem dzieci), bo klucz grupy zależy od parent_id.
  const remap = new Map();
  const canonical = (id) => { while (remap.has(id)) id = remap.get(id); return id; };
  const groupKey = (c) => `${c.ledger_id}|${c.parent_id === null ? 0 : canonical(c.parent_id)}|${c.name.trim()}`;

  // dwa przebiegi: korzenie (parent_id NULL) najpierw, potem reszta
  const passes = [cats.filter((c) => c.parent_id === null), cats.filter((c) => c.parent_id !== null)];
  const toDelete = [];
  for (const pass of passes) {
    const seen = new Map(); // key -> canonical id
    for (const c of pass) {
      const key = groupKey(c);
      if (seen.has(key)) { remap.set(c.id, seen.get(key)); toDelete.push(c.id); }
      else seen.set(key, c.id);
    }
  }

  if (!toDelete.length) {
    console.log(`Kategorie: ${total}, duplikatów: 0 — nic do zrobienia.`);
    await conn.end(); return;
  }

  console.log(`Kategorie: ${total}, duplikatów do scalenia: ${toDelete.length}`);
  if (DRY) {
    for (const dupId of toDelete) {
      const c = cats.find((x) => x.id === dupId);
      console.log(`  scaliłbym id=${dupId} "${c.name.trim()}" -> id=${canonical(dupId)}`);
    }
    console.log('== DRY RUN — nic nie zmieniono ==');
    await conn.end(); return;
  }

  await conn.beginTransaction();
  try {
    let tx = 0, kids = 0;
    for (const dupId of toDelete) {
      const canon = canonical(dupId);
      const [r1] = await conn.execute('UPDATE transactions SET category_id=? WHERE category_id=?', [canon, dupId]);
      const [r2] = await conn.execute('UPDATE categories SET parent_id=? WHERE parent_id=?', [canon, dupId]);
      tx += r1.affectedRows; kids += r2.affectedRows;
    }
    // usuwanie po przepięciu wszystkich referencji
    await conn.query('DELETE FROM categories WHERE id IN (?)', [toDelete]);
    await conn.commit();
    console.log(`Scalono ${toDelete.length} duplikatów. Przepięto: ${tx} transakcji, ${kids} podkategorii.`);
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM categories');
    console.log(`Kategorie po naprawie: ${n}`);
    console.log('Teraz uruchom:  npm run migrate   (doda odporny unikat, migracja 002)');
  } catch (e) { await conn.rollback(); throw e; }
  await conn.end();
})().catch((e) => { console.error('BŁĄD:', e.message); process.exit(1); });
