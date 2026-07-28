# RUNBOOK — przeniesiony

**Procedura wdrożenia mieszka w repo dokumentacji:**
[`w-wski/finansowe` → `RUNBOOK-WDROZENIE.md`](https://github.com/w-wski/finansowe/blob/main/RUNBOOK-WDROZENIE.md)

Tam jest komplet: panel seohost, baza, OAuth, aktywacja `nodevenv`, pierwszy deploy,
aktualizacja, migracje, reorganizacja kategorii, przydział, rollback.

---

### Dlaczego ten plik tu leży

2026-07-28 napisałem drugi runbook — w tym repo, od zera — bo przeszukałem tylko gałąź
domyślną płytkiego klonu `finansowe` i orzekłem, że taki dokument nie istnieje w żadnym repo.
Istniał, na gałęzi zadaniowej, i był znacznie pełniejszy od mojego.

Treść, która była w mojej wersji lepsza — lista rzeczy, których `rsync --delete` nie może
skasować (`.env`, fonty `sf-pro-*.woff2` pod licencją Apple, `node_modules`, `tmp/`, `*.log`) —
została wniesiona do tamtego dokumentu. Tutaj zostaje sam wskaźnik, bo do „RUNBOOK-a" odsyłają
komentarze w `app/public/sw.js`, `app/public/styles.css` i `app/scripts/migrate-xlsx.js`,
a odesłanie w próżnię już raz nas kosztowało dwa nieudane wdrożenia.

**Jedna procedura, jedno miejsce.** Nie dopisuj tu kroków — dopisuj je tam.
