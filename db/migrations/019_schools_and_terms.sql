-- Riders on per-term billing are invoiced for their SCHOOL's term, and the
-- schools do not share term dates. So the term dates live per school per year,
-- and each rider records which school they attend.
--
-- The three schools are seeded with the names as given; they can be renamed in
-- Settings without a migration.

CREATE TABLE schools (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 0
);

-- One row per school per term per year. term_no 1..4.
CREATE TABLE school_terms (
    id BIGSERIAL PRIMARY KEY,
    school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    year INT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    term_no INT NOT NULL CHECK (term_no BETWEEN 1 AND 4),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    UNIQUE (school_id, year, term_no),
    CHECK (period_start <= period_end)
);

CREATE INDEX school_terms_lookup ON school_terms (year, term_no);

-- Which school the rider attends; needed to pick their term dates
ALTER TABLE contacts ADD COLUMN school_id BIGINT REFERENCES schools(id) ON DELETE SET NULL;
CREATE INDEX contacts_school ON contacts (school_id) WHERE school_id IS NOT NULL;

INSERT INTO schools (name, sort_order) VALUES
    ('Redham Waldorf', 1),
    ('AISC T', 2),
    ('South African', 3);