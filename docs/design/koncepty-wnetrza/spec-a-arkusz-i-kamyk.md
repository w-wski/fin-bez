<!-- model: anthropic/claude-opus-5 · tokeny: {'prompt_tokens': 6852, 'completion_tokens': 12972, 'total_tokens': 19824, 'cost': 0.35856, 'is_byok': False, 'prompt_tokens_details': {'cached_tokens': 0, 'cache_write_tokens': 0, 'audio_tokens': 0, 'video_tokens': 0}, 'cost_details': {'upstream_inference_cost': 0.35856, 'upstream_inference_prompt_cost': 0.03426, 'upstream_inference_completions_cost': 0.3243}, 'completion_tokens_details': {'reasoning_tokens': 1264, 'image_tokens': 0, 'audio_tokens': 0}} -->

# Arkusz i kamyk

Wnętrze to jeden ciepły arkusz papieru, na którym treść porządkują włoskowate linie i powietrze — a jedynym szklanym przedmiotem, jak na ekranie logowania, pozostaje jeden kamyk: pasek nawigacji.

## Zasada organizująca

Obecne wnętrze pakuje wszystko w karty, a karty w karty — dlatego liczby konkurują z pojemnikami. Tutaj **karta znika**: tło jest ciągłe (te same trzy pastelowe plamy i to samo ziarno co na logowaniu, tylko rozciągnięte i ściszone), a struktura powstaje z grup wierszy oddzielonych liniami 0,5 px oraz z odstępów 24–56 px. To wynika bezpośrednio z ekranu startowego: tam też nie ma żadnego panelu — jest papier, typografia i **jeden** wypukły obiekt. Skoro na logowaniu szkło było wydarzeniem, we wnętrzu może być tylko jedno: kamyk nawigacji (dół na telefonie, lewa krawędź na desktopie); wszystko inne jest płaskie i nie rzuca cienia. Kolor kategorii przestaje malować tła — schodzi do 2-pikselowej pionowej kreski w marginesie wiersza, więc lista czyta się jak spis, a nie jak paleta.

## Tokeny

Wszystko w `styles.css`, OKLCH. `:root` = jasny, `:root[data-theme="dark"]` = osobna scena.

| token | jasny | ciemny |
|---|---|---|
| `--paper` | `oklch(98.1% 0.006 45)` | `oklch(16.5% 0.010 50)` |
| `--paper-sunk` (tło pod grupą, ledwo) | `oklch(96.3% 0.008 45)` | `oklch(20.5% 0.012 50)` |
| `--ink-1` | `oklch(23% 0.014 45)` | `oklch(96% 0.005 60)` |
| `--ink-2` | `oklch(44% 0.012 45)` | `oklch(76% 0.008 60)` |
| `--ink-3` (etykiety, ≥4.6:1) | `oklch(53% 0.010 45)` | `oklch(64% 0.010 60)` |
| `--hair` | `oklch(23% 0.014 45 / .11)` | `oklch(98% 0 0 / .10)` |
| `--hair-2` (pod nagłówkiem tabeli) | `oklch(23% 0.014 45 / .20)` | `oklch(98% 0 0 / .18)` |
| `--edge-ctl` (granica kontrolki, ≥3:1) | `oklch(23% 0.014 45 / .34)` | `oklch(98% 0 0 / .34)` |
| `--hair-w` | `1px` → `0.5px` przy `min-resolution: 2dppx` | j.w. |
| `--sage` | `oklch(46% 0.062 155)` | `oklch(74% 0.070 155)` |
| `--sage-fill` / `--on-sage` | `oklch(44% 0.064 155)` / `oklch(98% 0.004 155)` | `oklch(70% 0.062 155)` / `oklch(16% 0.02 155)` |
| `--num-out` (wydatek) | `oklch(23% 0.014 45)` | `oklch(96% 0.005 60)` |
| `--num-in` (przychód) | `oklch(44% 0.070 155)` | `oklch(76% 0.060 155)` |
| `--num-neg-mark` (tylko znak/kropka alertu) | `oklch(50% 0.140 25)` | `oklch(72% 0.100 25)` |
| `--blob-a/-b/-c` (szałwia/róż/niebo) | `oklch(93% 0.035 155)` / `oklch(94% 0.030 15)` / `oklch(93% 0.028 240)` | `oklch(30% 0.040 155)` / `oklch(28% 0.035 15)` / `oklch(28% 0.030 240)` |
| `--blob-opacity` | `.75` | `.55` |
| `--grain-opacity` | `.035` | `.065` |
| `--r-group` `--r-field` `--r-pebble` | `22px` `14px` `999px` |  |
| `--tap` | `44px` |  |
| `--s1…--s9` | `4 8 12 16 24 32 44 56 72 px` |  |
| `--lift` (tylko kamyk i paragon) | `0 1px 1px oklch(23% .02 45/.05), 0 8px 24px -8px oklch(23% .02 45/.20)` | `0 0 0 var(--hair-w) oklch(98% 0 0/.14), 0 16px 40px -16px oklch(0% 0 0/.6)` |
| `--glass-rim` | `inset 0 1px 0 oklch(100% 0 0/.75), inset 0 -1px 0 oklch(23% .02 45/.07)` | `inset 0 1px 0 oklch(100% 0 0/.14)` |
| `--dur` `--ease` | `180ms` `cubic-bezier(.32,.72,0,1)` |  |

Usuwamy: `--card-bg`, `--card-border`, `--card-shadow`, `--input-bg`.

## Układ i rytm

- Jedna kolumna czytania. Telefon: `--gutter: 20px`, grupy sięgają obu marginesów, a **linie separacji są wcięte o 20px od lewej** (jak w iOS) — to daje rytm bez obrysu.
- Tablet: kolumna `min(680px, 100% - 96px)`, wyśrodkowana. Desktop: `grid-template-columns: 232px minmax(0,680px) 1fr` — lewa szyna nawigacji (tekst, bez pigułek), kolumna treści, prawa strona zostaje **pusta** (powietrze jest materiałem, nie miejscem na widżet). Raporty mogą rozszerzyć kolumnę do `900px` tylko dla tabel.
- Nagłówek widoku: duży tytuł 34px w potoku strony (nie w pasku), `padding: 56px 0 8px`. Przy przewinięciu tytuł nie kurczy się layoutem — kopia 17/600 w kamyku pojawia się przez `opacity/transform` (IntersectionObserver na sentinelu).
- Rytm pionowy: sekcja = nagłówek 13px + grupa + `margin-bottom: var(--s8)`. Wiersz = min. 52px na telefonie.
- **Kartą jest tylko**: zdjęcie paragonu (prawdziwy przedmiot) i kamyk nawigacji. **Kartą NIE jest**: formularz wpisu, wpis w Historii, KPI, blok raportu, wiersz importu, filtry, modal ustawień kategorii — to grupy wierszy na papierze.

## Typografia

Jedna rodzina: `-apple-system/SF Pro`. Skala: 64 / 34 / 22 / 17 / 15 / 13 / 11.
- **34/700, tracking −0.03em** — tytuł widoku. Jeden na ekran.
- **17/400** — treść wiersza (opis, nazwa pola). **17/500 tabular** — wartości liczbowe w wierszach.
- **13/600, tracking 0.05em, uppercase, `--ink-3`** — wyłącznie nagłówki grup i nagłówki kolumn tabeli. Kasujemy etykiety per-pole (`DATA`, `TYP`, `KWOTA`, `KTO`) z Historii — kontekst wynika z pozycji.
- **11/500** — podpis pod KPI, stopka wyjaśniająca.
- Bohaterem liczba jest w trzech miejscach: pole kwoty we Wpisie (`clamp(44px, 13vw, 64px)/700, tracking −0.04em`), KPI w Raportach (32/600), saldo konta dziecka (28/600). W ciemnym motywie te wagi spadają o 100 (700→600) — optyczna kompensacja jasnego tekstu na ciemnym.
- Wszędzie liczby: `font-variant-numeric: tabular-nums; font-feature-settings:"tnum" 1,"case" 1;`, format `pl-PL` z twardą spacją grupującą.

## Komponenty

**Powierzchnia / grupa.** Nie ma tła ani obrysu — jest wcięta linia i powietrze. Wariant „zatopiony" (`--paper-sunk`, `--r-group`) rezerwuję dla dwóch rzeczy: edytowanego wiersza w Historii i wiersza importu wymagającego decyzji.
```css
.group{background:none;border:0;box-shadow:none;margin-block:var(--s5)}
.group > .row + .row{box-shadow:inset 0 var(--hair-w) 0 var(--hair)}
.group > .row + .row{background-clip:padding-box}
.row{min-height:52px;display:grid;grid-template-columns:1fr auto;align-items:center;
  gap:var(--s4);padding:var(--s4) var(--gutter);margin-inline:calc(var(--gutter)*-1);
  padding-inline:var(--gutter)}
.group--sunk{background:var(--paper-sunk);border-radius:var(--r-group);padding-block:var(--s2)}
```

**Nawigacja (kamyk).** Telefon: dolna pigułka, 5 pozycji, `backdrop-filter: blur(20px) saturate(1.4)` ustawiony **raz i nigdy nie animowany**; czyta się krawędzią (`--glass-rim`) i cieniem, nie mleczną plamą. Wskaźnik aktywnej pozycji to przesuwana `translate3d` kropka szałwiowa 5px pod ikoną — nigdy glow. Desktop: lewa szyna bez tła, pozycje jako tekst 15/500, aktywna 15/600 `--ink-1` + kropka.
```css
.pebble{position:fixed;inset:auto var(--gutter) max(12px,env(safe-area-inset-bottom));
  height:58px;display:flex;border-radius:var(--r-pebble);
  background:oklch(98% .006 45/.72);backdrop-filter:blur(20px) saturate(1.4);
  box-shadow:var(--lift),var(--glass-rim);will-change:auto}
.pebble a{flex:1;min-width:var(--tap);display:grid;place-items:center;color:var(--ink-2)}
.pebble a[aria-current]{color:var(--ink-1)}
.pebble__dot{position:absolute;bottom:9px;width:5px;height:5px;border-radius:50%;
  background:var(--sage);transition:transform var(--dur) var(--ease)}
```

**Pole formularza.** Zero prostokątów. Wiersz: nazwa po lewej (`--ink-2`), wartość po prawej (`--ink-1`, 17/500), szewron 11px `--ink-3`. Natywny `<select>`/`<input type=date>` leży na wierszu z `opacity:0` i pełną powierzchnią — dostajemy natywne koła iOS i cel 52px bez własnego widgetu. Tekstowe pola (opis) to wiersz z `input` bez ramki i z placeholderem `--ink-3`.
```css
.field{position:relative}
.field select,.field input[type=date]{position:absolute;inset:0;width:100%;height:100%;
  opacity:0;font:inherit;-webkit-appearance:none}
.field:focus-within{background:var(--paper-sunk);border-radius:var(--r-field)}
.field__val{color:var(--ink-1);font-weight:500}
```

**Pole kwoty.** Największy obiekt typograficzny aplikacji, wyrównany do prawej z przyklejonym „zł" 22/500 `--ink-3`. Brak ramki i brak stałej podkreślonej linii; przy fokusie pod polem wjeżdża włos szałwiowy skalowany transformem (bez layoutu).
```css
.amount{display:flex;align-items:baseline;justify-content:flex-end;gap:8px;padding:var(--s6) 0}
.amount input{border:0;background:none;text-align:right;width:100%;color:var(--ink-1);
  font-size:clamp(44px,13vw,64px);font-weight:700;letter-spacing:-.04em;
  font-variant-numeric:tabular-nums;caret-color:var(--sage)}
.amount::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1.5px;
  background:var(--sage);transform:scaleX(0);transform-origin:right;
  transition:transform var(--dur) var(--ease)}
.amount:focus-within::after{transform:scaleX(1)}
```

**Przycisk główny.** Jeden na ekran, szałwiowy kamyk, 52px, pełna szerokość kolumny, `--r-pebble`. Reakcja: `scale(.985)` + minimalne przygaszenie — bez podnoszenia cienia.
```css
.btn{min-height:52px;padding-inline:var(--s6);border:0;border-radius:var(--r-pebble);
  background:var(--sage-fill);color:var(--on-sage);font:600 17px/1 -apple-system,system-ui;
  box-shadow:var(--lift);transition:transform 120ms var(--ease),opacity 120ms}
.btn:active{transform:scale(.985);opacity:.92}
.btn--quiet{background:none;color:var(--sage);box-shadow:none}
```

**Lista Historii.** Telefon: sekcje po dacie (nagłówek 13px sticky, tło `--paper`), wiersz dwuwierszowy: opis 17/400 + podlinijka 13 `--ink-3` „Jedzenie · Fastfood · Szymon"; po prawej kwota 17/500 tabular. **Wydatki nie są czerwone** — mają minus; przychody `--num-in`; transfer dostaje ⇄ 11px w `--ink-3`. Edycja: wiersz zamienia się w `.group--sunk` w miejscu, bez modala; usuwanie przez swipe-in-place (`translateX` kontenera, akcja odsłonięta pod nim), a nie dwa przyciski-koła w każdym wierszu. Desktop: te same wiersze na siatce.
```css
.h-row{grid-template-columns:1fr auto;column-gap:var(--s5)}
.h-row__sub{font-size:13px;color:var(--ink-3);margin-top:2px}
.h-row__amt{font-weight:500;font-variant-numeric:tabular-nums;color:var(--num-out)}
.h-row[data-kind="in"] .h-row__amt{color:var(--num-in)}
@media (min-width:1024px){
  .h-row{grid-template-columns:88px 1fr 200px 132px;align-items:baseline}
  .h-row__sub{margin:0;grid-column:3}
}
```

**KPI.** Bez kafli. Rząd 2–3 pozycji rozdzielonych pionowym włosem, liczba 32/600 nad etykietą 11/500 uppercase. Na telefonie `grid-template-columns: 1fr 1fr` i zawijanie, na desktopie jeden rząd.
```css
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));
  gap:var(--s5) 0;padding-block:var(--s5);box-shadow:inset 0 var(--hair-w) 0 var(--hair)}
.kpi + .kpi{box-shadow:inset var(--hair-w) 0 0 var(--hair);padding-left:var(--s5)}
.kpi b{display:block;font:600 32px/1.05 -apple-system;letter-spacing:-.025em;
  font-variant-numeric:tabular-nums}
.kpi span{font:500 11px/1 -apple-system;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
```

**Słupek kategorii.** Nie pasek w rowku, a linia pod wierszem: nazwa po lewej, kwota po prawej (17/500), pod nimi 3px szyna w kolorze kategorii na torze `--hair`, szerokość przez `--pct`. Bez zaokrągleń większych niż 2px, bez gradientu.
```css
.bar{padding-block:var(--s3)}
.bar__track{height:3px;border-radius:2px;background:var(--hair);margin-top:var(--s2)}
.bar__fill{height:100%;border-radius:2px;background:var(--cat,var(--sage));
  width:calc(var(--pct)*1%)}
```

**Tabela.** Bez zebry, bez pionowych linii, bez ramki zewnętrznej. Nagłówek 11px uppercase `--ink-3` z `--hair-2` pod spodem, wiersze 44px z `--hair`, liczby do prawej, wiersz „Razem" 17/600 z mocniejszą linią górną. Na telefonie `table` przechodzi w te same `.row` (label→wartość) — jedno źródło rytmu.
```css
.t{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.t th{font:600 11px/1 -apple-system;letter-spacing:.06em;text-transform:uppercase;
  color:var(--ink-3);text-align:left;padding:0 0 var(--s3);
  box-shadow:inset 0 -1px 0 var(--hair-2)}
.t td{padding:var(--s4) 0;box-shadow:inset 0 -1px 0 var(--hair)}
.t td:not(:first-child),.t th:not(:first-child){text-align:right}
.t tr.total td{font-weight:600;box-shadow:inset 0 1px 0 var(--hair-2)}
```

**Kolor kategorii na wpisie.** Kolor z Admina wchodzi jako `style="--cat: oklch(...)"` na wierszu i pojawia się w **dwóch** formach: 2×20px zaokrąglona kreska w lewym marginesie wiersza (Historia, Import) oraz 7px kropka przed nazwą (filtry, selecty, legenda). Nigdy jako tło wiersza, nigdy jako kolor tekstu kwoty. Podkategoria dziedziczy kolor rodzica przy `oklch(from var(--cat) l c h / .55)`.
```css
.h-row::before{content:"";position:absolute;left:calc(var(--gutter) - 10px);top:50%;
  width:2px;height:20px;border-radius:1px;background:var(--cat,transparent);
  transform:translateY(-50%)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--cat);flex:none}
```

## Jasny vs ciemny

1. **Elewacja zmienia nośnik**: w jasnym kamyk unosi cień; w ciemnym cień jest niewidoczny, więc podnosi go jaśniejsza powierzchnia + 1px górny rant `oklch(100% 0 0/.14)`. `--lift` ma inną strukturę, nie inną barwę.
2. **Wagi**: hero-liczba i tytuły −100 w ciemnym (700→600, 600→500) — jasny tekst na ciemnym tle optycznie tłuścieje.
3. **Ziarno mocniejsze** (.035 → .065) — ciemne plamy pastelu bez ziarna pokazują banding na OLED.
4. **Plamy tła**: w ciemnym są większe (150% vs 110%), niżej i przy `--blob-opacity: .55`; szałwiowa plama trafia pod dolny kamyk, żeby szkło miało co zniekształcać.
5. **Chroma liczb w dół**: `--num-in`/`--num-neg-mark` tracą ~30% chromy, bo na ciemnym tle sycone barwy „świecą" i psują spokój.
6. **Włos jest jaśniejszy niż tło, ale nie biały** (`.10`), a granice kontrolek podnoszę do `.34` — na ciemnym potrzeba więcej alfy, żeby utrzymać 3:1.

## Czego NIE robimy

- **Nie robimy kart.** Żadnych `border-radius + border + shadow` wokół treści; zwłaszcza karty w karcie (obecny Wpis i Raporty).
- **Nie etykietujemy każdego pola uppercasem.** `DATA / TYP / KWOTA / OPIS / KTO` w każdym wpisie to szum; pozycja i format nośą tę informację.
- **Nie malujemy wydatków na czerwono.** Czerwień zostaje wyłącznie dla znaku ostrzeżenia (ujemny bilans, wiersz importu z konfliktem). Lista 200 wpisów nie może być alarmem.
- **Nie animujemy `backdrop-filter`, `blur`, `width`, `height`, `top`.** Kamyk ma blur ustawiony statycznie; wszystko rusza się przez `transform`/`opacity`.
- **Nie używamy glow, gradientów tęczowych ani koloru jako afordancji przycisku.** Klikalność wynika z wysokości wiersza, szewronu i jednego szałwiowego kamyka.
- **Nie stawiamy dwóch przycisków-kółek w każdym wierszu Historii** ani zebry w tabelach, ani ikon dla kategorii — kolor-kreska wystarcza i jest tańsza wizualnie.

## CSS sygnaturowy

```css
:root{
  --paper:oklch(98.1% .006 45); --paper-sunk:oklch(96.3% .008 45);
  --ink-1:oklch(23% .014 45); --ink-2:oklch(44% .012 45); --ink-3:oklch(53% .010 45);
  --hair:oklch(23% .014 45/.11); --hair-2:oklch(23% .014 45/.20);
  --edge-ctl:oklch(23% .014 45/.34); --hair-w:1px;
  --sage:oklch(46% .062 155); --sage-fill:oklch(44% .064 155); --on-sage:oklch(98% .004 155);
  --num-out:var(--ink-1); --num-in:oklch(44% .070 155);
  --blob-a:oklch(93% .035 155); --blob-b:oklch(94% .030 15); --blob-c:oklch(93% .028 240);
  --blob-opacity:.75; --grain-opacity:.035; --blob-size:110%;
  --gutter:20px; --r-group:22px; --r-field:14px; --r-pebble:999px; --tap:44px;
  --s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:32px;--s8:56px;
  --dur:180ms; --ease:cubic-bezier(.32,.72,0,1);
  --lift:0 1px 1px oklch(23% .02 45/.05), 0 8px 24px -8px oklch(23% .02 45/.20);
  --glass-rim:inset 0 1px 0 oklch(100% 0 0/.75), inset 0 -1px 0 oklch(23% .02 45/.07);
}
:root[data-theme="dark"]{
  --paper:oklch(16.5% .010 50); --paper-sunk:oklch(20.5% .012 50);
  --ink-1:oklch(96% .005 60); --ink-2:oklch(76% .008 60); --ink-3:oklch(64% .010 60);
  --hair:oklch(98% 0 0/.10); --hair-2:oklch(98% 0 0/.18); --edge-ctl:oklch(98% 0 0/.34);
  --sage:oklch(74% .070 155); --sage-fill:oklch(70% .062 155); --on-sage:oklch(16% .020 155);
  --num-in:oklch(76% .060 155);
  --blob-a:oklch(30% .040 155); --blob-b:oklch(28% .035 15); --blob-c:oklch(28% .030 240);
  --blob-opacity:.55; --grain-opacity:.065; --blob-size:150%;
  --lift:0 0 0 var(--hair-w) oklch(98% 0 0/.14), 0 16px 40px -16px oklch(0% 0 0/.6);
  --glass-rim:inset 0 1px 0 oklch(100% 0 0/.14);
}
@media (min-resolution:2dppx){:root{--hair-w:.5px}}

html{background:var(--paper)}
body{margin:0;color:var(--ink-1);font:400 17px/1.35 -apple-system,system-ui,sans-serif;
  letter-spacing:-.011em;-webkit-font-smoothing:antialiased}
/* jeden arkusz: plamy + ziarno, oba nieanimowane i fixed */
body::before,body::after{content:"";position:fixed;inset:-10%;pointer-events:none;z-index:-1}
body::before{opacity:var(--blob-opacity);
  background:
    radial-gradient(var(--blob-size) 60% at 12% -6%, var(--blob-a) 0, transparent 62%),
    radial-gradient(var(--blob-size) 55% at 96% 22%, var(--blob-b) 0, transparent 60%),
    radial-gradient(var(--blob-size) 70% at 30% 104%, var(--blob-c) 0, transparent 66%)}
body::after{opacity:var(--grain-opacity);mix-blend-mode:soft-light;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='g'%3E%3CfeTurbulence baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23g)'/%3E%3C/svg%3E")}

.view{width:min(680px,100%);margin-inline:auto;padding:0 var(--gutter) 132px}
.view > h1{font:700 34px/1.06 -apple-system,system-ui;letter-spacing:-.03em;margin:var(--s8) 0 var(--s2)}
.group-title{font:600 13px/1 -apple-system;letter-spacing:.05em;text-transform:uppercase;
  color:var(--ink-3);position:sticky;top:0;background:var(--paper);padding:var(--s5) 0 var(--s3)}
.row{position:relative;display:grid;grid-template-columns:1fr auto;align-items:center;
  gap:var(--s4);min-height:52px;padding:var(--s4) 0}
.row + .row{box-shadow:inset 0 var(--hair-w) 0 var(--hair)}
.num{font-weight:500;font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1,"case" 1}
@media (prefers-reduced-motion:reduce){*{transition-duration:1ms!important}}
```