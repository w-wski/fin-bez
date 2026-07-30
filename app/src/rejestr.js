// rejestr.js — kto CZYTA nasze dane (access_log, #17) i co MY wysyłamy na zewnątrz
// (outbound_log, #26). Zapisy fire-and-forget: rejestr audytowy nie może wywrócić
// ścieżki głównej — jeśli baza padnie akurat na INSERT-cie do logu, użytkownik i tak
// ma dostać swoje dane, a błąd trafia tylko na konsolę serwera.
const { q } = require('./db');

const KANALY = ['ro_api', 'eksport_csv', 'analiza'];

// Wywołujący NIE czeka na ten INSERT (brak await po stronie tras) — stąd .catch, nie
// try/catch: funkcja zwraca obietnicę, ale jej odrzucenie nie ma się propagować w górę.
function zapiszDostep(kanal, endpoint, okres, wierszy, tokenId) {
  if (!KANALY.includes(kanal)) {
    console.error('rejestr.zapiszDostep: nieznany kanał', kanal);
    return;
  }
  q(
    `INSERT INTO access_log (token_id, kanal, endpoint, okres, wierszy)
     VALUES (:tokenId, :kanal, :endpoint, :okres, :wierszy)`,
    {
      tokenId: tokenId ?? null,
      kanal,
      endpoint: String(endpoint || '').slice(0, 128),
      okres: okres ? String(okres).slice(0, 32) : null,
      wierszy: wierszy ?? null,
    },
  ).catch((e) => console.error('rejestr.zapiszDostep: INSERT nieudany —', e.message));
}

function zapiszWyjscie(narzedzie, cel, zapytan, znakow) {
  q(
    `INSERT INTO outbound_log (narzedzie, cel, zapytan, znakow_wyslanych)
     VALUES (:narzedzie, :cel, :zapytan, :znakow)`,
    {
      narzedzie: String(narzedzie || '').slice(0, 48),
      cel: String(cel || '').slice(0, 128),
      zapytan: Number.isInteger(zapytan) ? zapytan : 1,
      znakow: znakow ?? null,
    },
  ).catch((e) => console.error('rejestr.zapiszWyjscie: INSERT nieudany —', e.message));
}

// Dla panelu Admin (Z12) — ostatnie wpisy obu rejestrów, do wglądu „kto/co czytał/wysyłał".
async function ostatnieDostepy(limit) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  // LEFT JOIN, nie JOIN: dostęp bez tokenu (widget/wewnętrzne) ma zostać na liście, tylko
  // bez nazwy — to jest właśnie „KTO czytał", cel #17 (Z14 #6).
  return q(`SELECT a.id, a.token_id, t.name AS token_name, a.kanal, a.endpoint, a.okres, a.wierszy, a.created_at
              FROM access_log a
              LEFT JOIN api_tokens t ON t.id = a.token_id
              ORDER BY a.id DESC LIMIT ${n}`, {});
}

async function ostatnieWyjscia(limit) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  return q(`SELECT id, narzedzie, cel, zapytan, znakow_wyslanych, created_at
              FROM outbound_log ORDER BY id DESC LIMIT ${n}`, {});
}

module.exports = { zapiszDostep, zapiszWyjscie, ostatnieDostepy, ostatnieWyjscia };
