-- 008: reorganizacja taksonomii jako PROPOZYCJE, nie automat (decyzja Szymona 2026-07-24:
-- „Wszystkie decyzje o przydziale do nowych kategorii zrobię ręcznie. Zaproponuj, a ja wybiorę
-- w aplikacji, które jest które").
--
-- Skrypt reorganizacji nie rusza już transakcji. Zakłada docelowe drzewo kategorii i wpisuje
-- tutaj propozycje przydziału; przepięcie następuje dopiero po przyjęciu przez człowieka w UI.
-- Dzięki temu żadna kwota nie zmienia kategorii, księgi ani typu bez świadomej decyzji.
CREATE TABLE IF NOT EXISTS category_proposals (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id BIGINT UNSIGNED NOT NULL,
  from_category_id INT UNSIGNED NULL,          -- kategoria, w której wpis leży dziś (NULL = brak)
  to_category_id INT UNSIGNED NOT NULL,        -- proponowana kategoria docelowa
  to_ledger_id TINYINT UNSIGNED NULL,          -- NULL = bez zmiany księgi
  to_type ENUM('WYDATEK','PRZYCHÓD','TRANSFER') NULL,  -- NULL = bez zmiany typu
  tag VARCHAR(48) NULL,                        -- np. wyjazd-2026-06
  rule_id VARCHAR(8) NOT NULL,                 -- wiersz tabeli akceptacyjnej: A1, B3, C7, D4…
  status ENUM('NOWA','PRZYJETA','ODRZUCONA') NOT NULL DEFAULT 'NOWA',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  decided_by INT UNSIGNED NULL,                -- kto zdecydował
  decided_at TIMESTAMP NULL,
  -- Ta sama para (wpis, cel) nie powstaje dwa razy: ponowne uruchomienie skryptu nie dubluje
  -- propozycji, a raz ODRZUCONA propozycja nie wraca — decyzja „nie" jest trwała.
  UNIQUE KEY uq_prop (transaction_id, to_category_id),
  INDEX idx_prop_status (status, from_category_id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (to_category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;
