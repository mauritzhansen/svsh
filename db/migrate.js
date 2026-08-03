// Applies db/migrations/*.sql in filename order, once each, tracked in the
// schema_migrations table. Each migration runs in its own transaction.
//
//   npm run db:migrate              apply pending migrations
//   npm run db:migrate -- --baseline   record all files as applied WITHOUT
//                                      running them (fresh install after
//                                      schema.sql, which is always current)
//
// Rules: schema changes go BOTH into db/schema.sql (canonical, for fresh
// installs) AND into a new migration file (for existing databases, incl.
// production). Content updates (INSERT/UPDATE) go into migration files only.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://svsh@localhost/svsh'
});

async function main() {
    const baseline = process.argv.includes('--baseline');
    const { rows: who } = await pool.query('SELECT current_user, current_database()');
    console.log(`Migrating database "${who[0].current_database}" as role "${who[0].current_user}"`);
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
        await pool.query('SELECT 1 FROM schema_migrations LIMIT 1');
    } catch (err) {
        if (err.code === '42501') {
            console.error(
                `Permission denied on schema_migrations: it is owned by a different role than "${who[0].current_user}".\n` +
                `Fix as the owner/superuser:  ALTER TABLE schema_migrations OWNER TO ${who[0].current_user};\n` +
                `Then always run db:migrate as the same role the app connects as.`);
            process.exitCode = 1;
            return;
        }
        throw err;
    }
    const dir = path.join(__dirname, 'migrations');
    const files = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
        : [];
    const { rows } = await pool.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));
    let ran = 0;
    for (const file of files) {
        if (applied.has(file)) continue;
        if (baseline) {
            await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
            console.log(`baseline: ${file}`);
            ran++;
            continue;
        }
        const sql = fs.readFileSync(path.join(dir, file), 'utf8');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
            await client.query('COMMIT');
            console.log(`applied: ${file}`);
            ran++;
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(`FAILED: ${file}\n${err.message}`);
            process.exitCode = 1;
            return;
        } finally {
            client.release();
        }
    }
    console.log(ran ? `Done (${ran} ${baseline ? 'baselined' : 'applied'}).` : 'Nothing to do — up to date.');
}

main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());