// Runner testów: odpala KAŻDY scripts/test-*.js (alfabetycznie) + preflight na końcu.
// Powód (sprint 2026-07-30): łańcuch `a && b && c` w package.json był plikiem wspólnym —
// każde zlecenie dopisujące test musiałoby go edytować, czyli konflikt. Teraz nowy test
// wystarczy położyć w scripts/ — wpina się sam. Świadomy koszt: NIE da się „zapomnieć"
// wpiąć testu, ale też nie da się go celowo wyłączyć inaczej niż kasując plik (i dobrze).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const testy = fs.readdirSync(dir).filter((f) => /^test-.*\.js$/.test(f)).sort();
for (const t of [...testy, 'preflight.js']) {
  execFileSync(process.execPath, [path.join(dir, t)], { stdio: 'inherit' });
}
console.log(`\nRUNNER OK — ${testy.length} plików testowych + preflight`);
