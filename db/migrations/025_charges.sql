-- Reworks the livery extras and adds one-off expenses.
--
-- There are now three kinds of money beyond the lessons themselves:
--
--   1. livery_extras            - standard monthly livery charges that apply to
--                                 EVERY livery customer (set in Settings)
--   2. contact_monthly_charges  - extra monthly charges for ONE customer
--   3. contact_charges          - one-off expenses on a date (vet, a bag of
--                                 feed, a discount) for any customer at all,
--                                 livery or not
--
-- Monthly charges are a fixed cost per horse, so none of them are scaled by the
-- 50%/100% livery share — only the base livery price is.

-- (1) stops being a per-customer choice: it now applies to all of them, so the
-- join table that recorded who ticked what is no longer meaningful.
DROP TABLE IF EXISTS contact_livery_extras;

CREATE TABLE contact_monthly_charges (
    id BIGSERIAL PRIMARY KEY,
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price_cents INT NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX contact_monthly_charges_contact ON contact_monthly_charges (contact_id);

-- One-off expenses. Negative amounts are allowed on purpose: a discount or a
-- goodwill credit is the same thing with the sign flipped.
CREATE TABLE contact_charges (
    id BIGSERIAL PRIMARY KEY,
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    charge_date DATE NOT NULL,
    description TEXT NOT NULL,
    amount_cents INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contact_charges_contact ON contact_charges (contact_id, charge_date);

-- Mirrors participant_id exactly: UNIQUE so a charge cannot be billed twice,
-- and the line is removed with its invoice, which frees the charge again.
ALTER TABLE invoice_lines ADD COLUMN charge_id BIGINT UNIQUE
    REFERENCES contact_charges(id) ON DELETE SET NULL;
