-- Six riders started the term a week early, on 2026-08-03: Indigo (3 rides/wk),
-- Aira, Kaia J, Eliza, Norah, Ayaan. Their templates start 2026-08-03; every
-- OTHER rider on those shared rides gets a per-participant start of 2026-08-10,
-- so the early week materializes with only the early starters (and their
-- lessons price into advance invoices from 2026-08-03).

ALTER TABLE recurring_participants ADD COLUMN start_date DATE;

UPDATE recurring_rides SET start_date = '2026-08-03'
 WHERE notes LIKE 'MON-10%' OR notes LIKE 'MON-12%' OR notes LIKE 'TUE-03%'
    OR notes LIKE 'TUE-05%' OR notes LIKE 'WED-02%' OR notes LIKE 'WED-03%'
    OR notes LIKE 'THU-04%' OR notes LIKE 'FRI-03%';

UPDATE recurring_participants rp SET start_date = '2026-08-10'
  FROM recurring_rides r
 WHERE r.id = rp.recurring_id AND r.start_date = '2026-08-03'
   AND (rp.contact_id IS NULL OR rp.contact_id NOT IN (
        SELECT id FROM contacts
         WHERE name IN ('Indigo', 'Aira', 'Kaia J', 'Eliza', 'Norah', 'Ayaan')
           AND NOT archived));
