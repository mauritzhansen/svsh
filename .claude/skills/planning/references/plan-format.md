# PLAN.md Format

Structured execution plan written to `.cursor/plans/{feature}/PLAN.md`. The build agent reads this alongside CONTEXT.md. Every task must have enough information to execute and commit without asking further questions.

---

## Template

```markdown
---
feature: {feature-slug}
created: {YYYY-MM-DD}
status: planning        # planning | in-progress | complete | verified
context: .cursor/plans/{feature}/CONTEXT.md
---

# Plan: {Feature Name}

## Objective

{2-3 sentences: what this builds, why it matters, what "done" looks like.}

---

## Must-Haves

These are checked during verification. Build is not complete until all pass.

### Truths — observable behaviors when done
- {User can see / User can do / System does X when Y}
- {Each truth is independently testable}

### Artifacts — files that must exist and be substantive (not stubs)
- `{src/path/to/File.jsx}` — {what it does}
- `{src/path/to/service.js}` — {what it does}

### Key Links — wiring that must exist
- {ComponentA} imports and calls {ServiceB}
- {ScreenX} renders {ComponentY} when {condition}
- {SaveFlow} calls {MutationService.patch} on save

---

## Tasks

Tasks are ordered by dependency (Wave 1 has no dependencies; later waves depend on earlier ones).
Within a wave, tasks run sequentially unless marked `**Parallel:** yes` — a task may carry that
marker only when it touches no file any other task in the wave touches and nothing in the wave
depends on its result (in this repo one builder owns the whole plan, so the marker documents independence rather than driving dispatch).
Tasks are not committed one by one: a wave lands as ONE commit at its boundary (each task's `**Commit:**` line is the bullet it contributes to that commit's message).
Every `**Verify:**` line must be a command that can FAIL — see "Verify lines
must be able to fail" in the Rules section below before writing one.

### Wave 1 — {What this wave enables, e.g. "Data layer"}

#### Task 1.1 — {Task name}
**Files:** `{files to create or modify}`
**Parallel:** yes   {omit the line — or write `no` — when the task shares a file with, or must precede, another task in this wave}
**Action:** {Precise description of what to do. Reference CONTEXT.md decisions.
Include exact function signatures, component names, schema fields as needed.
Do not leave anything ambiguous.}
**Verify:** {A command that fails when the task is not done. SVSH examples:
`node --check server.js`; a targeted node script that exercises the route or
query against the local dev db and exits non-zero on the wrong answer.}
**Commit:** `{type}({scope}): {description}`

#### Task 1.2 — {Task name}
**Files:** `{files}`
**Parallel:** yes
**Action:** {description}
**Verify:** {Schema example: `psql -U svsh svsh -c "\\d {table}"` piped
through grep for the new column — fails when the migration didn't apply.}
**Commit:** `feat({scope}): {description}`

### Wave 2 — {What this wave enables, depends on Wave 1}

#### Task 2.1 — {Task name}
**Files:** `{files}`
**Action:** {description}
**Verify:** {Not every check is a test run — a grep, a build, a script is fine,
as long as you can say what makes it fail. `grep -n "{symbol}" {file}` fails
when the wiring is missing; "confirm it looks right" does not fail at all.}
**Commit:** `feat({scope}): {description}`

---

## Commit Convention

Format: `{type}({scope}): {description}`

| Type | When |
|------|------|
| `feat` | New functionality |
| `fix` | Bug fix |
| `refactor` | Restructure without behavior change |
| `style` | UI/styling only |
| `docs` | Documentation only |
| `chore` | Config, tooling, build |

Scope = feature slug or module (e.g. `litters`, `dog-edit`, `cache`).

---

## Out of Scope

{Anything explicitly excluded from this plan that might seem related.}
```

---

## Rules

- All git operations follow the repo's git rules in CLAUDE.md: explicit `--` pathspecs, never `git add .`, never push/stash.
- Every task must have a commit message — recorded in STATE.md when the task completes. Commits happen at wave boundaries, one commit per wave, never per task and never mid-task (Timo 2026-09-16).
- Each task must own distinct files where possible — so a reviewer can attribute each hunk of the wave commit to a task.
- **Mark parallelism explicitly (2026-09-01).** `**Parallel:** yes` on a task asserts two things the planner has checked: its `Files` are disjoint from every other task in the wave, and no task in the wave reads its output. In this repo the lead dispatches ONE builder per plan, so `Parallel: yes` is not a dispatch instruction — it documents independence for the reviewer's hunk-to-task attribution and keeps the option of concurrent builders open. A wrong marker surfaces as a rebase conflict or a red verify, so mark only what you have checked — the default is sequential.
- Waves define dependency order — never start a wave before all tasks in the previous wave are committed.
- Must-haves are the verification contract — write them before writing tasks. If you cannot write a truth, you do not understand the feature well enough to plan it.
- Tasks must be executable without questions — if a task requires a decision not in CONTEXT.md, stop and update CONTEXT.md first.

## Verify lines must be able to fail

A `**Verify:**` line is the contract a builder discharges to call a task done,
so a command that cannot fail records a verification that never happened.
Before writing one, ask: **what would make this command fail?** If the answer
is "nothing I can name", it is not a verification — and "placeholder",
"sanity check" and "approximate" are never acceptable answers.

Shapes that read green while checking nothing, adapted to SVSH (no test
framework here — verification is `node --check`, targeted node scripts, and
psql probes):

| Written | Why it cannot fail | Write instead |
|---|---|---|
| `node --check server.js` as the ONLY verify for a behaviour change | syntax-checks the file; any wrong-but-parseable logic passes | a targeted node script that calls the function/route and exits non-zero on the wrong answer |
| `psql … -c "SELECT …"` with no assertion | psql exits 0 on any result, including zero rows | pipe through `grep` for the expected value, or wrap in a node script that asserts |
| "start the server and confirm it looks right" | never fails by itself, and builders must not start servers | name the observable: the exact request, the exact expected response field |
(No CI guard enforces these shapes in this repo — the reviewer's check
"does this Verify actually fail when the behaviour is removed" is the only
gate, which is exactly why the shapes above must not be written in the
first place. Whether a named file or table actually exists stays on the
planner.)

Not every Verify is a test run. A grep, a build, or a script is fine, as long
as you can name what makes it fail: `grep -n "symbol" path/to/file` fails when
the wiring is missing; "confirm it looks right" does not fail at all.
