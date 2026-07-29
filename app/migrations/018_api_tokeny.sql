-- 018: tokeny API tylko-do-odczytu (Z10, pkt 16+18) — jedyna droga, którą dane finansowe
-- rodziny wychodzą poza aplikację (Claude, dashboard — obaj tą samą drogą, ten sam router).
--
-- SEKRET NIGDY W BAZIE: token_hash to sha256(sekret) w hexie (64 znaki), sam sekret
-- (`fin_ro_...`) generujemy raz w wydajToken() i pokazujemy człowiekowi tylko przy tworzeniu
-- (Z12, panel Admin) — w bazie nie da się go odtworzyć, więc kradzież bazy nie daje tokenów.
--
-- Celowo BEZ osobnej tabeli użytkowników API (pkt 18: „bez tabeli użytkowników") — token
-- dziedziczy zasięg ksiąg z user_id, czyli z istniejącej tabeli `users`. scope_ledgers
-- pozwala zawęzić dodatkowo (np. token dla Claude tylko do księgi RODZINA), ale NIGDY
-- rozszerzyć poza to, co widzi właściciel — to pilnowane w kodzie (ro/auth.js), nie w SQL-u.
CREATE TABLE IF NOT EXISTS api_tokens (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,                  -- dla człowieka: „dashboard", „claude"
  token_hash CHAR(64) NOT NULL UNIQUE,        -- sha256(sekret) hex — NIGDY sam sekret
  user_id INT UNSIGNED NOT NULL,              -- właściciel, z niego dziedziczony zasięg ksiąg
  scope_ledgers VARCHAR(32) NULL,             -- np. "1,2"; NULL = pełen zasięg właściciela
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP NULL,
  revoked_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;
