-- A rider moved from one lesson to another on the same day. The seat itself
-- travels (so an invoice line or a spent credit pointing at it is untouched);
-- this row marks the lesson they left so the series does not put them back
-- and the day still shows where they went. Never billable.
ALTER TABLE ride_cancellations DROP CONSTRAINT ride_cancellations_kind_check;
ALTER TABLE ride_cancellations
    ADD CONSTRAINT ride_cancellations_kind_check CHECK (kind IN ('cancelled', 'rescheduled', 'moved'));
ALTER TABLE ride_cancellations
    ADD COLUMN moved_to_ride_id BIGINT REFERENCES rides(id) ON DELETE SET NULL;
