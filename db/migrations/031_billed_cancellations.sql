-- Taking a rider off one week has three meanings, and they differ only in money:
--
--   rescheduled   they get a credit for another day (ride_cancellations.kind)
--   cancelled     they cancelled late, so the lesson is still charged  <- new
--   cancelled     they are off and not charged at all
--
-- The seat is removed in every case, so the day reads the same. This flag says
-- whether the lesson is still owed for, and invoicing bills the ones marked.
--
-- Default false keeps every existing cancellation uncharged, which is what they
-- were when they were recorded.

ALTER TABLE ride_cancellations ADD COLUMN billed BOOLEAN NOT NULL DEFAULT false;

-- Mirrors participant_id and charge_id: UNIQUE so a cancelled lesson cannot be
-- charged twice, and the line goes with its invoice, freeing it to bill again.
ALTER TABLE invoice_lines ADD COLUMN cancellation_id BIGINT UNIQUE
    REFERENCES ride_cancellations(id) ON DELETE SET NULL;
