// eksport.js — eksport CSV księgi dla admina (21b). Montowany pod /api/v1/eksport, z tym
// samym auth co inne trasy (sesja) + admin only, i pod wyłącznikiem 'eksport_csv' (21a):
// dopóki Szymon go nie włączy w Adminie, endpoint odpowiada 503, nie ciągnie danych.
const express = require('express');
const { q } = require('../db');
const { czyData } = require('../ocr/pola');
const { wymagajModalnosci } = require('../wylaczniki');
const { zapiszDostep } = require('../rejestr');

const router = express.Router();

// admin only — eksport masowy widzi obie księgi na raz, to nie jest widok dla juniora
// ani dla dorosłego współprowadzącego (ci mają swój zasięg w /transactions).
router.use((req, res, next) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
  next();
});
router.use(wymagajModalnosci('eksport_csv'));

const ZBIORY = ['ksiega', 'konto', 'produkty', 'telemetria'];
// „konto" w schemacie: transactions NIE MA kolumny konta bankowego używanej w praktyce —
// jest account_id → accounts (bank_name/account_name), ale nic w aplikacji go dziś nie
// wypełnia. Najbliższy odpowiednik „skąd wpis się wziął" to `source` (MANUAL/CSV/RECEIPT/
// MIGRACJA), więc zbior=konto filtruje PO ŹRÓDLE WPISU, nie po prawdziwym rachunku
// bankowym. Ograniczenie opisane też w artefakcie zlecenia Z11.
const ZRODLA = ['MANUAL', 'CSV', 'RECEIPT', 'MIGRACJA'];

// ---------- CSV: nagłówki PL, średnik (Excel PL), BOM, kwota z przecinkiem ----------
const BOM = '﻿';

// Pole trafia w cudzysłów, gdy zawiera separator, cudzysłów albo nową linię — inaczej
// opis z przecinkiem/średnikiem rozjeżdżałby kolumny w Excelu.
function pole(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
const kwotaPL = (v) => (v === null || v === undefined ? '' : Number(v).toFixed(2).replace('.', ','));

function csv(naglowki, wiersze) {
  const linie = [naglowki.map(pole).join(';')];
  for (const w of wiersze) linie.push(w.map(pole).join(';'));
  return BOM + linie.join('\r\n') + '\r\n';
}

function wyslijCsv(res, nazwa, tresc) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nazwa}"`);
  res.send(tresc);
}

// ---------- zapytania per zbiór ----------

async function pobierzKsiege(od, doD, source) {
  const params = { od, doD };
  let where = 't.deleted_at IS NULL AND t.tx_date BETWEEN :od AND :doD';
  if (source) { where += ' AND t.source = :source'; params.source = source; }
  const rows = await q(
    `SELECT t.tx_date, l.name AS ksiega, t.type, t.amount, t.currency, c.name AS kategoria,
            t.description, t.source, t.payment_method, u.name AS uzytkownik
       FROM transactions t
       JOIN ledgers l ON l.id = t.ledger_id
       JOIN users u ON u.id = t.user_id
       LEFT JOIN categories c ON c.id = t.category_id AND c.ledger_id = t.ledger_id
      WHERE ${where}
      ORDER BY t.tx_date, t.id`, params);
  return {
    naglowki: ['Data', 'Księga', 'Typ', 'Kwota', 'Waluta', 'Kategoria', 'Opis', 'Źródło', 'Płatność', 'Użytkownik'],
    wiersze: rows.map((r) => [r.tx_date, r.ksiega, r.type, kwotaPL(r.amount), r.currency,
      r.kategoria || '', r.description || '', r.source, r.payment_method || '', r.uzytkownik]),
  };
}

async function pobierzProdukty(od, doD) {
  const rows = await q(
    `SELECT p.name, p.unit, pc.name AS kategoria,
            COUNT(*) AS zakupow, ROUND(SUM(i.quantity), 3) AS ilosc,
            ROUND(SUM(i.value), 2) AS wydano, ROUND(SUM(COALESCE(i.discount, 0)), 2) AS rabaty
       FROM receipt_items i
       JOIN receipts r ON r.id = i.receipt_id
       JOIN products p ON p.id = i.product_id
       LEFT JOIN product_categories pc ON pc.id = p.product_category_id
      WHERE r.receipt_date BETWEEN :od AND :doD
      GROUP BY p.id ORDER BY wydano DESC`, { od, doD });
  return {
    naglowki: ['Produkt', 'Jednostka', 'Kategoria produktowa', 'Zakupy', 'Ilość', 'Wydano', 'Rabaty'],
    wiersze: rows.map((r) => [r.name, r.unit || '', r.kategoria || '', r.zakupow,
      String(r.ilosc ?? '').replace('.', ','), kwotaPL(r.wydano), kwotaPL(r.rabaty)]),
  };
}

async function pobierzTelemetrie(od, doD) {
  const rows = await q(
    `SELECT ts, user_name, view_name, action, duration_s, offline, detail
       FROM telemetry WHERE ts BETWEEN :od AND :doNast
       ORDER BY ts`, { od, doNast: `${doD} 23:59:59` });
  return {
    naglowki: ['Data', 'Użytkownik', 'Widok', 'Akcja', 'Czas (s)', 'Offline', 'Szczegóły'],
    wiersze: rows.map((r) => [r.ts, r.user_name || '', r.view_name, r.action,
      r.duration_s ?? '', r.offline ? '1' : '0', r.detail || '']),
  };
}

// GET /api/v1/eksport/csv?zbior=&od=&do=&konto=
router.get('/csv', async (req, res, next) => {
  try {
    const zbior = String(req.query.zbior || '');
    if (!ZBIORY.includes(zbior)) return res.status(400).json({ error: 'bad_zbior', dozwolone: ZBIORY });
    const od = czyData(req.query.od), doD = czyData(req.query.do);
    if (!od || !doD || od > doD) return res.status(400).json({ error: 'bad_period' });

    let dane;
    if (zbior === 'ksiega') {
      dane = await pobierzKsiege(od, doD, null);
    } else if (zbior === 'konto') {
      const konto = String(req.query.konto || '');
      if (!ZRODLA.includes(konto)) return res.status(400).json({ error: 'bad_konto', dozwolone: ZRODLA });
      dane = await pobierzKsiege(od, doD, konto);
    } else if (zbior === 'produkty') {
      dane = await pobierzProdukty(od, doD);
    } else {
      dane = await pobierzTelemetrie(od, doD);
    }

    zapiszDostep('eksport_csv', zbior, `${od}..${doD}`, dane.wiersze.length, null);
    wyslijCsv(res, `eksport-${zbior}-${od}_${doD}.csv`, csv(dane.naglowki, dane.wiersze));
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.pole = pole;         // eksport dla scripts/test-rejestry.js (escaping CSV)
module.exports.kwotaPL = kwotaPL;
module.exports.csv = csv;
module.exports.BOM = BOM;
module.exports.ZBIORY = ZBIORY;
module.exports.ZRODLA = ZRODLA;
