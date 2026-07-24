# fin-bez — instrukcja operacyjna (repo wdrożeniowe „finansowej")

To repo zawiera WYŁĄCZNIE kod uruchamiany na produkcji (`finanse.bezprzemocowo.pl`).
Dokumentacja, plany, audyty i definicje ekipy agentów mieszkają w `w-wski/finansowe`.

## Praca

- Gałąź robocza: `main` (deploy idzie z `main`).
- Commituj małymi krokami, po każdej skończonej rzeczy. Komunikat po polsku, tryb rozkazujący.
- Przed commitem: `npm test` (w katalogu `app/`). Musi być zielone.
- Nie ruszaj cudzych plików — zlecenie mówi, które pliki są twoje (`docs/zlecenia/` w `finansowe`).

## Uruchomienie i migracje

- `cd app && npm install` · start: `npm start` · migracje: `npm run migrate` (idempotentne).
- Migracje SQL: `app/migrations/NNN_nazwa.sql`, numeracja rosnąco, nigdy nie edytuj już wgranej.
- Na serwerze przed czymkolwiek: `source ~/nodevenv/domains/finanse.bezprzemocowo.pl/app/22/bin/activate`.

## Limity (bramka `npm test`)

- Plik produkcyjny < 300 linii, funkcja < 60 linii. Przekroczenie = podziel moduł.
- Zero pustych `catch {}` bez komentarza wyjaśniającego, dlaczego błąd jest nieszkodliwy.
- `scripts/preflight.js` pilnuje tych progów (zapadka: liczby mogą tylko maleć).

## Frontend

- Bez build stepu. `public/main.js` tylko spina moduły; logika w `public/js/<widok>.js`.
- Styl wspólny w `public/styles.css`, styl widoku w `public/css/<widok>.css`.
- Po każdej zmianie plików w `public/` podbij `CACHE_VERSION` w `public/sw.js`.

## Czego nie wolno

- Sekrety wyłącznie w `.env` poza repo. Żadnych kluczy, haseł, IBAN-ów w kodzie ani w testach.
- `DELETE`/`UPDATE` bez `WHERE` na tabelach księgi — nigdy. Usuwanie transakcji jest miękkie.
