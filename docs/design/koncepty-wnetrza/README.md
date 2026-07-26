# Trzy koncepty wnętrza aplikacji (2026-07-26)

Wnętrze (po zalogowaniu) ma dostać charakter ekranu logowania — Szymon: „musi wewnątrz być
bardziej designerskie". Zamiast jednej propozycji poprosiliśmy o trzy niezależne kierunki od
trzech różnych modeli (przez OpenRouter), każdy z tym samym briefem i referencjami (zrzuty
ekranu logowania + obecnego wnętrza), ale z innym priorytetem — żeby propozycje naprawdę się
różniły, a nie były trzema wariantami tego samego.

| Koncept | Autor | Priorytet w briefie | Sedno |
|---|---|---|---|
| **A — Arkusz i kamyk** | `anthropic/claude-opus-5` | spokój i redukcja | Karta znika. Treść leży na jednym ciepłym arkuszu, porządkują ją włoskowate linie i powietrze. JEDYNYM szklanym przedmiotem jest kamyk nawigacji. Kolor kategorii to 2 px kreska w marginesie. Wydatki nie są czerwone. |
| **B — Tafla** | `openai/gpt-5.5` | materiał | Wnętrze jako warstwy: tło → jedna wielka tafla robocza na widok → kamyki pól i akcji. Głębia z krawędzi, cieni i kolejności warstw (nigdy z animowanych rozmyć). Kolor kategorii to 4 px żyłka w materiale. |
| **C — Redakcja szklana** | `google/gemini-3.1-pro` | redakcja i dane | Dobrze złożony magazyn finansowy: nadtytuł, lead, drastyczny kontrast skali. Liczby są ilustracją. Szkło robione WYŁĄCZNIE światłem krawędzi, zero cieni. Kolor kategorii to redakcyjna kropka. |

## Co tu leży

- `spec-*.md` — pełne specyfikacje kierunków (tokeny jasny/ciemny, układ, typografia,
  komponenty, „czego NIE robimy", CSS sygnaturowy). Tekst modeli bez zmian.
- `koncept-*.html` — moje **makiety** tych specyfikacji: statyczne, na danych demonstracyjnych,
  te same dane w każdym koncepcie. Otwiera się w przeglądarce; `?dark` włącza motyw ciemny,
  `?v=historia|raporty|wpis` wybiera widok. NIE są częścią aplikacji.
- `wizja-*.jpg` — wizualizacje z modelu obrazowego (`google/gemini-3-pro-image`), zrobione na
  podstawie makiet: telefon jasny + ciemny na tle palety aplikacji.
- `narzedzia/` — skrypty, którymi to powstało (klucz API czytany z pliku poza repo).

## Zasady wspólne dla wszystkich trzech

Niezależnie od siebie wszystkie trzy modele odrzuciły to samo w obecnym wnętrzu i zgodziły się co
do kilku rzeczy — to jest twarda część wniosku, warta wdrożenia niezależnie od wyboru kierunku:

1. **Koniec z kartą wokół każdego wpisu** i etykietami `DATA / TYP / KWOTA / KTO` przy każdym
   rekordzie — pozycja i format niosą tę informację.
2. **Liczba jest bohaterem** (kwota we Wpisie, KPI w Raportach), tabular-nums wszędzie.
3. **Kolor kategorii jako drobny znak** (kreska / żyłka / kropka), nigdy jako tło całego wpisu.
4. **Zero animowanego `backdrop-filter`/`blur`** na dużych powierzchniach — szkło robimy krawędzią.
5. **Wydatki nie są czerwone** — czerwień zostaje dla ostrzeżeń; lista 200 wpisów nie ma być alarmem.

## Decyzja

Czeka na Szymona. Po wyborze kierunku (możliwe też: „A z przeszczepem X z B") wdrożenie idzie przez
`styles.css` + pliki `css/<widok>.css`, bez zmian w logice — tak jak redesign ekranu logowania.
