-- Quarter livery: a third share alongside full and half.
--
-- The share scales the base livery price only. The standard monthly charges
-- (bedding, feed) remain a cost per horse and are billed in full on a quarter
-- share, exactly as they are on a half.

ALTER TABLE horses DROP CONSTRAINT horses_livery_share_check;
ALTER TABLE horses ADD CONSTRAINT horses_livery_share_check
    CHECK (livery_share IN (25, 50, 100));
