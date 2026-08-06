-- Interested riders (prospects) not yet placed in lessons, rider ages,
-- and per-rider invoicing (each invoice is for one rider, billed to the payer).

ALTER TABLE contacts ADD COLUMN is_prospect BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contacts ADD COLUMN birth_year INT;

ALTER TABLE invoices ADD COLUMN rider_contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL;

-- Backfill: term-pass invoices are already per rider — link them
UPDATE invoices i SET rider_contact_id = tp.contact_id
  FROM term_passes tp
 WHERE tp.invoice_id = i.id AND i.rider_contact_id IS NULL;