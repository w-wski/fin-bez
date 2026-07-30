-- 021: DOMKNIĘCIE IDEMPOTENCJI OFFLINE + brakujące indeksy (audyt 2026-07-30).
--
-- Problem: dedupe kolejki offline w POST /transactions to SELECT-then-INSERT na legacy_id
-- (client_ref 'off:...'), bez ograniczenia w bazie. Dwa RÓWNOLEGŁE retry tego samego wpisu
-- (typowe po zaniku sieci) mijają się w oknie między SELECT a INSERT i księgują kwotę DWA razy.
--
-- Dlaczego kolumna generowana, a nie UNIQUE wprost na (user_id, legacy_id): legacy_id niesie
-- też ID ze starej aplikacji (import historyczny), których unikalności per user nikt nigdy
-- nie obiecywał — twardy UNIQUE mógłby wywalić migrację na żywej bazie. Ograniczenie ma
-- dotyczyć WYŁĄCZNIE referencji offline 'off:%', więc egzekwujemy je przez kolumnę generowaną
-- (NULL poza 'off:%', a NULL-e w UNIQUE się nie zderzają — wzorzec sentinela odwrotnie niż w 020).
ALTER TABLE transactions
  ADD COLUMN off_ref VARCHAR(128)
    GENERATED ALWAYS AS (IF(legacy_id LIKE 'off:%', legacy_id, NULL)) STORED,
  ADD UNIQUE KEY uq_tx_user_offref (user_id, off_ref);

-- Lista paragonów filtruje po (ledger_id, user_id) — dotąd był tylko indeks po dacie,
-- więc GET /receipts skanował całą tabelę (rosnący koszt z każdym paragonem).
ALTER TABLE receipts ADD INDEX idx_rcpt_ledger_user (ledger_id, user_id);
