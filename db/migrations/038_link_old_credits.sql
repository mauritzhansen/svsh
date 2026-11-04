-- Credits raised before migration 033 carry no missed_ride_id; the lesson is
-- named only in the note ("Missed ride on 2026-10-16 at 15:15"). Link them to
-- that lesson where it can be found unambiguously, so undoing the reschedule
-- takes the credit back and the picker can name the day.
UPDATE reschedule_credits cr SET missed_ride_id = m.ride_id
  FROM (
    SELECT DISTINCT ON (cr2.contact_id, r.id) cr2.id AS credit_id, r.id AS ride_id
      FROM reschedule_credits cr2
      JOIN ride_cancellations rc ON rc.contact_id = cr2.contact_id AND rc.kind = 'rescheduled'
      JOIN rides r ON r.id = rc.ride_id
     WHERE cr2.missed_ride_id IS NULL
       AND cr2.note = 'Missed ride on ' || r.date::text || ' at ' || to_char(r.start_time, 'HH24:MI')
       AND NOT EXISTS (SELECT 1 FROM reschedule_credits o
                        WHERE o.contact_id = cr2.contact_id AND o.missed_ride_id = r.id)
     ORDER BY cr2.contact_id, r.id, cr2.created_at
  ) m
 WHERE cr.id = m.credit_id;
