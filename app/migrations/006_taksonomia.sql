-- 006: taksonomia kategorii (akceptacja docs/KATEGORIE-ZMIANY-DO-AKCEPTACJI.md, 2026-07-24)
-- + kolory kategorii + audyt usunięć (cofanie) + źródło BUDZET.
-- Migracje są uruchamiane instrukcja po instrukcji i tolerują „już istnieje" (db-migrate.js).

-- TRANSFER: przesunięcie własnych pieniędzy (spłaty, cele) — poza raportem konsumpcji.
ALTER TABLE transactions MODIFY COLUMN type ENUM('WYDATEK','PRZYCHÓD','TRANSFER') NOT NULL;

-- Import arkusza „Budżet Domowy" księguje ze źródłem BUDZET (scripts/import-budzet.js).
ALTER TABLE transactions MODIFY COLUMN source ENUM('MANUAL','CSV','RECEIPT','MIGRACJA','BUDZET') NOT NULL DEFAULT 'MANUAL';

-- Tag kontekstu (np. wyjazd-2026-06) — decyzja §7.1: kontekst obok kategorii, nie zamiast.
ALTER TABLE transactions ADD COLUMN tag VARCHAR(48) NULL AFTER description;
CREATE INDEX idx_tx_tag ON transactions (tag);

-- Kto usunął — potrzebne, żeby „cofnij usunięcie" wiedziało, czyj to był ruch.
ALTER TABLE transactions ADD COLUMN deleted_by INT UNSIGNED NULL;
CREATE INDEX idx_tx_deleted ON transactions (deleted_at);

-- Kolor kategorii: NULL = przydziel automatycznie z palety motywu.
ALTER TABLE categories ADD COLUMN color CHAR(7) NULL;
ALTER TABLE categories ADD COLUMN sort_order SMALLINT NOT NULL DEFAULT 0;

-- Trwały słownik przemapowań: stara nazwa (z arkuszy, importów, starej aplikacji) → kategoria.
-- Dzięki temu kolejny import historii nie odtworzy starego bałaganu.
CREATE TABLE IF NOT EXISTS category_map (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ledger_id TINYINT UNSIGNED NOT NULL,
  old_name VARCHAR(160) NOT NULL,             -- „1000 Czynsz", „Ursędowe", „Wakacje > Nocleg"
  category_id INT UNSIGNED NULL,              -- docelowa kategoria (NULL = celowo pominięte)
  note VARCHAR(160) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_catmap (ledger_id, old_name),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;
