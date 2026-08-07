-- Read-only day/week schedule for instructors, shared as one unguessable link
-- (no login). The token is the only secret, so it can be rotated in Settings.
INSERT INTO settings (key, value)
SELECT 'public_schedule_token', md5(random()::text || clock_timestamp()::text) ||
                                 md5(random()::text || clock_timestamp()::text)
 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'public_schedule_token');
