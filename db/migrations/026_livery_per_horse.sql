-- Livery belongs to a HORSE, not to a person: a customer can stable more than
-- one, and each can be a full or a half share independently.
--
-- horses.owner_contact_id already means "this horse belongs to a contact rather
-- than the stable", which is exactly a livery horse, so the share goes beside
-- it. NULL share = the horse is not on livery (an owned horse that is simply
-- kept elsewhere, or stabled under some other arrangement).
--
-- The standard monthly charges (livery_extras: bedding, feed) are a cost per
-- horse, so two horses are billed two lots. The per-customer extras in
-- contact_monthly_charges stay per customer and are billed once.

ALTER TABLE horses ADD COLUMN livery_share INT
    CHECK (livery_share IN (50, 100));

CREATE INDEX horses_livery ON horses (owner_contact_id)
    WHERE livery_share IS NOT NULL;

-- Superseded by the column above. Nothing is lost: no contact has one set.
ALTER TABLE contacts DROP COLUMN livery_share;
