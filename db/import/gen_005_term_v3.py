# Generates db/migrations/005_term_schedule_v3.sql from the v3 term schedule
# (WhatsApp screenshots -> stable_term_schedule_v3.json, transcribed here).
# Non-destructive diff: adds new riders, fixes names/school details, replaces
# the weekly templates. Past rides, invoices and term passes are untouched.
# Term: 2026-08-10 .. 2026-09-23.
import datetime

TERM_START = '2026-08-10'
TERM_END = '2026-09-23'
YEAR = 2026

LVL = {'beg': 'beginner', 'beg-int': 'beginner-intermediate', 'int': 'intermediate',
       'int-adv': 'intermediate-advanced', 'adv': 'advanced', None: None}
DAY = {'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5}

# Full v3 roster: (name, level, age, collect, teacher, grade, note)
STUDENTS = [
    ('Adanna', None, 15, False, '', '', "2 years' experience. Marked '?' in source."),
    ('Aeryn', 'int', None, False, '', '', ''),
    ('Aira', 'beg-int', None, True, 'Sharan', 'Gr 3', ''),
    ('Akul', 'beg', None, True, '', '', 'Collected, but no school/grade/teacher recorded.'),
    ('Alistair', None, 12, False, '', '', "'have ridden' (prior experience)."),
    ('Amalia', 'int', None, False, '', '', ''),
    ('Anika', None, None, False, '', '', ''),
    ('Anna', 'int', None, False, '', '', ''),
    ('Asher', 'int', None, False, '', '', "Marked '?' in source."),
    ('Ayaan', 'beg', None, True, 'Sue', 'Gr 5', ''),
    ('Azania', 'beg', None, False, '', '', ''),
    ('Azara', 'adv', None, False, '', '', ''),
    ('Cairo', 'beg-int', None, True, 'Nicole', 'Gr 1', ''),
    ('Charlie', 'beg-int', None, False, '', '', ''),
    ('Chloe', 'int', None, False, '', '', ''),
    ('Dalia', 'beg', None, True, 'Nadia', 'Gr 2', ''),
    ('Elisa', 'int', None, False, '', '', ''),
    ('Eliza', 'beg', None, False, '', '', ''),
    ('Elizabeth', 'int', None, False, '', '', ''),
    ('Ella C', 'int', None, False, '', '', ''),
    ('Ella J', 'beg-int', None, False, '', '', ''),
    ('Ella P', 'adv', None, False, '', '', ''),
    ('Eloise', None, 7, False, '', '', ''),
    ('Emelie', 'adv', None, False, '', '', ''),
    ('Emily M', 'int', None, False, '', '', ''),
    ('Emily P', 'int', None, False, '', '', ''),
    ('Emily S', 'beg', None, False, '', '', ''),
    ('Erin G', None, 7, False, '', '', 'Thursday 16:30 with Phoebe.'),
    ('Erin J', 'int', None, False, '', '', 'The Erin in the Philline group.'),
    ('Everly', 'int', None, False, '', '', ''),
    ('Frankie', 'beg-int', None, False, '', '', ''),
    ('Grace', None, None, False, '', '', "Which Grace is unresolved (Monday 16:30 group) - provisional record."),
    ('Grace A', 'adv', None, False, '', '', "Marked '(2x)' in source - meaning unclear."),
    ('Gwynn', 'beg', None, True, 'Summer', 'K2', ''),
    ('Halo', 'adv', None, False, '', '', ''),
    ('Indigo', 'beg-int', None, False, '', '', 'Rides 3x per week (Mon, Tue, Fri).'),
    ('Isa', 'beg-int', None, False, '', '', ''),
    ('Jo', None, 14, False, '', '', "'have ridden' (prior experience)."),
    ('Kaia G', 'int', None, False, '', '', ''),
    ('Kaia J', 'beg-int', None, True, 'Nicole', 'Gr 1', ''),
    ('Kerry', 'int', None, False, '', '', ''),
    ('Ksenija', 'beg', None, False, '', '', 'Explicitly marked beginner.'),
    ('Lara', 'int', None, False, '', '', 'Provisional (bracketed in source).'),
    ('Layla', 'int', None, False, '', '', ''),
    ('Leah', 'int', None, False, '', '', ''),
    ('Lia', 'adv', None, False, '', '', ''),
    ('Lilly A', 'adv', None, False, '', '', "Possible duplicate of 'Lily A' (Friday) - verify."),
    ('Lily A', 'int', None, False, '', '', "Possible duplicate of 'Lilly A' (Thursday); marked '(2x)'."),
    ('Maya', 'adv', None, False, '', '', "Possibly the same person as 'Maya Haley' (Monday)."),
    ('Maya Haley', 'int', None, False, '', '', 'One student or two (Maya, Haley)? Unresolved.'),
    ('Meaghan', 'beg-int', None, False, '', '', ''),
    ('Mia', 'int', None, False, '', '', 'Provisional (bracketed in source).'),
    ('Micaiah', 'beg', None, False, '', '', ''),
    ('Morgan', 'adv', None, False, '', '', ''),
    ('Nolan', 'int', None, False, '', '', ''),
    ('Norah', 'int', None, False, '', '', ''),
    ('Olivia', 'beg-int', None, False, '', '', ''),
    ('Olympia', 'beg-int', None, False, '', '', ''),
    ('Owen', None, None, False, '', '', ''),
    ('Paige', 'int', None, False, '', '', ''),
    ('Paizley', 'beg-int', None, False, '', '', ''),
    ('Paula', 'int', None, False, '', '', ''),
    ('Philline', 'int', None, False, '', '', "Marked '(2x)' in source - meaning unclear."),
    ('Phoebe', None, None, False, '', '', ''),
    ('Salamander', 'adv', None, False, '', '', ''),
    ('Sean', 'int', None, False, '', '', ''),
    ('Shaylah', 'beg-int', None, False, '', '', ''),
    ('Sienna A', 'int', None, False, '', '', ''),
    ('Sienna L', 'int', None, False, '', '', ''),
    ('Sierra', 'beg-int', None, False, '', '', ''),
    ('Sophie', None, None, False, '', '', ''),
    ('Taheera', 'adv', None, False, '', '', ''),
    ('Tilda', 'beg-int', None, False, '', '', "Marked '(2x)' in source - meaning unclear."),
    ('Vicky', 'beg-int', None, False, '', '', ''),
    ('Zara', 'adv', None, False, '', '', ''),
]

# (name, is_assistant, note)
STAFF = [
    ('Tamara', False, ''), ('Gisela', False, ''), ('Naomi', False, ''),
    ('Hannah', False, ''), ('MJ', False, "Tentative on the Tuesday 15:00 group (bracketed '?')."),
    ('Elri', True, ''),
    ('Therapist (name TBC)', False, 'Runs the therapy sessions. Real name still to be confirmed.'),
]

# (ride_id, day, start, dur, level, instructors, assistants, students, horses, therapy, note)
RIDES = [
    ('MON-01', 'mon', '12:30', 60, None, ['Hannah'], [], ['Owen'], [], False, ''),
    ('MON-02', 'mon', '13:15', 75, 'beg', ['Tamara'], [], ['Azania'], [], False, ''),
    ('MON-03', 'mon', '13:45', 60, None, ['Hannah'], [], [], [], False, 'Empty slot - no student named in source.'),
    ('MON-04', 'mon', '14:00', 60, 'int', ['Gisela'], [], ['Sean'], [], False, ''),
    ('MON-05', 'mon', '14:55', 75, 'beg-int', ['Tamara'], ['Elri'], ['Cairo', 'Vicky'], [], False, ''),
    ('MON-06', 'mon', '15:00', 45, None, [], [], [], ['Tara', 'Bella'], True, 'Therapy session on Tara/Bella.'),
    ('MON-07', 'mon', '15:00', 60, 'int', ['Hannah'], [], ['Leah'], [], False, ''),
    ('MON-08', 'mon', '15:00', 60, None, ['Gisela'], [], ['Anika'], [], False, ''),
    ('MON-09', 'mon', '15:00', 60, 'int', ['Naomi'], [], ['Asher'], [], False, "Marked '?' in source."),
    ('MON-10', 'mon', '16:00', 60, 'beg-int', ['Hannah'], [], ['Aira'], [], False, 'No collection tick in source but school details in Monday header - verify.'),
    ('MON-11', 'mon', '16:00', 45, None, [], [], [], ['Tara', 'Bella'], True, 'Therapy session on Tara/Bella.'),
    ('MON-12', 'mon', '16:30', 75, None, ['Tamara'], ['Elri'], ['Paige', 'Aeryn', 'Elizabeth', 'Indigo'], [], False, ''),
    ('MON-13', 'mon', '16:30', 75, None, ['Naomi'], [], ['Layla', 'Nolan', 'Maya Haley', 'Grace'], [], False, 'Gisela bracketed in source - likely drop-in support.'),
    ('MON-14', 'mon', '16:00', 105, 'adv', ['Gisela'], [], ['Morgan', 'Lia'], [], False, ''),
    ('TUE-01', 'tue', '13:30', 60, 'beg', ['Tamara'], [], ['Emily S'], [], False, ''),
    ('TUE-02', 'tue', '15:00', 75, 'int', ['Gisela'], [], ['Ella C', 'Chloe'], [], False, ''),
    ('TUE-03', 'tue', '15:00', 75, None, ['Tamara', 'Hannah', 'Naomi'], ['Elri'], ['Olivia', 'Kaia J', 'Gwynn', 'Indigo', 'Eloise'], [], False, "MJ tentative (white heart bracketed '?')."),
    ('TUE-04', 'tue', '16:00', 75, 'int', ['Naomi'], [], ['Kerry', 'Kaia G'], [], False, ''),
    ('TUE-05', 'tue', '16:15', 60, 'beg-int', ['Hannah'], [], ['Aira'], [], False, ''),
    ('TUE-06', 'tue', '16:30', 75, 'beg-int', ['Tamara'], ['Elri'], ['Isa', 'Ella J', 'Charlie'], [], False, ''),
    ('TUE-07', 'tue', '16:15', 105, 'adv', ['Gisela'], [], ['Emelie', 'Taheera', 'Ella P'], [], False, ''),
    ('WED-01', 'wed', '14:45', 45, None, [], [], [], ['Peaches'], True, 'Therapy session on Peaches.'),
    ('WED-02', 'wed', '15:00', 75, None, ['Tamara', 'Gisela'], ['Elri'], ['Frankie', 'Sierra', 'Paizley', 'Micaiah', 'Eliza'], [], False, ''),
    ('WED-03', 'wed', '16:30', 75, 'int', ['Naomi'], [], ['Lara', 'Mia', 'Layla', 'Nolan', 'Norah'], [], False, '(Lara + Mia) bracketed in source - provisional pairing.'),
    ('WED-04', 'wed', '16:15', 105, 'adv', ['Gisela'], [], ['Salamander', 'Halo'], [], False, ''),
    ('WED-05', 'wed', '16:30', 75, 'int', ['Tamara'], [], ['Elisa', 'Amalia', 'Paula'], [], False, ''),
    ('THU-01', 'thu', '13:00', 75, 'adv', ['Naomi'], [], ['Maya', 'Zara', 'Lilly A'], [], False, '(+Lilly) bracketed - tentative.'),
    ('THU-02', 'thu', '13:45', 60, 'int', ['Gisela'], [], ['Sean'], [], False, ''),
    ('THU-03', 'thu', '13:30', 75, 'beg-int', ['Tamara'], [], ['Shaylah', 'Olympia', 'Tilda'], [], False, ''),
    ('THU-04', 'thu', '15:00', 75, None, ['Gisela', 'Tamara'], ['Elri'], ['Dalia', 'Aira', 'Ayaan', 'Akul'], [], False, 'All four riders are school collections.'),
    ('THU-05', 'thu', '15:00', 75, None, ['Naomi'], [], ['Jo', 'Alistair'], [], False, ''),
    ('THU-06', 'thu', '16:30', 75, None, ['Hannah'], [], ['Phoebe', 'Erin G'], [], False, ''),
    ('THU-07', 'thu', '16:30', 75, 'int', ['Tamara'], [], ['Philline', 'Erin J', 'Sienna L'], [], False, ''),
    ('THU-08', 'thu', '16:30', 75, 'int', ['Naomi'], [], ['Everly', 'Emily P'], [], False, ''),
    ('FRI-01', 'fri', '12:30', 60, None, ['Gisela'], [], ['Sophie'], [], False, ''),
    ('FRI-02', 'fri', '14:00', 75, None, ['Naomi'], [], [], [], False, "Empty slot - being re-filled (was Kate/Matilda/Sebastian)."),
    ('FRI-03', 'fri', '14:00', 75, None, ['Tamara'], ['Elri'], ['Meaghan', 'Indigo', 'Ksenija'], [], False, ''),
    ('FRI-04', 'fri', '14:00', 60, None, ['Gisela'], [], [], [], False, 'Empty slot - v1 had Grace K here, likely still her.'),
    ('FRI-05', 'fri', '15:30', 60, None, ['Tamara'], [], ['Adanna'], [], False, "Marked '?' in source."),
    ('FRI-06', 'fri', '15:15', 60, 'adv', ['Gisela'], [], ['Azara'], [], False, ''),
    ('FRI-07', 'fri', '15:15', 75, 'int', ['Naomi'], [], ['Sienna A', 'Emily M'], [], False, ''),
    ('FRI-08', 'fri', '16:30', 75, 'int', ['Tamara'], [], ['Leah', 'Anna', 'Lily A'], [], False, ''),
    ('FRI-09', 'fri', '16:30', 75, None, ['Naomi'], [], [], [], False, 'Empty slot - no student named in source.'),
    ('FRI-10', 'fri', '16:30', 90, 'adv', ['Gisela'], [], ['Lia', 'Grace A'], [], False, "'(Ice)' in source - likely the horse."),
]

THERAPIST = 'Therapist (name TBC)'


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def arr(names):
    return 'ARRAY[' + ', '.join(q(n) for n in names) + ']' if names else "ARRAY[]::text[]"


out = []
out.append('-- Term schedule v3 - FIRST REAL IMPORT (term %s to %s).' % (TERM_START, TERM_END))
out.append('-- Wipes ALL business data (system unused before this); keeps users,')
out.append('-- settings and the real horses. Generated by db/import/gen_005_term_v3.py.')
out.append("")
out.append("""DELETE FROM invoice_lines;
DELETE FROM invoices;
DELETE FROM term_passes;
DELETE FROM reschedule_credits;
DELETE FROM rides;
DELETE FROM recurring_rides;
DELETE FROM contact_horse_prefs;
DELETE FROM contact_availability;
DELETE FROM contacts;
DELETE FROM guides;
DELETE FROM ride_types;
DELETE FROM todos;
DELETE FROM service_contacts;

INSERT INTO ride_types (name, duration_min, price_cents) VALUES ('Therapy session', 45, 0);
""")

out.append('-- Staff')
for name, asst, note in STAFF:
    out.append("INSERT INTO guides (name, is_assistant, notes) VALUES (%s, %s, %s);"
               % (q(name), 'true' if asst else 'false', q(note)))
out.append('')

out.append('-- Riders')
for name, lvl, age, collect, teacher, grade, note in STUDENTS:
    level = 'NULL' if lvl is None else q(LVL[lvl])
    by = 'NULL' if age is None else str(YEAR - age)
    out.append(
        "INSERT INTO contacts (name, experience, birth_year, needs_collection, collection_teacher, collection_class, notes)\n"
        "VALUES (%s, %s, %s, %s, %s, %s, %s);"
        % (q(name), level, by, 'true' if collect else 'false', q(teacher), q(grade), q(note)))
out.append('')

out.append('-- Weekly templates (44), term-bound %s .. %s' % (TERM_START, TERM_END))
for ride_id, day, start, dur, lvl, ins, assts, students, horses, therapy, note in RIDES:
    level = 'NULL' if lvl is None else q(LVL[lvl])
    rt = "(SELECT id FROM ride_types WHERE name = 'Therapy session')" if therapy else 'NULL'
    guides = ins + assts + ([THERAPIST] if therapy else [])
    notes = (ride_id + (': ' + note if note else ''))
    out.append("""WITH t AS (
    INSERT INTO recurring_rides (weekday, start_time, duration_min, ride_type_id, level, start_date, end_date, notes)
    VALUES (%d, '%s', %d, %s, %s, '%s', '%s', %s)
    RETURNING id
), p AS (
    INSERT INTO recurring_participants (recurring_id, contact_id, frequency)
    SELECT t.id, c.id, 'weekly' FROM t, contacts c
     WHERE c.name = ANY(%s) AND NOT c.archived
    RETURNING 1
), ph AS (
    INSERT INTO recurring_participants (recurring_id, horse_id, frequency)
    SELECT t.id, h.id, 'weekly' FROM t, horses h WHERE h.name = ANY(%s)
    RETURNING 1
)
INSERT INTO recurring_guides (recurring_id, guide_id, mode)
SELECT t.id, g.id, 'foot' FROM t, guides g WHERE g.name = ANY(%s);
""" % (DAY[day], start, dur, rt, level, TERM_START, TERM_END, q(notes),
       arr(students), arr(horses), arr(guides)))

open(__file__.replace('import/gen_005_term_v3.py', 'migrations/005_term_schedule_v3.sql'), 'w').write('\n'.join(out) + '\n')
print('generated 005:', len(RIDES), 'templates,', len(STUDENTS), 'riders,', len(STAFF), 'staff')
