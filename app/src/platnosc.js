// Walidacja formy płatności (Z6) — moduł bezstanowy, żeby dało się go przetestować bez
// bazy i bez Express-a (wzorzec categories.js: flaga()/liczba() też siedzą osobno od routera).
// transactions.js UŻYWA tych funkcji, nie duplikuje ich logiki.

// Tylko dwie wartości albo brak pola — nic pomiędzy. Śmieć (literówka, "gotowka" bez ogonków,
// pusty napis, NULL) daje `null`, a NIE ciche zapisanie domyślnej — jawny błąd jest lepszy
// niż milczące odrzucenie tego, co użytkownik naprawdę miał na myśli.
const PLATNOSCI = ['ELEKTRONICZNA', 'GOTÓWKA'];
function platnosc(v) {
  if (v === undefined) return undefined;     // pole nieobecne — wywołujący decyduje o domyślnej
  return PLATNOSCI.includes(v) ? v : null;   // każda inna wartość (w tym null, '', liczby) = błąd
}

// POST: forma płatności ma sens WYŁĄCZNIE przy WYDATEK/PRZYCHÓD. TRANSFER to przesunięcie
// własnych pieniędzy między kontami tej samej księgi — nie jest zapłatą za nic, więc jawnie
// podana wartość jest błędem (użytkownik/klient pomylił pola), a milcząca wartość to zawsze NULL,
// nigdy domyślna ELEKTRONICZNA (żeby raport „ile zapłacono gotówką" nie liczył transferów).
function domyslnaPlatnosc(body) {
  const pm = platnosc(body.payment_method);
  if (pm === null) return { error: 'bad_payment_method' };
  if (body.type === 'TRANSFER') {
    if (pm !== undefined) return { error: 'payment_method_not_applicable' };
    return { value: null };
  }
  return { value: pm === undefined ? 'ELEKTRONICZNA' : pm };
}

// PATCH: zmiana dozwolona WYŁĄCZNIE między dwiema wartościami — raz ustalonej wiedzy nie
// czyścimy na NULL (migracja 015). `typWpisu` to typ PO ewentualnej zmianie w tym samym PATCH-u
// (nowy typ z body, jeśli podany, inaczej typ z bazy) — TRANSFER odrzuca payment_method zawsze,
// niezależnie czy wpis już był transferem, czy dopiero się nim staje w tym żądaniu.
function platnoscDoPatcha(body, typWpisu) {
  if (body.payment_method === undefined) return { touched: false };
  if (typWpisu === 'TRANSFER') return { error: 'payment_method_not_applicable' };
  const pm = platnosc(body.payment_method);
  if (!pm) return { error: 'bad_payment_method' };   // null (śmieć) i próba wyczyszczenia = błąd
  return { touched: true, value: pm };
}

module.exports = { PLATNOSCI, platnosc, domyslnaPlatnosc, platnoscDoPatcha };
