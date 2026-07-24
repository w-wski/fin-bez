const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 5, // shared hosting — oszczędnie
  namedPlaceholders: true,
  // Daty jako NAPISY ('2026-07-01'), nie obiekty Date. Bez tego mysql2 zwraca DATE jako
  // Date lokalnej północy, res.json() serializuje to do UTC i przy strefie Europe/Warsaw
  // front widzi dzień WCZEŚNIEJSZY — a przy edycji wpisu ta cofnięta data wracała do bazy
  // (transakcja wędrowała o dobę wstecz przy każdym zapisie). Cała aplikacja i tak
  // traktuje daty jak napisy ISO, więc to jest zgodne z resztą kodu.
  dateStrings: true,
});

async function q(sql, params) {
  const [rows] = await pool.execute(sql, params || {});
  return rows;
}

module.exports = { pool, q };
