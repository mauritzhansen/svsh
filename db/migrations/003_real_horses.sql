-- The real SVSH horse list. Existing horses not on it (demo/test entries) are
-- deactivated, never deleted, so any rides/history they carry stay intact.
-- Safe to run on any environment: inserts only missing names, then aligns
-- order/colour/active state by (case-insensitive) name.

WITH real(name, ord, color) AS (
    VALUES ('Eva', 1, '#6a8caf'), ('Peaches', 2, '#c98d5f'), ('Stella', 3, '#7c4dbe'),
           ('Tara', 4, '#2e7d32'), ('Amber', 5, '#b3542f'), ('Northern', 6, '#1858a8'),
           ('Belle', 7, '#a34f8c'), ('Ice', 8, '#5b8a9e'), ('Sugar', 9, '#8a6d4f'),
           ('Piper', 10, '#0e7d6d'), ('Bella', 11, '#b58e5a'), ('Delilah', 12, '#9e7c0c'),
           ('Daisy', 13, '#c2185b'), ('Ophilia', 14, '#5a7d2e')
)
INSERT INTO horses (name, sort_order, color)
SELECT r.name, r.ord, r.color FROM real r
WHERE NOT EXISTS (SELECT 1 FROM horses h WHERE lower(h.name) = lower(r.name));

WITH real(name, ord, color) AS (
    VALUES ('Eva', 1, '#6a8caf'), ('Peaches', 2, '#c98d5f'), ('Stella', 3, '#7c4dbe'),
           ('Tara', 4, '#2e7d32'), ('Amber', 5, '#b3542f'), ('Northern', 6, '#1858a8'),
           ('Belle', 7, '#a34f8c'), ('Ice', 8, '#5b8a9e'), ('Sugar', 9, '#8a6d4f'),
           ('Piper', 10, '#0e7d6d'), ('Bella', 11, '#b58e5a'), ('Delilah', 12, '#9e7c0c'),
           ('Daisy', 13, '#c2185b'), ('Ophilia', 14, '#5a7d2e')
)
UPDATE horses h SET active = true, sort_order = r.ord, color = r.color
  FROM real r WHERE lower(h.name) = lower(r.name);

UPDATE horses SET active = false
 WHERE lower(name) NOT IN
       ('eva', 'peaches', 'stella', 'tara', 'amber', 'northern', 'belle', 'ice',
        'sugar', 'piper', 'bella', 'delilah', 'daisy', 'ophilia');