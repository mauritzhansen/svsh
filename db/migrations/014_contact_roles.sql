-- Rider / parent stop being inferred and become things you tick, so a parent
-- can be recorded before any of their children ride, and a contact can be both.
-- The backfill uses the old derivation: anyone who rides (or is on a fixed
-- slot, has a level, or is an interested prospect) is a rider; anyone with a
-- child pointing at them is a parent.

ALTER TABLE contacts ADD COLUMN is_rider  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE contacts ADD COLUMN is_parent BOOLEAN NOT NULL DEFAULT false;

UPDATE contacts c SET is_rider = (
        c.experience IS NOT NULL
     OR c.is_prospect
     OR EXISTS (SELECT 1 FROM ride_participants rp
                 JOIN rides r ON r.id = rp.ride_id
                WHERE rp.contact_id = c.id AND r.status = 'active' AND NOT r.is_block)
     OR EXISTS (SELECT 1 FROM recurring_participants xp WHERE xp.contact_id = c.id));

UPDATE contacts c SET is_parent = EXISTS (
    SELECT 1 FROM contacts k WHERE k.parent_id = c.id AND NOT k.archived);

-- A contact must be at least one of the two, or it would vanish from every list
UPDATE contacts SET is_rider = true WHERE NOT is_rider AND NOT is_parent;