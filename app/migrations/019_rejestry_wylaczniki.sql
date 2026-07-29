-- 019: warstwa kontroli nad tym, KTO czyta nasze dane i CO MY wysyłamy na zewnątrz (Z11).
-- Cztery elementy jednego pytania „gdzie wyciekają dane": rejestr dostępu (#17), rejestr
-- wyjść (#26), wyłączniki modalności (21a) i eksport CSV (21b, kod w routes/eksport.js).
--
-- access_log: BEZ adresów IP i user agentów — celowo. To repo jest KSIĘGĄ RACHUNKOWĄ i
-- rejestrem dostępu do niej, nie ma budować drugiej bazy danych osobowych przy okazji.
-- Rejestrujemy CO odczytano (kanał, endpoint, okres, liczba wierszy), nie KTO z jakiego
-- urządzenia — do audytu „czy ktoś wyciągnął całą księgę" to wystarczy.
CREATE TABLE IF NOT EXISTS access_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- token_id BEZ klucza obcego: tabela api_tokens jeszcze nie istnieje w tym repo (dostęp
  -- ro_api to plan na przyszłość), a odczyty WEWNĘTRZNE (np. eksport z sesji admina) i tak
  -- nie mają tokenu. NULL = dostęp z sesji człowieka, nie przez token API.
  token_id INT UNSIGNED NULL,
  kanal ENUM('ro_api','eksport_csv','analiza') NOT NULL,
  endpoint VARCHAR(128) NOT NULL,
  okres VARCHAR(32) NULL,
  wierszy INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_access_created (created_at)
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

-- modalnosci: wyłącznik każdej ścieżki, którą dane mogłyby wyjść z tej aplikacji.
-- DOMYŚLNIE WSZYSTKO WYŁĄCZONE (wlaczona=0) — dane nie wychodzą, dopóki Szymon świadomie
-- nie włączy modalności w Adminie (Z12). To jest ustawienie bezpieczne z definicji: brak
-- decyzji człowieka = brak wysyłki, nigdy odwrotnie.
CREATE TABLE IF NOT EXISTS modalnosci (
  klucz VARCHAR(32) PRIMARY KEY,
  wlaczona TINYINT(1) NOT NULL DEFAULT 0,
  zmieniona_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  zmienil_user_id INT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

INSERT IGNORE INTO modalnosci (klucz, wlaczona) VALUES
  ('ro_api', 0),
  ('eksport_csv', 0),
  ('model_zewnetrzny', 0);
