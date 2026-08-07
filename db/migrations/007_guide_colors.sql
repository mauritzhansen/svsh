-- Instructors get a colour so they can be told apart at a glance on the
-- calendar (dot next to their name) and in the staff lists.
ALTER TABLE guides ADD COLUMN color TEXT NOT NULL DEFAULT '#6a6a66';

-- Distinct starting colours, assigned in name order; editable in Settings.
WITH numbered AS (
    SELECT id, row_number() OVER (ORDER BY is_assistant, name) AS n FROM guides
), palette(n, color) AS (
    VALUES (1, '#1565c0'), (2, '#c2185b'), (3, '#2e7d32'), (4, '#e65100'),
           (5, '#6a1b9a'), (6, '#00838f'), (7, '#a67f00'), (8, '#5d4037')
)
UPDATE guides g SET color = p.color
  FROM numbered nm JOIN palette p ON p.n = ((nm.n - 1) % 8) + 1
 WHERE g.id = nm.id;
