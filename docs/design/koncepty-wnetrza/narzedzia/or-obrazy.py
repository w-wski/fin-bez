#!/usr/bin/env python3
"""Wizualizacje trzech konceptów wnętrza: model obrazowy przez OpenRouter.
Wejście: zrzut ekranu logowania (język wizualny) + moja makieta danego konceptu
(układ i hierarchia) + opis kierunku. Wyjście: PNG do prezentacji."""
import base64, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = open(os.path.join(HERE, '.or-key')).read().strip()
OUT = os.path.join(HERE, 'obrazy')
os.makedirs(OUT, exist_ok=True)
MODEL = sys.argv[1] if len(sys.argv) > 1 else 'google/gemini-3-pro-image'

def data_url(path, mime='image/png'):
    with open(path, 'rb') as f:
        return f'data:{mime};base64,' + base64.b64encode(f.read()).decode()

WSPOLNE = """Create a single high-fidelity UI design presentation image (product design
portfolio quality, 4:3 landscape) for a private family-finance iOS app called "Finansowa".

Composition: TWO iPhone 15 Pro screens standing side by side, slightly angled, floating on a
seamless soft studio backdrop that continues the app's own palette (warm powdery off-white with
three huge, very soft pastel blooms: sage green, dusty rose, pale sky). Left phone = LIGHT theme,
right phone = DARK theme. Soft realistic contact shadows, no harsh reflections, no hands, no
desk props, no text labels outside the screens, no watermarks, no browser chrome.

Typography inside the screens: Apple SF Pro only. Numbers are tabular, Polish formatting
(1 234,56 zł). Accent colour is a deep sage green (never blue). Design language taken from the
attached login screen (image 1): calm, generous whitespace, glass read by its EDGE and shadow
rather than milky blur, extreme restraint — no rainbow gradients, no glow, no 3D icons,
no decorative illustration.

Render the screens crisply, pixel-perfect, as if screenshotted from a real shipped app.
Spell all Polish words exactly as given, with correct diacritics."""

KONCEPTY = {
    'A': {
        'nazwa': 'Arkusz i kamyk',
        'ref': 'shots-koncepty/a-historia-light-tel.png',
        'ref2': 'shots-koncepty/a-wpis-dark-tel.png',
        'opis': """CONCEPT A — "Arkusz i kamyk" (Sheet and pebble). Radical calm and reduction.
THE CARD IS ABOLISHED: no boxes, no rounded containers around content. Content sits directly on
one continuous warm paper surface; structure comes only from hairline 0.5px separators (inset from
the left edge, iOS-style) and large amounts of air. The ONLY glass object in the whole interior is
a floating navigation pebble at the bottom of the screen: a translucent horizontal capsule with a
bright rim, a soft drop shadow, five short text labels (Wpis, Historia, Raporty, Paragon, Import)
and one tiny sage dot marking the active tab.

LEFT PHONE (light) shows the "Historia" list view: a very large bold title "Historia" at the top
left, a quiet grey subtitle "Rodzina · lipiec 2026 · 23 wpisy", then date group headers in small
uppercase letter-spaced grey ("25 LIPCA", "24 LIPCA", "23 LIPCA"). Under each header a two-line
transaction row: first line the description in regular 17px ink ("Mcdonalds i śniadanie w trasie",
"Najem od Kamila", "Rata kredytu"), second line smaller grey meta ("Jedzenie › Fastfood · Szymon",
"Dom · Szymon", "⇄ Transfer · Anna"), and on the far right the amount in medium weight tabular
figures ("−51,50 zł", "+3 000,00 zł" in sage green, "1 200,00 zł"). Expenses are NOT red — just a
minus sign in normal ink. Each row has a tiny 2px vertical colour tick in the left margin (dusty
rose for Jedzenie, sage for Dom) — the category colour, nothing more.

RIGHT PHONE (dark) shows the "Nowy wpis" entry form on a deep warm-charcoal paper: the title
"Nowy wpis", a plain text three-way switch (Wydatek / Przychód / Transfer) where only the active
word is bright with a 2px sage underline, then a HUGE right-aligned amount "51,50" with a small
"zł" beside it, and below it label/value rows separated by hairlines: "Księga — Rodzina",
"Data — 25.07.2026", "Kategoria — Jedzenie › Fastfood", "Opis — Mcdonalds…". At the bottom one
full-width sage green pill button "Zapisz". No boxes anywhere.""",
    },
    'B': {
        'nazwa': 'Tafla',
        'ref': 'shots-koncepty/b-wpis-light-tel.png',
        'ref2': 'shots-koncepty/b-historia-dark-tel.png',
        'opis': """CONCEPT B — "Tafla" (The pane). Material and layers. The interior feels like a
physical object: background, then ONE big working glass pane per view (32px radius, translucent,
a bright 1px top edge catching light, a wide soft shadow beneath, and a faint specular sheen in the
upper half), and on that pane smaller "pebbles" — fields, segmented control, KPI lenses. Depth
comes from edges, shadows and layer order, never from animated blur.

LEFT PHONE (light) shows "Nowy wpis": a floating glass capsule navigation bar at the very top with
the active tab "Wpis" as a filled deep-sage pebble; below it a big tight title "Nowy wpis" and grey
subtitle "Rodzina · 25 lipca 2026"; then the large glass pane containing: a segmented control
(Wydatek / Przychód / Transfer) as a recessed glass well with the active segment raised as a light
pebble; a centred enormous amount "51,50" with a tiny letter-spaced uppercase caption "ZŁOTYCH"
under it and a thin hairline beneath; four glass field wells, each with a small uppercase grey key
on the left and its value on the right ("KSIĘGA — Rodzina", "DATA — 25.07.2026",
"KATEGORIA — Jedzenie › Fastfood", "OPIS — Mcdonalds i śniadanie…"); finally a tall deep-sage pill
button "Zapisz wpis" with a soft coloured shadow.

RIGHT PHONE (dark) shows "Historia" on a deep mineral navy-charcoal: same glass capsule nav with
"Historia" active in sage, big title "Historia", and a stack of four separate raised glass cards.
Each card has a 4px rounded vertical vein of the category colour on its left inner edge (dusty rose,
sage), a small grey category line on top left ("Jedzenie › Fastfood", "Dom", "⇄ Transfer",
"Dom › Media"), the amount top right in heavy tight figures ("−51,50 zł", "+3 000,00 zł" in mint
green, "1 200,00 zł", "−246,13 zł"), the description below ("Mcdonalds i śniadanie w trasie",
"Najem od Kamila", "Rata kredytu", "Prąd — wyrównanie za czerwiec") and a tiny grey meta line
("25.07 · Szymon"). One card carries a small outlined chip "Z BANKU".""",
    },
    'C': {
        'nazwa': 'Redakcja szklana',
        'ref': 'shots-koncepty/c-raporty-light-tel.png',
        'ref2': 'shots-koncepty/c-historia-dark-tel.png',
        'opis': """CONCEPT C — "Redakcja szklana" (Glass editorial). A well-set financial magazine.
Extreme typographic hierarchy: numbers are the illustration. Glass is made ONLY of edge light
(a bright 1px top border, a dark 1px bottom border) — absolutely no drop shadows, no blur.
No boxes around data; sections are divided by hairlines and by scale contrast alone.

LEFT PHONE (light) shows "Raporty": a small pill tab bar at the top (Wpis / Historia / Raporty /
Paragon) where the active tab is filled with the opaque page colour; then a tiny uppercase
letter-spaced kicker "RODZINA · LIPIEC 2026", a one-sentence editorial lede in grey
("Miesiąc zamknął się nadwyżką — trzeci raz z rzędu."), a full-width hairline, then the hero figure:
gigantic tight-tracked "1 968,37" with a small uppercase caption "BILANS MIESIĄCA", and beneath it
two smaller figures "6 200,00 / PRZYCHODY" and "4 231,63 / WYDATKI". Then a section label
"WYDATKI WG KATEGORII" above three rows: category name on the left, amount bold on the right
("Jedzenie — 1 650,00 zł", "Dom › Media — 980,13 zł", "Transport — 601,50 zł"), each with a thin
6px fully-rounded bar underneath in the category colour (dusty rose, sage, sage).

RIGHT PHONE (dark) shows "Historia" on deep matte onyx: the same pill tabs, kicker
"RODZINA · LIPIEC 2026", lede "23 wpisy · 4 231,63 zł wydatków", then a continuous editorial stream
with small uppercase sticky date headers ("PIĄTEK, 25 LIPCA", "CZWARTEK, 24 LIPCA",
"ŚRODA, 23 LIPCA"). Each entry is a three-column row: a 10px round dot in the category colour,
then two lines of text (title "Mcdonalds i śniadanie w trasie" / "Najem od Kamila" /
"Rata kredytu" and grey meta "Jedzenie › Fastfood · Szymon"), then a large heavy right-aligned
amount ("−51,50 zł", "+3 000,00 zł" in mint, "1 200,00 zł"). Rows separated by hairlines only.""",
    },
}


def rysuj(litera):
    k = KONCEPTY[litera]
    content = [
        {'type': 'text', 'text': WSPOLNE + '\n\n' + k['opis']
         + '\n\nATTACHED: image 1 = the app\'s login screen (the visual language to honour).'
           ' Images 2-3 = wireframe mockups of THIS concept (light and dark) — follow their layout,'
           ' hierarchy and content faithfully, but render them beautifully and pixel-crisp.'},
        {'type': 'image_url', 'image_url': {'url': data_url(os.path.join(HERE, 'ref-or/login-faza2-light-mobile.jpg'), 'image/jpeg')}},
        {'type': 'image_url', 'image_url': {'url': data_url(os.path.join(HERE, k['ref']))}},
        {'type': 'image_url', 'image_url': {'url': data_url(os.path.join(HERE, k['ref2']))}},
    ]
    body = json.dumps({
        'model': MODEL,
        'messages': [{'role': 'user', 'content': content}],
        'modalities': ['image', 'text'],
    }).encode()
    req = urllib.request.Request(
        'https://openrouter.ai/api/v1/chat/completions', data=body,
        headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json',
                 'HTTP-Referer': 'https://finanse.bezprzemocowo.pl', 'X-Title': 'finansowa-obrazy'})
    with urllib.request.urlopen(req, timeout=900) as r:
        d = json.load(r)
    msg = d['choices'][0]['message']
    zapisane = []
    for i, im in enumerate(msg.get('images') or []):
        url = im.get('image_url', {}).get('url', '') if isinstance(im, dict) else ''
        if not url.startswith('data:'):
            continue
        surowe = base64.b64decode(url.split(',', 1)[1])
        p = os.path.join(OUT, f'koncept-{litera}-{MODEL.split("/")[-1]}{"" if i == 0 else "-" + str(i)}.png')
        with open(p, 'wb') as f:
            f.write(surowe)
        zapisane.append(p)
    koszt = (d.get('usage') or {}).get('cost')
    return litera, k['nazwa'], zapisane, koszt, (msg.get('content') or '')[:160]


with ThreadPoolExecutor(max_workers=3) as ex:
    for litera, nazwa, pliki, koszt, txt in ex.map(rysuj, ['A', 'B', 'C']):
        print(f'{litera} ({nazwa}): {pliki} · koszt={koszt} · {txt!r}')
