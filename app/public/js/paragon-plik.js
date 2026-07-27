/* paragon-plik.js — druga droga dodania paragonu: PLIK z telefonu albo komputera
 * (Szymon 07-27: „osobny przycisk Aparat i osobny przycisk Plik").
 *
 * Trzy rodzaje pliku i trzy różne losy, bo niosą różną ilość prawdy:
 *
 *  .json  E-PARAGON w standardzie JPK_KASA_PARAGON_v2-0 (państwowy, podpisany). Pozycje,
 *         ilości, ceny, rabaty i VAT są w środku jako DANE. Zero OCR, zero zgadywania —
 *         wysyłamy treść i serwer czyta ją co do grosza. To najlepsza z trzech dróg.
 *  .pdf   Sprawdziliśmy PDF-a z aplikacji sklepu: nie ma w nim ANI JEDNEGO znaku tekstu,
 *         tylko dwie bitmapy. To znaczy, że PDF niesie dokładnie tyle, co zdjęcie — więc
 *         idzie tą samą drogą: serwer wyłuskuje obraz i puszcza rozpoznawanie tekstu.
 *  obraz  Zdjęcie zrobione wcześniej albo zrzut ekranu — wpada w zwykły tryb kadrowania,
 *         ten sam co z aparatu.
 *
 * Rozmiar sprawdzamy TU, przed wysłaniem: serwer i tak odrzuci za duży plik, ale
 * odrzucenie po minucie wysyłania przez komórkę to zła wiadomość w złym momencie.
 */

import { $, api, track, toast } from './core.js';

const LIMIT = 4 * 1024 * 1024;          // tyle samo, ile przyjmuje multer na serwerze
const rozszerzenie = (n) => (String(n).match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();

function komunikat(tekst, blad) {
  const el = $('#rcPlikMsg');
  if (!el) return;
  el.textContent = tekst || '';
  el.classList.toggle('err', !!blad);
}

/**
 * @param {File} plik
 * @param {object} h  { naObraz(file), naWynik(receipt) } — obraz wraca do kadrowania
 *                    w paragon.js, gotowy paragon do widoku wyniku.
 */
export async function przyjmijPlik(plik, h) {
  komunikat('');
  if (!plik) return;
  if (plik.size > LIMIT) {
    return komunikat(`Plik ma ${(plik.size / 1048576).toFixed(1)} MB, a przyjmujemy do 4 MB.`, true);
  }
  const rozsz = rozszerzenie(plik.name);
  const typ = plik.type || '';

  if (typ.startsWith('image/') || ['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(rozsz)) {
    return h.naObraz(plik);
  }
  if (rozsz === 'json' || typ === 'application/json') return eparagon(plik, h);
  if (rozsz === 'pdf' || typ === 'application/pdf') return pdf(plik, h);

  komunikat(`Nie znam formatu „${rozsz || typ || '?'}". Przyjmuję zdjęcie, .json (e-paragon) albo .pdf.`, true);
}

/** E-paragon: wysyłamy SUROWĄ treść pliku, a nie sparsowaną w przeglądarce. Parsowanie
 *  i sprawdzenie, czy paragon się sumuje, należy do serwera — przeglądarka nie jest
 *  miejscem, w którym rozstrzyga się, co wchodzi do księgi. */
async function eparagon(plik, h) {
  komunikat('Czytam e-paragon…');
  let tekst;
  try {
    tekst = await plik.text();
    JSON.parse(tekst);                  // sprawdzamy TYLKO, czy to w ogóle JSON
  } catch {
    return komunikat('Ten plik nie jest poprawnym JSON-em. Czy to na pewno e-paragon ze sklepu?', true);
  }
  try {
    const r = await api('/api/v1/receipts/eparagon', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: tekst,
    });
    track('Paragon: e-paragon wczytany', 'paragon', { pozycji: r.items ? r.items.length : 0 });
    komunikat('');
    if (r.duplikat) toast('Ten e-paragon już był wgrany — otwieram zapisany.');
    h.naWynik(r);
  } catch (err) {
    if (err.message === 'auth') return;
    komunikat('Nie udało się wczytać e-paragonu: ' + (err.data?.error || err.message), true);
  }
}

/** PDF: obraz w środku, więc na serwer i przez OCR. Mówimy wprost, czego się spodziewać —
 *  odczyt z obrazu jest gorszy niż z e-paragonu i użytkownik ma o tym wiedzieć ZAWCZASU,
 *  a nie dziwić się potem literówkom w nazwach towarów. */
async function pdf(plik, h) {
  komunikat('PDF to obraz paragonu — rozpoznaję tekst, to potrwa kilkanaście sekund…');
  const fd = new FormData();
  fd.append('plik', plik, plik.name);
  try {
    // `headers: {}` jest tu KONIECZNE: api() domyślnie ustawia `application/json`, a przy
    // FormData nagłówek musi ustawić przeglądarka — razem z granicą (boundary), której
    // sami nie znamy. Z narzuconym typem serwer dostałby multipart oznaczony jako JSON.
    const r = await api('/api/v1/receipts/pdf', { method: 'POST', body: fd, headers: {} });
    track('Paragon: pdf wczytany', 'paragon');
    komunikat('Odczyt z obrazu bywa niedokładny — sprawdź pozycje przed zapisaniem.');
    h.naWynik(r);
  } catch (err) {
    if (err.message === 'auth') return;
    komunikat('Nie udało się odczytać PDF-a: ' + (err.data?.error || err.message), true);
  }
}
