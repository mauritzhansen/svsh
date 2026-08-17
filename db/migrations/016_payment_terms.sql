-- How each payer settles up. Three arrangements exist at the school:
--   advance_monthly - pays up front, month by month
--   advance_term    - pays up front for the whole term (a term pass)
--   arrears         - invoiced after the rides have happened
--
-- Nullable on purpose: every existing contact starts as "not assigned" so the
-- gap is visible and can be worked through. The application requires it before
-- a parent can be saved, rather than a NOT NULL default silently guessing.

ALTER TABLE contacts ADD COLUMN payment_terms TEXT
    CHECK (payment_terms IN ('advance_monthly', 'advance_term', 'arrears'));