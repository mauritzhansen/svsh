-- A note for the whole day, written by whoever is scheduling and read by the
-- instructors on their phones: "arena closed until 10", "Ella's mum collecting
-- at 4", "farrier here all morning". Per-ride instructor_notes already cover
-- one lesson; this is what applies to the day itself.
--
-- One row per date, created on first use and deleted when the note is cleared,
-- so the table only ever holds days that actually have something to say.

CREATE TABLE day_notes (
    note_date DATE PRIMARY KEY,
    note TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- who wrote it, so the instructors know who to ask; the note outlives the
    -- account that wrote it
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);
