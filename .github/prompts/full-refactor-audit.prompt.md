---
name: full-refactor-audit
description: Deep, multi-phase DRY/architecture/refactor audit of the codebase, gated behind explicit approval before any code changes.
argument-hint: optional - a subsystem/directory to scope the audit to (default is the whole src/ tree)
---

This is an occasional, deliberately-invoked deep audit — **not** standing
repository policy. For everyday bug fixes and features, `AGENTS.md` at the
repo root already covers scope, verification commands, and the
harmonic-analysis rules; nothing here overrides it, and this prompt should
never be treated as if it were checked automatically.

You are a senior software architect performing a complete review of the
codebase (or the subsystem named above) to find technical debt, duplicated
logic, tangled dependencies, overly complex functions, and architectural
problems — then produce, and only later execute, a safe refactoring plan.

Do NOT start changing code immediately. Understand first, plan second,
execute only after the checkpoints below are passed.

## Codebase layout (for orientation, not as a source of truth — verify against the actual tree)

```
src/api/          Thin data-access wrappers
src/components/    UI (components/ui = shadcn primitives)
src/hooks/         React hooks; hooks/api = TanStack Query
src/lib/harmony/   Theory engine (chordDetection, sectionDetection, LoopEngine, ...)
src/lib/           Other utilities, connectors
src/pages/         Route components
src/player/        Player system (providers/, embeddedPlayer/, universal/)
src/services/      Business logic (harmonicAnalysis, similarityEngine, ...)
src/types/         Shared types
supabase/functions/  Edge functions
supabase/migrations/ Ordered schema migrations
```

## Phase 1 — Discovery (read-only)

**Non-DRY**: duplicate functions/hooks/types across `lib/`, `services/`,
`hooks/`, `components/`; repeated validation, transformation, or API-call
patterns; duplicated constants.

**Spaghetti**: import cycles between `hooks/` ↔ `services/` ↔ `lib/` ↔
`components/`; god files (>500 lines, >10 exports, mixed responsibilities);
cross-layer violations (components calling `services/` directly instead of
through a hook; `lib/harmony/` importing from `hooks/` or `components/`);
props drilling >3 levels.

**Architecture, checked against `AGENTS.md`**: harmony stored relatively
(Roman numerals) and never persisted as absolute chords; UI rendering kept
separate from harmonic/audio logic; data access kept separate from state
management; no `navigate()` during render; 44px touch targets; `dvh` not
`vh`.

**Type safety**: `any` usage, implicit `any`, unnarrowed `unknown`, missing
return types on exported functions, unguarded `as Type` assertions.

**Reconcile documentation against reality**: compare `docs/*` architecture
docs against the actual implementation and tests. Treat implementation,
observed behavior, and tests as the source of truth — a documentation/code
mismatch is a *finding*, never a license to change behavior to match the
doc. For each mismatch record: doc location, observed behavior, impact,
whether a doc update is needed, and which refactor phase (if any) it belongs
to. Do not update documentation during this read-only phase.

## Phase 2 — Categorize

Write `docs/refactor/REFACTOR_REGISTER.md`:

| Category | File/Location | Issue | Severity | Effort | Risk | Owner |
|----------|---------------|-------|----------|--------|------|-------|

Severity: Critical (blocks correctness) / High (maintainability) / Medium
(tech debt) / Low (nit). Risk: High (touches harmonic analysis/audio
pipeline) / Medium (UI/logic) / Low (util/test). Also write
`docs/refactor/DEPENDENCY_GRAPH.md` (layer boundaries, import cycles found)
and `docs/refactor/DRY_INVENTORY.md` (duplicate clusters, canonical
locations) and `docs/refactor/TYPE_SAFETY_AUDIT.md` (`any` locations).

Do NOT blindly apply DRY — two similar-looking blocks may represent
different business concepts. Prefer semantic duplication over textual
duplication, and it is fine to leave something duplicated intentionally when
abstracting it would increase complexity.

## Phase 3 — Plan (per category)

For DRY: identify the canonical location (`lib/` for pure functions, `hooks/`
for React-specific), extract with types, update callers, add a test, delete
the duplicates.

For spaghetti: map the dependency graph, define layer boundaries
(`pages → components → hooks/api → services → lib/harmony → types`), move
logic to the correct layer, break cycles via dependency inversion or event
callbacks rather than new global state.

For large functions (>50 lines or >3 responsibilities): extract pure
sub-functions into `lib/`, one meaningful concept per extraction (not one
function per line), add tests per extraction, then compose.

Avoid over-engineering: do not introduce factories, repositories, DI
containers, event buses, or extra layers unless the current codebase has a
concrete problem that the abstraction solves.

## Phase 4 — Verify

Baseline, before any change:
```bash
bun run lint
bun run typecheck        # tsc --noEmit -p tsconfig.app.json
bun run test
bun run build
```
Per-change: `npx vitest run <path>`, `npx tsc --noEmit -p tsconfig.app.json`,
`npx eslint <changed files>`.

**Harmonic analysis validation (critical)**: for any change touching
`lib/harmony/`, `services/harmonicAnalysis.ts`, or
`services/similarityEngine.ts`, run against the existing detection-run
fixtures and compare chord/section output against recorded expectations;
verify relative (Roman-numeral) storage is unchanged and absolute keys are
still display-only derivations.

## Phase 5 — Safe execution boundary

Inspection is unrestricted. Modification is controlled.

**Protected — do not touch except through a separately approved,
domain-specific task**: generated Supabase type definitions, SQL schema
bundles and migrations, seeded track data, shadcn UI primitives, lockfiles,
deployment configuration, audio-analysis algorithms (as algorithms — moving
them without changing behavior is in scope). If one of these genuinely needs
to change, stop and report: File / Reason / Risk / Required change /
Alternative — do not modify it silently.

**No destructive operations**: no `git reset --hard`, `git clean -fd`,
`git checkout -- .`, force-push, branch deletion, or removing a dependency
solely because it looks unused, unless explicitly requested for that exact
operation. If uncommitted changes already exist in the tree, they are
protected — never discard them.

**One coherent refactor at a time**, small reviewable diffs. If a diff comes
out unexpectedly large, stop and check whether it's genuine architectural
change or formatting/import-sorting/line-ending noise before proceeding.

**Validate after every significant step**: inspect the diff, run the
relevant tests, typecheck, lint, confirm public interfaces are unchanged. If
validation fails, stop in that area and investigate — don't keep changing
code to force a test green.

**Public API boundary**: before changing an exported function/class/type/
endpoint, identify its consumers. Default is to preserve the contract; if a
breaking change is genuinely necessary, stop and report: Public API /
Current contract / Proposed contract / Consumers affected / Why / Migration
/ Risk.

**Database safety**: no schema/migration/index/constraint changes as part of
ordinary refactoring; isolate any that turn out to be necessary into a
separate, explicitly-scoped migration task.

**Stop conditions** — halt and report rather than continuing through any of:
unexpected test or build failure, new type errors, a public API that would
break, a migration that appears necessary, an external integration contract
that would change, or the scope expanding beyond the approved phase.

**Deferred technical debt**: unrelated issues found along the way get
recorded (Location / Problem / Impact / Suggested action), not silently
fixed.

## Execution protocol

```
PHASE 1 (read-only) → PHASE 2 (categorize) → PHASE 3 (plan)
                              ↓
                    SAFE EXECUTION CHECKPOINT — stop here
                              ↓
        PHASE 4 low-risk cleanup → validate → repeat
                              ↓
        PHASE 5 structural refactoring → validate after every step
                              ↓
              Final review: full verification, inspect complete
              diff, confirm behavior preserved, write final report
```

No code changes may be made until the plan has been produced and a named
phase has been explicitly approved. For anything touching public APIs,
database schemas, auth, security-sensitive code, or production
configuration: stop at the boundary and name the required decision instead
of proceeding.

## Final report

Executive summary; resulting architecture; major problems found; DRY and
spaghetti-code improvements made; dependency/coupling improvements;
significant dead code removed; tests run/added/modified/passed, and any that
could not be run and why; type-check/lint/format results; remaining
technical debt (do not claim everything is clean); recommended next steps.

Everyday rules (scope discipline, smallest-fix bias, root-cause-first,
never claiming a check passed without running it) come from `AGENTS.md` —
this prompt does not restate them.
