// ro/auth.js — tokeny API tylko-do-odczytu (Z10, pkt 16+18). NAJWYŻSZA OSTROŻNOŚĆ: to
// jedyna droga, którą dane finansowe rodziny wychodzą poza aplikację (Claude i dashboard —
// obaj TĄ SAMĄ drogą, ten sam token). Token NIE ma własnej tożsamości: dziedziczy zasięg
// ksiąg z properties.owner (`user_id` → ledgerScope), a `scope_ledgers` może go wyłącznie
// ZAWĘZIĆ, nigdy rozszerzyć — literówka w konfiguracji ma dać mniej danych, nie więcej.
//
// Router (ro/api.js) używa stąd WYŁĄCZNIE `requireToken` i nie pisze do bazy. Zapis w tym
// pliku dotyczy TYLKO housekeepingu samych tokenów (wydanie/odnotowanie użycia/unieważnienie
// w tabeli api_tokens) — nigdy danych księgi (transactions/categories/receipts/products).
// Test (scripts/test-ro-api.js) pilnuje osobno, że router (ro/api.js) nie zawiera żadnego
// zapisu, i że zapisy tutaj dotykają wyłącznie tabeli api_tokens.
const crypto = require('crypto');
const { q } = require('../db');
const { ledgerScope } = require('../auth');

const PREFIX = 'fin_ro_';

/** sha256 hex — jedyna postać sekretu, jaka trafia do bazy. */
function haszuj(sekret) {
  return crypto.createHash('sha256').update(sekret, 'utf8').digest('hex');
}

/** Losowy sekret w formacie `fin_ro_<64 hex>` (32 losowe bajty). */
function generujSekret() {
  return PREFIX + crypto.randomBytes(32).toString('hex');
}

// Zasięg efektywny tokenu: przecięcie ról właściciela (ledgerScope) z ewentualnym
// zawężeniem scope_ledgers. Token NIGDY nie poszerza zasięgu właściciela.
function zasiegTokenu(user, scopeLedgers) {
  const wlasciciela = ledgerScope(user).ledgers;
  if (!scopeLedgers) return wlasciciela;
  const zawezenie = String(scopeLedgers).split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
  return wlasciciela.filter((l) => zawezenie.includes(l));
}

// Middleware: `Authorization: Bearer fin_ro_...`. Zły format / nieznany / unieważniony token
// dają DOKŁADNIE tę samą odpowiedź 401 — treść nie może zdradzić, czy token kiedyś istniał.
async function requireToken(req, res, next) {
  const DENY = () => res.status(401).json({ error: 'invalid_token' });
  const naglowek = req.headers.authorization || '';
  const dop = naglowek.match(/^Bearer\s+(\S+)$/);
  if (!dop || !dop[1].startsWith(PREFIX)) return DENY();
  try {
    const hash = haszuj(dop[1]);
    const rows = await q(
      `SELECT api_tokens.id, api_tokens.token_hash, api_tokens.scope_ledgers, api_tokens.revoked_at,
              users.id AS uid, users.name, users.role
         FROM api_tokens JOIN users ON users.id = api_tokens.user_id
        WHERE api_tokens.token_hash = :h AND users.active = 1`, { h: hash });
    if (!rows.length) return DENY();
    const row = rows[0];
    // Porównanie hasza stałoczasowe: nawet że WHERE już dopasował wiersz po indeksie,
    // druga, jawna weryfikacja w JS ma identyczny koszt niezależnie od treści — to ostatnia
    // linia obrony przed atakiem czasowym, gdyby kiedyś ktoś zmienił zapytanie na LIKE/skan.
    const bufA = Buffer.from(hash, 'utf8');
    const bufB = Buffer.from(row.token_hash || '', 'utf8');
    const pasuje = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
    if (!pasuje || row.revoked_at) return DENY();
    const user = { uid: row.uid, name: row.name, role: row.role };
    req.roToken = {
      id: row.id,
      name: row.name,
      ledgers: zasiegTokenu(user, row.scope_ledgers),
    };
    // Fire-and-forget: odnotowanie użycia nie może opóźniać ani wywrócić odpowiedzi GET.
    // Błąd loguje się, żeby cichy zanik last_used_at nie umknął przy audycie tokenów (Z12).
    q('UPDATE api_tokens SET last_used_at = NOW() WHERE id = :id', { id: row.id })
      .catch((e) => console.error('ro/auth: last_used_at nieaktualizowany', e.message));
    next();
  } catch (e) { next(e); }
}

// Wydanie nowego tokenu — używane przez panel Admin (Z12). Sekret wraca RAZ, w bazie zostaje
// tylko hash: nawet wyciek kopii bazy nie daje działającego tokenu.
async function wydajToken(userId, name, scope) {
  const sekret = generujSekret();
  const r = await q(
    'INSERT INTO api_tokens (name, token_hash, user_id, scope_ledgers) VALUES (:n, :h, :u, :s)',
    { n: String(name || '').trim().slice(0, 64) || 'token', h: haszuj(sekret), u: userId, s: scope || null });
  return { id: r.insertId, token: sekret };
}

// Unieważnienie — tylko właściciel tokenu (userId z sesji admina/adult, nie inny użytkownik).
async function uniewaznij(id, userId) {
  const r = await q(
    'UPDATE api_tokens SET revoked_at = NOW() WHERE id = :id AND user_id = :u AND revoked_at IS NULL',
    { id, u: userId });
  return r.affectedRows > 0;
}

module.exports = { requireToken, wydajToken, uniewaznij, haszuj, generujSekret, zasiegTokenu, PREFIX };
