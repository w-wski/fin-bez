// wylaczniki.js — wyłącznik każdej modalności, którą dane mogłyby opuścić aplikację
// (21a). Domyślnie WSZYSTKO WYŁĄCZONE (migracja 019) — Szymon włącza świadomie w Adminie.
const { q } = require('./db');

const CACHE_MS = 30000; // 30 s: nie odpytujemy bazy przy każdym żądaniu eksportu/API.
// Skutek uboczny: po przełączeniu w Adminie zmiana dotrze do middleware z opóźnieniem
// do 30 s (osobno per klucz — patrz cache poniżej), nie natychmiast. To akceptowalne dla
// wyłącznika bezpieczeństwa (lepiej 30 s zwłoki niż zapytanie do bazy na każdy request).
const cache = new Map(); // klucz -> { wlaczona, at }

async function czyWlaczona(klucz) {
  const trafiony = cache.get(klucz);
  if (trafiony && Date.now() - trafiony.at < CACHE_MS) return trafiony.wlaczona;
  const rows = await q('SELECT wlaczona FROM modalnosci WHERE klucz = :klucz', { klucz });
  // Brak wiersza (literówka klucza, migracja jeszcze nie odpalona) = bezpieczny domyślny
  // stan WYŁĄCZONY, nie 500 — awaria bazy/schematu nie ma otwierać wycieku danych.
  const wlaczona = rows.length ? !!rows[0].wlaczona : false;
  cache.set(klucz, { wlaczona, at: Date.now() });
  return wlaczona;
}

async function ustaw(klucz, wlaczona, userId) {
  await q(
    `UPDATE modalnosci SET wlaczona = :w, zmienil_user_id = :u WHERE klucz = :klucz`,
    { w: wlaczona ? 1 : 0, u: userId ?? null, klucz },
  );
  cache.delete(klucz); // następne czyWlaczona() od razu widzi nowy stan, nie czeka 30 s
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

module.exports = { czyWlaczona, ustaw, stanWszystkich, wymagajModalnosci };
