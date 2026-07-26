<!-- model: openai/gpt-5.5 · tokeny: {'prompt_tokens': 5743, 'completion_tokens': 5399, 'total_tokens': 11142, 'cost': 0.190685, 'is_byok': False, 'prompt_tokens_details': {'cached_tokens': 0, 'cache_write_tokens': 0, 'audio_tokens': 0, 'video_tokens': 0}, 'cost_details': {'upstream_inference_cost': 0.190685, 'upstream_inference_prompt_cost': 0.028715, 'upstream_inference_completions_cost': 0.16197}, 'completion_tokens_details': {'reasoning_tokens': 99, 'image_tokens': 0, 'audio_tokens': 0}} -->

# Tafla

Wnętrze „Finansowej” staje się spokojną, warstwową taflą szkła: dane leżą pod cienką krawędzią materiału, a najważniejsze akcje są jak wypolerowane kamyki.

## Zasada organizująca

Nowe wnętrze nie jest zbiorem webowych kart, tylko układem warstw: tło, tafla robocza, kamyki akcji, drobne soczewki statusów. Wynika to bezpośrednio z ekranu logowania — szkło nie jest tu mlecznym `blur`, tylko widoczną krawędzią, cieniem wewnętrznym i delikatnym napięciem między powierzchniami. Każdy widok ma jedną główną taflę roboczą, a nie wiele równorzędnych boxów; dzięki temu aplikacja jest bardziej „przedmiotem” niż dashboardem. Kategorie finansowe nie dostają przypadkowych badge’y, tylko kolorową żyłkę w materiale — cienki, konsekwentny akcent przypisany wpisowi.

## Tokeny

Wszystkie tokeny w `:root` i nadpisane w `[data-theme="dark"]`. Kolory w OKLCH.

```css
:root {
  --bg: oklch(97.5% 0.012 65);
  --bg-wash-sage: oklch(91% 0.035 155 / .48);
  --bg-wash-rose: oklch(93% 0.045 20 / .42);
  --bg-wash-sky: oklch(92% 0.035 230 / .34);

  --text: oklch(18% 0.012 60);
  --text-muted: oklch(48% 0.012 60);
  --text-soft: oklch(61% 0.010 60);

  --sage: oklch(43% 0.075 160);
  --sage-strong: oklch(36% 0.085 160);
  --danger: oklch(47% 0.145 25);
  --income: oklch(44% 0.105 150);

  --glass: oklch(99% 0.006 70 / .72);
  --glass-raised: oklch(100% 0.004 70 / .84);
  --glass-line: oklch(78% 0.012 70 / .72);
  --glass-line-bright: oklch(100% 0 0 / .92);
  --glass-shadow: 0 22px 60px oklch(38% 0.018 60 / .12), 0 3px 10px oklch(38% 0.018 60 / .08);
  --glass-shadow-tight: 0 10px 26px oklch(38% 0.018 60 / .14), 0 1px 3px oklch(38% 0.018 60 / .10);

  --field: oklch(99% 0.004 70 / .62);
  --field-border: oklch(54% 0.010 70 / .58);
  --focus-ring: oklch(43% 0.075 160 / .34);

  --radius-xl: 32px;
  --radius-lg: 24px;
  --radius-md: 18px;
  --radius-pill: 999px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;

  --hairline: 1px;
}
```

```css
[data-theme="dark"] {
  --bg: oklch(15.5% 0.018 255);
  --bg-wash-sage: oklch(32% 0.060 165 / .26);
  --bg-wash-rose: oklch(30% 0.060 18 / .20);
  --bg-wash-sky: oklch(29% 0.055 235 / .22);

  --text: oklch(93% 0.010 80);
  --text-muted: oklch(72% 0.012 80);
  --text-soft: oklch(58% 0.012 80);

  --sage: oklch(67% 0.085 160);
  --sage-strong: oklch(74% 0.090 160);
  --danger: oklch(70% 0.130 25);
  --income: oklch(72% 0.115 150);

  --glass: oklch(23% 0.018 255 / .68);
  --glass-raised: oklch(28% 0.020 255 / .76);
  --glass-line: oklch(64% 0.020 255 / .28);
  --glass-line-bright: oklch(100% 0 0 / .16);
  --glass-shadow: 0 26px 70px oklch(0% 0 0 / .38), 0 2px 8px oklch(0% 0 0 / .26);
  --glass-shadow-tight: 0 12px 34px oklch(0% 0 0 / .34), 0 1px 3px oklch(0% 0 0 / .35);

  --field: oklch(19% 0.016 255 / .68);
  --field-border: oklch(74% 0.010 255 / .30);
  --focus-ring: oklch(67% 0.085 160 / .36);
}
```

## Układ i rytm

Mobile-first: ekran ma pionowy rytm `24 / 32 / 48`, z jedną kolumną i bez zagęszczania informacji. Szerokość treści: telefon `min(100% - 32px, 520px)`, tablet `min(100% - 64px, 760px)`, desktop `min(100% - 96px, 1180px)`. Na telefonie główny widok jest jedną taflą `.sheet`; w niej mogą istnieć mniejsze „kamyki” pól, KPI lub akcji, ale nie mnożymy kart wewnątrz kart.

Nagłówek widoku jest poza taflą: duży tytuł, krótki kontekst, ewentualnie jeden filtr. To daje powietrze jak na ekranie logowania. Kartą jest: formularz Wpisu, pojedynczy wpis Historii na telefonie, blok Paragonu, grupa KPI, importowany wiersz wymagający decyzji. Kartą NIE jest: każdy label, każdy filtr, każdy wiersz tabeli na desktopie — tam materiałem jest cała tabela jako tafla, a wiersze są tylko nacięciami światła.

Nawigacja jest pływającą szklaną belką: na telefonie poziomy pasek pod topbarem, przewijany, z aktywną zakładką jako szałwiowy kamyk. Na desktopie pozostaje w górze, ale ma szerokość treści, nie pełny ciężki navbar.

## Typografia

Jeden krój: SF Pro. Tytuły widoków: `font-size: clamp(34px, 9vw, 52px)`, `font-weight: 750`, `letter-spacing: -0.045em`, `line-height: .96`. Nagłówki sekcji są małe, techniczne, ale eleganckie: `11px`, `700`, uppercase, `letter-spacing: .16em`, kolor `--text-soft`.

Liczby są bohaterem tam, gdzie użytkownik podejmuje decyzję: kwota we Wpisie, kwota w Historii, KPI, suma paragonu, różnica importu. Wszystkie liczby: `font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;`. Kwota główna we Wpisie ma skalę obiektu: `48–64px` na telefonie, `72px` na desktopie, semibold, ciasny tracking. Nie robimy „etykietowego” formularza — najpierw kwota, potem kontekst.

## Komponenty

### Powierzchnia / karta

Powierzchnia ma wyglądać jak tafla o realnej krawędzi: jasna linia od góry, cień pod spodem, subtelny inset. Nie używamy ciężkiego `backdrop-filter` na dużych obszarach; materiał budują półprzezroczysty kolor, border i shadow.

```css
.sheet,
.card {
  background: var(--glass);
  border: 1px solid var(--glass-line);
  border-top-color: var(--glass-line-bright);
  border-radius: var(--radius-xl);
  box-shadow: var(--glass-shadow);
}
.card {
  border-radius: var(--radius-lg);
  box-shadow: var(--glass-shadow-tight);
}
```

### Nawigacja

Nawigacja jest wąską szklaną rynną, a aktywny element jest kamykiem. Ma cele dotyku minimum `44px`, brak ikonowego hałasu, brak podkreśleń.

```css
.nav {
  display: flex;
  gap: 4px;
  min-height: 52px;
  padding: 5px;
  overflow-x: auto;
  background: var(--glass);
  border: 1px solid var(--glass-line);
  border-radius: var(--radius-pill);
  box-shadow: var(--glass-shadow-tight);
}
.nav__item {
  min-height: 44px;
  padding: 0 18px;
  border-radius: var(--radius-pill);
  color: var(--text-muted);
}
.nav__item[aria-current="page"] {
  background: var(--sage);
  color: white;
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / .28), 0 8px 18px oklch(43% .075 160 / .24);
}
```

### Pole formularza

Pole jest szklanym wgłębieniem, nie standardowym inputem z webowego formularza. Label siedzi nad polem jako mały opis techniczny, a sama wartość ma dużo miejsca.

```css
.field {
  min-height: 56px;
  padding: 10px 16px;
  background: var(--field);
  border: 1px solid var(--field-border);
  border-top-color: var(--glass-line-bright);
  border-radius: var(--radius-md);
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / .34);
}
.field:focus-within {
  border-color: var(--sage);
  box-shadow: 0 0 0 4px var(--focus-ring), inset 0 1px 0 oklch(100% 0 0 / .34);
}
```

### Pole kwoty

Kwota jest centrum formularza Wpisu. To jedyny element, który może być naprawdę duży; reszta formularza ma się podporządkować.

```css
.amount-field {
  text-align: center;
  padding: 22px 8px 18px;
}
.amount-field input {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: center;
  font-size: clamp(48px, 15vw, 72px);
  line-height: .95;
  font-weight: 700;
  letter-spacing: -.055em;
  font-variant-numeric: tabular-nums;
}
.amount-field::after {
  content: "";
  display: block;
  height: 1px;
  margin: 18px auto 0;
  width: min(340px, 84%);
  background: var(--field-border);
}
```

### Przycisk główny

Przycisk główny to cięższy szałwiowy kamyk. Nie świeci, nie gradientuje tęczą; ma krawędź, cień i stan wciśnięcia przez `transform`.

```css
.button-primary {
  min-height: 56px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--sage);
  color: white;
  font-weight: 750;
  letter-spacing: -.018em;
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / .24), 0 14px 28px oklch(43% .075 160 / .28);
}
.button-primary:active {
  transform: translateY(1px) scale(.992);
}
```

### Lista Historii — telefon i desktop

Na telefonie każdy wpis jest osobnym obiektem: data i osoba są ciche, kwota i kategoria dominują, kolor kategorii jest pionową żyłką po lewej. Nie pokazujemy etykiet „DATA / TYP / KATEGORIA” przy każdym rekordzie — to był webowy ciężar.

Na desktopie Historia przechodzi w jedną taflę tabeli z lekkimi separatorami. Edycja w miejscu odbywa się przez rozwinięcie wiersza jako podniesionej soczewki, nie przez modal zasłaniający ekran.

```css
.history-card {
  position: relative;
  padding: 18px 18px 16px 22px;
  border-radius: var(--radius-lg);
}
.history-card::before {
  content: "";
  position: absolute;
  left: 10px;
  top: 16px;
  bottom: 16px;
  width: 4px;
  border-radius: 999px;
  background: var(--cat-color);
}
@media (min-width: 860px) {
  .history-list {
    display: table;
    width: 100%;
  }
  .history-card {
    display: table-row;
    box-shadow: none;
    background: transparent;
  }
}
```

### KPI

KPI to małe soczewki leżące na tafli raportu. Liczba jest duża, label mały i szeroko rozstrzelony; KPI nie dostają ikon, bo liczby są wystarczającą informacją.

```css
.kpi {
  padding: 16px;
  border-radius: var(--radius-md);
  background: var(--glass-raised);
  border: 1px solid var(--glass-line);
  border-top-color: var(--glass-line-bright);
}
.kpi__value {
  font-size: clamp(28px, 7vw, 40px);
  line-height: 1;
  font-weight: 750;
  letter-spacing: -.045em;
  font-variant-numeric: tabular-nums;
}
.kpi__label {
  margin-top: 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--text-soft);
}
```

### Słupek kategorii

Słupek kategorii nie jest wykresem z SaaS-u. To cienka kolorowa inkluzja w materiale: wysokość `6px`, zaokrąglenie, bez glow, z bardzo delikatną linią górną.

```css
.category-bar {
  height: 6px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--cat-color) 86%, white);
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / .35);
}
.category-row {
  display: grid;
  grid-template-columns: minmax(92px, 160px) 1fr max-content;
  gap: 12px;
  align-items: center;
}
```

### Tabela

Tabela jest jedną taflą, a nie siatką pudełek. Wiersze mają tylko dolną linię o niskim kontraście; hover na desktopie podnosi wiersz kolorem tła, bez animowania layoutu.

```css
.table-shell {
  overflow: hidden;
  border-radius: var(--radius-xl);
  background: var(--glass);
  border: 1px solid var(--glass-line);
}
.table th {
  height: 44px;
  font-size: 11px;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--text-soft);
}
.table td {
  min-height: 52px;
  border-top: 1px solid var(--glass-line);
  font-variant-numeric: tabular-nums;
}
.table tr:hover td {
  background: oklch(100% 0 0 / .045);
}
```

### Kolor kategorii na wpisie

Kolor kategorii jest tokenem inline ustawianym na rekordzie, np. `style="--cat-color: oklch(...)"`. Wpis ma żyłkę, małą kropkę przy nazwie kategorii i ewentualnie zabarwiony mini-chip; nie barwimy całej karty, żeby zachować spokój.

```css
.entry {
  --cat-color: var(--sage);
}
.entry__category::before {
  content: "";
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--cat-color);
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / .4);
}
.entry__chip {
  color: color-mix(in oklch, var(--cat-color) 74%, var(--text));
  background: color-mix(in oklch, var(--cat-color) 14%, transparent);
  border: 1px solid color-mix(in oklch, var(--cat-color) 38%, transparent);
}
```

## Jasny vs ciemny

Jasny motyw jest pudrowy, niemal ceramiczny: tło ma ciepłą biel i pastelowe plamy, a szkło jest czytane głównie przez cień pod taflą oraz jasną górną krawędź. Ciemny motyw nie jest po prostu przyciemniony — jest bardziej mineralny: mniej różu, więcej głębokiego granatu i grafitu, mniejsza przezroczystość jasnych krawędzi, mocniejszy cień kontaktowy. W jasnym motywie tafle są „na papierze”; w ciemnym wyglądają jak przygaszone szkło nad czarną powierzchnią. Akcent szałwiowy w ciemnym jest jaśniejszy i bardziej świetlisty, ale nadal bez glow jako afordancji.

## Czego NIE robimy

1. Nie robimy dashboardu z siatką równorzędnych kafli — każdy widok ma jedną główną taflę i jasną hierarchię.  
2. Nie używamy dużych animowanych `backdrop-filter`, rozmyć ani efektów „frosted glass” na całych ekranach.  
3. Nie barwimy interfejsu na niebiesko tylko dlatego, że to aplikacja finansowa; akcentem pozostaje głęboka szałwia.  
4. Nie pokazujemy etykiet pól przy każdym rekordzie Historii na telefonie — wpis ma być czytany jak paragonowy zapis, nie formularz.  
5. Nie robimy tęczowych gradientów, neonów, glow, ikon 3D ani ilustracyjnych ozdobników.  
6. Nie zmniejszamy dotykalnych celów, żeby „zmieścić więcej danych”; rodzinne finanse mają być codziennie wygodne, nie gęste.

## CSS sygnaturowy

```css
:root {
  --bg: oklch(97.5% .012 65);
  --text: oklch(18% .012 60);
  --muted: oklch(50% .012 60);
  --sage: oklch(43% .075 160);
  --glass: oklch(99% .006 70 / .72);
  --glass-2: oklch(100% .004 70 / .84);
  --line: oklch(78% .012 70 / .72);
  --line-hi: oklch(100% 0 0 / .92);
  --shadow: 0 22px 60px oklch(38% .018 60 / .12), 0 3px 10px oklch(38% .018 60 / .08);
  --r-xl: 32px;
  --r-lg: 24px;
  --pill: 999px;
}

body {
  margin: 0;
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  background:
    radial-gradient(800px 520px at 12% 0%, oklch(91% .035 155 / .48), transparent 62%),
    radial-gradient(760px 540px at 85% 18%, oklch(93% .045 20 / .42), transparent 64%),
    radial-gradient(720px 520px at 50% 100%, oklch(92% .035 230 / .30), transparent 66%),
    var(--bg);
  font-variant-numeric: tabular-nums;
}

.shell {
  width: min(100% - 32px, 1180px);
  margin-inline: auto;
  padding-block: 18px 48px;
}

.view-title {
  margin: 34px 0 22px;
  font-size: clamp(36px, 9vw, 56px);
  line-height: .94;
  font-weight: 750;
  letter-spacing: -.05em;
}

.sheet {
  position: relative;
  padding: clamp(18px, 4vw, 32px);
  border-radius: var(--r-xl);
  background: var(--glass);
  border: 1px solid var(--line);
  border-top-color: var(--line-hi);
  box-shadow: var(--shadow);
}

.sheet::before {
  content: "";
  position: absolute;
  inset: 1px 1px auto;
  height: 42%;
  border-radius: calc(var(--r-xl) - 1px) calc(var(--r-xl) - 1px) 44% 44%;
  background: linear-gradient(oklch(100% 0 0 / .30), transparent);
  pointer-events: none;
}

.pebble {
  min-height: 44px;
  border-radius: var(--pill);
  background: var(--glass-2);
  border: 1px solid var(--line);
  border-top-color: var(--line-hi);
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / .30), 0 10px 24px oklch(38% .018 60 / .12);
}

.amount {
  font-size: clamp(48px, 15vw, 72px);
  line-height: .95;
  font-weight: 750;
  letter-spacing: -.055em;
}

.cat-edge {
  --cat-color: var(--sage);
  position: relative;
}

.cat-edge::after {
  content: "";
  position: absolute;
  left: 10px;
  top: 16px;
  bottom: 16px;
  width: 4px;
  border-radius: var(--pill);
  background: var(--cat-color);
}
```