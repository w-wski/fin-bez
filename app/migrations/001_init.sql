-- finansowa — schemat V1 (MySQL/MariaDB, utf8mb4)
-- Uruchamiane przez: npm run migrate (scripts/db-migrate.js)

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

CREATE TABLE IF NOT EXISTS ledgers (
  id TINYINT UNSIGNED PRIMARY KEY,
  name VARCHAR(32) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

INSERT IGNORE INTO ledgers (id, name) VALUES (1, 'RODZINA'), (2, 'PERSEVERA');

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,          -- konto Google (OAuth)
  name VARCHAR(64) NOT NULL,                   -- Szymon / Anna / Bartek / PERSEVERA
  role ENUM('admin','adult','junior','company') NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

CREATE TABLE IF NOT EXISTS accounts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ledger_id TINYINT UNSIGNED NOT NULL,
  bank_name VARCHAR(64) NOT NULL,              -- 'PKO BP', 'mBank', ..., 'GOTÓWKA'
  account_name VARCHAR(64) NOT NULL DEFAULT 'Główne',
  iban VARCHAR(34) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'PLN',
  type ENUM('bank','cash','card') NOT NULL DEFAULT 'bank',
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ledger_id TINYINT UNSIGNED NOT NULL,
  parent_id INT UNSIGNED NULL,
  name VARCHAR(96) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_cat (ledger_id, parent_id, name),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id),
  FOREIGN KEY (parent_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ledger_id TINYINT UNSIGNED NOT NULL,
  account_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NOT NULL,
  tx_date DATE NOT NULL,
  type ENUM('WYDATEK','PRZYCHÓD') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,               -- zawsze dodatnia; znak wynika z type
  currency CHAR(3) NOT NULL DEFAULT 'PLN',
  category_id INT UNSIGNED NULL,
  description VARCHAR(512) NULL,
  source ENUM('MANUAL','CSV','RECEIPT','MIGRACJA') NOT NULL DEFAULT 'MANUAL',
  bank_tx_id BIGINT UNSIGNED NULL,             -- uzgodnienie z bank_transactions
  legacy_id VARCHAR(128) NULL,                 -- ID/timestamp ze starej aplikacji
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,                   -- soft delete z audytem
  INDEX idx_tx_ledger_date (ledger_id, tx_date),
  INDEX idx_tx_user (user_id),
  INDEX idx_tx_legacy (legacy_id),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

CREATE TABLE IF NOT EXISTS bank_imports (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id INT UNSIGNED NULL,
  bank_name VARCHAR(64) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  imported_by INT UNSIGNED NOT NULL,
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  rows_ok INT NOT NULL DEFAULT 0,
  rows_dup INT NOT NULL DEFAULT 0,
  rows_err INT NOT NULL DEFAULT 0,
  FOREIGN KEY (imported_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

CREATE TABLE IF NOT EXISTS bank_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  import_id INT UNSIGNED NULL,
  account_id INT UNSIGNED NULL,
  ledger_id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  transaction_date DATE NOT NULL,
  booking_date DATE NULL,
  amount DECIMAL(12,2) NOT NULL,               -- ze znakiem, jak w wyciągu
  currency CHAR(3) NOT NULL DEFAULT 'PLN',
  counterparty VARCHAR(255) NULL,
  title VARCHAR(512) NULL,
  balance DECIMAL(14,2) NULL,
  tx_hash CHAR(64) NOT NULL UNIQUE,            -- SHA-256, anty-duplikacja jak w prototypie
  matched_transaction_id BIGINT UNSIGNED NULL, -- NULL = nieuzgodnione z księgą
  INDEX idx_bt_date (transaction_date),
  FOREIGN KEY (import_id) REFERENCES bank_imports(id),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

CREATE TABLE IF NOT EXISTS mapping_cache (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pattern VARCHAR(255) NOT NULL,               -- ocr_name / kontrahent
  category_id INT UNSIGNED NULL,
  hits INT NOT NULL DEFAULT 1,
  confidence DECIMAL(3,2) NOT NULL DEFAULT 0.90,
  updated_by VARCHAR(64) NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pattern (pattern),
  FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

CREATE TABLE IF NOT EXISTS api_costs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_name VARCHAR(64) NULL,
  action VARCHAR(64) NOT NULL,
  model VARCHAR(64) NULL,
  tokens_in INT NULL, tokens_out INT NULL,
  cost_pln DECIMAL(10,6) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

CREATE TABLE IF NOT EXISTS telemetry (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_name VARCHAR(64) NULL,
  view_name VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  duration_s DECIMAL(8,1) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;
