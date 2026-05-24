# Apply handoff to claude-context

Review the most recent handoff in `.claude/handoffs/` and propose
updates to `CLAUDE.md` and `claude-context/` based on what it
contains. This is a fresh session specifically so the previous
session's bias doesn't leak through.

Clean git, then `git checkout -b docs/apply-handoff-{slug}` where
`{slug}` matches the handoff file.

## Pre-flight check

Read root `CLAUDE.md`. Run `wc -c CLAUDE.md` and divide by 3.7 to
estimate tokens. If the result is **over 2,000 tokens**, STOP and
print:

> "Root CLAUDE.md is {N} tokens — too large for the on-demand
> pattern. Run `.claude/prompts/emergency-slim-claude.md` first,
> then re-run this prompt."

Do NOT proceed with the handoff if the root file is bloated.
Applying handoff updates to a bloated root makes it worse.

## Pre-flight check — cited commits reachable from main

Open the newest handoff in `.claude/handoffs/` and grep its
"What we built" / "Schema changes" sections for commit SHAs (any
7+ hex chars adjacent to a backtick or "commit"). For each SHA,
run:

```bash
git merge-base --is-ancestor <sha> main && echo "ok: <sha>" || echo "MISSING: <sha>"
```

If any are missing, the handoff describes work that hasn't merged
to main yet. STOP and ask whether to:

1. Merge / fast-forward main from the source branch first, then
   re-run this prompt.
2. Apply the docs anyway and note the unmerged code in the commit
   body (rare — only when the handoff explicitly documents
   intent, not state).
3. Abandon the handoff.

Applying docs that describe unmerged code produces ground-truth
docs that are ahead of the code; reviewers and future
apply-handoff sessions will read them as canonical.

## Pre-flight check — cited service paths are imported

If the handoff cites a service or helper as "enforced in `<path>:<symbol>`"
(or similar load-bearing claims), the path must actually be imported from
`apps/` somewhere. Scan the "What we built", "New invariants discovered",
and "Contradictions" sections for `path:symbol` patterns. For each one:

```bash
git grep -nE "from ['\"][^'\"]*<basename>" -- apps/
```

If no app imports the file, the citation is naming dead code. STOP and ask
whether to:

1. Treat the path as a stale reference, find the live equivalent, and
   rewrite the proposal to point at it.
2. Apply the docs anyway because the rule is still aspirationally correct
   (rare — only when the handoff explicitly flags the path as the intended
   future home).
3. Abandon the handoff.

Background: two false-positive "enforced in `<path>`" citations shipped
across the 2026-05-11 and 2026-05-12 handoff-apply passes — both pointed
at `apps/manager/src/services/menu/services/categories.ts:deleteCategory`,
which the manager barrel hadn't re-exported in months. Grepping importers
is cheap; trusting a doc citation is expensive.

## Pre-flight check — cited admin routes are reachable from the sidebar

If the handoff cites any admin route under `apps/admin/src/app/(admin)/`
(by path or by URL like `/conduct/games-config`), grep
`apps/admin/src/components/layout/nav-links.tsx` for the route's href.
If no nav entry points at the route, the page exists on disk but is
undiscoverable in the UI — it is NOT done. Flag this in step 2 under
"Needs human input" (apply the docs anyway, fix the wiring, or both?).
Do not silently accept "page exists" as satisfaction of the handoff;
"page exists AND is linked" is the bar. Background:
`/conduct/games-config` sat unlinked through a prior apply-handoff
pass that only verified the file existed.

## Step 1 — Read and assess

Read `.claude/handoffs/` and pick the newest file. Also read:

- Root `CLAUDE.md`
- `claude-context/` directory listing — `ls claude-context/` and
  `ls claude-context/domain/` to see what files exist
- The per-app `CLAUDE.md` for any app mentioned in the handoff

For each proposed update in the handoff, apply this filter:

1. **Is it an invariant?** Would violating it cause a bug, security
   issue, or performance regression? If no — reject. Conventions
   don't belong in `CLAUDE.md`.
2. **Is it durable?** Will this rule still be true in 6 months, or
   is it tied to a temporary state (specific library version, open
   migration, beta feature)? If temporary — reject or park in a
   `TODO` comment with an expiry trigger.
3. **Is it already covered?** Grep `CLAUDE.md` and `claude-context/`
   for adjacent rules. If a rule exists, _refine_ it rather than
   add a new one. One home per rule — never two.
4. **Does it have a clear home?** Universal foot-gun → root
   `CLAUDE.md`. Domain-specific → `claude-context/domain/<domain>.md`.
   Likely-to-recur bug → `claude-context/gotchas.md`. App-specific →
   per-app `CLAUDE.md`. If none fit, reject or flag it in step 4.

## Step 2 — Produce a change proposal

Do NOT edit any file yet. Print a proposal with three sections:

### Accepted (will apply)

For each:

- Source item from the handoff
- Target file and exact section heading
- Diff sketch (the line(s) to add or change)
- One-sentence rationale

### Rejected (will not apply)

For each:

- Source item
- Why it was rejected — point at the specific filter above that
  disqualified it

### Needs human input (stop and ask)

For each:

- Source item
- The open question
- Your recommendation

Print all three lists. Stop. Wait for me to review.

## Step 3 — Apply accepted changes (only after I confirm)

Edit the target files. Keep edits minimal — add to existing
sections rather than creating new ones when possible.

**Root CLAUDE.md budget guard:** after edits, re-check
`wc -c CLAUDE.md` ÷ 3.7. If it exceeds 1,500 tokens, the edit
made it too heavy. Move the new content to a domain file or
gotchas.md instead and add a cross-reference. The root file must
stay under 1,500 tokens at all times.

If you add a rule to a domain file, check whether it duplicates
something in the root `CLAUDE.md`. If yes, either remove the root
entry (dedupe downward) or refine the rule in one location.

After editing, for every file touched:

- Re-read it end-to-end
- Confirm no duplicate rules were introduced
- Confirm no rule was accidentally weakened by the edit

## Step 4 — Schema map (skip unless script exists)

`pnpm schema:map` is not currently defined in this repo. If the
handoff's "Schema changes" section listed migrations, note it in
the PR body instead; `claude-context/schema-map.md` is maintained
manually. If a `schema:map` script is later added, run it here
and commit the regenerated map in the same branch.

## Step 5 — Sync the import list and create missing targets

If any accepted change targeted a new domain file that didn't
exist before (e.g. you created `claude-context/domain/foo.md`):

1. Add it to the reference-docs section of root `CLAUDE.md`
2. Verify it's listed alongside the other domain files

Run `ls claude-context/domain/` and compare against the import
list in root `CLAUDE.md`. Any file NOT in the list → add it.
Any list entry pointing to a file that doesn't exist → remove it.

**Each `@claude-context/domain/` entry stays terse — one short
clause, not a mini-changelog.** Sibling entries are ~50–80 chars
(e.g. `pricing.md — variant band, SPVP override, snapshots`).
Anything over ~120 chars or with multiple sentences needs to
shrink. Rationale: two kudos branches each landed ~260–280-char
entries in May 2026 and pushed root past the 2,000-token
pre-flight gate; a third apply-handoff session had to trim
before it could proceed. The full description belongs in the
domain file the entry points at, not in the index.

## Step 6 — Archive the handoff

Move the applied handoff to
`.claude/handoffs/applied/{original-filename}`. This keeps
unapplied handoffs visible at the top level.

## Finalize

Commit as `docs: apply handoff {slug}`. Print the summary of
changes by file and the root CLAUDE.md token count. End.
