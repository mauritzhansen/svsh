-- A rider taken off a ride used to be simply deleted from ride_participants.
-- That lost the fact that they were ever booked: the day showed nothing, a
-- rider removed from the weekly slot vanished completely, and there was no way
-- to tell "cancelled" from "rescheduled" or to put them back.
--
-- Deliberately a separate table rather than a status column on
-- ride_participants: thirty-odd queries (invoicing, conflicts, reports) count
-- seats, and any one of them forgetting to exclude a cancelled row would
-- silently mis-bill or double-book a horse. Nothing cancelled is ever a seat.

CREATE TABLE ride_cancellations (
    id BIGSERIAL PRIMARY KEY,
    ride_id BIGINT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    -- 'cancelled'   = not riding, nothing owed back
    -- 'rescheduled' = not riding, holds a credit for another day
    kind TEXT NOT NULL CHECK (kind IN ('cancelled', 'rescheduled')),
    -- true when they were also taken off the weekly slot, not just this day
    from_series BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ride_id, contact_id)
);

CREATE INDEX ride_cancellations_ride ON ride_cancellations (ride_id);
