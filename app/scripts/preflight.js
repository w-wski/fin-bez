#!/usr/bin/env node
// Bramka jakości uruchamiana w `npm test` (wzorzec „ratchet budget" z audytu jcode):
// liczby długu mogą tylko MALEĆ. Nowy dług = czerwone testy, nie cicha zgoda.
// Baseline: scripts/budzet.json (aktualizowany automatycznie, gdy dług spadnie).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUDGET_FILE = path.join(__dirname, 'budzet.json');
const MAX_LINES = 300;                 // plik produkcyjny; przekroczenie = podziel moduł
const SKIP = new Set(['node_modules', '.git', 'ocr-data', 'receipts']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|sql|css|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const rel = (p) => path.relative(ROOT, p);

// 1. Rozmiar plików
const tooBig = files
  .filter((f) => f.endsWith('.js'))
  .map((f) => [rel(f), fs.readFileSync(f, 'utf8').split('\n').length])
  .filter(([, n]) => n > MAX_LINES)
  .sort((a, b) => b[1] - a[1]);

// 2. Połknięte błędy: pusty catch bez komentarza wyjaśniającego
const swallowed = [];
for (const f of files.filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(f, 'utf8');
  src.split('\n').forEach((line, i) => {
    if (/catch\s*(\([^)]*\))?\s*\{\s*\}\s*$/.test(line)) swallowed.push(`${rel(f)}:${i + 1}`);
  });
}

// 3. Sekrety w kodzie (shared hosting + dane finansowe = bramka o najwyższym priorytecie)
const SECRETS = [
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/, 'klucz Anthropic'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'klucz AWS'],
  [/\bghp_[A-Za-z0-9]{20,}\b/, 'token GitHub'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'klucz prywatny'],
  [/\bPL\d{26}\b/, 'numer IBAN'],
];
const leaks = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const [re, name] of SECRETS) if (re.test(src)) leaks.push(`${rel(f)} — ${name}`);
}

const now = { pliki_za_duze: tooBig.length, polkniete_bledy: swallowed.length };
const base = fs.existsSync(BUDGET_FILE) ? JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8')) : null;

if (leaks.length) {
  console.error('PREFLIGHT: sekret w kodzie — commit zablokowany:');
  leaks.forEach((l) => console.error('  ' + l));
  process.exit(1);
}

if (!base) {
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(now, null, 2) + '\n');
  console.log('PREFLIGHT: zapisano baseline', now);
  process.exit(0);
}

let failed = false;
for (const [k, v] of Object.entries(now)) {
  if (v > base[k]) {
    failed = true;
    console.error(`PREFLIGHT: ${k} wzrosło ${base[k]} → ${v} (dług może tylko maleć)`);
    if (k === 'pliki_za_duze') tooBig.forEach(([f, n]) => console.error(`  ${f}: ${n} linii (limit ${MAX_LINES})`));
    if (k === 'polkniete_bledy') swallowed.forEach((s) => console.error('  ' + s));
  }
}
if (failed) process.exit(1);

const improved = Object.entries(now).some(([k, v]) => v < base[k]);
if (improved) {
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(now, null, 2) + '\n');
  console.log('PREFLIGHT: dług spadł — zapadka przesunięta', now);
} else {
  console.log('PREFLIGHT OK', now);
}
