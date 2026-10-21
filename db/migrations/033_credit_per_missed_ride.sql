-- A reschedule credit belongs to one missed lesson, but nothing said so: the
-- dialog raised a fresh credit on every save, so re-opening a ride and saving
-- it again gave the rider another one. Riders ended up with "Lara ×3" in the
-- calendar bar for a single missed Wednesday.
--
-- Recording WHICH ride was missed makes the credit idempotent: the day can be
-- saved as often as you like and it stays one credit. Credits are raised from
-- the cancellation now, not from the browser.

ALTER TABLE reschedule_credits ADD COLUMN missed_ride_id BIGINT
    REFERENCES rides(id) ON DELETE SET NULL;

-- Old credits have no ride on them, so they are left out of the constraint
-- rather than guessed at; they can still be used and cleared by hand.
CREATE UNIQUE INDEX reschedule_credits_one_per_missed_ride
    ON reschedule_credits (contact_id, missed_ride_id)
 WHERE missed_ride_id IS NOT NULL;
