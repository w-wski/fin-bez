# RUNBOOK — wdrożenie „finansowej" na seohost

Procedura wdrożenia `finanse.bezprzemocowo.pl`. Do tego pliku odwołują się `app/public/sw.js`,
`app/public/styles.css` i `app/scripts/migrate-xlsx.js`.

> **Dlaczego ten plik powstał dopiero teraz (2026-07-28).** `README` odsyłał do
> `RUNBOOK-WDROZENIE.md` w repo `finansowe`, ale taki plik nigdy nie istniał — w żadnym repo.
> Kosztowało to dwa nieudane wdrożenia: `npm run migrate` z korzenia domeny (gdzie nie ma
> `package.json`) i `git pull` w katalogu, który nie jest repozytorium.

## Układ na serwerze

```
~/domains/finanse.bezprzemocowo.pl/
  repo/        klon gita — TU się pobiera kod, aplikacja z tego nie działa
  app/         DZIAŁAJĄCA aplikacja (Passenger, Node 22) — cel rsynca
  receipts/    wgrane paragony (poza docrootem, poza gitem) — NIE DOTYKAĆ
```

Rozdział `repo/` od `app/` jest celowy: `git pull` nigdy nie pisze wprost do katalogu, z którego
serwuje Passenger, więc nieudane pobranie nie zostawia aplikacji w połowicznym stanie.

## Czego NIE WOLNO skasować

Te rzeczy żyją **wyłącznie na serwerze** i nie ma ich w repo. Nadpisanie albo skasowanie
którejkolwiek psuje produkcję, a odtworzenie nie jest możliwe z gita:

| Ścieżka | Co to | Dlaczego nie ma tego w repo |
|---|---|---|
| `app/.env` | hasła do bazy, sekret JWT, klucze API | sekrety nigdy w gicie, nawet prywatnym |
| `app/public/fonts/sf-pro-*.woff2` | 4 pliki fontu SF Pro | licencja Apple zabrania redystrybucji |
| `app/node_modules/` | zależności | instalowane na miejscu |
| `receipts/` | wgrane paragony | dane, nie kod |
| `app/tmp/` | `restart.txt` Passengera | artefakt runtime'u |

Dlatego `rsync` niżej ma `--exclude` na każdą z nich. **`--exclude` w rsyncu chroni też przed
`--delete`** — pliki wykluczone nie są kasowane po stronie odbiorcy. Usunięcie któregokolwiek
`--exclude` przy jednoczesnym `--delete` skasuje te pliki z produkcji.

## Wdrożenie

```bash
# 0. Środowisko Node (bez tego `node`/`npm` to wersje systemowe, nie 22)
source ~/nodevenv/domains/finanse.bezprzemocowo.pl/app/22/bin/activate

# 1. Pobierz kod do KLONU (nie do katalogu aplikacji)
cd ~/domains/finanse.bezprzemocowo.pl/repo
git pull origin main          # albo gałąź zadaniowa, jeśli wdrażasz przed scaleniem

# 2. Podgląd: co rsync by zmienił. Nic nie zapisuje — zawsze rób ten krok pierwszy.
rsync -a --delete --itemize-changes --dry-run \
  --exclude '.env' --exclude 'node_modules/' --exclude 'tmp/' \
  --exclude 'public/fonts/sf-pro-*.woff2' \
  ~/domains/finanse.bezprzemocowo.pl/repo/app/ \
  ~/domains/finanse.bezprzemocowo.pl/app/

# 3. To samo bez --dry-run, gdy podgląd wygląda sensownie
rsync -a --delete \
  --exclude '.env' --exclude 'node_modules/' --exclude 'tmp/' \
  --exclude 'public/fonts/sf-pro-*.woff2' \
  ~/domains/finanse.bezprzemocowo.pl/repo/app/ \
  ~/domains/finanse.bezprzemocowo.pl/app/

# 4. Zależności — TYLKO gdy zmienił się package-lock.json
cd ~/domains/finanse.bezprzemocowo.pl/app
npm ci

# 5. Migracje (idempotentne — drugi przebieg nic nie robi)
npm run migrate

# 6. Bramka jakości. Ma skończyć się „PREFLIGHT OK".
npm test

# 7. Restart aplikacji
touch ~/domains/finanse.bezprzemocowo.pl/app/tmp/restart.txt
```

> **Krok 7 wymaga potwierdzenia przy pierwszym użyciu.** `restart.txt` to standard Passengera,
> ale panel seohost może wymagać przycisku „Restart" w zakładce Node.js. Jeśli po `touch`
> aplikacja dalej serwuje starą wersję — użyj przycisku w panelu i **popraw tę linijkę w tym
> pliku**, zamiast pamiętać wyjątek.

Na koniec **twarde odświeżenie** w przeglądarce. Po zmianach w `app/public/` numer
`CACHE_VERSION` w `sw.js` musi być podbity w tym samym commicie, inaczej service worker
poda staremu użytkownikowi stary interfejs.

## Weryfikacja po wdrożeniu

```bash
cd ~/domains/finanse.bezprzemocowo.pl/app
node scripts/stan-przydzialu.js     # stan reorganizacji kategorii (tylko odczyt)
ls public/fonts/sf-pro-*.woff2      # 4 pliki — jeśli zniknęły, rsync miał złe --exclude
test -f .env && echo ".env na miejscu"
```

W przeglądarce: zalogowanie, jeden wpis w Historii, jeden paragon.

## Wycofanie

```bash
cd ~/domains/finanse.bezprzemocowo.pl/repo
git log --oneline -5
git checkout <sha-poprzedniego-działającego>
# … i rsync z kroku 3 jeszcze raz
```

**Migracji się nie cofa.** Wszystkie są addytywne (dodają kolumny i tabele), więc starszy kod
działa na nowszej bazie. Jeśli migracja padła w połowie — patrz niżej, nie kombinuj z ręcznym
`ALTER`-em.

## Znane pułapki

- **Migracja 012 (`fk_item_prod`).** Runner toleruje „kolumna/indeks już istnieje", ale **nie**
  „klucz obcy o tej nazwie już istnieje". Jeśli 012 padnie w połowie, powtórka wywali się na
  kluczu obcym. Wtedy: zapisz kod błędu i zgłoś, nie naprawiaj ręcznie.
- **Dziura w numeracji migracji na 011.** Runner sortuje po nazwach i pamięta, co wykonał —
  nieszkodliwe, ale niech nie zaskakuje.
- **`npm run migrate` z korzenia domeny** kończy się `ENOENT: package.json`. `package.json`
  jest w `app/`, nie w korzeniu.
- **`git pull` w `app/`** kończy się `not a git repository`. Klon jest w `repo/`.
