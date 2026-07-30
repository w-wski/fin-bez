-- 024: USTAWIENIA UI PER UŻYTKOWNIK, na serwerze (decyzja Szymona 2026-07-30, pkt 12:
-- zwijane sekcje Raportów pamiętają ostatni stan użytkownika między urządzeniami).
-- Celowo generyczny worek klucz→JSON zamiast kolumny per widżet: następne ustawienie
-- (np. zwijane kategorie Admina, wybory czatu) to INSERT, nie migracja. Wzorzec
-- nadpisywania jak w 020: ostatni zapis wygrywa (ON DUPLICATE KEY UPDATE).
CREATE TABLE IF NOT EXISTS user_ui (
  user_id INT UNSIGNED NOT NULL,
  klucz VARCHAR(64) NOT NULL,               -- np. 'raporty.zwiniete'
  wartosc JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, klucz),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;
