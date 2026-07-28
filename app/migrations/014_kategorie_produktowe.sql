-- 014: KATEGORIA PRODUKTOWA jako OSOBNA OŚ (decyzja Szymona 2026-07-28: „daj osobno, żywność").
--
-- Problem, który to rozwiązuje. Na jednym paragonie z Biedronki leżą obok siebie ser, proszek
-- do prania i wino. W budżecie cały ten paragon jest jednym wpisem w jednej kategorii
-- („Zakupy spożywcze"), bo tak wygląda przelew. Ale pytanie „ile wydajemy na nabiał" nie da
-- się z tego odpowiedzieć — kategoria budżetowa opisuje PRZELEW, nie TOWAR.
--
-- Do tej pory `products.category_id` wskazywał na to samo drzewo, co wpisy w księdze, więc obie
-- role siedziały w jednej kolumnie i wykluczały się nawzajem: przypisanie serowi „Zakupy
-- spożywcze" nic nie mówiło o serze, a przypisanie „Nabiał" psuło budżet.
--
-- Po tej migracji są dwie niezależne osie i obie liczby są prawdziwe naraz:
--
--   budżetowa   `transactions.category_id`      → „ile poszło na dom, ile na dziecko"
--   produktowa  `products.product_category_id`  → „ile wydajemy na nabiał, ile na mięso"
--
-- `products.category_id` ZOSTAJE nietknięte — jest wypełnione danymi z `item_dict` (migracja
-- 012) i służy podpowiadaniu kategorii budżetowej przy pozycji paragonu. Kasowanie kolumny
-- wyrzuciłoby te podpowiedzi do kosza; dwie kolumny o dwóch różnych rolach są tańsze niż
-- migracja danych, której nikt nie zamawiał.

-- Drzewo płytkie z założenia (korzeń + opcjonalne dziecko), jak taksonomia budżetu.
-- `parent_key` to ten sam chwyt co w migracji 002: MySQL nie łapie duplikatów, gdy parent_id
-- jest NULL (NULL ≠ NULL w UNIQUE), więc dwa korzenie „Nabiał" przeszłyby bez mrugnięcia.
-- Kolumna generowana (0 dla korzeni) daje unikat odporny na NULL-e.
CREATE TABLE IF NOT EXISTS product_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  parent_id INT UNSIGNED NULL,
  parent_key INT UNSIGNED AS (IFNULL(parent_id, 0)) STORED,
  name VARCHAR(80) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pcat (parent_key, name),
  INDEX idx_pcat_parent (parent_id),
  CONSTRAINT fk_pcat_parent FOREIGN KEY (parent_id) REFERENCES product_categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_polish_ci;

ALTER TABLE products ADD COLUMN product_category_id INT UNSIGNED NULL AFTER category_id;
ALTER TABLE products ADD INDEX idx_prod_pcat (product_category_id);
ALTER TABLE products ADD CONSTRAINT fk_prod_pcat
  FOREIGN KEY (product_category_id) REFERENCES product_categories(id);

-- Punkt startowy: jeden poziom, szeroko, bez podkategorii. Wąskie drzewo na starcie jest
-- łatwiejsze do rozbudowania niż głębokie do sprzątnięcia, a przy pustym katalogu produktów
-- nie ma jeszcze danych, które podpowiedziałyby właściwy podział. Lista pokrywa TAKŻE
-- nie-żywność (chemia, kosmetyki), bo te towary leżą na tym samym paragonie ze sklepu
-- spożywczego i bez własnej półki wpadłyby do „Inne”, zaciemniając odczyt.
-- INSERT IGNORE + unikat null-safe wyżej: powtórny przebieg nie zdubluje żadnej pozycji.
INSERT IGNORE INTO product_categories (parent_id, name, sort_order) VALUES
  (NULL, 'Nabiał i jaja',            10),
  (NULL, 'Pieczywo',                 20),
  (NULL, 'Owoce i warzywa',          30),
  (NULL, 'Mięso i wędliny',          40),
  (NULL, 'Ryby',                     50),
  (NULL, 'Mrożonki',                 60),
  (NULL, 'Sypkie, makarony, mąki',   70),
  (NULL, 'Konserwy i przetwory',     80),
  (NULL, 'Przyprawy, sosy, oleje',   90),
  (NULL, 'Słodycze i przekąski',    100),
  (NULL, 'Napoje',                  110),
  (NULL, 'Kawa i herbata',          120),
  (NULL, 'Alkohol',                 130),
  (NULL, 'Dania gotowe',            140),
  (NULL, 'Chemia domowa',           150),
  (NULL, 'Kosmetyki i higiena',     160),
  (NULL, 'Dla dziecka',             170),
  (NULL, 'Zwierzęta',               180),
  (NULL, 'Dom i drobne',            190),
  (NULL, 'Inne',                    900);
