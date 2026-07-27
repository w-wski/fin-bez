/* dostep.js — kto może zobaczyć paragon i do której księgi wolno go dopisać.
 *
 * Wyjęte z routes/receipts.js: to reguła DOMOWA (K9), nie szczegół trasy HTTP, a od kiedy
 * paragon wchodzi trzema drogami (zdjęcie, PDF, e-paragon), sprawdzenie księgi robiło się
 * w trzech miejscach tym samym kodem. Jedna reguła = jedno miejsce do poprawienia.
 */
const { q } = require('../db');
const { ledgerScope } = require('../auth');

/** Księga z żądania + sprawdzenie zakresu. Zwraca `null` I ODPOWIADA sama (403),
 *  gdy księga jest poza zasięgiem użytkownika. */
function ksiega(req, res) {
  const scope = ledgerScope(req.user);
  const id = parseInt((req.body && req.body.ledger_id) || 1, 10);
  if (!scope.ledgers.includes(id)) { res.status(403).json({ error: 'ledger_forbidden' }); return null; }
  return id;
}

/** K9: paragon i jego obraz widzi WYŁĄCZNIE właściciel albo admin. Cudzy = 404, nie 403 —
 *  403 zdradzałoby, że taki paragon istnieje. Sama rola „adult" nie wystarcza: zakres
 *  księgi jest tu za szeroki, a paragon bywa prywatny. */
async function wlasnyParagon(req, res) {
  const scope = ledgerScope(req.user);
  const rows = await q('SELECT * FROM receipts WHERE id = :id', { id: parseInt(req.params.id, 10) || 0 });
  const rc = rows[0];
  const moj = rc && rc.user_id === req.user.uid;
  if (!rc || !scope.ledgers.includes(rc.ledger_id) || (!moj && req.user.role !== 'admin')) {
    res.status(404).json({ error: 'not_found' }); return null;
  }
  return rc;
}

/** DATE z MySQL wraca jako napis (db.js: dateStrings) albo obiekt Date — do przeglądarki
 *  musi trafić czysta doba lokalna, inaczej strefa czasowa cofa paragon o jeden dzień. */
function dataISO(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}

module.exports = { ksiega, wlasnyParagon, dataISO };
