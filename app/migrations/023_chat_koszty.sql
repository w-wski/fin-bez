-- 023: CZAT ANALIZ (decyzja Szymona 2026-07-30, pyt. 5-6) + koszty API per użytkownik.
--
-- Rozmowy zapisujemy w bazie z dwóch powodów: (a) „popularne pytania" liczone z historii
-- (GROUP BY pytanie), żeby nie wpisywać tego samego ponownie; (b) telemetria kosztów —
-- kto ile korzysta i ile to obciąża OpenRouter. Treść pytań zostaje w NASZEJ bazie;
-- do modelu wychodzą tylko dane okresu (hierarchicznie: najpierw zapisane podsumowania).
CREATE TABLE IF NOT EXISTS chat_rozmowy (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  okres_typ ENUM('miesiac','kwartal','rok') NOT NULL,
  okres VARCHAR(10) NOT NULL,
  szeroki TINYINT(1) NOT NULL DEFAULT 0,    -- 1 = „Poszerz poszukiwania" (rok bieżący + zapisane podsumowania)
  pytanie VARCHAR(512) NOT NULL,
  odpowiedz TEXT NULL,                      -- NULL = model nie odpowiedział (błąd/limit)
  model VARCHAR(64) NULL,
  tokens_in INT NULL, tokens_out INT NULL,
  koszt_usd DECIMAL(10,6) NULL,             -- z nagłówków/generation OpenRouter, NULL = nieznany
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_chat_user (user_id, created_at),
  INDEX idx_chat_okres (okres_typ, okres),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- api_costs (szkielet z 001, dotąd niezasilany — audyt) dostaje user_id, bo user_name
-- nie łączy się rzetelnie z users.id (zmiana imienia, brak unikalności). Dokańczamy
-- tabelę zamiast budować nową: zasilanie przejmuje src/rejestr.js (telemetria wychodząca)
-- i czat. Twardy limit miesięczny czatu ($5/mies. łącznie, decyzja pyt. 2) liczy się
-- z chat_rozmowy.koszt_usd — odcięcie w kodzie PRZED wywołaniem modelu.
ALTER TABLE api_costs
  ADD COLUMN user_id INT UNSIGNED NULL AFTER user_name,
  ADD COLUMN koszt_usd DECIMAL(10,6) NULL AFTER cost_pln,
  ADD INDEX idx_costs_user_ts (user_id, ts);
