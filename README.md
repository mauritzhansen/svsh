# SVSH — Sweet Valley School of Horsemanship 🐴

Simple scheduling, contacts and invoicing for the Sweet Valley School of
Horsemanship (production: svsh.aplacetostay.co.za). Built to be self-hosted
cheaply: one Node.js process + one PostgreSQL database, no external services,
no frameworks.

Rides are group lessons or outrides: one or more riders (horses usually
assigned on the day), one or more instructors (on foot, on a horse, running or
cycling), an experience level (beginner → advanced, 5 steps, colour-coded in
the calendar) and a duration. Fixed weekly rides repeat automatically;
individual riders on them can be marked "every 2nd week".

## Term schedule import

`npm run db:import-term` loads `db/import/students.csv` + `db/import/rides.csv`
(the transcribed term schedule): **destructive** — wipes all rides, fixed
rides, invoices, contacts and instructors first (horses, ride types, users and
settings are kept). Source ambiguities are preserved as notes on the imported
records.

## Features

- **Day calendar** — all horses side by side, slots colour-coded open / booked / blocked. Tap a slot to book a contact onto it.
- **Open slots** — create bookable times in bulk (pick horses + times for a day).
- **Fixed weekly slots** — "every Tuesday 15:00 on Luna for Anna" repeats automatically; can also repeat as an open slot.
- **Contacts** — searchable list with phone/email/address, ride history and invoices per contact. A kid rider can be linked to a parent contact: rides are booked on the rider, the invoice goes to the parent (lines show the rider's name).
- **Guides** — the people who lead rides, assignable to any slot. Managed under Settings; they don't need login accounts.
- **Ride types with fixed prices** — e.g. Outride 1 hour, Lesson 30 min, Pony ride.
- **Automatic monthly invoicing** — when a month ends, every contact with rides gets an invoice automatically. Reconcile with the bank statement and mark as *paid*. PDFs are generated on demand.
- **Users & roles** — `admin` (everything), `helper` (everything except users/business settings), `guide` (calendar and contacts only).
- **Mobile-first** — designed to be used from a phone; add it to the home screen.

## Setup

Requires Node.js 18+ and PostgreSQL.

```bash
npm install
npm run db:create      # createdb svsh
npm run db:schema      # apply db/schema.sql
npm run db:seed        # optional: demo horses, ride types, contacts
npm start              # http://localhost:4700
```

On first visit the app asks you to create the initial admin account.

Configuration via environment variables:

- `DATABASE_URL` — Postgres connection string (default `postgres://localhost/svsh`)
- `PORT` — HTTP port (default `4700`)

## Deployment

Same pattern as other self-hosted projects: run `node server.js` behind an
nginx reverse proxy (which should terminate TLS), with PostgreSQL on the same
box. Back up with a nightly `pg_dump svsh`.

### Database role (one-time per environment)

The app and all db scripts connect explicitly as the `svsh` Postgres role
(`postgres://svsh@localhost/svsh` by default, or set `DATABASE_URL`), so
ambient `PGUSER`/`PGDATABASE` from other projects can't interfere. Set up once
per environment (local or server), as a superuser:

```sql
CREATE ROLE svsh LOGIN;              -- add PASSWORD '...' on servers
ALTER DATABASE svsh OWNER TO svsh;
-- if the db pre-dates the role, transfer existing objects too:
-- ALTER TABLE <each table> OWNER TO svsh; ALTER SEQUENCE <each> OWNER TO svsh;
```

All objects must stay owned by `svsh`; always run `db:migrate` as `svsh` so
newly created tables keep consistent ownership.

### Database updates (migrations)

The database is updated with numbered SQL files in `db/migrations/`, applied
once each and tracked in `schema_migrations`:

```bash
npm run db:migrate     # apply pending migrations (run on the server after git pull)
```

Conventions:
- Every schema change goes BOTH into `db/schema.sql` (canonical, used by fresh
  installs / `db:reset`) AND into a new `db/migrations/NNN_name.sql` file.
- Content updates (INSERT/UPDATE fixes) go into migration files only.
- Fresh installs (`npm run db:reset`) load `schema.sql` and then baseline all
  migration files as already-applied (`node db/migrate.js --baseline`).

Deploying to production — code AND database together — is one command from
your machine:

```bash
git push prod master
```

The server's post-receive hook checks out the code, runs `npm ci`, applies any
new `db/migrations/*.sql` (same `schema_migrations` tracking as `db:migrate`,
using the app's `DATABASE_URL` from `/etc/svsh.env`), restarts the service and
verifies it came up — all shown live in the push output. `npm run db:migrate`
is for local development; SSH-ing in manually is only for troubleshooting.

## Data model (short version)

- `slots` — one horse at one date/time; status `open`, `booked` (has a contact), `blocked`, or `cancelled` (hidden tombstone for a removed occurrence of a fixed slot).
- `recurring_slots` — weekly templates, materialized into `slots` on demand; materialization only ever inserts missing rows, never deletes.
- `invoices` / `invoice_lines` — a ride can be invoiced only once (`invoice_lines.slot_id` is UNIQUE); invoiced rides are locked. Deleting an invoice frees its rides again.
- Prices come from the ride type at invoicing time (`slots.price_cents` can override per ride).