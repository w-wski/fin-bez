-- 009: propozycja może się zdezaktualizować, i to trzeba odróżnić od decyzji człowieka.
--
-- Propozycja zakłada, że wpis leży w konkretnej kategorii (`from_category_id`). Jeśli Szymon
-- w międzyczasie przeniesie ten wpis ręcznie w Historii, propozycja przestaje mieć sens:
-- jej przyjęcie cofnęłoby jego własną decyzję. Taką propozycję trzeba zdjąć z listy — ale
-- NIE jako `ODRZUCONA`, bo to sfałszowałoby ślad („Szymon powiedział nie") tam, gdzie nikt
-- nic nie powiedział. Stąd osobny status.
ALTER TABLE category_proposals
  MODIFY COLUMN status ENUM('NOWA','PRZYJETA','ODRZUCONA','NIEAKTUALNA') NOT NULL DEFAULT 'NOWA';

-- Zapytania karty „Przydział" filtrują po statusie i po kategorii docelowej; istniejący
-- idx_prop_status pokrywa tylko (status, from_category_id).
CREATE INDEX idx_prop_cel ON category_proposals (status, to_category_id);
