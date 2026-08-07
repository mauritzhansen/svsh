-- The horses 003 deactivated were pure test data — remove them completely,
-- along with the test references pointing at them. Rider seats keep the rider
-- (horse unassigned); horse-only seats and emptied blocks/rides are dropped.
-- Invoice lines are text/amount snapshots and survive any seat deletion.

-- Rider seats on a test horse: keep the rider, unassign the horse
UPDATE ride_participants SET horse_id = NULL
 WHERE horse_id IN (SELECT id FROM horses WHERE NOT active)
   AND contact_id IS NOT NULL;

-- Horse-only seats (open seats / blocks) on test horses go away
DELETE FROM ride_participants
 WHERE horse_id IN (SELECT id FROM horses WHERE NOT active);

-- Instructor mounts on test horses: instructor stays, on foot
UPDATE ride_guides SET mode = 'foot', horse_id = NULL
 WHERE horse_id IN (SELECT id FROM horses WHERE NOT active);

-- Rides left with nothing in them are meaningless now
DELETE FROM rides r
 WHERE NOT EXISTS (SELECT 1 FROM ride_participants rp WHERE rp.ride_id = r.id)
   AND NOT EXISTS (SELECT 1 FROM ride_guides rg WHERE rg.ride_id = r.id);

DELETE FROM horses WHERE NOT active;
