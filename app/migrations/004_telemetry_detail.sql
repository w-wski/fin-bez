-- 004: szczegółowa telemetria — kolumna detail (kontekst zdarzenia: kwoty NIE są tu
-- zapisywane w celach księgowych, tylko diagnostyka UX jak w LOGI prototypu),
-- flaga offline (czy zdarzenie zaszło bez sieci) i indeks czasu do raportów.
ALTER TABLE telemetry ADD COLUMN detail VARCHAR(255) NULL;
ALTER TABLE telemetry ADD COLUMN offline TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE telemetry ADD INDEX idx_tel_ts (ts);
ALTER TABLE telemetry ADD INDEX idx_tel_user (user_name);
