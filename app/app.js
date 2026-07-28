// finansowa — punkt wejścia (Passenger na seohost uruchamia ten plik).
const express = require('express');
const path = require('path');
const config = require('./src/config');
const auth = require('./src/auth');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// --- health / diagnostyka (bez sekretów) ---
app.get('/healthz', (req, res) => {
  res.json({ ok: config.missing.length === 0, missing_env: config.missing });
});

// --- auth ---
app.get('/auth/login', (req, res) => res.redirect(auth.loginUrl(req.query.next || '/')));
app.get('/auth/callback', async (req, res) => {
  try {
    const { email, emailVerified } = await auth.exchangeCode(req.query.code);
    if (!emailVerified) return res.status(403).send('E-mail niezweryfikowany w Google.');
    const user = await auth.findUserByEmail(email);
    if (!user) return res.status(403).send(`Brak dostępu dla ${email}. Poproś administratora o dodanie konta.`);
    auth.setCookie(res, auth.signSession(user));
    const next = String(req.query.state || '/');
    const cel = next.startsWith('/') ? next : '/';
    // `witaj=1` = znacznik ŚWIEŻEGO logowania dla frontendu (plansza powitalna grana
    // tylko po powrocie z Google, nie przy każdym starcie aplikacji). Frontend zjada
    // go przez history.replaceState, więc nie zostaje w adresie.
    res.redirect(cel + (cel.includes('?') ? '&' : '?') + 'witaj=1');
  } catch (e) {
    console.error('auth callback:', e.message);
    res.status(500).send('Błąd logowania Google. Spróbuj ponownie.');
  }
});
const wylogowanie = (req, res) => { auth.clearCookie(res); res.json({ ok: true }); };
app.post('/auth/logout', wylogowanie);
// GET jako zapasowe wyjście: WAF hostingu (ModSecurity/LiteSpeed) potrafi uciąć POST
// błędem 400, zanim dotrze do aplikacji. Skutek podrobionego GET-a to co najwyżej
// wylogowanie kogoś — nic nie ginie, więc wygoda wygrywa z purystycznym POST-only.
app.get('/auth/logout', wylogowanie);
app.get('/api/v1/me', (req, res) => {
  const s = auth.readSession(req);
  if (!s) return res.status(401).json({ error: 'auth_required' });
  res.json({ id: s.uid, name: s.name, role: s.role, scope: auth.ledgerScope(s) });
});

// --- API v1 ---
const reports = require('./src/routes/reports');
app.use('/api/v1', reports); // /summary ma własny auth (sesja LUB token widgetu)
app.use('/api/v1/transactions', auth.requireAuth, require('./src/routes/transactions'));
app.use('/api/v1/categories', auth.requireAuth, require('./src/routes/categories'));
app.use('/api/v1/imports', auth.requireAuth, require('./src/routes/imports'));
app.use('/api/v1/receipts', auth.requireAuth, require('./src/routes/receipts'));
app.use('/api/v1/proposals', auth.requireAuth, require('./src/routes/proposals'));
app.use('/api/v1/products', auth.requireAuth, require('./src/routes/products'));

// --- szczegółowa telemetria (następca arkusza LOGI; poza księgą) ---
// Przyjmuje pojedyncze zdarzenie LUB batch {events:[...]} (kolejka offline).
app.post('/api/v1/telemetry', auth.requireAuth, async (req, res) => {
  try {
    const { q } = require('./src/db');
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : [req.body || {}];
    for (const b of events) {
      await q(
        `INSERT INTO telemetry (user_name, view_name, action, duration_s, detail, offline, ts)
         VALUES (:u, :v, :a, :d, :det, :off, COALESCE(:ts, NOW()))`,
        { u: req.user.name, v: String(b.view || '').slice(0, 64), a: String(b.action || '').slice(0, 64),
          d: b.duration_s ?? null, det: b.detail ? String(b.detail).slice(0, 255) : null,
          off: b.offline ? 1 : 0,
          ts: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(b.ts || '') ? new Date(b.ts) : null });
    }
    res.json({ ok: true, n: events.length });
  } catch { res.json({ ok: false }); } // telemetria nigdy nie blokuje UI
});

// --- statyczny frontend ---
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: 'index.html' }));

// błędy
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large_5mb' });
  console.error('server_error:', err && err.message ? err.message : err); // bez pełnego obiektu (może zawierać fragmenty SQL/wartości)
  res.status(500).json({ error: 'server_error' });
});

app.listen(config.port, () => console.log(`finansowa: listening on :${config.port}`));
