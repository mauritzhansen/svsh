-- Some riders simply hand over cash at the end of the lesson, which is neither
-- paid in advance nor invoiced in arrears.

ALTER TABLE contacts DROP CONSTRAINT contacts_payment_terms_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_payment_terms_check
    CHECK (payment_terms IN ('advance_monthly', 'advance_term', 'arrears', 'cash_after'));
