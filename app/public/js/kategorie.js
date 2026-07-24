// Kategorie: pobranie drzewa, cache offline, listy wyboru w formularzu Wpisu.
import { $, api, state, CATS_CACHE_KEY } from './core.js';

export let CATS = [];
export const getCats = () => CATS;

export function renderCats() {
  const main = $('#catMain');
  main.innerHTML = '<option value="">Kategoria…</option>' +
    CATS.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  $('#catSub').hidden = true;
}

export async function loadCats() {
  const ledger = $('#ledger').value || state.me.scope.ledgers[0];
  try {
    CATS = (await api(`/api/v1/categories?ledger=${ledger}`)).categories;
    localStorage.setItem(CATS_CACHE_KEY + ledger, JSON.stringify(CATS)); // cache na offline
  } catch (err) {
    if (err.message === 'auth') throw err;
    try { CATS = JSON.parse(localStorage.getItem(CATS_CACHE_KEY + ledger)) || []; } catch { CATS = []; }
  }
  renderCats();
}

export function onCatMain() {
  const c = CATS.find((x) => String(x.id) === $('#catMain').value);
  const sub = $('#catSub');
  if (c && c.children.length) {
    sub.innerHTML = '<option value="">Podkategoria</option>' +
      c.children.map((k) => `<option value="${k.id}">${k.name}</option>`).join('');
    sub.hidden = false;
  } else { sub.hidden = true; sub.innerHTML = ''; }
}
