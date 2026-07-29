-- 017: układ kafli/widgetów raportu — PER UŻYTKOWNIK, W BAZIE (Z9, decyzja Szymona 2026-07-28).
--
-- Dlaczego baza, nie localStorage. `localStorage` zniknęłaby przy zmianie urządzenia/przeglądarki
-- (telefon → laptop, wyczyszczone dane strony), a układ raportu to preferencja OSOBY, nie
-- URZĄDZENIA — Szymon ma ją mieć identyczną wszędzie, tak jak role i zasięg ksiąg (`users`),
-- a nie tak jak np. wybrana skóra (jasna/ciemna), która ZOSTAJE w `localStorage`, bo to
-- kosmetyka urządzenia, nie decyzja o TREŚCI raportu. Stąd też PK na `user_id`: jeden układ
-- na osobę, bez historii wersji — to jest ustawienie, nie księga, więc nadpisywanie jest OK
-- (w przeciwieństwie do `transactions`, gdzie nic nie ginie bezpowrotnie).
--
-- `layout` to JEDEN obiekt JSON: { kolejnosc: [id-kafli], ukryte: [id-kafli] }. Walidacja
-- ścisła (dokładnie te dwa klucze, tablice napisów, limity długości/liczby) siedzi w
-- src/routes/uklad.js — SQL sam nie wie, co to jest "kafel", więc nie próbuje tego pilnować
-- CHECK-iem; to samo podejście co przy innych polach opisowych w tej bazie.
CREATE TABLE IF NOT EXISTS report_layout (
  user_id INT UNSIGNED PRIMARY KEY,
  layout JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;
