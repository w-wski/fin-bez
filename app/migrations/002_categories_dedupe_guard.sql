-- 002: (a) odporny unikat kategorii — MySQL nie łapie duplikatów, gdy parent_id
-- jest NULL (NULL≠NULL w UNIQUE), więc dwukrotny import dublował kategorie główne;
-- generated column parent_key (=0 dla korzeni) daje unikat null-safe.
-- (b) nowe źródło transakcji BUDZET (import z arkusza „Budżet Domowy").
--
-- WYMÓG: przed tą migracją usuń istniejące duplikaty:  node scripts/fix-categories.js
--
-- Stary uq_cat (ledger_id, parent_id, name) obsługuje DWA klucze obce: parent_id oraz
-- ledger_id (jest jego prefiksem). Żeby móc go usunąć, oba FK muszą najpierw dostać
-- indeksy zastępcze: idx_cat_parent dla parent_id, a nowy uq_cat2 (zaczyna się od
-- ledger_id) dla ledger_id. Dopiero wtedy DROP starego uq_cat przechodzi.
-- Każdy ALTER to osobny statement — db-migrate wykonuje je pojedynczo i toleruje
-- „obiekt już istnieje" (idempotencja po częściowym przebiegu).

ALTER TABLE transactions MODIFY source ENUM('MANUAL','CSV','RECEIPT','MIGRACJA','BUDZET') NOT NULL DEFAULT 'MANUAL';
ALTER TABLE categories ADD COLUMN parent_key INT UNSIGNED AS (IFNULL(parent_id, 0)) STORED;
ALTER TABLE categories ADD INDEX idx_cat_parent (parent_id);
ALTER TABLE categories ADD UNIQUE KEY uq_cat2 (ledger_id, parent_key, name);
ALTER TABLE categories DROP INDEX uq_cat;
