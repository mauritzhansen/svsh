-- Where the ride happens: the instructor decides unless stated.
ALTER TABLE rides ADD COLUMN venue TEXT NOT NULL DEFAULT 'instructor'
    CHECK (venue IN ('instructor', 'arena', 'outride'));
ALTER TABLE recurring_rides ADD COLUMN venue TEXT NOT NULL DEFAULT 'instructor'
    CHECK (venue IN ('instructor', 'arena', 'outride'));
