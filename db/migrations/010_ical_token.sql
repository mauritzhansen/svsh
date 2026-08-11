-- Token for the private iCal subscription feed (dated to-dos). Separate from
-- the instructor schedule token so either can be rotated on its own.
INSERT INTO settings (key, value)
SELECT 'ical_token', md5(random()::text || clock_timestamp()::text) ||
                     md5(random()::text || clock_timestamp()::text)
 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'ical_token');
