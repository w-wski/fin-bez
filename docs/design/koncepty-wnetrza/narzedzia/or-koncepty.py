#!/usr/bin/env python3
"""Trzy koncepty wnętrza „finansowej" z trzech różnych modeli przez OpenRouter.
Referencje: zrzuty ekranu logowania (cel) + obecne wnętrze (punkt wyjścia)."""
import base64, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = open(os.path.join(HERE, '.or-key')).read().strip()
REF = os.path.join(HERE, 'ref-or')
OUT = os.path.join(HERE, 'koncepty')
os.makedirs(OUT, exist_ok=True)

def img(name):
    with open(os.path.join(REF, name), 'rb') as f:
        return 'data:image/jpeg;base64,' + base64.b64encode(f.read()).decode()

BRIEF = """Jesteś dyrektorem artystycznym specjalizującym się w interfejsach klasy Apple.
Projektujesz WNĘTRZE (po zalogowaniu) prywatnej aplikacji finansowej „Finansowa" —
pieniądze jednej polskiej rodziny i jej małej spółki. Używa jej codziennie 2-4 osoby,
głównie na iPhonie, czasem na iPadzie i desktopie. To nie SaaS dla tysięcy — to
narzędzie domowe, ma być piękne i spokojne jak dobry przedmiot, nie „dashboard".

## Referencja: ekran logowania (ZAŁĄCZONE OBRAZY 1-2)
Obraz 1 to nasz ekran startowy — jest udany i wyznacza język wizualny całości.
Obraz 2 to klatka z animacji: szklana soczewka („kamyk") sunie w górę i zniekształca
napis pod sobą. Cechy tego języka: ciepła pudrowa biel z trzema wielkimi, miękkimi
plamami pastelu (szałwia / róż / niebo) i ledwo wyczuwalnym ziarnem; jeden krój —
SF Pro, tytuły semibold/bold z ciasnym trackingiem; szkło czytane KRAWĘDZIĄ i cieniem,
nie mleczną papką; akcent = głęboka szałwia (nie niebieski); ogromna ilość powietrza;
wstrzemięźliwość — zero gradientowych tęcz, zero glow jako afordancji.

## Punkt wyjścia: obecne wnętrze (ZAŁĄCZONE OBRAZY 3-5)
Obraz 3: karta „Wpis" (telefon, jasny) — segment typu, wielka kwota, selecty, „Zapisz".
Obraz 4: „Historia" (telefon, jasny) — każdy wpis jako karta z etykietami pól.
Obraz 5: „Raporty" (desktop, ciemny) — KPI, słupki wg kategorii, tabele.
Wnętrze jest POPRAWNE, ale bezpieczne i „webowe" — brakuje mu charakteru ekranu
logowania i designerskiej ręki. Właściciel powiedział wprost: „musi wewnątrz być
bardziej designerskie".

## Widoki, które trzeba obsłużyć
Wpis (formularz: typ, kwota, księga, data, kategoria+podkategoria, opis) · Historia
(lista wpisów z filtrami, edycja w miejscu, Kosz) · Paragon (zdjęcie + pozycje) ·
Import (CSV z banku, wiersze do uzgodnienia) · Raporty (KPI, wydatki wg kategorii,
trend 6 miesięcy, konto dziecka, najem, rodzina vs spółka, telemetria) · Przydział
i Admin (kategorie, kolory, osoby).

## Twarde ograniczenia techniczne (NIE do negocjacji)
- Czysty CSS w plikach, ZERO buildu, zero Tailwinda, zero frameworka JS. Vanilla ES modules.
- Wszystkie wartości przez custom properties (design tokens) w styles.css; OKLCH.
- Motyw jasny I ciemny — osobne scen (ciemny to nie przyciemniony jasny).
- Mobile-first (telefon), tablet drugi, desktop trzeci.
- Wydajność na iPhonie jest święta: NIE animujemy backdrop-filter ani blur na dużych
  powierzchniach; nie animujemy layoutu; tylko transform/opacity.
- Kontrast WCAG AA dla tekstu i granic kontrolek; cele dotyku >= 44 px.
- Kategorie mają własne kolory (nadawane w Adminie) i muszą wyróżniać wpisy.
- Liczby: tabular-nums, polski format (1 234,56 zł).

## Twoje zadanie
Zaproponuj JEDEN spójny, wyrazisty kierunek wizualny wnętrza, wyprowadzony z języka
ekranu logowania, o priorytecie podanym niżej. NIE opisuj wariantów ani alternatyw —
jedna decyzja, obroniona. Bądź konkretny do poziomu wartości i selektorów; unikaj
ogólników w rodzaju „nowoczesny, czysty design". Nie proponuj bibliotek.

Odpowiedz po polsku, w Markdownie, dokładnie w tej strukturze:
1. `# Nazwa konceptu` — jedno-dwa słowa + jedno zdanie idei.
2. `## Zasada organizująca` — 3-5 zdań: co jest tu nowego wobec obecnego wnętrza i
   dlaczego wynika to z ekranu logowania.
3. `## Tokeny` — konkretne zmiany/nowe tokeny (nazwa: wartość dla jasnego i ciemnego).
4. `## Układ i rytm` — siatka, szerokości, odstępy, nagłówki widoków, co jest kartą
   i co nią NIE jest.
5. `## Typografia` — jak używasz skali, wagi, tracking; gdzie liczby są bohaterem.
6. `## Komponenty` — po 2-4 zdania i kluczowe deklaracje CSS dla: powierzchnia/karta,
   nawigacja, pole formularza, pole kwoty, przycisk główny, lista Historii (telefon i
   desktop), KPI, słupek kategorii, tabela, kolor kategorii na wpisie.
7. `## Jasny vs ciemny` — co się różni poza zamianą barw.
8. `## Czego NIE robimy` — 4-6 pułapek, które ten kierunek świadomie odrzuca.
9. `## CSS sygnaturowy` — 25-50 linii gotowego CSS oddającego charakter kierunku.
"""

PRIORYTETY = {
    'A': """PRIORYTET DLA CIEBIE: SPOKÓJ I REDUKCJA. Wnętrze ma być tak ciche, że
    liczby same wychodzą na pierwszy plan. Myśl: iOS Ustawienia i Apple Wallet —
    grupowane listy, włoskowate separatory, minimum obrysów, powietrze jako główny
    materiał. Kwestionuj samą kartę jako pojemnik.""",
    'B': """PRIORYTET DLA CIEBIE: MATERIAŁ. Wnieś do wnętrza fizykę szkła z ekranu
    logowania — kamyk, tafla, krawędź łapiąca światło, głębia warstw. Ma się czuć jak
    przedmiot, nie jak strona. Ale bez animowanych rozmyć: głębia z krawędzi, cieni
    i kolejności warstw.""",
    'C': """PRIORYTET DLA CIEBIE: REDAKCJA I DANE. Wnętrze jako dobrze złożony
    magazyn finansowy: mocna hierarchia typograficzna, liczby jako materiał
    ilustracyjny, wykresy i kwoty komponowane jak plansze w albumie. Kolor kategorii
    jest tu narzędziem redakcyjnym.""",
}

MODELE = {
    'A': 'anthropic/claude-opus-5',
    'B': 'openai/gpt-5.5',
    'C': 'google/gemini-3.1-pro-preview',
}

IMGS = ['login-faza2-light-mobile.jpg', 'klatka-p058-mobile.jpg',
        'wpis-light-mobile.jpg', 'historia-light-mobile.jpg', 'raporty-dark-desktop.jpg']


def zapytaj(litera):
    model = MODELE[litera]
    content = [{'type': 'text', 'text': BRIEF + '\n\n' + PRIORYTETY[litera]}]
    for n in IMGS:
        content.append({'type': 'image_url', 'image_url': {'url': img(n)}})
    body = json.dumps({
        'model': model,
        'messages': [{'role': 'user', 'content': content}],
        'max_tokens': 13000,
        'temperature': 0.8,
    }).encode()
    req = urllib.request.Request(
        'https://openrouter.ai/api/v1/chat/completions', data=body,
        headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json',
                 'HTTP-Referer': 'https://finanse.bezprzemocowo.pl', 'X-Title': 'finansowa-koncepty'})
    with urllib.request.urlopen(req, timeout=600) as r:
        d = json.load(r)
    txt = d['choices'][0]['message']['content']
    u = d.get('usage', {})
    path = os.path.join(OUT, f'koncept-{litera}.md')
    with open(path, 'w') as f:
        f.write(f'<!-- model: {model} · tokeny: {u} -->\n\n' + txt)
    return litera, model, u, len(txt), path


with ThreadPoolExecutor(max_workers=3) as ex:
    for litera, model, u, n, path in ex.map(zapytaj, ['A']):
        print(f'{litera}: {model} · {n} znaków · usage={u} · {path}')
