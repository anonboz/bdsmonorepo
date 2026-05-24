# End-of-build handoff

Before I close this session, produce a handoff document. Do NOT
modify `CLAUDE.md`, `claude-context/`, or any per-app `CLAUDE.md`
in this session. Write your findings to a new file so a fresh
session can review them with clean eyes.

## What to do

Write `.claude/handoffs/{YYYY-MM-DD}-{short-slug}.md` summarizing
this session. Use the slug that matches what we built (e.g.
`2026-04-16-staff-leave-requests`).

Structure the handoff as follows.

### 1. What we built

One paragraph. Name the feature / fix / refactor. List the top-level
changes: new routes, new models, new packages, removed code.

### 2. New invariants discovered

Rules that emerged during the build that weren't in `claude-context/`
before. For each, state:

- The rule in one sentence (behavioral, not descriptive)
- Where code enforces it today
- Why it matters — what breaks if someone ignores it
- Proposed home: root `CLAUDE.md`, a specific domain file, a
  per-app `CLAUDE.md`, or `gotchas.md`

Be strict here. A rule is an invariant only if violating it would
produce a bug, a security issue, or a performance regression.
"We chose to name the file X" is a convention, not an invariant.
Convention goes in code review, not in `CLAUDE.md`.

### 3. Gotchas hit during the build

Things that surprised us or cost time. For each:

- Symptom (what we saw first)
- Root cause
- Fix
- Whether to add to `claude-context/gotchas.md` (only if it's
  likely to happen again, not a one-off)

### 4. Contradictions with existing docs

Any place in `claude-context/` or `CLAUDE.md` where a current rule
turned out to be wrong, incomplete, or describing an obsolete pattern.
Quote the existing rule, describe the contradiction, propose the
corrected rule.

### 5. Schema changes

If any migration ran this session:

- Migration name(s)
- Models added / modified / removed
- Whether `pnpm schema:map` was run (it should have been)
- Any new enum values that code elsewhere needs to handle

### 6. What should NOT be in the docs

List anything that felt like a candidate for `CLAUDE.md` but
shouldn't go there — implementation choices, one-off fixes,
experiments, temporary scaffolding. This list keeps the next
session from over-updating.

### 7. Open questions

Anything ambiguous that a human should decide before the context
files are updated. Examples:

- "Should this pattern apply to all apps or just Manager?"
- "Is this rule permanent or tied to the current auth provider?"
- "Do we want to enforce this in a lint rule, a doc rule, or both?"

## Verification

After writing the handoff, list the file path and print the section
headings. Do not edit any `claude-context/` or `CLAUDE.md` file.

That's it. I'll start a fresh session with the other prompt to
actually apply updates.
