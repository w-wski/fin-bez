# fin-bez

Kod produkcyjny mikroserwisu **„finansowa"** — finanse rodziny i spółki PERSEVERA,
działający pod adresem `finanse.bezprzemocowo.pl`.

- **Tu jest tylko kod.** Deploy idzie z gałęzi `main`.
- **Dokumentacja, plany, audyty, decyzje i definicje ekipy agentów**: [`w-wski/finansowe`](https://github.com/w-wski/finansowe).
- Zasady pracy w tym repo: [`AGENTS.md`](AGENTS.md).

## Skrót

```bash
cd app
npm install          # zależności
npm run migrate      # migracje bazy (idempotentne)
npm test             # parsery + bramka jakości (scripts/preflight.js)
npm start            # serwer (domyślnie port z .env)
```

Konfiguracja przez `.env` **poza repo** (wzór: `app/.env.example`).
Procedura wdrożenia na serwer: [`RUNBOOK-WDROZENIE.md` w repo `finansowe`](https://github.com/w-wski/finansowe/blob/main/RUNBOOK-WDROZENIE.md)
(w tym repo został sam wskaźnik — komentarze w kodzie odsyłają do „RUNBOOK-a").

## Układ

```
app/
  app.js              punkt wejścia (Express)
  src/                logika serwera: auth, db, routes/, banks/, ocr/
  migrations/         NNN_nazwa.sql — rosnąco, nigdy nie edytuj wgranej
  scripts/            migracje, importy, testy, preflight
  public/             frontend bez build stepu
    main.js           tylko spina moduły
    js/<widok>.js     logika widoku
    css/<widok>.css   styl widoku
```
