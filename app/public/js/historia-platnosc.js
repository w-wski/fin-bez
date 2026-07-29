// Forma płatności w edycji Historii (Z6) — wydzielone z historia.js, żeby zmieścić się
// w limicie 300 linii. TRANSFER nie jest płatnością (K6b, ta sama reguła żyje też na serwerze
// w src/platnosc.js) — tu tylko odzwierciedlamy to w UI, nie duplikujemy walidacji.
import { el } from './core.js';

// Trójstanowy select: „—" tylko wyświetla NULL, nie da się go wybrać z powrotem (patrz
// zmienionaPlatnosc niżej i API — raz ustawionej wartości nie czyścimy). Dla TRANSFER pole
// w ogóle się nie pokazuje (null) — przesunięcie między własnymi kontami nie jest zapłatą.
export function selectPlatnosci(r) {
  if (r.type === 'TRANSFER') return null;
  const sel = el('select', { title: 'Forma płatności' });
  if (r.payment_method == null) sel.append(el('option', { value: '', disabled: 'disabled' }, '—'));
  sel.append(el('option', { value: 'ELEKTRONICZNA' }, 'Elektronicznie'), el('option', { value: 'GOTÓWKA' }, 'Gotówka'));
  sel.value = r.payment_method || '';
  return sel;
}

// Wartość do wysłania w PATCH-u albo undefined, gdy pole nie zmieniło się (albo go nie ma —
// select null przy TRANSFER, albo stoi na „—" nietkniętej, jedynej opcji disabled).
export function zmienionaPlatnosc(r, platnoscSel) {
  if (!platnoscSel || !platnoscSel.value) return undefined;
  return platnoscSel.value !== (r.payment_method || '') ? platnoscSel.value : undefined;
}
