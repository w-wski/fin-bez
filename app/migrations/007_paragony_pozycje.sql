-- 007: pozycje paragonu — kod z paragonu obok opisu człowieka, jednostka miary,
-- oraz słownik podpowiedzi uczący się z wcześniejszych korekt (decyzje Szymona 2026-07-24).

-- ocr_name  = surowy odczyt OCR (NIGDY nie nadpisywany — ślad audytowy)
-- code      = kod z paragonu po ewentualnej korekcie ręcznej (zwykle skrót, np. „CHL TOST 500G")
-- name      = opis człowieka (czytelny: „chleb tostowy")
ALTER TABLE receipt_items ADD COLUMN code VARCHAR(255) NULL AFTER ocr_name;
ALTER TABLE receipt_items ADD COLUMN unit VARCHAR(8) NULL;      -- kg, szt., l, m, opak.

-- Słownik podpowiedzi: znormalizowany kod z paragonu → opis, jednostka, kategoria.
-- Uczy się z KAŻDEJ ręcznej korekty; ostatnia decyzja człowieka jest wiążąca (hits rośnie).
CREATE TABLE IF NOT EXISTS item_dict (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code_norm VARCHAR(160) NOT NULL,            -- kod bez znaków diakrytycznych/spacji, wielkimi
  name VARCHAR(255) NOT NULL,                 -- podpowiadany opis
  unit VARCHAR(8) NULL,
  category_id INT UNSIGNED NULL,
  hits INT NOT NULL DEFAULT 1,
  updated_by VARCHAR(64) NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_item_code (code_norm),
  FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;
