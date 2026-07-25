// Rusztowanie Z5 (odtworzone): main.js importuje ten moduł, a plik zaginął przy
// scalaniu — bez niego cały graf importów frontendu umierał na starcie.
// Kontrakt (docs/zlecenia/Z5-przydzial.md): initPrzydzial rejestruje
// refreshers.przydzial, kontener to #przydzialBox. Logikę wypełni budowniczy Z5.
import { $, el, api, refreshers } from './core.js';

async function render() {
  const box = $('#przydzialBox');
  box.innerHTML = '';
  try {
    const dane = await api('/api/v1/proposals');
    if (!dane.groups?.length) {
      box.append(el('p', { class: 'msg' }, 'Brak propozycji do przyjęcia — wszystko przydzielone.'));
      return;
    }
    // Grupy renderuje implementacja Z5; szkielet pokazuje tylko licznik.
    box.append(el('p', { class: 'msg' }, `Propozycje: ${dane.groups.length} grup — widok w budowie (Z5).`));
  } catch {
    box.append(el('p', { class: 'msg err' }, 'Nie udało się pobrać propozycji (tylko administrator).'));
  }
}

export function initPrzydzial() { refreshers.przydzial = render; }
