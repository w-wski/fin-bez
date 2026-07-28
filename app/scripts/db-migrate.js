// Uruchamia pliki migrations/*.sql w kolejności nazw; pomija już zastosowane.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('../src/config'); // ładuje .env

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASS, database: process.env.DB_NAME,
    multipleStatements: true, charset: 'utf8mb4',
  });
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const [done] = await conn.query('SELECT filename FROM schema_migrations');
  const doneSet = new Set(done.map((r) => r.filename));

  // Kody „obiekt już istnieje / już nie istnieje" — tolerowane, żeby migracja była
  // idempotentna także po częściowym przebiegu (np. ALTER padł w połowie pliku).
  const IGNORABLE = new Set([
    'ER_DUP_FIELDNAME',   // 1060 kolumna już istnieje
    'ER_DUP_KEYNAME',     // 1061 indeks/klucz już istnieje
    'ER_CANT_DROP_FIELD_OR_KEY', // 1091 DROP czegoś, czego nie ma
    'ER_TABLE_EXISTS_ERROR',     // 1050
    'ER_DUP_ENTRY',       // 1062 unikat już nałożony na te same dane (nic do zrobienia)
    // 1826 klucz obcy o tej nazwie już istnieje. Bez tego powtórka migracji, która padła
    // W POŁOWIE, wywracała się na własnym FK — a to jest dokładnie ten przebieg, w którym
    // powtórka jest potrzebna. Trafiło się na 012 (`fk_item_prod`) i było opisane w RUNBOOK-u
    // jako pułapka „nie naprawiaj ręcznie"; pułapka przestaje istnieć, zamiast być pamiętana.
    // Nazwa klucza obcego musi być nadana JAWNIE (CONSTRAINT <nazwa>), inaczej MySQL wygeneruje
    // kolejną (tabela_ibfk_2) i przy powtórce założy drugi, zdublowany klucz zamiast pominąć.
    'ER_FK_DUP_NAME',     // 1826
  ]);

  for (const f of files) {
    if (doneSet.has(f)) { console.log('SKIP', f); continue; }
    const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\s*--.*$/gm, ''); // usuń komentarze liniowe
    // wykonuj statement po statemencie, tolerując „już istnieje"
    const stmts = sql.split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      try { await conn.query(stmt); }
      catch (e) {
        if (IGNORABLE.has(e.code)) { console.log('  (pomijam:', e.code + ')'); continue; }
        throw e;
      }
    }
    await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [f]);
    console.log('OK  ', f);
  }
  await conn.end();
  console.log('Migracje zakończone.');
})().catch((e) => { console.error('BŁĄD migracji:', e.message); process.exit(1); });
