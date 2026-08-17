-- What an instructor is paid for taking one lesson. Stored in cents like every
-- other amount, so no rounding creeps in. NULL = not set yet, which reads
-- differently from "works for free".

ALTER TABLE guides ADD COLUMN rate_cents INT CHECK (rate_cents IS NULL OR rate_cents >= 0);
