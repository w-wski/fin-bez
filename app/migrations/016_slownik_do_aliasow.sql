-- 016: domknięcie backfillu item_dict → products/product_aliases (Z7, plan pkt 9). Migracja 012
-- zrobiła to samo przy swoim wdrożeniu; między 012 a wyłączeniem zapisu do item_dict (ten sam
-- Z7) `learnItem` dalej pisała RÓWNOLEGLE do item_dict, więc mogły powstać wpisy słownika
-- nowsze niż tamten backfill — bez aliasu. Ta migracja je dogania.
--
-- UWAGA (korekta po adwersaryjnej weryfikacji): to NIE jest kopia 1:1 migracji 012. Krok 1 ma
-- dodatkowy warunek (NOT EXISTS alias globalny) — 012 zakładała produkt dla każdej nowej nazwy
-- bez patrzenia na aliasy; tu zakładamy produkt tylko wtedy, gdy naprawdę brakuje i produktu
-- AKTYWNEGO, i aliasu (inaczej krok 2 sam by dowiązał istniejący produkt, a krok 1 założyłby
-- drugi, zbędny). Krok 3 (uzupełnienie unit/category_id) w 012 w ogóle nie istniał.
--
-- item_dict NIE JEST kasowana ani przemianowywana — zostaje jako tabela ARCHIWALNA. Kod od tej
-- migracji jej nie czyta i nie pisze (patrz slownik.js, produkt-baza.js). DROP dopiero w osobnym
-- wydaniu, gdy produkcja potwierdzi tydzień działania na nowej ścieżce.

-- 1) produkt dla wpisów słownika, których nazwa jeszcze nie ma ŻADNEGO produktu AKTYWNEGO,
--    i które nie mają jeszcze globalnego aliasu.
INSERT INTO products (name, unit, category_id, notes)
SELECT d.name, d.unit, d.category_id, 'z item_dict (migracja 016, domknięcie długu)'
FROM item_dict d
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.name = d.name AND p.active = 1)
  AND NOT EXISTS (SELECT 1 FROM product_aliases a WHERE a.shop = '*' AND a.code_norm = d.code_norm);

-- 2) alias globalny dla KAŻDEGO kodu ze słownika, którego jeszcze nie ma w product_aliases.
--    `products.name` NIE MA unikatu — dwa produkty AKTYWNE mogą (błędnie, albo po ręcznym
--    scaleniu) nazywać się tak samo. Naiwny `JOIN products p ON p.name = d.name` dałby wtedy
--    DWA wiersze do wstawienia z tym samym kluczem (shop='*', code_norm) → ER_DUP_ENTRY na
--    unikacie `uq_alias`. Ten kod błędu jest na liście „ignorowalnych" w runnerze migracji,
--    więc CAŁY ten INSERT...SELECT (wszystkie wiersze, nie tylko kolidujący) przepadłby po
--    cichu, a migracja wyglądałaby na wykonaną. Podzapytanie `MAX(p2.id)` wybiera
--    deterministycznie JEDEN — najnowszy aktywny — produkt per nazwa, więc duplikat fizycznie
--    nie może powstać.
INSERT INTO product_aliases (product_id, shop, code_norm, source, hits)
SELECT (SELECT MAX(p2.id) FROM products p2 WHERE p2.name = d.name AND p2.active = 1),
       '*', d.code_norm, 'ocr', d.hits
FROM item_dict d
WHERE EXISTS (SELECT 1 FROM products p WHERE p.name = d.name AND p.active = 1)
  AND NOT EXISTS (SELECT 1 FROM product_aliases a WHERE a.shop = '*' AND a.code_norm = d.code_norm);

-- 3) jednostka/kategoria: gdy alias dowiązał się do produktu, który JUŻ istniał (z 012 albo z
--    wcześniejszego przebiegu tej migracji) z NULL-ami w tych polach, uzupełniamy je z item_dict
--    — ale TYLKO wypełniając NULL, nigdy nie nadpisując tego, co produkt ma już ustalone (to samo
--    zabezpieczenie co w produkt-baza.js#zapamietaj: cudza, późniejsza decyzja człowieka wygrywa).
UPDATE products p
  JOIN item_dict d ON p.name = d.name AND p.active = 1
   SET p.unit = COALESCE(p.unit, d.unit), p.category_id = COALESCE(p.category_id, d.category_id);
