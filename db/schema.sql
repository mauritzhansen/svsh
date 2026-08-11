-- StableBook schema

CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'helper' CHECK (role IN ('admin', 'helper', 'guide')),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE contacts (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    -- Most riders are kids: a rider can point at the parent contact who pays.
    -- One level only (a parent cannot itself have a parent). Invoices for the
    -- rider's rides go to the parent when set.
    parent_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
    -- Interested rider not yet placed in a lesson (intake/waiting list)
    is_prospect BOOLEAN NOT NULL DEFAULT false,
    birth_year INT, -- approximate age tracking; UI captures an age and stores the year
    experience TEXT CHECK (experience IN ('beginner', 'beginner-intermediate', 'intermediate', 'intermediate-advanced', 'advanced')),
    -- Kid riders that must be collected (from school) before their ride
    needs_collection BOOLEAN NOT NULL DEFAULT false,
    collection_teacher TEXT,
    collection_class TEXT,
    notes TEXT,
    archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Instructors/guides are the people who lead rides and lessons. They are a
-- resource like horses, not logins; they may or may not also have a user
-- account. is_assistant marks assistant instructors.
CREATE TABLE guides (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    color TEXT NOT NULL DEFAULT '#6a6a66', -- dot colour on the calendar
    is_assistant BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE horses (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#7c9885',
    -- Set when the horse belongs to a contact (livery) rather than the stable;
    -- pickers float it to the top for the owner and warn for anyone else
    owner_contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 0
);

-- Per-contact horse preferences: 'preferred' horses float to the top of the
-- booking pickers (⭐); 'caution' horses (esp. for kid riders) are shown
-- separated and flagged (⚠) with the reason, instead of hidden entirely.
CREATE TABLE contact_horse_prefs (
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    horse_id BIGINT NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('preferred', 'caution')),
    reason TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (contact_id, horse_id)
);

-- Weekly availability windows per contact (e.g. "Mon 14:00-17:00").
-- No rows at all = no restriction; with rows, bookings outside the windows
-- are flagged (not forbidden) in the pickers.
CREATE TABLE contact_availability (
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    weekday INT NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- ISO: 1=Monday .. 7=Sunday
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    PRIMARY KEY (contact_id, weekday, start_time),
    CHECK (start_time < end_time)
);

CREATE TABLE ride_types (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    duration_min INT NOT NULL DEFAULT 60,
    price_cents INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true
);

-- A repeating weekly ride/lesson template: same weekday/time every week, with
-- a group of riders and instructors. Materialized into rides on demand.
CREATE TABLE recurring_rides (
    id BIGSERIAL PRIMARY KEY,
    weekday INT NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- ISO: 1=Monday .. 7=Sunday
    start_time TIME NOT NULL,
    duration_min INT,
    ride_type_id BIGINT REFERENCES ride_types(id),
    level TEXT CHECK (level IN ('beginner', 'beginner-intermediate', 'intermediate', 'intermediate-advanced', 'advanced')),
    venue TEXT NOT NULL DEFAULT 'instructor' CHECK (venue IN ('instructor', 'arena', 'outride')),
    active BOOLEAN NOT NULL DEFAULT true,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE,
    notes TEXT
);

CREATE TABLE recurring_participants (
    id BIGSERIAL PRIMARY KEY,
    recurring_id BIGINT NOT NULL REFERENCES recurring_rides(id) ON DELETE CASCADE,
    contact_id BIGINT REFERENCES contacts(id) ON DELETE CASCADE,
    horse_id BIGINT REFERENCES horses(id) ON DELETE SET NULL, -- usually assigned on the day
    -- Default cadence is every week (unmarked); 'biweekly' = every second week,
    -- anchored on biweekly_anchor (falls back to the template start_date)
    frequency TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly', 'biweekly')),
    biweekly_anchor DATE,
    start_date DATE, -- per-rider start when later/earlier than the template's
    CHECK (contact_id IS NOT NULL OR horse_id IS NOT NULL)
);

CREATE TABLE recurring_guides (
    id BIGSERIAL PRIMARY KEY,
    recurring_id BIGINT NOT NULL REFERENCES recurring_rides(id) ON DELETE CASCADE,
    guide_id BIGINT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'foot' CHECK (mode IN ('foot', 'horse', 'running', 'cycling')),
    horse_id BIGINT REFERENCES horses(id) ON DELETE SET NULL
);

-- A ride is one outing/lesson at a date/time: one or more seats
-- (ride_participants: rider and/or horse; horses are often assigned later)
-- and any number of instructors/guides.
-- is_block marks "these horses are unavailable" rather than a bookable ride.
CREATE TABLE rides (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    duration_min INT, -- overrides the ride type's duration (60 when neither set)
    ride_type_id BIGINT REFERENCES ride_types(id),
    ride_type_name TEXT, -- snapshot, filled when the ride type is deleted so history keeps its label
    is_block BOOLEAN NOT NULL DEFAULT false,
    all_day BOOLEAN NOT NULL DEFAULT false, -- whole-day block (only used with is_block)
    -- where it happens; 'instructor' = the instructor decides on the day
    venue TEXT NOT NULL DEFAULT 'instructor' CHECK (venue IN ('instructor', 'arena', 'outride')),
    -- Experience level of the ride; drives the calendar colour coding
    level TEXT CHECK (level IN ('beginner', 'beginner-intermediate', 'intermediate', 'intermediate-advanced', 'advanced')),
    -- 'cancelled' is a tombstone for a deleted occurrence of a recurring ride:
    -- hidden everywhere but kept so re-materialization does not recreate it.
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    recurring_id BIGINT REFERENCES recurring_rides(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (recurring_id, date)
);

CREATE TABLE ride_participants (
    id BIGSERIAL PRIMARY KEY,
    ride_id BIGINT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    horse_id BIGINT REFERENCES horses(id), -- NULL = horse not assigned yet
    alt_horse_id BIGINT REFERENCES horses(id), -- optional stand-in, instructor picks on the day
    contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL, -- NULL = open seat
    -- Seat came from the weekly template (a fixed lesson) — term passes cover
    -- only these (plus credit-based make-ups), not extra ad-hoc bookings
    from_recurring BOOLEAN NOT NULL DEFAULT false,
    price_cents INT, -- optional override; invoicing falls back to the ride type price
    UNIQUE (ride_id, horse_id),
    UNIQUE (ride_id, contact_id),
    CHECK (horse_id IS NOT NULL OR contact_id IS NOT NULL)
);

CREATE TABLE ride_guides (
    id BIGSERIAL PRIMARY KEY,
    ride_id BIGINT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    guide_id BIGINT NOT NULL REFERENCES guides(id),
    mode TEXT NOT NULL DEFAULT 'foot' CHECK (mode IN ('foot', 'horse', 'running', 'cycling')),
    horse_id BIGINT REFERENCES horses(id), -- which horse the guide rides (mode 'horse')
    UNIQUE (ride_id, guide_id)
);

CREATE INDEX idx_rides_date ON rides(date);
CREATE INDEX idx_participants_ride ON ride_participants(ride_id);
CREATE INDEX idx_participants_contact ON ride_participants(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX idx_ride_guides_ride ON ride_guides(ride_id);

CREATE TABLE invoices (
    id BIGSERIAL PRIMARY KEY,
    number TEXT UNIQUE NOT NULL,
    contact_id BIGINT NOT NULL REFERENCES contacts(id),
    period_start DATE,
    period_end DATE,
    -- 'monthly' = after the fact (rides that happened); 'advance' = up front (term pass)
    kind TEXT NOT NULL DEFAULT 'monthly' CHECK (kind IN ('monthly', 'advance')),
    -- Invoices are per rider, billed to the payer (parent) in contact_id
    rider_contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid')),
    total_cents INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoice_lines (
    id BIGSERIAL PRIMARY KEY,
    invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    participant_id BIGINT UNIQUE REFERENCES ride_participants(id) ON DELETE SET NULL, -- UNIQUE: a seat can only be invoiced once
    description TEXT NOT NULL,
    ride_date DATE,
    amount_cents INT NOT NULL DEFAULT 0
);

-- A "right to a new ride", granted when a rider couldn't make a booked ride
-- and it was rescheduled rather than cancelled. Open until used_ride_id is set.
CREATE TABLE reschedule_credits (
    id BIGSERIAL PRIMARY KEY,
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_at TIMESTAMPTZ,
    used_ride_id BIGINT REFERENCES rides(id) ON DELETE SET NULL
);

-- Prepaid coverage of a rider's FIXED lessons for a date range, invoiced in
-- advance. Extra ad-hoc rides in the period stay billable after the fact.
CREATE TABLE term_passes (
    id BIGSERIAL PRIMARY KEY,
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, -- the rider covered
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    invoice_id BIGINT REFERENCES invoices(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (period_start <= period_end)
);

-- Simple to-dos; dated (and optionally timed) ones double as the day's
-- activities in the calendar's first column. Done items go to the archive.
CREATE TABLE todos (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    todo_date DATE,
    todo_time TIME,
    done_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- School directory: external service contacts (vet, farrier, handyman, ...).
-- Instructors appear in the directory from the guides table -- don't duplicate
-- them here; riders/parents live in contacts.
CREATE TABLE service_contacts (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
    ('business_name', 'Sweet Valley School of Horsemanship'),
    ('business_address', ''),
    ('currency', 'R'),
    ('invoice_footer', 'Thank you for riding with us!'),
    ('day_start', '09:00'),
    ('day_end', '19:00');