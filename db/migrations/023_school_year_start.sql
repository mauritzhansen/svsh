-- Schools do not share an academic year. AISCT runs August to July, so its
-- Terms 1 and 2 fall in one calendar year and Terms 3 and 4 in the next. The
-- other schools run January to December, where the academic and calendar year
-- are the same thing.
--
-- Without this, AISCT's terms had to be filed under the calendar year they fall
-- in, which put Term 3 (January) after Term 1 (August) in the same row of the
-- settings grid and made the term numbers on invoices wrong.
--
-- With it, school_terms.year means the year the ACADEMIC year starts in. For
-- AISCT, year 2026 = August 2026 to July 2027 and holds all four of its terms
-- in order. For a January school, year 2026 is simply 2026, exactly as before.
--
-- Stored as a month number rather than a two-value flag so a school starting in
-- any other month needs no further migration. Default 1 keeps every existing
-- school on the calendar year, so nothing already entered changes meaning.

ALTER TABLE schools ADD COLUMN year_start_month INT NOT NULL DEFAULT 1
    CHECK (year_start_month BETWEEN 1 AND 12);
