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

// Koszty API per user (Z20, migracja 023 dokańcza szkielet api_costs z 001) — telemetria
// Admina (K8) potrzebuje wiedzieć KTO ile kosztuje, nie tylko ile łącznie. Fire-and-forget
// jak zapiszWyjscie: koszt zapisany tu jest informacyjny (audyt), nigdy nie ma wywrócić
// odpowiedzi modelu, gdyby akurat baza była niedostępna.
function zapiszKosztApi(userId, action, model, tokensIn, tokensOut, kosztUsd) {
  q(
    `INSERT INTO api_costs (user_id, action, model, tokens_in, tokens_out, koszt_usd)
     VALUES (:userId, :action, :model, :tin, :tout, :koszt)`,
    {
      userId: userId ?? null,
      action: String(action || '').slice(0, 64),
      model: model ? String(model).slice(0, 64) : null,
      tin: Number.isInteger(tokensIn) ? tokensIn : null,
      tout: Number.isInteger(tokensOut) ? tokensOut : null,
      koszt: kosztUsd ?? null,
    },
  ).catch((e) => console.error('rejestr.zapiszKosztApi: INSERT nieudany —', e.message));
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

// Suma miesięczna kosztów per user per źródło (chat/analiza) — telemetria Admina (K8).
// LEFT JOIN users: user_id bywa NULL (np. narracja Analiz woła dostawcę bez kontekstu usera —
// narracja() celowo NIE ZMIENIONA sygnaturą tego zlecenia), taki wiersz ma zostać widoczny
// jako „—", nie zniknąć z sumy.
async function kosztyMiesieczne() {
  return q(
    `SELECT u.name AS user_name, a.action AS zrodlo, ROUND(SUM(COALESCE(a.koszt_usd, 0)), 4) AS koszt
       FROM api_costs a LEFT JOIN users u ON u.id = a.user_id
      WHERE DATE_FORMAT(a.ts, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')
      GROUP BY a.user_id, a.action ORDER BY koszt DESC`, {});
}

module.exports = { zapiszDostep, zapiszWyjscie, zapiszKosztApi, ostatnieDostepy, ostatnieWyjscia, kosztyMiesieczne };
