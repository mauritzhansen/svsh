// Seed demo data: a few horses, ride types and contacts so the app is not empty.
// The first user account is created through the app itself on first visit.
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost/svsh'
});

async function main() {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM horses');
    if (rows[0].n > 0) {
        console.log('Horses already exist, skipping seed.');
        return;
    }

    const horses = [
        ['Spirit', '#7c9885'],
        ['Luna', '#8d7c9a'],
        ['Biscuit', '#b58e5a'],
        ['Storm', '#6a8caf'],
        ['Daisy', '#c98d8d']
    ];
    for (let i = 0; i < horses.length; i++) {
        await pool.query(
            'INSERT INTO horses (name, color, sort_order) VALUES ($1, $2, $3)',
            [horses[i][0], horses[i][1], i]
        );
    }

    await pool.query(`
        INSERT INTO ride_types (name, duration_min, price_cents) VALUES
        ('Outride 1 hour', 60, 35000),
        ('Lesson 30 min', 30, 25000),
        ('Pony ride', 20, 15000)
    `);

    console.log('Seeded demo horses and ride types. Contacts and instructors come from db/import_term.js.');
}

main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());