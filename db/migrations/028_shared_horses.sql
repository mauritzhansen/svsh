-- A horse with an owner is that contact's, not the school's. By default only
-- they (and the riders they pay for) can be given it when a ride is planned.
--
-- Some owners are happy for their horse to be used in lessons generally; this
-- flag says so, and then the horse behaves like a school horse in the pickers.
--
-- Default false: an owned horse is private unless the owner says otherwise,
-- which is the safer way round to get it wrong.

ALTER TABLE horses ADD COLUMN shared_with_school BOOLEAN NOT NULL DEFAULT false;
