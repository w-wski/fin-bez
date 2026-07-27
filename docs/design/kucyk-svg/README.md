# Kucyk WEKTOROWY (SVG) — wersja odłożona 2026-07-27

Tu leży komplet planszy powitalnej w wersji SVG, czyli **stan przed przejściem na pixel
art**. Zachowany na wyraźne życzenie Szymona („zachowaj to gdzieś z boku") — nie po to,
żeby go rozwijać, tylko żeby nie zginął, gdyby kiedyś trzeba było do niego wrócić.

| plik | co to było |
|---|---|
| `witaj-kucyk.svg.js` | kucyk jako SVG: warianty A/B/C, uchwyty `.w-tail`, `.w-leg`, `OS` (transform-origin) |
| `witaj.svg.js` | reżyseria 6,2 s: ogon w górę → jedna chmura z zadu → napis → ogon w dół → uśmiech → wybieg |
| `witaj-konfetti.svg.js` | konfetti jako OKRĄGŁE kropki, JEDNO źródło (zad) |

To **nie jest kod produkcyjny** i nie jest importowany. Rozszerzenie `.svg.js` jest celowe:
plik nie da się pomylić z modułem z `app/public/`. Leży w `docs/`, poza zasięgiem bramki
preflight (limit 300 linii na plik `.js` w `app/`).

Wersja żywa: `app/public/witaj-kucyk.js` (pixel art, dylatowany kontur, tęcza pasmami),
`app/public/witaj.js` (reżyseria ~8,3 s, dwie chmury: zad → lewa połowa napisu,
pysk → prawa). Wcześniejsze trzy propozycje wektorowe: `docs/design/kucyki/`.
