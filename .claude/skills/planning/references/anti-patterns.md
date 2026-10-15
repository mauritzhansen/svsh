# Universal Anti-Patterns

Rules that apply to every planning and execution session. No exceptions.

---

## Git Rules

All git operations follow the repo's git rules in CLAUDE.md (explicit `--` pathspecs, never `git add .`, never push/stash). Additionally for planning:

- Do not commit mid-execution — record changes in STATE.md, commit only at wave boundaries on user approval.
- One commit per wave, never one per task (Timo 2026-09-16: per-task and per-doc commits each became a merge-queue entry and a gate run; the chain grew for an hour with no work in it).
- Do not commit mid-conversation — while iterating with the user on a plan or doc, accumulate and land once when he says it is done.
- Commit messages must follow the plan's format: `{type}({scope}): {description}`.

---

## Context Rules

- **Read CONTEXT.md before any task** — locked decisions there are final. Do not re-litigate.
- **Read PLAN.md fully before starting Wave 1** — understand the whole plan before touching any files.
- **Do not load all reference files upfront** — read the skill's reference list and load only what the current task requires.
- **When context is heavy** (many files read, long conversation) — warn the user: *"Context is getting heavy. Consider committing current work and starting a fresh session for the next wave."*

---

## Decision Rules

- **Locked decisions in CONTEXT.md are final** — if a decision is wrong, stop and update CONTEXT.md. Do not silently override it during execution.
- **Silence in CONTEXT.md is not permission** — if a decision is not in CONTEXT.md and not in the Agent Discretion section, stop and ask before proceeding.
- **Never add a feature not in PLAN.md** — out-of-scope ideas belong in CONTEXT.md's Deferred section, not in the current build.

---

## Execution Rules

- **Existence ≠ implementation** — do not mark a task done because the file exists. Check that it is substantive, wired, and behaves correctly.
- **One wave at a time** — never start Wave 2 before all Wave 1 tasks are committed.
- **Follow the existing codebase pattern** — for any pattern not in PLAN.md or CONTEXT.md, look at how the nearest existing equivalent is done and match it exactly. Do not invent a new pattern.
- **Do not create files not listed in the task** — if you discover a file is needed that isn't in the plan, add it to the plan first (update PLAN.md), then create it.

---

## Planning Rules

- **Write must-haves before writing tasks** — if you cannot write a testable truth, you do not understand the feature well enough to plan it.
- **Every task must be executable without questions** — a task that requires a decision not captured in CONTEXT.md is incomplete. Update CONTEXT.md first.
- **Scope creep belongs in Deferred** — if the user mentions something outside the domain boundary during planning, note it in CONTEXT.md Deferred Ideas and continue.
- **Do not create planning documents the user has not approved** — present the plan, wait for confirmation before writing files.
- **Follow the skill template, not the biggest existing plan.** When writing a new plan, anchor on [`context-format.md`](context-format.md) + [`plan-format.md`](plan-format.md), not on the largest sibling in `.cursor/plans/` — large completed epics (e.g. accounting-foundations) grow their own conventions for their scale and copying that shape for a small plan produces 50%+ bloat. Lean is the default; sections beyond the template (Risks / Setup Prerequisites / Worth Surfacing / numbered `D-N` IDs across categories) are an epic-scale opt-in, not a baseline.
