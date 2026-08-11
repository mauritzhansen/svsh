-- An optional second horse per seat: the instructor picks on the day.
ALTER TABLE ride_participants ADD COLUMN alt_horse_id BIGINT REFERENCES horses(id);
