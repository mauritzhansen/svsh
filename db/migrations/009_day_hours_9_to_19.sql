-- Calendar day range: the school runs 09:00-19:00
UPDATE settings SET value = '09:00' WHERE key = 'day_start';
UPDATE settings SET value = '19:00' WHERE key = 'day_end';
