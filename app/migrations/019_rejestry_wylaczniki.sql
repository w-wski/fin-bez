-- 019: warstwa kontroli nad tym, KTO czyta nasze dane i CO MY wysyłamy na zewnątrz (Z11).
-- Cztery elementy jednego pytania „gdzie wyciekają dane": rejestr dostępu (#17), rejestr
-- wyjść (#26), wyłączniki modalności (21a) i eksport CSV (21b, kod w routes/eksport.js).
--
-- UWAGA runnera (db-migrate.js, ta sama pułapka co w 018): plik dzielony po średniku, więc
-- ŻADEN komentarz w tym pliku nie może zawierać średnika — inaczej instrukcja rozpada się
-- na dwa fragmenty i kończy błędem składni.
--
-- access_log: BEZ adresów IP i user agentów — celowo. To repo jest KSIĘGĄ RACHUNKOWĄ i
-- rejestrem dostępu do niej, nie ma budować drugiej bazy danych osobowych przy okazji.
-- Rejestrujemy CO odczytano (kanał, endpoint, okres, liczba wierszy), nie KTO z jakiego
-- urządzenia — do audytu „czy ktoś wyciągnął całą księgę" to wystarczy.
CREATE TABLE IF NOT EXISTS access_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- token_id Z kluczem obcym do api_tokens (migracja 018, sortuje się przed tą) — dostęp
  -- ro_api naprawdę idzie przez ten token. NULL = dostęp z sesji człowieka (Admin/eksport),
  -- nie przez token API. ON DELETE SET NULL: usunięcie tokenu nie ma kasować historii
  -- audytowej, tylko odciąć ją od skasowanego tokenu.
  token_id INT UNSIGNED NULL,
  kanal ENUM('ro_api','eksport_csv','analiza') NOT NULL,
  endpoint VARCHAR(128) NOT NULL,
  okres VARCHAR(32) NULL,
  wierszy INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_access_created (created_at),
  CONSTRAINT fk_access_token FOREIGN KEY (token_id) REFERENCES api_tokens(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- outbound_log (#26): telemetria WYCHODZĄCA — co MY wysyłamy do narzędzi zewnętrznych
-- (np. Anthropic przy analizie). Liczby i cel, NIGDY treść: ten log nie może stać się
-- drugą kopią danych finansowych pod inną nazwą tabeli.
CREATE TABLE IF NOT EXISTS outbound_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  narzedzie VARCHAR(48) NOT NULL,
  cel VARCHAR(128) NOT NULL,
  zapytan INT UNSIGNED NOT NULL DEFAULT 1,
  znakow_wyslanych INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_outbound_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- modalnosci: wyłącznik każdej ścieżki, którą dane mogłyby wyjść z tej aplikacji — w tym
-- widget dashboardu (X-Widget-Token na /api/v1/summary), nie tylko eksport i API. DOMYŚLNIE
-- WSZYSTKO WYŁĄCZONE (wlaczona=0) — dane nie wychodzą, dopóki Szymon świadomie nie włączy
-- modalności w Adminie (Z12). To jest ustawienie bezpieczne z definicji: brak decyzji
-- człowieka = brak wysyłki, nigdy odwrotnie.
CREATE TABLE IF NOT EXISTS modalnosci (
  klucz VARCHAR(32) PRIMARY KEY,
  wlaczona TINYINT(1) NOT NULL DEFAULT 0,
  zmieniona_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  zmienil_user_id INT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

INSERT IGNORE INTO modalnosci (klucz, wlaczona) VALUES
  ('ro_api', 0),
  ('eksport_csv', 0),
  ('model_zewnetrzny', 0),
  ('widget', 0);
