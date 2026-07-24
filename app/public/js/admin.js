// Panel administracyjny (widoczny wyłącznie dla roli admin).
// Zawartość renderowana z JS do kontenera #adminBox — index.html trzyma tylko pusty kontener.
import { refreshers } from './core.js';

export function initAdmin() {
  refreshers.admin = async () => { /* wypełnia zlecenie Z3 (kategorie: edycja, kolory) */ };
}
