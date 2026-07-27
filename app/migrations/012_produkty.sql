-- 012: PRODUKTY — kanoniczna tożsamość towaru, oderwana od pojedynczego paragonu.
--
-- Odpowiedź na pytanie Szymona (2026-07-27): NIE, do tej pory produkty nie miały swojej
-- tabeli. Było `receipt_items` (linie konkretnego paragonu — surowy materiał) i `item_dict`
-- (podpowiedzi OCR: kod → nazwa/jednostka/kategoria, JEDEN wiersz na kod, nadpisywany).
-- Do analizy „jak zmieniała się cena mleka przez dwa lata" to nie wystarcza: linie paragonu
-- nie wiedzą, że „Jog Naturalny 400g" z Biedronki i „JOGURT NAT.400G" z Lidla to ten sam
-- produkt, a `item_dict` nie przechowuje historii, bo trzyma tylko ostatnią decyzję.
--
-- Rozdział na trzy poziomy, bo każdy odpowiada na inne pytanie:
--   receipt_items   — CO BYŁO NA PARAGONIE (ślad audytowy, nigdy nie zmieniany masowo)
--   product_aliases — JAK TEN SKLEP TO NAZYWA (jeden produkt ma wiele nazw kasowych)
--   products        — CZYM TO JEST (jedna tożsamość, po której liczymy ceny i ilości)
--
-- Cena z paragonu ma DWIE wartości i obie są potrzebne: katalogową (`unit_price`) oraz
-- faktycznie zapłaconą (`value` / ilość). Na dzisiejszym paragonie czereśnie miały 24,99
-- zł/kg katalogowo i 11,49 zł/kg po rabacie — analiza „czy drożeje" bez tej różnicy kłamie.

CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,                  -- nazwa dla człowieka: „jogurt naturalny 400 g"
  unit VARCHAR(8) NULL,                        -- kg, szt., l, opak.
  category_id INT UNSIGNED NULL,               -- kategoria budżetowa (ta sama taksonomia)
  brand VARCHAR(80) NULL,
  ean VARCHAR(20) NULL,                        -- gdy kiedyś dojdzie skanowanie kodów
  -- Krotność opakowania w jednostce bazowej: „400 g" → 0.400 przy unit='kg'. Pozwala
  -- porównać cenę za kilogram między różnymi gramaturami tego samego towaru.
  pack_size DECIMAL(10,3) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_prod_name (name),
  INDEX idx_prod_cat (category_id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- Nazwa kasowa → produkt. `shop = '*'` znaczy „w każdym sklepie", a nie NULL: MySQL
-- dopuszcza wiele NULL-i w indeksie UNIQUE, więc na NULL-u nie da się oprzeć zasady
-- „jeden alias globalny na kod".
CREATE TABLE IF NOT EXISTS product_aliases (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id INT UNSIGNED NOT NULL,
  shop VARCHAR(64) NOT NULL DEFAULT '*',
  code_norm VARCHAR(160) NOT NULL,             -- kod bez diakrytyków i spacji, WIELKIMI
  code_raw VARCHAR(255) NULL,                  -- jak dokładnie brzmiał (ślad)
  source ENUM('ocr','eparagon','reka') NOT NULL DEFAULT 'reka',
  hits INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_alias (shop, code_norm),
  INDEX idx_alias_prod (product_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

-- Linie paragonu wskazują na produkt. NULL = jeszcze nierozpoznane (to normalny stan,
-- nie błąd: nowy towar czeka na pierwsze przypisanie przez człowieka).
ALTER TABLE receipt_items ADD COLUMN product_id INT UNSIGNED NULL AFTER category_id;
ALTER TABLE receipt_items ADD COLUMN discount DECIMAL(10,2) NULL AFTER value;
ALTER TABLE receipt_items ADD COLUMN vat_id CHAR(1) NULL AFTER discount;
ALTER TABLE receipt_items ADD INDEX idx_item_prod (product_id);
ALTER TABLE receipt_items ADD CONSTRAINT fk_item_prod
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

-- Paragon wie, SKĄD się wziął. E-paragon (plik .json w standardzie JPK) niesie własny,
-- globalnie jednoznaczny identyfikator dokumentu — `doc_key`. Dzięki niemu ten sam plik
-- wgrany dwa razy nie zrobi dwóch paragonów i nie musimy tego zgadywać z sumy i daty,
-- jak przy zdjęciu. `receipt_hash` zostaje dla zdjęć.
ALTER TABLE receipts ADD COLUMN source ENUM('zdjecie','eparagon','pdf') NOT NULL DEFAULT 'zdjecie' AFTER ledger_id;
ALTER TABLE receipts ADD COLUMN doc_key VARCHAR(190) NULL AFTER receipt_hash;
ALTER TABLE receipts ADD COLUMN nip VARCHAR(16) NULL AFTER shop_name;
ALTER TABLE receipts ADD COLUMN payment VARCHAR(32) NULL AFTER total;
ALTER TABLE receipts ADD COLUMN discount_total DECIMAL(12,2) NULL AFTER total;
ALTER TABLE receipts ADD UNIQUE KEY uq_doc_key (doc_key);

-- `image_path` był NOT NULL, bo paragon zawsze był zdjęciem. E-paragon zdjęcia nie ma.
ALTER TABLE receipts MODIFY COLUMN image_path VARCHAR(255) NULL;

-- Zasilenie z tego, co już wiemy: każdy wpis słownika OCR to gotowy produkt z aliasem.
-- item_dict ZOSTAJE (nadal podpowiada przy OCR) — nie kasujemy niczego, dokładamy warstwę.
INSERT INTO products (name, unit, category_id, notes)
SELECT d.name, d.unit, d.category_id, 'z item_dict (migracja 012)'
FROM item_dict d
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.name = d.name);

INSERT INTO product_aliases (product_id, shop, code_norm, source, hits)
SELECT p.id, '*', d.code_norm, 'ocr', d.hits
FROM item_dict d
JOIN products p ON p.name = d.name
WHERE NOT EXISTS (SELECT 1 FROM product_aliases a WHERE a.shop = '*' AND a.code_norm = d.code_norm);
