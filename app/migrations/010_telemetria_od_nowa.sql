-- Wyzerowanie liczników telemetrii (polecenie Szymona, 2026-07-25).
-- Dotychczasowe duration_s mierzyły czas OTWARTEJ ZAKŁADKI, także w tle — po zmianie
-- frontend liczy wyłącznie czas, gdy aplikacja jest na ekranie (Page Visibility API).
-- Stare wiersze mieszałyby dwie nieporównywalne miary, więc zaczynamy od zera.
DELETE FROM telemetry;
