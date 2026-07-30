// wylaczniki.js — wyłącznik każdej modalności, którą dane mogłyby opuścić aplikację
// (21a). Domyślnie WSZYSTKO WYŁĄCZONE (migracja 019) — Szymon włącza świadomie w Adminie.
const { q } = require('./db');

// Zamknięty zbiór modalności (musi być 1:1 z wierszami wstawionymi w migracji 019).
// Whitelist chroni przed literówką w Adminie/kodzie ('ro-api' zamiast 'ro_api'), która
// bez tej listy byłaby CICHYM no-op: UPDATE nie trafiłby w żaden wiersz, ustaw() zwróciłaby
// sukces, UI pokazałby „wyłączono", a stary (włączony) stan modalności zostałby bez zmian.
const KLUCZE = ['ro_api', 'eksport_csv', 'model_zewnetrzny', 'widget'];

const CACHE_MS = 30000; // 30 s: nie odpytujemy bazy przy każdym żądaniu eksportu/API.
// Skutek uboczny: po przełączeniu w Adminie zmiana dotrze do middleware z opóźnieniem
// do 30 s (osobno per klucz — patrz cache poniżej), nie natychmiast. To akceptowalne dla
// wyłącznika bezpieczeństwa (lepiej 30 s zwłoki niż zapytanie do bazy na każdy request).
// UWAGA: cache jest PER PROCES (zwykła Mapa w pamięci). Pod Passengerem/PM2 z więcej niż
// jednym workerem inne procesy mają WŁASNY cache — ustaw() czyści go tylko w procesie,
// który obsłużył żądanie z Admina, więc pozostałe workery i tak dogonią zmianę dopiero
// po swoich max 30 s. To nie jest błąd tej funkcji, tylko właściwość cache w pamięci
// procesu — gdyby to miało być spójne od razu, trzeba by cache trzymać poza procesem
// (np. w samej bazie/Redisie), co dziś jest przerostem formy nad treścią.
const cache = new Map(); // klucz -> { wlaczona, at }

async function czyWlaczona(klucz) {
  const trafiony = cache.get(klucz);
  if (trafiony && Date.now() - trafiony.at < CACHE_MS) return trafiony.wlaczona;
  // Jeśli tabela `modalnosci` w ogóle nie istnieje (migracja 019 jeszcze nie odpalona),
  // ten SELECT rzuci (ER_NO_SUCH_TABLE) i wyjątek poleci do wywołującego — TO JEST 500,
  // nie „bezpieczny OFF". Bezpieczny OFF dotyczy tylko przypadku, gdy TABELA istnieje,
  // a brakuje w niej WIERSZA dla danego klucza (literówka, klucz jeszcze niewstawiony).
  const rows = await q('SELECT wlaczona FROM modalnosci WHERE klucz = :klucz', { klucz });
  const wlaczona = rows.length ? !!rows[0].wlaczona : false;
  cache.set(klucz, { wlaczona, at: Date.now() });
  return wlaczona;
}

// Rzuca przy nieznanym kluczu (literówka) i przy braku wiersza w bazie (affectedRows===0)
// — obie sytuacje to CICHY no-op bez tego rzucenia, a przy wyłączniku bezpieczeństwa
// cichy no-op jest gorszy niż widoczny błąd. Wywołujący (panel Admin, Z12) łapie wyjątek
// i pokazuje go człowiekowi zamiast fałszywego „ok".
async function ustaw(klucz, wlaczona, userId) {
  if (!KLUCZE.includes(klucz)) throw new Error(`nieznany_klucz_modalnosci: ${klucz}`);
  const wynik = await q(
    `UPDATE modalnosci SET wlaczona = :w, zmienil_user_id = :u WHERE klucz = :klucz`,
    { w: wlaczona ? 1 : 0, u: userId ?? null, klucz },
  );
  if (!wynik.affectedRows) throw new Error(`modalnosc_nie_istnieje_w_bazie: ${klucz}`);
  cache.delete(klucz); // następne czyWlaczona() W TYM PROCESIE od razu widzi nowy stan
  return true;
}

// Dla panelu Admin (Z12): pełny stan wszystkich modalności, zawsze świeży z bazy
// (to jest ekran, na którym Szymon PODEJMUJE decyzję — cache tu byłby mylący).
async function stanWszystkich() {
  return q('SELECT klucz, wlaczona, zmieniona_at, zmienil_user_id FROM modalnosci ORDER BY klucz', {});
}

// Middleware trasowy: blokuje ścieżkę, dopóki modalność jest wyłączona.
function wymagajModalnosci(klucz) {
  return async (req, res, next) => {
    try {
      if (!(await czyWlaczona(klucz))) {
        return res.status(503).json({ error: 'modalnosc_wylaczona', klucz });
      }
      next();
    } catch (e) { next(e); }
  };
}

module.exports = { KLUCZE, czyWlaczona, ustaw, stanWszystkich, wymagajModalnosci };
