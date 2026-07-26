# Brief techniczny do projektowania wnętrza „Finansowej"

Dokument do wklejenia projektantowi (człowiekowi albo modelowi) jako prompt. **Zawiera wyłącznie
zmienne techniczne** — zero sugestii wizualnych: żadnych barw, krojów jako intencji, metafor,
nastroju ani odniesień do obecnego wyglądu. Kierunek estetyczny to decyzja projektanta.

Wersja: 2026-07-26. Utrzymanie: aktualizuj, gdy zmieni się stack, bramki lub kontrakt DOM.

---

Projektujesz **wnętrze** (widoki po zalogowaniu) prywatnej aplikacji finansowej dla jednej rodziny
i jej jednoosobowej spółki. Poniżej wszystko, co ogranicza rozwiązanie technicznie. O wyglądzie
decydujesz Ty — nie ma tu żadnych wskazówek estetycznych i nie proś o nie.

## 1. Skala użycia i urządzenia

- 2–4 stałych użytkowników, praca codzienna, wiele krótkich sesji dziennie.
- **Priorytet urządzeń: telefon → tablet → desktop.** Telefon to iPhone (Safari iOS), często w
  ruchu, jedną ręką; tablet to iPad; desktop to Safari/Chrome, okno zwykle nie na pełnym ekranie.
- Aplikacja jest instalowana jako PWA (tryb standalone, bez paska adresu) i **musi działać
  offline**: odczyt z cache, zapisy kolejkowane i wysyłane po powrocie sieci.
- Zakładany baseline przeglądarek: iOS/macOS Safari 17+, aktualny Chrome. Wolno używać
  `oklch()`, `color-mix()`, `:has()`, `clamp()`, zapytań kontenerowych, `env(safe-area-inset-*)`.

## 2. Stack i sposób wdrożenia (nienegocjowalne)

- Frontend: **czysty HTML + CSS + JavaScript (ES modules), zero buildu, zero frameworka, zero
  zależności npm w warstwie klienta.** Nie ma Tailwinda, preprocesorów, PostCSS-a ani bundlera.
  To, co napiszesz, ląduje 1:1 na serwerze.
- Backend: Node.js + Express + MySQL na współdzielonym hostingu (CloudLinux Passenger). Nie ma
  SSR, nie ma generowania stron — jeden statyczny `index.html` i API JSON.
- **Zero zewnętrznych zasobów w czasie działania**: żadnych CDN-ów, webfontów z sieci, bibliotek
  ikon, zewnętrznych obrazów. Wszystko własne, na serwerze (offline musi działać w 100%).
- Struktura plików, w której wolno pracować:
  - `app/public/styles.css` — tokeny (custom properties) + komponenty wspólne dla wielu widoków;
  - `app/public/css/<widok>.css` — styl jednego widoku (`historia`, `paragon`, `kategorie`,
    `przydzial`, `logowanie`);
  - `app/public/index.html` — jeden dokument, w nim wszystkie widoki jako `<section id="view-…">`
    przełączane atrybutem `hidden` (zmiany prezentacyjnego markupu są OK, patrz §6);
  - `app/public/js/*.js` — logika (renderowanie danych, API, walidacja). **Nie przeprojektowujesz
    logiki**; jeśli Twój projekt wymaga zmian w JS, wypisz je osobno jako listę do wykonania.
- Ikony: gdy potrzebne, inline SVG w markupie. Nie ma pliku z ikonami ani font-icons.

## 3. Architektura tokenów (obowiązkowa forma odpowiedzi)

- Wszystkie wartości wizualne **muszą** być custom properties zdefiniowanymi w jednym miejscu
  (`:root` = motyw jasny, `:root[data-theme="dark"]` = motyw ciemny). Komponenty nie znają
  wartości — czytają wyłącznie tokeny. Zero literałów kolorów/odstępów w regułach komponentów.
- Motyw ustawia atrybut `data-theme` na `<html>` **przed pierwszym malowaniem** (inline script);
  tryb `auto` przełącza jasny/ciemny wg pory dnia. Projekt musi wyglądać skończenie w obu
  motywach — ciemny nie może być mechanicznym odwróceniem jasnego.
- Nazwij tokeny rolami, nie wyglądem (`--surface`, `--line-strong`, a nie `--szary-3`).
- Podaj **komplet wartości dla obu motywów** dla każdego wprowadzonego tokenu.

## 4. Wydajność (twarde reguły — łamanie widać na iPhonie natychmiast)

1. Animujemy **wyłącznie** `transform` i `opacity`. Nigdy `width`, `height`, `top`, `left`,
   `margin`, `padding`, `box-shadow`, `filter`, `background`.
2. **Zero animowanego `backdrop-filter` i `blur()`** na dużych powierzchniach; statyczne, małe
   użycie jest dopuszczalne, ale każde policz jako koszt.
3. Nie zapisujemy custom properties na dużych podrzewach co klatkę (unieważnia styl całego
   podrzewa). Wartości zmieniane w animacji idą inline na konkretny element.
4. `background-attachment: fixed` — zakazane (osobna, wolna ścieżka rysowania na iOS).
5. Najwyżej jeden przebieg filtra SVG na scenę; `will-change` tylko na czas trwania animacji.
6. `@media (prefers-reduced-motion: reduce)` musi wyłączać ruch, nie psując czytelności.
7. Listy mają do kilkuset wierszy — układ nie może wymagać pomiarów JS ani mierzyć elementów
   w pętli przewijania.

## 5. Dostępność i ergonomia (bramki, nie życzenia)

- Kontrast tekstu ≥ 4.5:1 (małe) / 3:1 (duże); granice kontrolek i ikony funkcjonalne ≥ 3:1 —
  w obu motywach.
- Cele dotykowe ≥ 44 × 44 px, z odstępem między sąsiadującymi akcjami.
- Widoczny stan fokusu klawiatury dla każdego elementu interaktywnego; kolejność tabulacji
  zgodna z układem wizualnym.
- Kolor nigdy nie jest jedynym nośnikiem informacji (dotyczy m.in. znaku kwoty, typu wpisu,
  kolorów kategorii) — musi towarzyszyć mu znak, tekst lub pozycja.
- Przyciski bez etykiety tekstowej wymagają `aria-label`.
- Respektuj `env(safe-area-inset-*)` dla elementów przyklejonych do krawędzi.
- Stany, które trzeba zaprojektować dla każdego bloku danych: dane, **brak danych**, wczytywanie,
  błąd, offline, „trwa zapis".

## 6. Kontrakt z JavaScriptem (co się zepsuje, jeśli to zignorujesz)

Moduły JS odnajdują elementy po identyfikatorach i klasach. Możesz zmieniać strukturę i klasy
prezentacyjne, ale **każda zmiana poniższych zaczepów wymaga wypisania jej jako zadania do
wykonania w JS** (inaczej widok przestaje działać):

- Widoki: `#view-wpis`, `#view-historia`, `#view-paragon`, `#view-import`, `#view-raporty`,
  `#view-przydzial`, `#view-admin`; przełączanie przez `hidden`; nawigacja to
  `#nav button[data-view="…"]`, aktywna dostaje klasę `.active`.
- Wpis: `#txForm`, `#segType` (trzy `button[data-type]`), `#amount`, `#ledger`, `#txDate`,
  `#catMain`, `#catSub`, `#catAddBox`, `#desc`, `#txMsg`.
- Historia: `#fLedger`, `#fFrom`, `#fTo`, `#fType`, `#histTools`, `#fGo`, `#txTable` (thead/tbody
  renderowane z JS, komórki dostają `data-label`), `#more`.
- Raporty: `#rLedger`, `#rZakres`, `#rMonth`, `#rFrom`, `#rTo`, `#kpi`, `#byCat`, `#trend`,
  `#fvp`, `#telemetria`.
- Import: `#impForm`, `#impFile`, `#impLedger`, `#impBank`, `#impMsg`, `#unmatched`, `#unCount`,
  `#impTable`. Paragon: `#rcFile`, `#rcCanvas`, `#rcResult`, `#rcOut`, `#rcMsg` i pokrewne.
- Wspólne: `header`, `#who`, `#logout`, `#netBadge`, `.theme-switch`, `.toast` (komunikat z
  opcjonalną akcją „Cofnij", żyje ~12 s), `.msg` (komunikat pod formularzem).
- Elementy renderowane z JS, którym musisz dać styl: wiersz tabeli Historii (tryb odczytu i tryb
  edycji w miejscu), wiersz „do uzgodnienia" w Imporcie, kafle/pozycje KPI, wiersz kategorii ze
  słupkiem, wiersz propozycji w Przydziale, drzewo kategorii w Adminie.

## 7. Dane, które trzeba pokazać (kształty prawdziwe, z API)

- **Dwie księgi**: `RODZINA` (id 1) i `PERSEVERA` (id 2, spółka). Użytkownik ma dostęp do jednej
  lub obu; wybór księgi występuje w formularzu, filtrach i raportach.
- **Wpis (transakcja)**: data (`RRRR-MM-DD`), typ z trzech: `WYDATEK` / `PRZYCHÓD` / `TRANSFER`
  (transfer = przesunięcie własnych pieniędzy, nie konsumpcja), kwota, kategoria (ścieżka
  `Rodzic › Dziecko`, może być pusta), opis (**od 0 do ~120 znaków, bywa długi**), autor wpisu,
  księga, opcjonalne powiązanie z wierszem wyciągu bankowego (flaga „uzgodniony").
- **Kategorie**: drzewo o **dwóch poziomach** (kategoria → podkategoria, głębiej się nie da),
  ~30–60 pozycji, każda z opcjonalnym **kolorem nadanym przez administratora (hex, może być
  `null`)**; podkategoria bez własnego koloru dziedziczy kolor rodzica. Kategoria może być
  zarchiwizowana. Kolory pochodzą od użytkownika — Twój projekt musi wyglądać dobrze zarówno
  gdy kolorów nie ma wcale, gdy ma je część, jak i gdy są brzydkie albo do siebie podobne.
- **Raporty**: 4–6 wskaźników liczbowych okresu (przychody, wydatki, bilans, liczba wpisów,
  wiersze bankowe do uzgodnienia), wydatki wg kategorii (nazwa + kwota + udział, ~3–15 pozycji),
  trend 6 miesięcy (tabela 4 kolumn), zobowiązania i cele, rozliczenie kieszonkowego dziecka
  (saldo narastające), przepływ najmu (trzy strony), zestawienie rodzina vs spółka, telemetria
  użycia. Okres wybiera się jako miesiąc / kwartał / rok / zakres własny.
- **Historia**: tabela 7 kolumn (data, typ, kategoria, kwota, opis, autor, akcje), stronicowana
  po 50, z filtrami i widokiem „Kosz" (wpisy usunięte miękko, z akcją przywrócenia). Wiersz
  wchodzi w **tryb edycji w miejscu** (formularz w obrębie wiersza, bez modala).
- **Import**: wgranie CSV z jednego z pięciu banków, lista wierszy wymagających decyzji
  człowieka, historia importów.
- **Paragon**: zdjęcie z telefonu (kadrowanie na canvasie), lista pozycji z kwotami i jednostkami,
  suma kontrolna.
- **Przydział**: propozycje przepięcia wpisów do innych kategorii, grupowane, do przyjęcia lub
  odrzucenia; jedna decyzja naraz, operacja może trwać sekundy.

## 8. Liczby, język, formaty

- Interfejs w **języku polskim**, z pełną diakrytyką. Słowa bywają długie
  (`PRZYCHÓD`, `Podkategoria`, `Wyrównanie`, `do uzgodnienia`) — układ nie może ich ucinać ani
  łamać w środku wyrazu; brak miejsca rozwiązuj układem, nie skracaniem treści.
- Kwoty: format polski, spacja jako separator tysięcy, przecinek dziesiętny, jednostka „zł"
  (`1 234,56 zł`). Zakres realny: od `0,01` do `999 999,99`; ujemne wartości występują w bilansie.
- **Wszystkie liczby wyrównane w kolumnach i w cyfrach tabelarycznych** (`tabular-nums`) — kwoty
  muszą dać się skanować wzrokiem w pionie.
- Daty: przechowywane jako `RRRR-MM-DD`; prezentacja do Twojej decyzji, ale musi być
  jednoznaczna i stabilnej szerokości.
- Kwoty przychodzą z API jako łańcuchy znaków (`"3000.00"`) — formatowanie robi warstwa JS.

## 9. Bramki jakości w repozytorium (`npm test` musi przechodzić)

- Plik `.js` **maksymalnie 300 linii** (limit „ratchet": dług może tylko maleć). Nie dotyczy CSS,
  ale styl jednego widoku trzymamy w jego własnym pliku.
- Zakaz połkniętych błędów (pusty `catch` bez wyjaśnienia).
- Skaner sekretów — żadnych kluczy w repo.
- Deploy: rsync katalogu aplikacji + restart procesu + podbicie wersji cache w service workerze.
  Dlatego liczba i nazwy plików CSS/JS mają znaczenie: nowy plik trzeba dopisać do listy app
  shella.

## 10. Czego oczekuję w odpowiedzi

1. Kierunek wizualny nazwany i uzasadniony w kilku zdaniach (to Twoja decyzja — nie sugeruję nic).
2. Komplet tokenów: nazwa → wartość dla motywu jasnego i ciemnego.
3. Siatka, szerokości, skala odstępów, skala typograficzna (z konkretnymi wartościami).
4. Specyfikacja komponentów z §6 wraz ze **wszystkimi stanami** z §5 i gotowymi deklaracjami CSS.
5. Zasady responsywności: punkty łamania i co dokładnie zmienia się w układzie na telefonie,
   tablecie i desktopie (szczególnie: tabela 7 kolumn na 390 px szerokości).
6. Jak kolor kategorii pochodzący od użytkownika wchodzi w interfejs, nie psując go.
7. Lista zmian wymaganych w JS, jeśli Twój projekt narusza kontrakt z §6.
8. Kryteria odbioru: mierzalne warunki, po których poznam, że wdrożenie jest zgodne z projektem.

Nie pytaj o preferencje estetyczne — zaproponuj i obroń. Pytaj tylko wtedy, gdy brakuje Ci
**faktu technicznego** albo informacji o danych.
