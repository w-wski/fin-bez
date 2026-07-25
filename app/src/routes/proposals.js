// Rusztowanie Z5 (odtworzone): trasa /api/v1/proposals jest zamontowana w app.js,
// a plik zaginął przy scalaniu — bez niego serwer wywracał się na starcie.
// Kontrakt docelowy w docs/zlecenia/Z5-przydzial.md (repo finansowe, K6).
// Właścicielem implementacji jest budowniczy Z5 — tu wyłącznie minimalny szkielet:
// GET zwraca pustą listę grup, zapisy odpowiadają 501, dopóki Z5 nie wypełni logiki.
const express = require('express');
const router = express.Router();

// K6: decyzje o przydziale podejmuje wyłącznie administrator.
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'admin_only' });
  next();
}

router.get('/', requireAdmin, (_req, res) => res.json({ groups: [] }));

for (const akcja of ['accept', 'reject', 'retarget']) {
  router.post(`/${akcja}`, requireAdmin, (_req, res) =>
    res.status(501).json({ error: 'not_implemented', detail: `Z5: ${akcja} czeka na implementację` }));
}

module.exports = router;
