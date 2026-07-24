#!/bin/bash
# Interaktywne tworzenie .env — zamiast ręcznej edycji w nano.
# Użycie (z katalogu app):  bash scripts/setup-env.sh
# Pyta o wartości, sekrety JWT/WIDGET generuje sam, hasła czyta bez echa,
# zapisuje do ../.env (poza docrootem) z chmod 600. Istniejący .env nie jest
# nadpisywany bez wyraźnego potwierdzenia.
set -euo pipefail

TARGET="$(cd "$(dirname "$0")/../.." && pwd)/.env"

if [ -f "$TARGET" ]; then
  echo "UWAGA: $TARGET już istnieje."
  read -rp "Nadpisać? [t/N] " ans
  [ "${ans,,}" = "t" ] || { echo "Nic nie zmieniono."; exit 0; }
fi

echo "== finansowa: konfiguracja .env =="
echo "(Enter przy pytaniach z [nawiasem] przyjmuje wartość domyślną)"
echo

read -rp  "DB_HOST [localhost]: " DB_HOST; DB_HOST=${DB_HOST:-localhost}
read -rp  "DB_NAME (nazwa bazy z panelu): " DB_NAME
read -rp  "DB_USER (użytkownik bazy): " DB_USER
read -rsp "DB_PASS (hasło bazy — nie będzie widoczne): " DB_PASS; echo
read -rp  "GOOGLE_CLIENT_ID: " GOOGLE_CLIENT_ID
read -rsp "GOOGLE_CLIENT_SECRET (nie będzie widoczny): " GOOGLE_CLIENT_SECRET; echo
read -rp  "BASE_URL [https://finanse.bezprzemocowo.pl]: " BASE_URL
BASE_URL=${BASE_URL:-https://finanse.bezprzemocowo.pl}
echo
echo "E-maile Google członków rodziny (do logowania i migracji):"
read -rp  "EMAIL_SZYMON: " EMAIL_SZYMON
read -rp  "EMAIL_ANNA (Enter = pomiń): " EMAIL_ANNA
read -rp  "EMAIL_BARTEK (Enter = pomiń): " EMAIL_BARTEK
read -rp  "EMAIL_PERSEVERA (Enter = pomiń): " EMAIL_PERSEVERA

JWT_SECRET=$(openssl rand -hex 32)
WIDGET_TOKEN=$(openssl rand -hex 24)

umask 177
cat > "$TARGET" <<EOF
DB_HOST=$DB_HOST
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASS=$DB_PASS
JWT_SECRET=$JWT_SECRET
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET
BASE_URL=$BASE_URL
WIDGET_TOKEN=$WIDGET_TOKEN
EMAIL_SZYMON=$EMAIL_SZYMON
EMAIL_ANNA=$EMAIL_ANNA
EMAIL_BARTEK=$EMAIL_BARTEK
EMAIL_PERSEVERA=$EMAIL_PERSEVERA
EOF
chmod 600 "$TARGET"

echo
echo "OK: zapisano $TARGET (chmod 600). JWT_SECRET i WIDGET_TOKEN wygenerowane automatycznie."
echo "WIDGET_TOKEN (dla widgetu dashboardu — zapisz w bezpiecznym miejscu): $WIDGET_TOKEN"
echo
echo "Weryfikacja:"
node -e "require('$(cd "$(dirname "$0")/.." && pwd)/src/config'); const c=require('$(cd "$(dirname "$0")/.." && pwd)/src/config'); console.log(c.missing.length? 'BRAKUJE: '+c.missing.join(', ') : 'env OK — wszystkie wymagane pola są.');"
