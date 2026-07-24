// Mały parser CSV (cudzysłowy, separator ; lub ,) — bez zależności zewnętrznych.
function parseCsv(text, delimiter) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

// Wybór separatora: ten, który daje więcej kolumn w pierwszej niepustej linii.
function guessDelimiter(text) {
  const line = text.split('\n').find((l) => l.trim() !== '') || '';
  return (line.split(';').length >= line.split(',').length) ? ';' : ',';
}

// Kwoty PL: "1 234,56", "-1234.56", "1.234,56"
function parseAmount(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).replace(/[\s ]/g, '').replace(/PLN|zł/gi, '');
  if (t === '') return null;
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const v = parseFloat(t);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

// Daty: YYYY-MM-DD / DD.MM.YYYY / DD-MM-YYYY
function parseDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{2})[.\-\/](\d{2})[.\-\/](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

module.exports = { parseCsv, guessDelimiter, parseAmount, parseDate };
