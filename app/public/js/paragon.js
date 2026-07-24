// Karta „Paragon": obróbka zdjęcia W PRZEGLĄDARCE (kadr 4 rogami + auto-propozycja,
// skala do 1200px, B&W, kontrast/jasność) → upload małego JPG → wynik OCR do edycji.
// Decyzje Szymona 07-24: hybryda (przycisk „Popraw AI"), kadr ręczny z propozycją auto.

import { $, el, zl, api, track } from './core.js';
import { getCats } from './kategorie.js';

const deps = { $, el, zl, api, track, getCats };
let img = null;            // źródłowy obraz
let corners = null;        // 4 rogi [{x,y}] w układzie canvasa edycji
let dragIdx = -1;
let processedBlob = null;
let currentReceipt = null;

const W_EDIT = 900;        // szerokość robocza edytora

export function initParagon() {
  $('#rcFile').onchange = onFile;
  $('#rcApply').onclick = applyCrop;
  $('#rcBack').onclick = () => step('kadr');
  $('#rcSend').onclick = send;
  $('#rcBright').oninput = renderProcessed;
  $('#rcBW').onchange = renderProcessed;
  const cv = $('#rcCanvas');
  cv.addEventListener('pointerdown', pDown);
  cv.addEventListener('pointermove', pMove);
  cv.addEventListener('pointerup', () => { dragIdx = -1; });
}

function step(name) {
  ['start', 'kadr', 'podglad', 'wynik'].forEach((s) => { deps.$('#rc-' + s).hidden = s !== name; });
}

function onFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const cv = deps.$('#rcCanvas');
    const scale = Math.min(1, W_EDIT / img.width);
    cv.width = Math.round(img.width * scale);
    cv.height = Math.round(img.height * scale);
    corners = autoProposeCorners(cv);
    drawEdit();
    step('kadr');
    deps.track('Paragon: zdjęcie wczytane', 'paragon');
  };
  img.src = url;
}

// AUTO-PROPOZYCJA: paragon = największy jasny obszar; bierzemy bbox jasnych pikseli
// (percentyl) z lekkim marginesem. Użytkownik zawsze może poprawić rogi ręcznie.
function autoProposeCorners(cv) {
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const { data, width, height } = ctx.getImageData(0, 0, cv.width, cv.height);
  const lum = new Uint8Array(width * height);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < width * height; i++) {
    const l = (data[i * 4] * 3 + data[i * 4 + 1] * 6 + data[i * 4 + 2]) / 10 | 0;
    lum[i] = l; hist[l]++;
  }
  let cum = 0, thr = 200;
  for (let v = 255; v >= 0; v--) { cum += hist[v]; if (cum > width * height * 0.25) { thr = v; break; } } // top 25% najjaśniejszych
  let minX = width, maxX = 0, minY = height, maxY = 0, n = 0;
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    if (lum[y * width + x] >= thr) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (n < 100 || maxX - minX < 40 || maxY - minY < 40) { minX = width * .08; maxX = width * .92; minY = height * .05; maxY = height * .95; }
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
}

function drawEdit() {
  const cv = deps.$('#rcCanvas'), ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  ctx.strokeStyle = '#1f9d5a'; ctx.lineWidth = 2; ctx.fillStyle = 'rgba(31,157,90,.15)';
  ctx.beginPath();
  corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
  ctx.closePath(); ctx.fill(); ctx.stroke();
  for (const c of corners) { ctx.beginPath(); ctx.arc(c.x, c.y, 12, 0, 7); ctx.fillStyle = '#1f9d5a'; ctx.fill(); }
}

function evPos(e) {
  const r = e.target.getBoundingClientRect();
  const cv = e.target;
  return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height };
}
function pDown(e) {
  const p = evPos(e);
  dragIdx = corners.findIndex((c) => Math.hypot(c.x - p.x, c.y - p.y) < 30);
  if (dragIdx >= 0) e.target.setPointerCapture(e.pointerId);
}
function pMove(e) {
  if (dragIdx < 0) return;
  const cv = e.target, p = evPos(e);
  corners[dragIdx] = { x: Math.max(0, Math.min(cv.width, p.x)), y: Math.max(0, Math.min(cv.height, p.y)) };
  drawEdit();
}

// Homografia 4 punkty -> prostokąt (DLT + eliminacja Gaussa), odwrotne mapowanie pikseli.
function solveH(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) { // Gauss z częściowym wyborem
    let piv = c;
    for (let r2 = c + 1; r2 < 8; r2++) if (Math.abs(A[r2][c]) > Math.abs(A[piv][c])) piv = r2;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r2 = 0; r2 < 8; r2++) {
      if (r2 === c || !A[r2][c]) continue;
      const f = A[r2][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r2][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [...h, 1]; // h33=1
}

function applyCrop() {
  const cvE = deps.$('#rcCanvas');
  // wymiary wyjścia z geometrii kadru (max 1200 px szerokości)
  const wTop = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
  const hL = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
  const outW = Math.min(1200, Math.max(400, Math.round(wTop / cvE.width * img.width)));
  const outH = Math.max(400, Math.round(outW * (hL / wTop)));
  // homografia liczona na WSPÓŁRZĘDNYCH ORYGINAŁU (pełna rozdzielczość źródła)
  const sc = img.width / cvE.width;
  const src = corners.map((c) => ({ x: c.x * sc, y: c.y * sc }));
  const H = solveH([{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }], src); // odwrotna: out->src
  const s = document.createElement('canvas'); s.width = img.width; s.height = img.height;
  s.getContext('2d').drawImage(img, 0, 0);
  const sd = s.getContext('2d').getImageData(0, 0, s.width, s.height);
  const o = deps.$('#rcOut'); o.width = outW; o.height = outH;
  const octx = o.getContext('2d');
  const od = octx.createImageData(outW, outH);
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const d = H[6] * x + H[7] * y + H[8];
    const sx = (H[0] * x + H[1] * y + H[2]) / d | 0;
    const sy = (H[3] * x + H[4] * y + H[5]) / d | 0;
    const oi = (y * outW + x) * 4;
    if (sx >= 0 && sy >= 0 && sx < s.width && sy < s.height) {
      const si = (sy * s.width + sx) * 4;
      od.data[oi] = sd.data[si]; od.data[oi + 1] = sd.data[si + 1]; od.data[oi + 2] = sd.data[si + 2];
    } else { od.data[oi] = od.data[oi + 1] = od.data[oi + 2] = 255; }
    od.data[oi + 3] = 255;
  }
  octx.putImageData(od, 0, 0);
  o.dataset.raw = '1';
  window.__rcRaw = octx.getImageData(0, 0, outW, outH); // baza do regulacji
  step('podglad');
  renderProcessed();
}

// B&W + kontrast (rozciągnięcie 2-98 percentyla) + jasność + opcjonalna binaryzacja (Otsu)
function renderProcessed() {
  const o = deps.$('#rcOut'); if (!window.__rcRaw) return;
  const raw = window.__rcRaw, w = raw.width, h = raw.height;
  const bright = parseInt(deps.$('#rcBright').value, 10);        // -60..60
  const binar = deps.$('#rcBW').checked;
  const lum = new Uint8Array(w * h), hist = new Array(256).fill(0);
  for (let i = 0; i < w * h; i++) {
    const l = (raw.data[i * 4] * 3 + raw.data[i * 4 + 1] * 6 + raw.data[i * 4 + 2]) / 10 | 0;
    lum[i] = l; hist[l]++;
  }
  let lo = 0, hi = 255, cum = 0;
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum > w * h * 0.02) { lo = v; break; } }
  cum = 0; for (let v = 255; v >= 0; v--) { cum += hist[v]; if (cum > w * h * 0.02) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  let thr = 128;
  if (binar) { // Otsu
    let sum = 0, total = w * h; for (let v = 0; v < 256; v++) sum += v * hist[v];
    let sumB = 0, wB = 0, best = 0;
    for (let v = 0; v < 256; v++) {
      wB += hist[v]; if (!wB) continue; const wF = total - wB; if (!wF) break;
      sumB += v * hist[v];
      const between = wB * wF * ((sumB / wB) - ((sum - sumB) / wF)) ** 2;
      if (between > best) { best = between; thr = v; }
    }
  }
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    let v = ((lum[i] - lo) / range) * 255 + bright;
    v = Math.max(0, Math.min(255, v));
    if (binar) v = v >= thr + bright * 0.3 ? 255 : 0;
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255;
  }
  o.getContext('2d').putImageData(out, 0, 0);
  o.toBlob((b) => { processedBlob = b; deps.$('#rcSize').textContent = b ? Math.round(b.size / 1024) + ' KB' : ''; }, 'image/jpeg', 0.85);
}

async function send() {
  const { $, track } = deps;
  if (!processedBlob) return;
  const msg = $('#rcMsg'); msg.className = 'msg'; msg.textContent = 'Odczytuję (OCR)… to może potrwać do pół minuty.';
  const fd = new FormData();
  fd.append('image', processedBlob, 'paragon.jpg');
  fd.append('ledger_id', $('#ledger') ? ($('#ledger').value || 1) : 1);
  try {
    const res = await fetch('/api/v1/receipts', { method: 'POST', body: fd });
    const data = await res.json();
    if (res.status === 409) { msg.textContent = 'Ten paragon już jest w bazie (duplikat).'; msg.className = 'msg err'; return; }
    if (!res.ok) throw new Error(data.error || res.status);
    track('Paragon: OCR', 'paragon', { detail: `pozycje=${data.items.length}; conf=${data.ocr_confidence ?? '?'}` });
    msg.textContent = '';
    renderResult(data);
    step('wynik');
  } catch (e) {
    track('Paragon: błąd OCR', 'paragon', { detail: String(e.message).slice(0, 80) });
    msg.textContent = 'Błąd OCR: ' + e.message; msg.className = 'msg err';
  }
}

function renderResult(rc) {
  const { $, el, zl, api, track } = deps;
  currentReceipt = rc;
  const box = $('#rcResult'); box.innerHTML = '';
  box.append(el('h2', {}, `${rc.shop_name || 'Sklep?'} · ${rc.receipt_date || 'data?'} · SUMA: ${rc.total !== null ? zl(rc.total) : '—'}`));
  for (const w of rc.warnings || []) box.append(el('p', { class: 'msg err' }, w));
  const cats = deps.getCats();
  const flat = [];
  for (const c of cats) { flat.push(c); for (const k of c.children || []) flat.push({ ...k, name: c.name + ' > ' + k.name }); }
  const tb = el('table');
  tb.innerHTML = '<thead><tr><th>Pozycja</th><th class="num">Wartość</th><th>Kategoria</th></tr></thead>';
  const body = el('tbody');
  for (const it of rc.items) {
    const tr = el('tr', { class: it.low_confidence ? 'lowconf' : '' });
    tr.append(el('td', {}, (it.name || it.ocr_name) + (it.quantity && it.quantity !== 1 ? ` (${it.quantity}×)` : '')),
      el('td', { class: 'num' }, it.value !== null ? zl(it.value) : '—'));
    const sel = el('select');
    sel.innerHTML = '<option value="">kategoria…</option>' +
      flat.map((c) => `<option value="${c.id}" ${c.id === it.category_id ? 'selected' : ''}>${c.name}</option>`).join('');
    sel.onchange = async () => {
      await api(`/api/v1/receipts/${rc.id}/items/${it.id}`, { method: 'PATCH', body: JSON.stringify({ category_id: sel.value || null }) });
      track('Paragon: korekta kategorii', 'paragon'); // samouczenie po stronie serwera
    };
    const td = el('td'); td.append(sel); tr.append(td); body.append(tr);
  }
  tb.append(body); box.append(tb);
  const row = el('div', { class: 'row wrap' });
  if (rc.ai_available) {
    const ai = el('button', { class: 'btn' }, '✨ Popraw AI (nieczytelny?)');
    ai.onclick = async () => {
      ai.disabled = true; ai.textContent = 'AI czyta…';
      try { const better = await api(`/api/v1/receipts/${rc.id}/ai-fix`, { method: 'POST' });
        track('Paragon: ai-fix', 'paragon', { detail: `pozycje=${better.items.length}` });
        renderResult({ ...better, ai_available: true });
      } catch (e) { ai.textContent = 'AI nie pomogło: ' + e.message; }
    };
    row.append(ai);
  }
  const ok = el('button', { class: 'btn primary' }, `Potwierdź → wpis ${rc.total !== null ? zl(rc.total) : ''} w księdze`);
  ok.onclick = async () => {
    try {
      const r = await api(`/api/v1/receipts/${rc.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });
      track('Paragon: potwierdzony', 'paragon');
      box.innerHTML = ''; box.append(el('p', { class: 'msg ok' }, `Zapisano w księdze (wpis #${r.transaction_id}). Pozycje produktowe w bazie paragonów.`));
      deps.$('#rcFile').value = '';
      setTimeout(() => step('start'), 1500);
    } catch (e) { box.append(el('p', { class: 'msg err' }, 'Błąd: ' + (e.data?.error || e.message))); }
  };
  row.append(ok); box.append(row);
}
