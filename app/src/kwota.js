// JEDNO miejsce, w którym aplikacja zamienia napis na kwotę. Wersja przeglądarkowa
// (public/js/kwota.js) musi mieć IDENTYCZNE ciało funkcji — pilnuje tego scripts/test-kwota.js.
//
// Kwota bywa wpisana ręcznie albo przeklejona z arkusza/bankowości: „1 234,56", „1.234,56",
// „1234.56", „1234 zł", liczba. Ostatnia grupa 1–2 cyfr to grosze, grupy trzycyfrowe to tysiące.
// Zwraca liczbę nieujemną albo null, gdy zapisu NIE DA SIĘ odczytać jednoznacznie: w księdze
// rachunkowej cicha pomyłka (parseFloat('1 234,56') = 1) jest gorsza niż odmowa zapisu.
function parseKwota(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.abs(v) : null;
  const s = String(v === null || v === undefined ? '' : v)
    .replace(/\s/g, '')                          // \s obejmuje też spację nierozdzielającą (tak kopiuje się z arkusza)
    .replace(/^[+-]/, '')                        // znak wynika z `type`, nie z kwoty
    .replace(/(zł|zl|pln)$/i, '');
  if (!/^\d+([.,]\d+)*$/.test(s)) return null;
  const g = s.split(/[.,]/);
  const sep = s.match(/[.,]/g) || [];
  // poprawne grupowanie tysięcy: pierwsza grupa 1–3 cyfry, każda następna dokładnie 3
  const tysiace = (cz) => cz.length === 1 || (cz[0].length <= 3 && cz.slice(1).every((x) => x.length === 3));
  const ostatnia = g[g.length - 1];
  if (g.length > 1 && ostatnia.length <= 2) {
    return tysiace(g.slice(0, -1)) ? Number(g.slice(0, -1).join('') + '.' + ostatnia) : null;
  }
  // Ostatnia grupa ma 3 cyfry. To tysiące tylko przy kropce („1.234" = 1234). Przecinek
  // w polskim zapisie oznacza część dziesiętną, więc „12,345" jest niejednoznaczne
  // (12,345 zł czy 12 345 zł?) — odmawiamy zamiast zgadywać o trzy rzędy wielkości.
  if (g.length > 1 && sep[sep.length - 1] === ',') return null;
  return tysiace(g) ? Number(g.join('')) : null;
}

module.exports = { parseKwota };
