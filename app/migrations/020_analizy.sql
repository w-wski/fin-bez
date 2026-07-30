-- 020: `analizy` (Z12) — migawki analiz okresowych (miesiąc/kwartał/rok), liczone z
-- księgi + opcjonalna narracja modelu (src/model/dostawca.js: dziś Anthropic, jutro może
-- model lokalny family-os — przepięcie w JEDNYM pliku, nie w schemacie). Analiza to
-- POCHODNA księgi, nie księga sama — nowe przeliczenie tego samego okresu NADPISUJE
-- poprzednie, nie dopisuje kolejny wiersz (inaczej tabela rosłaby przy każdym kliknięciu
-- „Przygotuj analizę" tego samego miesiąca).
--
-- ledger_id: kontrakt API (src/analizy.js, routes/analizy.js) mówi „NULL = obie księgi",
-- ale w SAMEJ TABELI trzymamy sentinel 0, nie NULL — MySQL dopuszcza WIELE wierszy z NULL
-- w indeksie UNIQUE (ten sam problem rozwiązano już w product_aliases, migracja 012, przez
-- shop='*'), więc ON DUPLICATE KEY UPDATE nigdy by nie trafił w istniejący wiersz „obie
-- księgi" — każde „Przygotuj analizę" dopisywałoby nowy, zamiast nadpisać. `0` nie koliduje
-- z prawdziwym ledger_id (1/2 z tabeli `ledgers`), więc jest bezpiecznym sentinelem.
CREATE TABLE IF NOT EXISTS analizy (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  okres_typ ENUM('miesiac','kwartal','rok') NOT NULL,
  okres VARCHAR(10) NOT NULL,               -- '2026-07' / '2026-Q3' / '2026'
  ledger_id TINYINT UNSIGNED NOT NULL DEFAULT 0,   -- 0 = obie księgi (patrz komentarz wyżej)
  dane JSON NOT NULL,                       -- liczby — kształt patrz src/analizy.js#policzOkres
  narracja TEXT NULL,                       -- tekst modelu, NULL gdy offline (brak dostawcy albo wyłącznik)
  model VARCHAR(48) NULL,                   -- np. claude-sonnet-5, NULL gdy narracja jest NULL
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_analiza_okres (okres_typ, okres, ledger_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;
