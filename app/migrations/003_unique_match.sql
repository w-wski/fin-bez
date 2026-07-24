-- 003: jeden wpis księgi nie może być uzgodniony z dwoma wierszami bankowymi.
-- NULL wielokrotny jest w MySQL dozwolony, więc unikat blokuje tylko realne duplikaty
-- uzgodnień (podwójne księgowanie w obejściu guardu /match).
ALTER TABLE bank_transactions ADD UNIQUE KEY uq_matched (matched_transaction_id);
