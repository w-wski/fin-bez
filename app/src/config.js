// Konfiguracja z env / pliku .env poza docrootem (wzorzec z wp-ai, DECYZJE #62).
const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  // .env szukany kolejno: $ENV_FILE, ../.env (poza public_html), ./.env
  const candidates = [
    process.env.ENV_FILE,
    path.join(__dirname, '..', '..', '.env'),
    path.join(__dirname, '..', '.env'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const txt = fs.readFileSync(p, 'utf8');
      for (const line of txt.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
      }
      return p;
    } catch { /* następny kandydat */ }
  }
  return null;
}
loadEnvFile();

const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS', 'JWT_SECRET'];
const missing = required.filter((k) => !process.env[k]);

module.exports = {
  missing,
  port: parseInt(process.env.PORT || '3000', 10),
  baseUrl: process.env.BASE_URL || 'https://finanse.bezprzemocowo.pl',
  db: {
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    charset: 'utf8mb4',
  },
  jwtSecret: process.env.JWT_SECRET,
  jwtDays: 7,
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  },
  // token tylko-do-odczytu dla widgetu dashboardu (GET /api/v1/summary)
  widgetToken: process.env.WIDGET_TOKEN || '',
  maxCsvBytes: 5 * 1024 * 1024, // limit 5 MB jak w prototypie
};
