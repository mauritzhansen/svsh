-- Fixes from the rides + invoicing review (Oct 2026).

-- D. A refund raised because an invoiced rider was cancelled without charge
-- belongs to that invoice: delete the draft and the refund goes with it,
-- instead of lingering as a discount on the next invoice for a lesson nobody
-- is being charged for any more.
ALTER TABLE contact_charges
    ADD COLUMN source_invoice_id BIGINT REFERENCES invoices(id) ON DELETE CASCADE;

CREATE INDEX contact_charges_source_invoice
    ON contact_charges (source_invoice_id) WHERE source_invoice_id IS NOT NULL;

-- Refunds raised before this column existed name the invoice in their text.
UPDATE contact_charges ch SET source_invoice_id = i.id
  FROM invoices i
 WHERE ch.source_invoice_id IS NULL
   AND ch.amount_cents < 0
   AND ch.description LIKE 'Refund — cancelled lesson %(invoice ' || i.number || ')';

-- O. Livery, standing monthly charges and arena fees used to be de-duplicated
-- by matching the line's description text, so renaming a horse or a charge
-- billed it again. Each such line now carries a key naming what it bills
-- ("livery:<horse>:<month>:base", "arena:<rider>:2026-Q4"), and the database
-- refuses a second line with the same key. Older lines keep a NULL key and are
-- still matched by description, so nothing already billed is billed twice.
ALTER TABLE invoice_lines ADD COLUMN source_key TEXT;

CREATE UNIQUE INDEX invoice_lines_source_key
    ON invoice_lines (source_key) WHERE source_key IS NOT NULL;

-- S. Invoice numbers came from MAX+1 over the table: two invoices created at
-- once collided, and deleting the latest draft let the next invoice take its
-- number — which is how one number ended up on two different documents. A
-- counter per year only ever goes up.
CREATE TABLE invoice_counters (
    year INT PRIMARY KEY,
    last INT NOT NULL DEFAULT 0
);

INSERT INTO invoice_counters (year, last)
SELECT SUBSTRING(number FROM 'INV-(\d{4})-')::int,
       MAX(SUBSTRING(number FROM '\d+$')::int)
  FROM invoices
 WHERE number ~ '^INV-\d{4}-\d+$'
 GROUP BY 1;

-- N/U. Which run made an invoice was never recorded (kind was always
-- 'monthly'), so the holiday-policy paragraph printed on every invoice,
-- arrears and cash ones included. Invoices to payers billed in advance are
-- the advance ones.
UPDATE invoices i SET kind = 'advance'
  FROM contacts c
 WHERE c.id = i.contact_id
   AND c.payment_terms IN ('advance_monthly', 'advance_term')
   AND i.kind = 'monthly';
