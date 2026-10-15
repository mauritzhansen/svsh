# Questioning Guide

How to gather requirements before writing CONTEXT.md. This is not a checklist — it is a thinking discipline.

---

## Philosophy

**You are a thinking partner, not an interviewer.**

The user often has a fuzzy idea. Your job is to help them sharpen it. Ask questions that make them think *"oh, I hadn't considered that"* or *"yes, that's exactly what I mean."*

Don't interrogate. Collaborate. Don't follow a script. Follow the thread.

---

## How to Question

**Start open.** Let them dump their mental model. Don't interrupt with structure.

**Follow energy.** Whatever they emphasised, dig into that. What excited them? What problem sparked this?

**Challenge vagueness.** Never accept fuzzy answers. "Good" means what? "Users" means who? "Simple" means how?

**Make the abstract concrete.** "Walk me through using this." "What does that actually look like?"

**Clarify ambiguity.** "When you say Z, do you mean A or B?" "You mentioned X — tell me more."

**Know when to stop.** When you understand what they want, why they want it, who it's for, and what done looks like — offer to proceed.

---

## Question Types

Use as inspiration, not a list to march through. Pick what's relevant to the thread.

**Motivation** — why this exists:
- "What prompted this?"
- "What are you doing today that this replaces?"

**Concreteness** — what it actually is:
- "Walk me through using this."
- "You said X — what does that actually look like?"
- "Give me an example."

**Clarification** — what they mean:
- "When you say Z, do you mean A or B?"
- "You mentioned X — tell me more about that."

**Success** — how you'll know it's working:
- "How will you know this is working?"
- "What does done look like?"

---

## Codebase Scout Before Questions

Before asking anything, scan the relevant part of the codebase to ground your questions in reality. What you find determines what you ask.

**What to look for:**
- Existing implementations similar to what's being built — read the closest one
- Reusable components, hooks, services, patterns
- Integration points where new code connects
- Partial implementations already in place

**Annotate your options with code context.** Don't present generic choices — present choices grounded in what already exists.

- Bad: "What screen pattern do you want?"
- Good: "You already have `SplitListPreviewLayout` with `VirtualizedList` used in DogsScreen and ContactsScreen — should Litters follow the same pattern, or do you need something different?"

---

## Domain Probes

When the user mentions a technology area, probe with domain knowledge. Pick 2-3 probes relevant to the thread — never walk through the full list.

| User mentions | Probe with |
|---|---|
| "API" or "endpoint" | REST or existing pattern? What operations? Business rules on save? |
| "database" or "table" | Existing schema? New table or extending? Key fields and relationships? |
| "cache" or "sync" | Already in IndexedDB? Already syncable? What data does the UI need? |
| "screen" or "page" | Which pattern: list→preview→edit, detail-only, settings? What tabs? |
| "save" or "edit" | Which fields editable? Lookups needed? Any find-or-create? Validation rules? |
| "upload" or "media" | Gallery, avatar, documents? Processing pipeline? Size limits? |
| "search" or "filter" | Client-side or server-side? What fields filterable? Full-text or exact? |
| "permissions" | Feature flag only? RBAC checks? Workspace-scoped? |
| "notifications" | Push, in-app, email? What triggers them? |

---

## Carry Forward Prior Decisions

If the user has existing CONTEXT.md files from related features, read them. Do not re-ask questions already answered — carry decisions forward and note them:

*"In the Dogs screen plan you decided on `SplitListPreviewLayout` with inline edit. Carrying that forward for Litters unless you want something different."*

---

## Decision Gate

When you have enough clarity to write CONTEXT.md, offer to proceed:

*"I think I understand what you're after. Ready for me to write up the context document, or is there more to discuss?"*

If they want to continue — ask what they want to add or probe gaps you noticed.

Loop until they confirm.

---

## Domain Skill Probes

When a domain skill is loaded alongside the planning skill, read its **"When planning a feature"** section before gathering requirements. That section contains the specific areas to probe for that domain (e.g. Dexie schema, feature flags, API endpoints for web-app; DB migrations, route contracts for API; navigation, offline support for mobile).

Each domain skill owns its own probe list. The planning skill does not hardcode domain-specific questions — it reads them from the loaded skill.

---

## Anti-Patterns

- **Checklist walking** — going through domains regardless of what the user said
- **Canned questions** — "What are your success criteria?" regardless of context
- **Interrogation** — firing questions without building on answers
- **Rushing** — minimising questions to get to "the work"
- **Shallow acceptance** — taking vague answers without probing deeper
- **Premature constraints** — asking about tech stack before understanding the idea
- **Asking about user skill level** — never ask. The agent builds.

---

## Scope Creep Handling

If the user mentions something outside the feature boundary during questioning:

*"{Feature X} sounds like a separate piece of work. I'll note it as a deferred idea for later. Back to {current topic}…"*

Capture in CONTEXT.md Deferred Ideas section.
