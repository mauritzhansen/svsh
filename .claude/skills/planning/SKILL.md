---
name: planning
description: Create and maintain feature plans in `.cursor/plans/`. Use when asked to plan, status, execute, or verify a feature.
---

# Planning

## Feature Folder Structure

Every feature gets a self-contained folder. Multiple agents or developers can pick up any plan.

```
.cursor/plans/{feature-slug}/
├── CONTEXT.md        # Requirements decisions, canonical refs, code context
├── PLAN.md           # Tasks with must-haves, wave order, commit format
├── STATE.md          # Current execution position (updated per task)
├── SUMMARY.md        # What was built, commits, deviations (written post-build)
└── VERIFICATION.md   # Goal-backward verification results (written post-build)
```

Feature slug: kebab-case, descriptive (e.g. `litters-screen`, `contact-edit`, `dog-gallery`). Slug confirmation happens at Step 4 — do not create `.cursor/plans/{feature-slug}` or write any plan files until the user confirms the name.

**The folder IS the deliverable.** Never render an HTML copy of a plan and
never publish a plan, dispatch brief, or handover as an Artifact page —
report the folder path in a line or two of plain text. This overrides the
harness's own guidance that treats "a plan other people will follow" as
something to publish (owner rule, 2026-09-01; reaffirmed 2026-09-02 after
plan pages appeared unasked). A page happens only when the owner explicitly
asks for one.

**Multi-plan epics:** when a body of work is too large for one plan and is split into multiple sequential plans, add a sibling umbrella folder `.cursor/plans/{epic-slug}/` containing a single `EPIC.md`. EPIC.md owns vision, cross-plan non-negotiables, prod evidence, plan roster, and pickup instructions. Each child plan folder uses the prefix `{epic-slug}-{phase-slug}/` and its CONTEXT.md links back to EPIC.md as the first canonical reference. Stub child plans (folders for phases not yet planned in detail) contain only a placeholder CONTEXT.md pointing to EPIC.md until they are ready to be fleshed out.

---

## Plan Format (status table)

The top-level `.cursor/plans/` status table uses this format for tracking across features:

```markdown
# Plans

| Feature | Status | Started | Last active |
|---------|--------|---------|-------------|
| litters-screen | 🔄 In progress | 2026-04-05 | 2026-04-06 |
| contact-edit | ⬜ Todo | 2026-04-07 | — |
| dog-gallery | ✅ Done | 2026-03-20 | 2026-03-22 |
```

---

## New Feature Workflow

When asked to plan a new feature, execute these steps in order. Do not skip steps.

### Step 1 — Initial codebase scan

Before asking any questions, scan the relevant part of the codebase. What you find determines what you ask. This pass is broad and grounds your opening questions; Step 3 returns for targeted lookups once the user's answers narrow the scope.

Look for: existing implementations similar to what's being built, reusable components/hooks/services, established patterns, integration points, and any partial implementation already in place.

Do not ask the user anything until you understand what already exists.

### Step 2 — Gather requirements through conversation

This is a collaborative thinking session, not a questionnaire. Follow [questioning.md](references/questioning.md) precisely.

Start open — let the user explain what they want. Follow what they emphasise. Challenge vagueness. Make things concrete. Annotate options with what you found in the codebase scout.

If a domain skill is loaded (e.g. web-app), use its domain-specific knowledge to ask informed questions. If no domain skill is loaded, use the domain probes in `questioning.md` to guide the conversation based on what the user mentions.

Carry forward decisions from existing CONTEXT.md files for related features — do not re-ask.

When you have enough clarity to write CONTEXT.md, offer to proceed. Loop until the user confirms.

### Step 3 — Codebase scout (targeted)

After the conversation, do targeted lookups based on the user's answers:
- If an entity was named, check if it exists in schemas, stores, services, API routes
- If a screen or UI was named, read the closest existing implementation as a reference
- If API endpoints were discussed, check if they exist

### Step 4 — Confirm plan name

Before creating any files, propose a name and get explicit user confirmation.

Use this interaction pattern:
- Suggest one default slug based on the scoped feature
- Ask: *"What would you like to call this plan?"*
- If the user gives a different name, use their name
- Confirm final slug before creating `.cursor/plans/{feature-slug}/`

Do not create the folder or write CONTEXT.md until the user confirms the name.

### Step 5 — Write CONTEXT.md

Create the feature folder and write CONTEXT.md. See [context-format.md](references/context-format.md) for the full template.

```bash
mkdir -p .cursor/plans/{feature-slug}
```

Do not write PLAN.md yet — show CONTEXT.md to the user first.

### Step 6 — Confirm and write PLAN.md

Present CONTEXT.md to the user. Ask: *"Does this capture everything correctly? Any decisions to change before I write the plan?"*

On confirmation, write PLAN.md. See [plan-format.md](references/plan-format.md) for the full template.

Rules when writing the plan:
- Write must-haves (truths, artifacts, key links) **before** writing tasks — they define done
- Organise tasks into waves by dependency; within a wave, mark tasks with disjoint files and no ordering dependency `**Parallel:** yes` (plan-format.md) — in this repo one builder owns the whole plan, so the marker documents independence rather than driving dispatch
- Every task must be self-contained: files, action, verify, commit message
- Tasks must be executable without further questions — if a decision is missing, add it to CONTEXT.md first
- Size Verify to the change: name the acceptance checks that can fail (each must-have truth, plus the one failure mode a new guard exists to catch) — not an enumerated test suite. The builder decides test granularity; a Verify list longer than the Action it verifies is a sign the plan is prescribing steps instead of stating the goal

### Step 7 — Write STATE.md

```markdown
# State: {Feature Name}

**Status:** planning
**Current wave:** 1
**Current task:** 1.1
**Last commit:** —
**Started:** {date}
**Last active:** {date}

## Pending Commits

| Task(s) | Files | Commit message | Status |
|---------|-------|----------------|--------|

## Decisions made during execution
None yet.

## Blockers
None.
```

Status values match PLAN.md frontmatter: `planning` → `in-progress` (set when Wave 1 starts) → `complete` (all waves committed) → `verified` (VERIFICATION.md status = passed).

A status line may carry a trailing annotation after the value, set off by `—` or parentheses (e.g. `**Status:** closed — superseded by phase-2, 2026-09-04`); the value is what precedes it.

Three post-`verified` disposition states exist. They are set in STATE.md by testing/orchestration sessions, never by a planning session — planning sessions only ever set the four values above (PLAN.md frontmatter stays at its last planning-lifecycle value):

- `external-review` — verified and handed to someone outside the fleet for review; parked until the feedback is triaged. It then exits to `in-progress` if that triage leaves any wave pending, or to `closed` if nothing actionable remains.
- `closed` — terminal: the plan is finished, needs no further routing, and is excluded from orchestration scans.
- `done` — a legacy synonym for `closed`, still honoured by scans. Use `closed` for new plans.

Parking is exact-match only: a scan treats a plan as parked on precisely `external-review`, `closed` or `done`, nothing else. A status value outside this vocabulary is never normalised to a documented one and never silently skipped — if a scan cannot tell from the status line whether a plan still needs routing, it surfaces the plan for a human decision instead of deciding alone.

During execution, the Pending Commits table is populated after each task completes — one row per task, so the ledger shows what each task changed. **The wave lands as ONE commit** (Timo 2026-09-16: dev's history reads one commit per wave, never one per task or per finding): at the wave checkpoint every row is committed together, the commit message names the wave, and each row's status is set to that one commit's subject.

### Step 8 — Present next steps

```
---

## ▶ Ready to Build

**{Feature Name}** — {objective one-liner}

Plans written to `.cursor/plans/{feature-slug}/`

Start execution:
  /skill:planning → "execute .cursor/plans/{feature-slug}/PLAN.md"

Or open a new agent session and say:
  "Continue the {feature-slug} plan from .cursor/plans/{feature-slug}/"

---
```

---

## Executing a Plan

When asked to execute a plan or continue from a plan folder:

1. **Read STATE.md** — find current wave and task. If `Last commit` disagrees with `git log`, run the drift reconciliation below before continuing.
2. **Read CONTEXT.md** — load locked decisions and canonical references
3. **Read PLAN.md** — understand the full plan and must-haves
4. **Mirror remaining tasks into TodoWrite** — one todo per task, in wave order. Mark `in_progress` when starting a task, `completed` when its row lands in STATE.md's Pending Commits table.
5. **Read the canonical references** listed in CONTEXT.md
6. **Execute the current task** — follow the action precisely
7. **Verify the task** using the task's Verify step
8. **Record the change in STATE.md** — log which files changed and the intended commit message (do NOT commit yet); set top-level Status to `in-progress` on the first task of Wave 1
9. **Move to the next task** — repeat from step 6

After all tasks in a wave are complete, **pause and request commit approval** (see Wave Commit Checkpoint below). Do not start the next wave until the current wave is committed.

After all waves are committed, set STATE.md status to `complete` and run verification (see below).

---

## Wave Commit Checkpoint

When a wave is complete, present the pending commits and wait for user approval before committing anything.

```
── Wave {N} complete ────────────────────────────────────
{N} tasks complete. Ready to commit:

  Task {X.Y}  {file(s)}   → {commit message}
  Task {X.Z}  {file(s)}   → {commit message}

Pause other agents working on this codebase, then say
"commit wave {N}" to proceed.
─────────────────────────────────────────────────────────
```

On approval, commit the whole wave as ONE commit following the repo's git rules in CLAUDE.md (stage specific files with explicit `--` pathspecs, never `git add .`). The message names the wave and what it did; the STATE.md update rides in the same commit.

> **The merge queue is per-developer — check before you route through it.**
> The queue is Timo's mechanism and is not implemented on every checkout. It
> binds a session only where it is actually wired, and the test is one command:
>
> ```
> git config --get core.hooksPath
> ```
>
> **No output → the queue is not wired here. Commit normally** (`git add -- <path>`
> then `git commit`) and ignore the rest of this box and the queue clause in the
> archive step. Do not submit to the queue, do not treat its absence as a gap,
> and do not wire it — on a checkout where it is off, that is the owner's
> deliberate choice (Brian, 2026-09-16, confirmed with Timo).
>
> A wrong guess here is expensive in one direction only: `merge-queue process`
> provisions a test database even for a review-exempt docs-only entry, so on a
> checkout without the harness Postgres up it bounces and strands a plain
> markdown commit (observed 2026-09-16).

Where `core.hooksPath` IS set: **`dev` is a single-writer branch fed only by the merge queue** (`.cursor/plans/dev-merge-queue/`) — a bare `git commit` on `dev` in the main checkout is refused structurally (`block-dev-commit.sh`). A closeout edit made directly in the main checkout goes through the queue instead: `node scripts/merge-queue.mjs submit --paths <the changed files> --message "<summary>"` (docs-set paths land with no reviewer; anything else needs `--reviewed-by <row>` or `--owner-approved "<Timo's words + time>"`), and it waits for the next `process` batch — never a `process` run of its own. A worktree branch still commits normally — only the main checkout on `dev` is affected. STATE.md records the wave commit's SUBJECT, not its sha: worktree branches always integrate via rebase, a pre-rebase sha becomes unreachable, and subjects survive (rule 2026-09-01). There is no post-integration stamp commit (removed 2026-09-16). Confirm: "Wave {N} committed. Starting Wave {N+1}..."

**Never commit mid-conversation.** When a session is iterating with Timo on a plan, a doc or a design, nothing is committed until he says the piece is done — each conversational commit was becoming its own merge-queue entry and gate run (Timo 2026-09-16: "five agents committing a document, and an hour is gone"). Accumulate, then land once.

### A wave boundary is a release boundary (ruling 2026-08-31)

Every wave ends GREEN in every suite — CI-covered or not — because each wave ships as its own small push. When a plan adds guards:

- **Attribution guards** (snapshots/fixtures that prove a later change moved nothing) go in the FIRST wave and never go red — that is where their value lives.
- **Closure guards** (orphan, ledger, freshness checks that make "removal without prune" impossible) may land before the removal ONLY if the prune they police lands in the SAME wave. Otherwise the plan declares the push unit up front (which waves ship together) and enumerates the expected-red set per task, so a reviewer can tell a scheduled red from a defect.

A bundling discovered mid-execution is a planning defect even when the outcome is fine.

---

## Verification

After all plan tasks are committed, verify the build. See [verification.md](references/verification.md) for the full protocol.

Summary:
1. Load must-haves from PLAN.md
2. For each truth — find evidence it exists in the codebase
3. For each artifact — check all four levels (exists, substantive, wired, tested)
4. For each key link — confirm the wiring exists
5. Scan for stubs in modified files
6. Determine status: `passed` / `gaps_found` / `human_needed`
7. Write VERIFICATION.md
8. Write SUMMARY.md — see [summary-format.md](references/summary-format.md)
9. Update STATE.md status to `verified` (if VERIFICATION.md status = passed) or leave at `complete` (if `human_needed` or `gaps_found`)
10. **Archive the plan** once its status is a bare `verified` or `complete` (no qualifiers, no held items, no owner steps outstanding): `git mv .cursor/plans/<slug> .cursor/plans/archive/<slug>`, committed with the close-out — where the merge queue is wired (see the per-developer box in Wave Commit Checkpoint), that commit is `node scripts/merge-queue.mjs submit --paths .cursor/plans/<slug> --message "archive <slug>"` (a `.cursor/plans/` move is docs-set, so no `--reviewed-by` is needed) rather than a direct `git commit`; where it is not wired, commit it directly. The top level of `.cursor/plans/` lists live work only; see `.cursor/plans/archive/README.md`. Never archive an umbrella epic folder while any sub-plan is live.

If `gaps_found` — list gaps in VERIFICATION.md, create additional tasks in PLAN.md for fixes, execute them, then re-run verification.

---

## Working Through an Existing Plan

1. Read STATE.md — find where to resume
2. Reconcile drift if `Last commit` disagrees with `git log` (see below)
3. Read CONTEXT.md — reload decisions
4. Find current task in PLAN.md
5. Execute, commit, update STATE.md
6. Repeat until all tasks done
7. Run verification

---

## Reconciling STATE.md drift

If STATE.md disagrees with `git log` (agent crashed mid-wave, manual commits, abandoned execution, or someone resumed without updating STATE.md):

1. Run `git log --oneline {STATE.md Last commit}..HEAD` to find commits since STATE.md was last updated.
2. For each commit, find the matching wave in PLAN.md by commit subject and mark its task rows in Pending Commits with that subject.
3. If a commit doesn't match any task, log it under "Decisions made during execution".
4. Set `Current wave` and `Current task` to the next uncommitted task.
5. Update `Last commit` to the most recent hash and `Last active` to today.
6. Resume normal execution.

If working tree is dirty (uncommitted changes), inspect the diff before resuming — those changes may belong to a partially-completed task. Decide whether to finish and commit it, or revert.

---

## Reference Files

Read these as needed — not all upfront:

- [questioning.md](references/questioning.md) — how to gather requirements: thinking partner philosophy, question types, codebase scouting, domain probes, anti-patterns
- [context-format.md](references/context-format.md) — CONTEXT.md template and rules
- [plan-format.md](references/plan-format.md) — PLAN.md template, must-haves, task format, wave structure
- [summary-format.md](references/summary-format.md) — SUMMARY.md template, deviation rules, one-liner rules
- [verification.md](references/verification.md) — goal-backward verification, stub detection, VERIFICATION.md format
- [anti-patterns.md](references/anti-patterns.md) — universal rules for git, context, decisions, execution
