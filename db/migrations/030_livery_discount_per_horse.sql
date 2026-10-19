-- The livery discount is negotiated per HORSE, not per customer: a customer
-- with two horses may have a deal on one of them and not the other.
--
-- Supersedes contacts.livery_discount_cents from migration 029, which was only
-- ever applied locally — no contact has a value set.
--
-- Positive amount, subtracted when the invoice is built. It only applies in a
-- month where that horse is actually charged livery, so taking the horse off
-- livery ends its discount with nothing else to remember.

ALTER TABLE horses ADD COLUMN livery_discount_cents INT NOT NULL DEFAULT 0
    CHECK (livery_discount_cents >= 0);

ALTER TABLE contacts DROP COLUMN livery_discount_cents;
