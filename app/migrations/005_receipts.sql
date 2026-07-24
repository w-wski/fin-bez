-- 005: OCR paragonów — osobne tabele bazy produktowej (decyzja Szymona 07-24:
-- osobne tabele w tej samej MySQL, nie osobna baza fizyczna).
CREATE TABLE IF NOT EXISTS receipts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ledger_id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  user_id INT UNSIGNED NOT NULL,
  shop_name VARCHAR(128) NULL,
  receipt_date DATE NULL,
  total DECIMAL(12,2) NULL,
  ocr_engine ENUM('tesseract','ai') NOT NULL DEFAULT 'tesseract',
  ocr_confidence DECIMAL(4,1) NULL,           -- średnia pewność tesseracta (0-100)
  ocr_text MEDIUMTEXT NULL,                   -- surowy tekst OCR (diagnostyka/re-parsowanie)
  image_path VARCHAR(255) NOT NULL,           -- względem RECEIPTS_DIR, poza docrootem
  receipt_hash CHAR(64) NOT NULL,             -- anty-dup: sklep|data|suma|skrót pozycji
  status ENUM('NOWY','POTWIERDZONY','ODRZUCONY') NOT NULL DEFAULT 'NOWY',
  transaction_id BIGINT UNSIGNED NULL,        -- wpis w księdze po potwierdzeniu
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_receipt_hash (receipt_hash),
  INDEX idx_rcpt_date (receipt_date),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

CREATE TABLE IF NOT EXISTS receipt_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  receipt_id INT UNSIGNED NOT NULL,
  line_no SMALLINT UNSIGNED NOT NULL,
  ocr_name VARCHAR(255) NOT NULL,             -- surowa nazwa z paragonu
  name VARCHAR(255) NULL,                     -- nazwa po korekcie użytkownika
  quantity DECIMAL(8,3) NULL,
  unit_price DECIMAL(10,2) NULL,
  value DECIMAL(10,2) NULL,
  category_id INT UNSIGNED NULL,              -- z samouczenia (mapping_cache) lub korekty
  low_confidence TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;
