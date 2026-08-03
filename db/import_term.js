// Imports the term schedule from db/import/{students,rides}.csv.
// DESTRUCTIVE: wipes all rides, fixed rides, invoices, contacts and
// instructors first (horses, ride types, users and settings are kept).
// Safe to re-run: it always rebuilds from the CSVs.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://svsh@localhost/svsh'
});

const LEVEL_MAP = {
    'beg': 'beginner',
    'beg-int': 'beginner-intermediate',
    'int': 'intermediate',
    'int-adv': 'intermediate-advanced',
    'adv': 'advanced'
};
const WEEKDAY_MAP = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };

// Minimal CSV parser (handles quoted fields with commas and "" escapes)
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') inQuotes = false;
            else field += ch;
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            row.push(field); field = '';
        } else if (ch === '\n') {
            row.push(field); field = '';
            if (row.some((f) => f !== '')) rows.push(row);
            row = [];
        } else if (ch !== '\r') {
            field += ch;
        }
    }
    if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
    const header = rows.shift();
    return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] || ''])));
}

function multi(value) {
    return String(value || '').split('|').map((s) => s.trim()).filter(Boolean);
}

async function main() {
    const students = parseCsv(fs.readFileSync(path.join(__dirname, 'import', 'students.csv'), 'utf8'));
    const rides = parseCsv(fs.readFileSync(path.join(__dirname, 'import', 'rides.csv'), 'utf8'));
    console.log(`Read ${students.length} students, ${rides.length} rides.`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Wipe (order matters for FKs)
        for (const table of ['invoice_lines', 'invoices', 'rides', 'recurring_rides',
                             'contact_horse_prefs', 'contact_availability', 'contacts', 'guides']) {
            await client.query(`DELETE FROM ${table}`);
        }

        // Instructors and assistants. A name seen as a lead instructor anywhere
        // wins over being listed as an assistant elsewhere.
        const instructorNames = new Set();
        const assistantNames = new Set();
        rides.forEach((r) => {
            multi(r.instructors).concat(multi(r.instructor_alternates)).forEach((n) => instructorNames.add(n));
            multi(r.assistant_instructors).concat(multi(r.assistant_alternates)).forEach((n) => assistantNames.add(n));
        });
        const guideIds = {};
        for (const name of [...instructorNames].sort()) {
            const { rows } = await client.query(
                'INSERT INTO guides (name, is_assistant) VALUES ($1, false) RETURNING id', [name]);
            guideIds[name] = rows[0].id;
        }
        for (const name of [...assistantNames].sort()) {
            if (guideIds[name]) continue;
            const { rows } = await client.query(
                'INSERT INTO guides (name, is_assistant) VALUES ($1, true) RETURNING id', [name]);
            guideIds[name] = rows[0].id;
        }

        // Students -> contacts
        const contactIds = {};
        for (const s of students) {
            const notes = [
                s.flags,
                s.marked_2x === 'true' ? "Marked '(2x)' in the term schedule — meaning unclear (two lessons? two horses? double billing?)." : '',
                s.tentative === 'true' ? 'Tentative enrolment.' : '',
                s.level_conflict ? `Level differs between rides in the source: ${s.level_conflict.replace('|', ' vs ')}.` : ''
            ].filter(Boolean).join(' ');
            const { rows } = await client.query(
                `INSERT INTO contacts (name, experience, needs_collection, collection_teacher, collection_class, notes)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [s.name, LEVEL_MAP[s.level] || null, s.needs_collection === 'true',
                 s.school_teacher || '', s.school_grade || '', notes]);
            contactIds[s.student_id] = rows[0].id;
        }

        // Rides -> fixed weekly ride templates (everyone weekly per the source)
        for (const r of rides) {
            const noteParts = [r.flags];
            if (r.instructor_alternates) noteParts.push(`Instructor alternate(s): ${multi(r.instructor_alternates).join(', ')}.`);
            if (r.assistant_alternates) noteParts.push(`Assistant alternate(s): ${multi(r.assistant_alternates).join(', ')}.`);
            const { rows } = await client.query(
                `INSERT INTO recurring_rides (weekday, start_time, duration_min, level, notes, start_date)
                 VALUES ($1, $2, $3, $4, $5, CURRENT_DATE) RETURNING id`,
                [WEEKDAY_MAP[r.day], r.start_time, parseInt(r.duration_min, 10) || null,
                 LEVEL_MAP[r.level] || null, noteParts.filter(Boolean).join(' | ')]);
            const recurringId = rows[0].id;
            for (const sid of multi(r.student_ids)) {
                if (!contactIds[sid]) { console.warn(`  ${r.ride_id}: unknown student '${sid}'`); continue; }
                await client.query(
                    `INSERT INTO recurring_participants (recurring_id, contact_id, frequency)
                     VALUES ($1, $2, 'weekly')`,
                    [recurringId, contactIds[sid]]);
            }
            for (const name of multi(r.instructors).concat(multi(r.assistant_instructors))) {
                await client.query(
                    `INSERT INTO recurring_guides (recurring_id, guide_id, mode)
                     VALUES ($1, $2, 'foot')`,
                    [recurringId, guideIds[name]]);
            }
        }

        await client.query('COMMIT');
        console.log(`Imported ${Object.keys(guideIds).length} instructors, ${Object.keys(contactIds).length} students, ${rides.length} fixed weekly rides.`);
        console.log('Templates start from today; the calendar materializes them as days are viewed.');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());