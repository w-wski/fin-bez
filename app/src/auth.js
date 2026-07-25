// Google OAuth (code flow) + sesja JWT w cookie httpOnly.
// Dostęp mają wyłącznie e-maile obecne w tabeli users (active=1).
const jwt = require('jsonwebtoken');
const config = require('./config');
const { q } = require('./db');

const COOKIE = 'f_auth';

function loginUrl(state) {
  const p = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.baseUrl + '/auth/callback',
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state: state || '/',
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
}

async function exchangeCode(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.baseUrl + '/auth/callback',
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error('Google token exchange failed: ' + res.status);
  const tok = await res.json();
  // id_token = JWT podpisany przez Google; e-mail bierzemy z payloadu,
  // a wiarygodność gwarantuje bezpośrednia wymiana code->token po TLS.
  const payload = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString('utf8'));
  return { email: (payload.email || '').toLowerCase(), emailVerified: payload.email_verified };
}

function signSession(user) {
  return jwt.sign(
    { uid: user.id, name: user.name, role: user.role },
    config.jwtSecret,
    { expiresIn: `${config.jwtDays}d` }
  );
}

function setCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${config.jwtDays * 86400}`);
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function readSession(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!m) return null;
  try { return jwt.verify(m[1], config.jwtSecret); } catch { return null; }
}

// Middleware: wymaga zalogowania. Dociąga aktualny stan konta z bazy, żeby dezaktywacja
// (active=0) lub zmiana roli działały natychmiast, a nie dopiero po wygaśnięciu 7-dniowego JWT.
async function requireAuth(req, res, next) {
  const s = readSession(req);
  if (!s) return res.status(401).json({ error: 'auth_required' });
  try {
    const rows = await q('SELECT id, name, role FROM users WHERE id = :id AND active = 1', { id: s.uid });
    if (!rows.length) return res.status(401).json({ error: 'account_inactive' });
    req.user = { uid: rows[0].id, name: rows[0].name, role: rows[0].role };
    next();
  } catch (e) { next(e); }
}

// Które księgi widzi użytkownik i czy tylko własne wpisy.
// admin:   obie księgi, wszystko + telemetria i edycja słownika kategorii.
// adult:   obie księgi, wszystko — dorosły WSPÓŁPROWADZĄCY finanse (Anna: RODZINA plus
//          działalność szkoleniowa w PERSEVERZE), więc raporty i wpisy spółki też.
//          Bez telemetrii i bez edycji kategorii — te zostają przy adminie (decyzja 2026-07-24).
// junior:  RODZINA, tylko własne wpisy.
// company: PERSEVERA, wszystko.
function ledgerScope(user) {
  switch (user.role) {
    case 'admin': return { ledgers: [1, 2], ownOnly: false };
    case 'adult': return { ledgers: [1, 2], ownOnly: false };
    case 'junior': return { ledgers: [1], ownOnly: true };
    case 'company': return { ledgers: [2], ownOnly: false };
    case 'widget': return { ledgers: [1], ownOnly: false }; // read-only widget: tylko RODZINA
    default: return { ledgers: [], ownOnly: true };
  }
}

async function findUserByEmail(email) {
  const rows = await q('SELECT id, email, name, role FROM users WHERE email = :email AND active = 1', { email });
  return rows[0] || null;
}

module.exports = { loginUrl, exchangeCode, signSession, setCookie, clearCookie, readSession, requireAuth, ledgerScope, findUserByEmail };
