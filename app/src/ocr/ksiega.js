// Styk paragonu z KSIĘGĄ: potwierdzenie (jeden WYDATEK) i synchronizacja nagłówka.
// Wydzielone z routes/receipts.js (limit 300 linii) — tam została walidacja wejścia i HTTP.
//
// Reguła nadrzędna: paragon i wpis w księdze pokazują TĘ SAMĄ kwotę i TĘ SAMĄ datę, zawsze.
// Dlatego każda zmiana, która dotyka obu tabel, idzie w JEDNEJ transakcji SQL.
const { pool } = require('../db');

// Nagłówek paragonu + (gdy paragon jest już zaksięgowany) kwota/data wpisu w księdze.
// `sets`/`params` to gotowe fragmenty UPDATE-a receipts, `ksiegaSet` to pola transactions.
// Zwraca stan księgi: 'zaktualizowany' | 'w koszu' | null (paragon jeszcze nie zaksięgowany).
async function zapiszNaglowek(rc, sets, params, ksiegaSet) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`UPDATE receipts SET ${sets.join(', ')} WHERE id = ?`, [...params, rc.id]);
    let ksiega = null;
    const kolumny = Object.keys(ksiegaSet || {});
    if (rc.transaction_id && kolumny.length) {
      // deleted_at IS NULL: wpisu w koszu nie wskrzeszamy po cichu — mówimy o tym użytkownikowi
      const [r] = await conn.execute(
        `UPDATE transactions SET ${kolumny.map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND deleted_at IS NULL`,
        [...kolumny.map((k) => ksiegaSet[k]), rc.transaction_id]);
      ksiega = r.affectedRows ? 'zaktualizowany' : 'w koszu';
    }
    await conn.commit();
    return ksiega;
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

// K8: potwierdzenie księguje JEDEN wydatek i jest idempotentne — zatrzask statusu sprawia,
// że przy dwóch równoległych kliknięciach tylko jedno przestawi NOWY→POTWIERDZONY.
// Kwota i data są tu już zwalidowane przez router (kwota > 0, data istnieje w kalendarzu).
async function ksieguj(rc, user, kwota, data, categoryId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [lock] = await conn.execute(
      "UPDATE receipts SET status='POTWIERDZONY' WHERE id=? AND status<>'POTWIERDZONY'", [rc.id]);
    if (!lock.affectedRows) {
      await conn.rollback();
      const [[cur]] = await conn.query('SELECT transaction_id FROM receipts WHERE id=?', [rc.id]);
      return { transaction_id: cur ? cur.transaction_id : null, already_confirmed: true };
    }
    const [r] = await conn.execute(
      `INSERT INTO transactions (ledger_id, user_id, tx_date, type, amount, category_id, description, source, legacy_id)
       VALUES (?, ?, ?, 'WYDATEK', ?, ?, ?, 'RECEIPT', ?)`,
      [rc.ledger_id, user.uid, data, kwota, categoryId,
        ('Paragon: ' + (rc.shop_name || '')).slice(0, 512), 'rcpt:' + rc.receipt_hash.slice(0, 24)]);
    await conn.execute('UPDATE receipts SET transaction_id=? WHERE id=?', [r.insertId, rc.id]);
    await conn.commit();
    return { transaction_id: r.insertId };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

module.exports = { zapiszNaglowek, ksieguj };
