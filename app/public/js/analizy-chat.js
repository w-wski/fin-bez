// Czat analiz (Z20, pkt 13/pyt. 5-6) — pod omówieniem karty Analizy, w OSOBNYM kontenerze
// #analizyChatBox (analizy.js czyści #analizyBox przy każdej zmianie okresu i skasowałby
// rozmowę, gdyby czat siedział tam). Bezpieczeństwo: czat WYŁĄCZNIE czyta (POST /api/v1/chat
// nie zapisuje nic poza chat_rozmowy po stronie serwera) — front tu nie ma żadnej ścieżki
// zapisu do ksiąg.
import { el, api, track } from './core.js';

let wysylanie = false; // blokada podwójnej wysyłki — jak `przycisk.disabled` w analizy.js

function opisBledu(err) {
  if (err instanceof TypeError) return 'brak połączenia z internetem';
  return err?.data?.komunikat || err?.data?.error || err?.message || 'błąd';
}

function wierszRozmowy(pytanie, tresc, jestBledem) {
  const w = el('div', { class: 'chat-wiersz' });
  w.append(el('p', { class: 'chat-pytanie' }, pytanie));
  w.append(el('p', { class: jestBledem ? 'msg err' : 'msg chat-odpowiedz' }, tresc));
  return w;
}

async function wyslijPytanie(historiaBox, okresTyp, okres, szeroki, pytanie) {
  wysylanie = true;
  const tymczasowy = wierszRozmowy(pytanie, 'Myślę…', false);
  historiaBox.append(tymczasowy);
  try {
    const wynik = await api('/api/v1/chat', {
      method: 'POST',
      body: JSON.stringify({ okres_typ: okresTyp, okres, pytanie, szeroki: szeroki ? 1 : 0 }),
    });
    track('Pytanie do czatu analiz', 'analizy', { detail: `${okresTyp}:${okres}` });
    tymczasowy.remove();
    // odpowiedz === null → model nie odpowiedział (limit/klucz/saldo) — komunikat CZYTELNY,
    // nigdy cicha pustka (zasady bezpieczeństwa zlecenia).
    if (wynik.odpowiedz) historiaBox.append(wierszRozmowy(pytanie, wynik.odpowiedz, false));
    else historiaBox.append(wierszRozmowy(pytanie, wynik.komunikat || 'model niedostępny — sprawdź saldo OpenRouter', true));
  } catch (err) {
    tymczasowy.remove();
    historiaBox.append(wierszRozmowy(pytanie, opisBledu(err), true));
  } finally {
    wysylanie = false;
  }
}

/** Renderuje sekcję czatu do `kontener` dla podanego okresu — wołane z analizy.js po KAŻDYM
 *  wyświetleniu analizy (z narracją lub bez). Sonduje GET /popularne najpierw: 403
 *  ('model_wylaczony') oznacza wyłącznik model_zewnetrzny OFF → sekcja w ogóle się nie
 *  renderuje (K5, „wyłączony ZNIKA z planszy"), inny błąd (offline) nie blokuje wysyłki. */
export async function renderChat(kontener, { okresTyp, okres }) {
  kontener.innerHTML = '';
  let popularne = [];
  try {
    ({ items: popularne } = await api('/api/v1/chat/popularne'));
  } catch (err) {
    if (err?.data?.error === 'model_wylaczony') return;
  }

  kontener.append(el('h3', {}, 'Czat o tym okresie'));

  if (popularne.length) {
    const podp = el('div', { class: 'row wrap chat-podpowiedzi' });
    for (const p of popularne.slice(0, 3)) {
      const b = el('button', { class: 'btn small', type: 'button' }, p);
      podp.append(b);
    }
    kontener.append(podp);
    // Klik podpowiedzi wstawia pytanie do pola (K2) — spięte niżej, gdy `pole` już istnieje.
    kontener._podpowiedzi = podp;
  }

  const historiaBox = el('div', { class: 'stack chat-historia' });
  const pole = el('input', { type: 'text', maxlength: '512', placeholder: 'Zapytaj o ten okres…' });
  if (kontener._podpowiedzi) {
    kontener._podpowiedzi.querySelectorAll('button').forEach((b) => { b.onclick = () => { pole.value = b.textContent; }; });
  }

  const wyslij = el('button', { class: 'btn', type: 'button' }, 'Wyślij');
  const szerokiCheck = el('input', { type: 'checkbox' });
  const szerokiPole = el('label', { class: 'row chat-szeroki' });
  szerokiPole.append(szerokiCheck, el('span', {}, 'Poszerz poszukiwania'));

  const wyslijTeraz = () => {
    const tresc = pole.value.trim();
    if (!tresc || wysylanie) return;
    pole.value = '';
    wyslijPytanie(historiaBox, okresTyp, okres, szerokiCheck.checked, tresc);
  };
  wyslij.onclick = wyslijTeraz;
  pole.onkeydown = (e) => { if (e.key === 'Enter') wyslijTeraz(); };

  const wierszWpisu = el('div', { class: 'row chat-pole' });
  wierszWpisu.append(pole, wyslij);
  kontener.append(historiaBox, wierszWpisu, szerokiPole);
}

// Zgodność z sw.js/preflight (Z20 fala B zastępuje szkielet majstra) — moduł montuje się
// SAM przez renderChat() wołane z analizy.js, initChat() nie jest już potrzebne osobno,
// ale zostaje jako no-op, gdyby main.js kiedyś chciał ją wywołać wprost.
export function initChat() { /* montowanie: analizy.js#odswiezCzat -> renderChat() */ }
