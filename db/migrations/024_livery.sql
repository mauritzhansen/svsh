-- Livery: a paying contact can also stable a horse here, billed monthly on the
-- same invoice as the lessons.
--
-- The share is 50 or 100 percent — a half share is two owners splitting one
-- stable — and it scales the base livery price only. Extras (bedding, feed,
-- supplements and so on) are a fixed cost per horse and are charged in full
-- whichever share the contact is on, so they are deliberately NOT scaled.
--
-- NULL share means "not a livery customer", so nothing changes for the riders
-- who only take lessons.

ALTER TABLE contacts ADD COLUMN livery_share INT
    CHECK (livery_share IN (50, 100));

-- The catalogue of extras, maintained in Settings alongside the base price
-- (settings.livery_price_cents). Kept as rows rather than a settings blob so a
-- price change does not have to be hunted down in free text.
CREATE TABLE livery_extras (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    price_cents INT NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 0
);

-- Which extras a given livery customer actually pays for. Not every customer
-- takes every extra, so this is a choice per contact rather than a blanket one.
CREATE TABLE contact_livery_extras (
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    extra_id BIGINT NOT NULL REFERENCES livery_extras(id) ON DELETE CASCADE,
    PRIMARY KEY (contact_id, extra_id)
);

CREATE INDEX contacts_livery ON contacts (livery_share) WHERE livery_share IS NOT NULL;
