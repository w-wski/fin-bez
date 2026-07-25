/* typografia.js — polska mikrotypografia w warstwie prezentacji.
 *
 * Sierotki (zawieszki): jednoliterowe spójniki i przyimki — a, i, o, u, w, z —
 * nie mogą zostać na końcu wiersza. Wiążemy je z następnym wyrazem twardą spacją
 * (U+00A0), zgodnie z polskimi zasadami składu tekstu. Dotyczy też wersalików
 * na początku zdania (A, I, O, U, W, Z).
 *
 * Działa na węzłach tekstowych całego dokumentu i na wszystkim, co dorenderuje
 * main.js (MutationObserver). Idempotentne: po podmianie spacji na twardą wzorzec
 * przestaje pasować, więc obserwator nie wpada w pętlę. Nie dotyka logiki ani
 * pól formularzy (input/textarea nie mają tekstowych węzłów potomnych).
 */

const ORPHAN = /([\s („«>-]|^)([aiouwzAIOUWZ])[ \t]+(?=\S)/g;
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CANVAS', 'svg']);

function fixNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.nodeValue;
    if (t && t.length > 2) {
      const r = t.replace(ORPHAN, '$1$2 ');
      if (r !== t) node.nodeValue = r;
    }
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || SKIP.has(node.tagName)) return;
  for (const child of node.childNodes) fixNode(child);
}

function boot() {
  fixNode(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') fixNode(m.target);
      else if (m.addedNodes) m.addedNodes.forEach(fixNode);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
