// Jedyne źródło prawdy o tym, co jest „żywe" po wprowadzeniu archiwizacji (022, audyt
// 2026-07-30): paragony i importy z deleted_at NIE ISTNIEJĄ dla odczytów — list, raportów,
// analiz, RO-API, koszyka produktów. Każde zapytanie o receipts/bank_imports dokleja tę
// klauzulę przez funkcje niżej, NIGDY własny warunek (rozjazd filtrów w 5 miejscach to
// dokładnie ten błąd, którego unikamy — wzorzec jak scopeWhere() w routes/transactions.js).
//
// alias — prefiks tabeli w zapytaniu ('r', 'bi', '' gdy bez aliasu).
function zywyWarunek(alias) {
  const p = alias ? `${alias}.` : '';
  return `${p}deleted_at IS NULL`;
}

const zywyParagon = (alias = 'r') => zywyWarunek(alias);
const zywyImport = (alias = 'bi') => zywyWarunek(alias);

module.exports = { zywyParagon, zywyImport };
