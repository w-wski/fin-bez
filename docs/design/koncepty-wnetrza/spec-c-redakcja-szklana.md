<!-- model: google/gemini-3.1-pro-preview · tokeny: {'prompt_tokens': 6791, 'completion_tokens': 5497, 'total_tokens': 12288, 'cost': 0.079546, 'is_byok': False, 'prompt_tokens_details': {'cached_tokens': 0, 'cache_write_tokens': 0, 'audio_tokens': 0, 'video_tokens': 0}, 'cost_details': {'upstream_inference_cost': 0.079546, 'upstream_inference_prompt_cost': 0.013582, 'upstream_inference_completions_cost': 0.065964}, 'completion_tokens_details': {'reasoning_tokens': 1961, 'image_tokens': 0, 'audio_tokens': 0}} -->

# Redakcja Szklana
Precyzja drukowanego magazynu finansowego połączona z fizycznością i spokojem szkła z ekranu logowania.

## Zasada organizująca
Obecne wnętrze aplikacji (obrazy 3-5) cierpi na „syndrom dashboardu” — zamyka każdą, nawet najmniejszą informację w osobnym, szarym pudełku z cieniem, co tworzy wizualny hałas i duszność. Kierunek „Redakcja Szklana” całkowicie odrzuca pudełkowanie na rzecz struktury typograficznej. Tło aplikacji przejmuje miękkie, pudrowe światło z ekranu logowania (uzyskane czystym CSS-em, bez kosztownego bluru), a interfejs staje się warstwą cienkiego, precyzyjnie dociętego szkła leżącą bezpośrednio na nim. Szkło to definiujemy wyłącznie światłem na krawędzi (1px `border` o wysokim kontraście świetlnym) i krystaliczną typografią. Zamiast etykiet (np. słowa „KWOTA”), hierarchię buduje drastyczny kontrast wielkości i grubości fontu — liczby stają się gigantycznymi, pierwszoplanowymi ilustracjami ekranu.

## Tokeny
Używamy przestrzeni OKLCH dla idealnego balansu percepcyjnego. Zmienne definiujemy w `:root` (jasny) i `@media (prefers-color-scheme: dark)` (ciemny).

```css
:root {
  /* Tło: Pudrowa biel z logowania vs Głęboki, chłodny mat */
  --bg-base: oklch(98% 0.01 90);
  --bg-surface: oklch(100% 0 0 / 0.4); /* Powierzchnia przepuszcza tło */
  
  /* Akcent: Głęboka szałwia (z przycisku logowania) */
  --accent-main: oklch(45% 0.08 160);
  --accent-soft: oklch(90% 0.04 160);
  
  /* Typografia: Złamana czerń vs Czysta biel */
  --text-hero: oklch(15% 0.01 90);
  --text-body: oklch(35% 0.01 90);
  --text-muted: oklch(60% 0.01 90);
  
  /* Szkło i krawędzie */
  --glass-edge-top: oklch(100% 0 0 / 0.8);
  --glass-edge-bottom: oklch(0% 0 0 / 0.05);
  --hairline: oklch(0% 0 0 / 0.08); /* Zamiast grubych borderów */
  
  /* Semantyka finansowa */
  --color-income: oklch(55% 0.12 150);
  --color-expense: oklch(50% 0.15 25);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-base: oklch(18% 0.01 260);
    --bg-surface: oklch(22% 0.01 260 / 0.6);
    --accent-main: oklch(75% 0.1 160);
    --text-hero: oklch(98% 0 0);
    --text-body: oklch(85% 0 0);
    --text-muted: oklch(65% 0 0);
    --glass-edge-top: oklch(100% 0 0 / 0.15);
    --glass-edge-bottom: oklch(0% 0 0 / 0.4);
    --hairline: oklch(100% 0 0 / 0.1);
  }
}
```

## Układ i rytm
Aplikacja oddycha przestrzenią. Na telefonie bazowy padding ekranu to aż `24px` (zamiast standardowych 16px).
Kartą jest wyłącznie **główny kontener widoku** (np. cały formularz nowego wpisu lub cały blok raportu). Pojedynczy wpis w Historii **nie jest kartą** — jest wierszem tekstu oddzielonym od następnego linią grubości włosa (`var(--hairline)`). Wyrównanie do lewej jest świętością dla tekstu, wyrównanie do prawej dla kwot. Nagłówki widoków (np. "Nowy wpis") znikają jako osobne byty — ich rolę przejmuje ogromna kwota lub nazwa sekcji zintegrowana z układem. Szerokość maksymalna dla czytelności na desktopie to `680px` dla formularzy i list, a `1024px` dla raportów.

## Typografia
To serce tego kierunku. Używamy wyłącznie systemowego fontu (SF Pro na Apple).
- **Skala:** Ekstremalna. Typografia redakcyjna. Kwoty to `font-size: 3rem` (lub więcej dla KPI), `font-weight: 700`, `letter-spacing: -0.04em`. Metadane to `font-size: 0.75rem`, `text-transform: uppercase`, `letter-spacing: 0.06em`.
- **Liczby:** Każda kwota otrzymuje `font-variant-numeric: tabular-nums;`. Dzięki temu przy animacjach opacity i zmianach stanów przecinki i cyfry stoją w równych kolumnach.
- **Hierarchia:** Usuwamy wizualne etykiety "KATEGORIA", "DATA". Znaczenie wynika z formy. Jeśli coś jest dużą datą, to jest datą.

## Komponenty

- **Powierzchnia/Karta:** Pozbywamy się `box-shadow`. Karta to delikatnie przyciemnione/rozjaśnione tło z podwójną krawędzią imitującą grubość szkła. `background: var(--bg-surface); border-top: 1px solid var(--glass-edge-top); border-bottom: 1px solid var(--glass-edge-bottom); border-radius: 24px;`.
- **Nawigacja (Segmented Control / Tabbar):** Kształt pastylki (jak przycisk logowania). Aktywny element ma fizyczne, nieprzezroczyste wypełnienie w kolorze tła, nieaktywne to sam tekst. Żadnych obrysów zewnętrznych.
- **Pole formularza (Input/Select):** Zamiast pełnych ramek (jak na obr. 3), stosujemy styl "magazynowy". Pole to tylko dolna krawędź `border-bottom: 1px solid var(--hairline)`, tekst wpisywany jest duży (`1.125rem`). Po kliknięciu linia zmienia kolor na `--accent-main`.
- **Pole kwoty (Hero Input):** Brak jakichkolwiek ramek. Kwota jest centralnym lub prawostronnym, gigantycznym elementem (`4rem`, `bold`), który dominuje nad całym formularzem wpisu.
- **Przycisk główny:** Podążamy za ekranem logowania. Kształt pastylki (`border-radius: 999px`), głęboka szałwia (`var(--accent-main)`), tekst biały, `font-weight: 600`. Żadnych gradientów.
- **Lista Historii (Telefon):** Koniec z osobnymi białymi boxami. Lista to ciągły strumień. Data to sticky header (mały, uppercase, muted). Wiersz to grid: z lewej ikona/kropka koloru kategorii, obok dwuliniowy tekst (Kategoria > Opis), a po prawej stronie, absolutnie wyrównana do prawej, waga ciężka — kwota w tabular-nums.
- **Lista Historii (Desktop):** Ta sama zasada, ale rozwinięta do pełnej tabeli bez pionowych linii. Tylko poziome `var(--hairline)`.
- **KPI / Raporty:** Liczba jest bohaterem. Pudełka z obrazka 5 znikają. KPI to duża liczba (np. `6200,00 zł`) na czystym tle, pod nią mały, szeroko rozstrzelony podpis "PRZYCHODY".
- **Słupek kategorii:** Minimalistyczna, zaokrąglona linia (wysokość `6px`), wypełniona w 100% kolorem kategorii nadanym w Adminie. Kwota wyrównana do prawej krawędzi słupka.
- **Kolor kategorii na wpisie:** Kropka o średnicy `12px` (afordancja z magazynu punktującego) obok nazwy kategorii. Żadnych kolorowych teł pod całym wpisem.

## Jasny vs ciemny
Zabronione jest proste odwrócenie kolorów. W trybie jasnym aplikacja jest papierowo-szklana (ciepła biel, ledwo zauważalne cienie pod krawędziami). W trybie ciemnym staje się matowym, głębokim onyksem. Elementy szklane w trybie ciemnym nie mają białego tła z opacity (co dawałoby efekt taniego, mlecznego plastiku), lecz opierają się wyłącznie na świetlnych refleksach na górnych krawędziach kart (`border-top: 1px solid rgba(255,255,255,0.15)`). Kolory kategorii w trybie ciemnym muszą być automatycznie transformowane (np. w CSS via `color-mix` lub osobne tokeny), aby utrzymać czytelność WCAG AA na ciemnym tle (zwiększona jasność, zmniejszona saturacja).

## Czego NIE robimy
1. **Żadnego `backdrop-filter: blur()` na dużych kartach.** Zabija to baterię i klatki na sekundę podczas scrollowania na starszych iPhone'ach. Szkło robimy krawędzią.
2. **Żadnych redundantnych etykiet.** Odrzucamy podejście bazodanowe ("DATA: 2026-07-25", "KWOTA: 50 zł").
3. **Żadnych szarych, zaokrąglonych przycisków pomocniczych.** Jak na obr. 3 ("Wydatek/Przychód"). Używamy eleganckich, typograficznych przełączników.
4. **Zera ikonograficznego szumu.** Nie dodajemy ikonek do każdej kategorii, jeśli nie są absolutnie konieczne. Kolorowa kropka i mocna typografia wystarczą.
5. **Żadnego centrowania danych.** Kwoty muszą tworzyć nienaganną prawą kolumnę, aby ułatwić skanowanie wzrokiem.

## CSS sygnaturowy
Poniższy kod ilustruje rygor typograficzny i architekturę "szkła krawędziowego" na przykładzie wiersza historii, zastępując ciężkie karty z obecnego designu.

```css
/* Baza - pudrowe światło z ekranu logowania (bez obrazków) */
body {
  background-color: var(--bg-base);
  /* Subtelne plamy pasteli nakładane radialnie, bez bluru */
  background-image: 
    radial-gradient(circle at 20% 0%, oklch(95% 0.05 140 / 0.4) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, oklch(95% 0.03 340 / 0.3) 0%, transparent 40%);
  background-attachment: fixed;
  color: var(--text-hero);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* Karta / Powierzchnia (np. tło dla Raportów) */
.glass-surface {
  background: var(--bg-surface);
  border-radius: 24px;
  /* Cały efekt szkła opiera się na świetle krawędzi, nie na cieniu */
  border-top: 1px solid var(--glass-edge-top);
  border-bottom: 1px solid var(--glass-edge-bottom);
  border-left: 1px solid var(--hairline);
  border-right: 1px solid var(--hairline);
}

/* Element listy Historii - Redakcyjny, czysty wiersz */
.entry-row {
  display: grid;
  grid-template-columns: 12px 1fr auto;
  gap: 16px;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid var(--hairline);
  /* Optymalizacja dotyku */
  min-height: 60px; 
}

.entry-row:last-child {
  border-bottom: none;
}

/* Kropka redakcyjna (Kolor Kategorii) */
.entry-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: var(--category-color); /* wstrzykiwane inline z bazy */
  margin-top: 4px;
  align-self: start;
}

/* Typografia wiersza */
.entry-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.entry-title {
  font-size: 1.0625rem;
  font-weight: 500;
  color: var(--text-hero);
  line-height: 1.2;
}

.entry-meta {
  font-size: 0.8125rem;
  color: var(--text-muted);
  font-weight: 400;
}

/* Kwota - Bohater */
.entry-amount {
  font-size: 1.35rem; /* Znacznie większe niż tekst obok */
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums; /* Kluczowe dla kolumn finansowych */
  text-align: right;
  color: var(--text-hero);
}

.entry-amount[data-type="expense"] {
  /* Wydatki są standardowe (czarne/białe), przychody akcentowane */
}

.entry-amount[data-type="income"] {
  color: var(--color-income);
}
```