-- Some riders pay an arena fee once a quarter, on top of their lessons. The
-- amount is one school-wide setting (settings.arena_fee_cents); this flag says
-- who it applies to.

ALTER TABLE contacts ADD COLUMN pays_arena_fee BOOLEAN NOT NULL DEFAULT false;
