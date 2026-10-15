# SUMMARY.md Format

Written after all tasks are committed. Documents what was actually built — not what was planned.

---

## Template

```markdown
---
feature: {feature-slug}
completed: {YYYY-MM-DD}
duration: {e.g. 45 min, 1h 20m}
tasks: {N}
---

# Summary: {Feature Name}

**{Substantive one-liner — what actually shipped, not "Feature implemented."}**

## Accomplishments
- {Most important outcome}
- {Second key accomplishment}
- {Third if applicable}

## Task Commits

| Task | Commit | Type | Description |
|------|--------|------|-------------|
| 1.1 | `abc123f` | feat | {what was done} |
| 1.2 | `def456g` | feat | {what was done} |
| 2.1 | `hij789k` | feat | {what was done} |

## Files Created / Modified
- `{path}` — {what it does}

## Decisions Made During Execution
{Decisions the agent made that weren't in CONTEXT.md — or "None — followed plan exactly."}

## Deviations from Plan

{If none: "None — plan executed exactly as written."}

{If deviations:}

### {N}. [{Rule} — {Category}] {Title}
- **Found during:** Task {X}
- **Issue:** {what was wrong}
- **Fix:** {what was done}
- **Files:** {files modified}

**Total deviations:** {N}
**Impact:** {brief assessment}

## Issues Encountered
{Problems and resolutions — or "None."}

## What's Next
{What this enables, or remaining work in a follow-up plan.}
```

---

## Deviation Rules

The build agent will encounter unplanned work. These rules define how to handle it:

| Rule | Trigger | Action | Permission |
|------|---------|--------|------------|
| **Bug** | Broken behaviour, errors, type errors, security issues | Fix, verify, track | Auto |
| **Missing critical** | Missing error handling, validation, auth, logging | Add, verify, track | Auto |
| **Blocking** | Missing deps, wrong types, broken imports | Fix blocker, verify, track | Auto |
| **Architectural** | New DB table, schema change, new service, breaking API | **STOP — ask user** | Requires approval |

Priority: Architectural (STOP) > Bug/Missing/Blocking (auto).

When in doubt, treat as architectural and ask.

---

## One-liner Rules

The one-liner must describe what shipped, not that shipping occurred.

Good: `"Litters list→preview screen with dam/sire display and puppy count badges"`
Bad: `"Litters screen implemented"`, `"Feature complete"`, `"All tasks done"`
