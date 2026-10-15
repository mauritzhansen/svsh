# CONTEXT.md Format

Output of requirements gathering. Written to `.cursor/plans/{feature}/CONTEXT.md` before any planning or building begins. Downstream agents read this file — every section must be complete.

---

## Template

```markdown
# {Feature Name} — Context

**Gathered:** {YYYY-MM-DD}
**Status:** Ready for planning

---

## Domain Boundary

{One clear sentence stating what this feature delivers and where it stops.
This is the scope anchor — anything outside it is deferred.}

---

## Implementation Decisions

### {Category — e.g. Screen Pattern}
- {Locked decision in one sentence}
- {Another locked decision}

### {Category — e.g. Data Layer}
- {Locked decision}

### Agent Discretion
{Areas where the user said "you decide" or did not specify — agent has flexibility here
but must stay consistent with existing codebase patterns.}

> **`D-N:` prefix is optional.** Use numbered IDs (e.g. `**D-01:**`) only when the plan has 5+ architectural decisions that need cross-reference from PLAN.md, STATE.md, or sibling plans. For typical plans, prose is cleaner — numbering ceremony for 2-3 decisions creates noise.

---

## Canonical References

**Read these before planning or building.**

### Architecture
- `{exact/relative/path.md}` — {what it defines that's relevant}

### Screen patterns
- `{path}` — {relevance}

### API contracts
- `{path}` — {relevance}

{If no external docs: "No external specs — decisions fully captured above."}

---

## Existing Code to Reuse

### Components / hooks
- `{import path}` — {how it applies}

### Patterns to follow
- {Pattern}: {how it applies to this feature}

### Integration points
- {Where new code connects to existing system}

---

## Deferred Ideas

{Things that came up but are out of scope for this feature. Don't lose them.}

- {Idea} — deferred because {reason}

{If none: "None."}
```

---

## Rules

- **Domain boundary is mandatory** — without it, scope creeps during build.
- **Every canonical reference needs an exact relative path** — not just a filename. The build agent reads it directly.
- **Locked decisions are final** — the build agent must not re-litigate them. If a decision is wrong, update CONTEXT.md, not the plan.
- **Agent discretion must be explicit** — silence is not discretion. If the user didn't specify, say so.
- **Deferred ideas must be captured** — they surface as future feature plans.
- **Keep it lean.** Target ~80–120 lines. The build agent re-reads this file every session; bloat compounds. Don't add sections beyond the template (Risks / Setup Prerequisites / Worth Surfacing / etc.) unless the plan is genuinely epic-scale (5+ waves, multi-week). For normal plans, the five sections above are sufficient — let PLAN.md carry per-wave detail.
