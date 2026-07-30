-- 022: ARCHIWIZACJA (soft-delete) paragonów i importów CSV + plik CSV na serwerze.
-- Decyzja Szymona 2026-07-30 (pyt. 3a): dane finansowe święte — NIC nie znika twardo.
-- „Usunięcie" = deleted_at + deleted_by; przywrócenie = wyczyszczenie obu. Filtrowanie
-- odczytu robi WYŁĄCZNIE src/zywe.js (jedna klauzula używana wszędzie — patrz audyt:
-- rozjazd filtrów w 5 miejscach to gwarantowany błąd przy następnej zmianie).
ALTER TABLE receipts
  ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN deleted_by INT UNSIGNED NULL DEFAULT NULL;

-- Import CSV: plik zostaje na serwerze (decyzja pyt. 11 — poza webrootem, jak obrazy
-- paragonów), a file_hash domyka idempotencję CAŁEGO pliku: drugi upload tego samego CSV
-- = czytelny 409, nie ciche „0 dodanych" z wyścigu per-wiersz na tx_hash.
ALTER TABLE bank_imports
  ADD COLUMN file_hash CHAR(64) NULL,
  ADD COLUMN file_path VARCHAR(255) NULL,
  ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN deleted_by INT UNSIGNED NULL DEFAULT NULL,
  ADD UNIQUE KEY uq_imp_file_hash (file_hash);

-- Wycofanie importu NIE potrzebuje nowej kolumny: wpis księgi zna swoją bankową transakcję
-- (transactions.bank_tx_id), a ta zna import (bank_transactions.import_id) — łańcuch już
-- istnieje. Odnotowane tu, żeby następny agent nie dokładał zbędnej referencji.
