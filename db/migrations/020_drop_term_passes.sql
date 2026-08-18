-- Term passes are gone: per-term billing is now just an invoice over the
-- school's term dates, so the pass was a second, redundant record of coverage.
-- Verified empty on production (0 passes, 0 advance invoices) before dropping.

DROP TABLE IF EXISTS term_passes;
