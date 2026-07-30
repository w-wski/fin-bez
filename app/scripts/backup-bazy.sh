#!/bin/bash
# Z19/K8 — backup TYGODNIOWY bazy finansowej (cron hostingu, np. raz w tygodniu w nocy).
# Odrębny od scripts/backup.sh (backup codzienny, 30 dni) — Szymon poprosił o osobny zrzut
# tygodniowy z INNĄ retencją (8 najnowszych, nie 30 dni) i katalogiem PARAMETREM, nie na sztywno.
#
# Użycie: backup-bazy.sh [katalog_docelowy] [plik_env]
#   katalog_docelowy — domyślnie $HOME/backups/finansowa-tygodniowo (POZA webrootem)
#   plik_env         — domyślnie ../.env względem tego skryptu (jak reszta aplikacji, src/config.js)
set -euo pipefail

DEST_DIR="${1:-$HOME/backups/finansowa-tygodniowo}"
ENV_FILE="${2:-$(dirname "$0")/../../.env}"
RETENCJA=8   # trzymamy 8 ostatnich zrzutów tygodniowych (K8) — nie dni, tylko liczba plików

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${DB_HOST:?brak DB_HOST w $ENV_FILE}"
: "${DB_NAME:?brak DB_NAME w $ENV_FILE}"
: "${DB_USER:?brak DB_USER w $ENV_FILE}"
: "${DB_PASS:?brak DB_PASS w $ENV_FILE}"

mkdir -p "$DEST_DIR"
STAMP=$(date +%Y-%m-%d)
PLIK="$DEST_DIR/finansowa-tygodniowo-$STAMP.sql.gz"

# --single-transaction: zrzut spójny bez blokowania tabel (dane finansowe czytane w locie
# przez aplikację nie mogą czekać na LOCK TABLES podczas backupu).
mysqldump -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" --single-transaction "$DB_NAME" \
  | gzip > "$PLIK" \
  && echo "OK backup tygodniowy: $PLIK ($(du -h "$PLIK" | cut -f1))" \
  || { echo "BŁĄD backupu tygodniowego"; exit 1; }

# Rotacja: trzymaj tylko $RETENCJA najnowszych zrzutów, resztę usuń (stare, ale wciąż realne pliki —
# nie "twarde kasowanie danych finansowych", bo to KOPIE zapasowe, nie księga sama).
mapfile -t STARE < <(ls -1t "$DEST_DIR"/finansowa-tygodniowo-*.sql.gz 2>/dev/null | tail -n +$((RETENCJA + 1)))
for f in "${STARE[@]:-}"; do
  [ -n "$f" ] && rm -f -- "$f"
done
