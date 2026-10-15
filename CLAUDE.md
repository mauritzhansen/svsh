# CLAUDE.md — SVSH (Sweet Valley School of Horsemanship)

Scheduling, contacts and invoicing for a riding stable. Solo-developer
app; production is live on a Hetzner box behind Caddy.

## Stack

- **Server**: single-file Express app (`server.js`), port 4700, no build step
- **Database**: PostgreSQL, local dev db `svsh` (`postgres://svsh@localhost/svsh`)
- **Frontend**: vanilla JS/CSS served from `public/`, fully self-contained (strict CSP, no external assets)
- **PDF**: pdfkit (invoices)
- **Tests**: none — verification is `node --check server.js`, targeted node scripts, and plan Verify steps

## Database rules (absolute)

Schema changes go BOTH into `db/schema.sql` (canonical, fresh installs)
AND into a new `db/migrations/NNN_*.sql` file (existing databases,
including production). Content updates (INSERT/UPDATE) go into migration
files only. `npm run db:migrate` applies pending migrations locally.
Applying anything to production is Mauritz's, by hand, over ssh — never
Claude's, never an agent's.

## Commands

```bash
npm start              # dev server on :4700 (Mauritz runs this himself)
npm run db:migrate     # apply pending migrations to local dev db
npm run db:schema      # load schema.sql into a fresh local db
npm run db:seed        # seed local dev data
```

## Fleet (lead / builder / reviewer)

This repo runs Timo's lead-agent workflow, trimmed for a solo app —
see `.claude/skills/lead/SKILL.md` (doctrine, a command table) and
`.claude/skills/planning/` (plan folders in `.cursor/plans/`).
Agent definitions: `.claude/agents/builder.md`, `reviewer.md`.
Mechanisms: `scripts/lead/ledger.mjs` + `watchdog.mjs`,
`scripts/lead/authorize.mjs` → `scripts/agent-integrate.mjs` (ff-only),
`scripts/agent-rebase.mjs`, `scripts/worktree-setup.mjs`.
Hooks in `.claude/hooks/` (tests: `python3 .claude/hooks/tests/run_tests.py`).

Pushing and deploying are Mauritz's, by hand, every time. `git push` is
permission-denied for everyone, including him inside Claude sessions.
