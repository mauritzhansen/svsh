-- Notes meant for the instructors: shown on the ride and on the public
-- schedule, unlike the private `notes` field which stays in the dialog.
ALTER TABLE rides ADD COLUMN instructor_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE recurring_rides ADD COLUMN instructor_notes TEXT NOT NULL DEFAULT '';
