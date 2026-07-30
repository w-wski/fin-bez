// admin-dostep.js — panel Admin „Dostęp" (Z12): wyłączniki modalności, rejestr dostępu,
// telemetria wychodząca. Wołane z admin.js: initAdminDostep(kontener) buduje szkielet RAZ
// i zwraca async funkcję odświeżenia — kontener MUSI być osobnym elementem niż #adminBox,
// bo admin.js czyści #adminBox (innerHTML='') przy każdym odświeżeniu drzewa kategorii;
// gdyby ten panel siedział tam, znikałby przy każdej zmianie koloru/nazwy kategorii.
// Reużywa wyłącznie klasy globalne (styles.css/raporty.css) — ten plik nie ma WŁASNEGO
// arkusza CSS (nie ma go na liście zlecenia), więc trzyma się tego, co już jest wczytane.
import { el, api, toast } from './core.js';

const OPISY_MODALNOSCI = {
  ro_api: 'API tylko do odczytu (Claude, dashboard)',
  eksport_csv: 'Eksport CSV',
  model_zewnetrzny: 'Model zewnętrzny (narracja w Analizach)',
};

const opisBledu = (err) => (err instanceof TypeError || !navigator.onLine)
  ? 'brak połączenia z internetem'
  : (err?.data?.error || err?.message || 'błąd');

async function rysujWylaczniki(box) {
  box.innerHTML = '';
  let modalnosci;
  try { ({ modalnosci } = await api('/api/v1/dostep/modalnosci')); }
  catch (err) { box.append(el('p', { class: 'msg err' }, 'Nie udało się wczytać: ' + opisBledu(err))); return; }
  const lista = el('div', { class: 'stack' });
  for (const m of modalnosci) {
    const wiersz = el('label', { class: 'row' });
    const pole = el('input', { type: 'checkbox' });
    pole.checked = !!m.wlaczona;
    pole.onchange = async () => {
      const wlacz = pole.checked;
      pole.disabled = true;
      try {
        await api('/api/v1/dostep/modalnosci', {
          method: 'PATCH', body: JSON.stringify({ klucz: m.klucz, wlaczona: wlacz }),
        });
        toast('Zapisano.');
      } catch (err) { pole.checked = !wlacz; toast('Nie zapisano: ' + opisBledu(err)); }
      pole.disabled = false;
    };
    wiersz.append(pole, el('span', {}, OPISY_MODALNOSCI[m.klucz] || m.klucz));
    lista.append(wiersz);
  }
  box.append(lista);
  box.append(el('p', { class: 'msg' }, 'Domyślnie wszystko wyłączone — dane nie wychodzą, dopóki świadomie nie włączysz modalności.'));
}

// Pole z sekretem: pokazane RAZ, z przyciskiem kopiowania i wyraźnym ostrzeżeniem.
function polSekretu(token) {
  const box = el('div', { class: 'stack' });
  const wiersz = el('div', { class: 'row' });
  const pole = el('input', { type: 'text', readonly: 'readonly', value: token });
  const kopiuj = el('button', { class: 'btn small', type: 'button' }, 'Kopiuj');
  kopiuj.onclick = () => {
    navigator.clipboard?.writeText(token)
      .then(() => toast('Skopiowano.'))
      .catch(() => toast('Nie udało się skopiować — zaznacz pole i skopiuj ręcznie.'));
  };
  wiersz.append(pole, kopiuj);
  box.append(wiersz, el('p', { class: 'msg err' },
    'Ten sekret NIE wyświetli się drugi raz — baza trzyma wyłącznie jego hash. Zapisz go teraz.'));
  return box;
}

async function rysujTokeny(box) {
  box.innerHTML = '';
  const formularz = el('div', { class: 'row wrap' });
  const nazwa = el('input', { type: 'text', maxlength: '64', placeholder: 'nazwa (np. „claude”)' });
  const wydaj = el('button', { class: 'btn', type: 'button' }, 'Wydaj token');
  const sekretBox = el('div');
  const listaBox = el('div');
  wydaj.onclick = async () => {
    const n = nazwa.value.trim();
    if (!n) { toast('Podaj nazwę tokenu.'); return; }
    wydaj.disabled = true;
    try {
      const r = await api('/api/v1/dostep/tokeny', { method: 'POST', body: JSON.stringify({ name: n }) });
      sekretBox.innerHTML = '';
      sekretBox.append(polSekretu(r.token));
      nazwa.value = '';
      await rysujListeTokenow(listaBox);
    } catch (err) { toast('Nie wydano tokenu: ' + opisBledu(err)); }
    wydaj.disabled = false;
  };
  formularz.append(nazwa, wydaj);
  box.append(formularz, sekretBox, listaBox);
  await rysujListeTokenow(listaBox);
}

async function rysujListeTokenow(box) {
  box.innerHTML = '';
  let items;
  try { ({ items } = await api('/api/v1/dostep/tokeny')); }
  catch (err) { box.append(el('p', { class: 'msg err' }, 'Nie udało się wczytać listy: ' + opisBledu(err))); return; }
  if (!items.length) { box.append(el('p', { class: 'msg' }, 'Brak wydanych tokenów.')); return; }
  const t = el('table');
  t.innerHTML = '<thead><tr><th>Nazwa</th><th>Wydany</th><th>Ostatnio użyty</th><th>Stan</th><th></th></tr></thead>';
  const tb = el('tbody');
  for (const it of items) {
    const tr = el('tr');
    const stan = it.revoked_at ? 'unieważniony' : 'aktywny';
    tr.append(el('td', {}, it.name), el('td', {}, it.created_at || '—'),
      el('td', {}, it.last_used_at || 'nigdy'), el('td', {}, stan));
    const akcja = el('td');
    if (!it.revoked_at) {
      const btn = el('button', { class: 'btn small', type: 'button' }, 'Unieważnij');
      btn.onclick = async () => {
        if (!confirm(`Unieważnić token „${it.name}"? Tego się nie cofnie.`)) return;
        try { await api(`/api/v1/dostep/tokeny/${it.id}`, { method: 'DELETE' }); await rysujListeTokenow(box); }
        catch (err) { toast('Nie unieważniono: ' + opisBledu(err)); }
      };
      akcja.append(btn);
    }
    tr.append(akcja);
    tb.append(tr);
  }
  t.append(tb);
  const w = el('div', { class: 'overflow' }); w.append(t); box.append(w);
}

// Tabelka wspólna dla rejestru dostępu i telemetrii wychodzącej — te same kolumny wzorca,
// różne pola danych (nazwane wprost, nie generycznie — czytelniej dla admina niż JSON.stringify).
function tabelaProsta(headers, rows) {
  const t = el('table');
  t.innerHTML = '<thead><tr>' + headers.map((h) => `<th>${h}</th>`).join('') + '</tr></thead>';
  const tb = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    r.forEach((v) => tr.append(el('td', {}, v === null || v === undefined ? '—' : String(v))));
    tb.append(tr);
  }
  t.append(tb);
  const w = el('div', { class: 'overflow' }); w.append(t); return w;
}

async function rysujRejestr(box) {
  box.innerHTML = '';
  try {
    const { items } = await api('/api/v1/dostep/rejestr');
    if (!items.length) { box.append(el('p', { class: 'msg' }, 'Rejestr jest pusty.')); return; }
    box.append(tabelaProsta(['Kanał', 'Endpoint', 'Okres', 'Wierszy', 'Kiedy'],
      items.map((r) => [r.kanal, r.endpoint, r.okres, r.wierszy, r.created_at])));
  } catch (err) { box.append(el('p', { class: 'msg err' }, 'Nie udało się wczytać: ' + opisBledu(err))); }
}

async function rysujWyjscia(box) {
  box.innerHTML = '';
  try {
    const { items } = await api('/api/v1/dostep/wyjscia');
    if (!items.length) { box.append(el('p', { class: 'msg' }, 'Rejestr jest pusty — nic jeszcze nie wyszło.')); return; }
    box.append(tabelaProsta(['Narzędzie', 'Cel', 'Zapytań', 'Znaków', 'Kiedy'],
      items.map((r) => [r.narzedzie, r.cel, r.zapytan, r.znakow_wyslanych, r.created_at])));
  } catch (err) { box.append(el('p', { class: 'msg err' }, 'Nie udało się wczytać: ' + opisBledu(err))); }
}

/** Buduje szkielet RAZ do `kontener` i zwraca async funkcję odświeżenia treści trzech
 *  sekcji — wołający (admin.js) decyduje, KIEDY odświeżać (przy otwarciu karty Admin),
 *  ten moduł się o to sam nie stara (żadnego fetchu przy samym imporcie/wywołaniu). */
export function initAdminDostep(kontener) {
  kontener.innerHTML = '';
  const sWylaczniki = el('div'), sTokeny = el('div'), sRejestr = el('div'), sWyjscia = el('div');
  kontener.append(
    el('h2', {}, 'Wyłączniki modalności'), sWylaczniki,
    el('h2', {}, 'Tokeny dostępu'), sTokeny,
    el('h2', {}, 'Rejestr dostępu'), sRejestr,
    el('h2', {}, 'Telemetria wychodząca'), sWyjscia,
  );
  return async () => {
    await rysujWylaczniki(sWylaczniki);
    await rysujTokeny(sTokeny);
    await rysujRejestr(sRejestr);
    await rysujWyjscia(sWyjscia);
  };
}
