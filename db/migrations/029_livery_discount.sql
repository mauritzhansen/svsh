-- A negotiated discount off the livery fee for one customer.
--
-- Held on the CONTACT, not the horse: it is a deal struck with the person, so
-- it comes off once a month however many horses they stable. Stored as a
-- positive amount and subtracted when the invoice is built, which keeps the
-- intent obvious in the data (a "discount" of -500 would be ambiguous).
--
-- It only applies in a month where they are actually charged livery, so ending
-- their livery ends the discount without anything else having to be remembered.

ALTER TABLE contacts ADD COLUMN livery_discount_cents INT NOT NULL DEFAULT 0
    CHECK (livery_discount_cents >= 0);
