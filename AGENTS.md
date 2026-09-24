# Repository Instructions

## Clade (clademusic) Development Rules

- Fix bugs with the smallest possible change.
- The actual audio/harmonic analysis behavior (chord detection, section detection, similarity engine) is the source of truth, not variable or type names.
- Before changing harmonic analysis or similarity logic, trace the implementation in `src/lib/harmony/` and `src/services/`.
- Do not run multiple agents on the same bug.
- Do not change harmonic analysis, chord detection, or similarity-engine algorithms until the audio pipeline's inputs, state transitions, and data flow are confirmed correct.
- Always test against known reference tracks/fixtures (existing detection-run test fixtures, recorded chord/section expectations) after changes to analysis logic.

## Working Method

* Inspect the relevant implementation, configuration, types, and tests before proposing a diagnosis or changing code.
* Treat reported causes as hypotheses until confirmed from the actual code path.
* Identify the root cause before editing.
* Make the smallest complete change that resolves the problem.
* Do not refactor unrelated code as part of a feature or bug fix.
* Preserve existing behavior outside the requested scope.
* State assumptions when repository evidence is incomplete.
* Never claim that a command, test, build, or check passed unless it was actually run successfully.

## Agent Execution Rules

### Scope Control
* Do not expand the task beyond the reported issue.
* Do not redesign systems while debugging a specific bug.
* Do not improve architecture unless the current issue cannot be solved without it.
* If a local fix exists, prefer it over a structural change.
* Do not start implementation until diagnosis is complete.
* Do not let agents modify the same files simultaneously.
* Prefer one strong reasoning chain over multiple conflicting approaches.

### Debugging Workflow
For bugs:
1. Locate the runtime path involved (e.g. `src/lib/harmony/`, `src/services/`, `src/player/`, `src/components/`).
2. Confirm the suspected cause with code evidence.
3. Make the smallest fix.
4. Run the relevant verification (`bun run test`, a targeted `npx vitest run <path>`, or the relevant Playwright spec).
5. Do not modify code if the diagnosis is not confirmed.

Do not spend time proposing alternative architectures before proving the current implementation is wrong.

### Multi-Agent Behavior
* Do not assign multiple agents to independently solve the same bug.
* Parallel agents should only handle independent tasks.
* One agent should own diagnosis.
* One agent should own implementation.
* One agent should validate.
* Agents must pass findings, assumptions, and affected files to the next agent before implementation begins.
* Implementation agents should use existing investigation results instead of restarting analysis.

### Shared Workspace Rules

* Never allow multiple agents to modify the same files simultaneously.
* Before editing, check whether another agent has active changes in the same area.
* One agent owns implementation for a task.
* Other agents may review, test, or investigate but must not modify the same code path.
* Do not merge competing implementations automatically.
* Resolve conflicts by comparing against the original task requirements and repository behavior.
* Do not push changes until the implementation has been validated.
* Prefer sequential agent workflow:
  1. Investigator finds the cause.
  2. Implementer makes the change.
  3. Validator tests the result.
* Only one agent may modify harmonic analysis, chord detection, section detection, or similarity-engine logic at a time.
* Changes to that analysis logic require validation against known reference tracks/fixtures before being considered done.
* Never force-push or overwrite another agent's changes without explicit confirmation.

### Harmonic Analysis / Chord Detection Logic
For the harmonic analysis, chord detection, section detection, and similarity engine (`src/lib/harmony/`, `src/services/harmonicAnalysis.ts`, `src/services/similarityEngine.ts`):
* The actual audio/detection behavior is the specification — never infer correctness from variable names or comments alone.
* Verify the audio pipeline's data flow and state transitions (analyser sampling, section boundaries, chord spans, coverage windows) before changing detection or similarity algorithms.
* A detection result that looks wrong does not automatically mean the algorithm is wrong — reproduce and trace before concluding.
* Prefer trace instrumentation, targeted unit tests, and reproduction over speculation.
* Harmony is stored **relatively** (Roman numerals, relative tonal center). Never persist absolute chords as primary data — absolute keys are derived only for display (see `docs/ARCHITECTURE_SUMMARY.md`, `docs/HARMONIC_ANALYSIS_ARCHITECTURE.md`).
* Do not optimize detection/similarity performance until correctness of the underlying data flow and thresholds (e.g. silence/energy thresholds, coverage windows) is verified.

## Project Architecture

* Follow the repository's existing architecture and conventions before introducing new patterns.
* Keep UI rendering (`src/components/`, `src/pages/`), harmonic/audio logic (`src/lib/harmony/`, `src/player/`), data access (`src/services/`, `src/integrations/`, `src/api/`), state management (`src/hooks/`, TanStack Query), and reusable utilities (`src/lib/`) separated.
* Keep components and functions focused on one responsibility.
* Prefer explicit, readable code over clever abstractions.
* Extract shared logic when duplication is meaningful and the abstraction has a clear responsibility.
* Do not introduce dependencies, architectural layers, or design patterns without a concrete need.
* Avoid global mutable state and hidden side effects.

## TypeScript and React

* Preserve strict TypeScript type safety.
* Do not use `any` unless an external boundary makes it unavoidable and the reason is documented.
* Fix type errors at their source rather than suppressing them.
* Use descriptive names for components, functions, variables, and types.
* Keep React components focused on presentation and interaction.
* Move substantial harmonic-analysis logic and reusable calculations into typed functions, hooks, or modules (`src/lib/`, `src/services/`, `src/hooks/`), not into components.
* Avoid unnecessary effects, duplicated derived state, and avoidable re-renders.
* Never call `navigate()` during render; put it in an effect. Routing during render updates the router mid-render and can loop.
* Validate external data and handle missing or invalid values safely — the Supabase client degrades to a disabled stub without credentials, so failures should be handled gracefully rather than assumed to be connection bugs.
* Maintain compatibility with both desktop and mobile layouts: interactive controls need a 44px minimum touch target on mobile, and layout heights should use `dvh`, not `vh`.

## Changes and Refactoring

* Do not rewrite working modules when a localized fix is sufficient.
* Separate substantial refactoring from behavioral changes when practical.
* Preserve public interfaces unless changing them is required.
* Before changing shared code, identify its callers and possible regressions.
* Remove dead code only after confirming it is unused.
* Do not add speculative abstractions for hypothetical future requirements.

## Verification

* This repo is **bun-first**: use `bun run <script>` for the scripts defined in `package.json` (`dev`, `build`, `lint`, `typecheck`, `test`, `test:watch`, `test:e2e`, `test:e2e:smoke`, `test:pw:ui`). Do not invent build or test commands without inspecting `package.json` and `docs/` first.
* Run `bun run test`, not `bun test` — the bare form invokes Bun's own test runner instead of Vitest and skips the jsdom setup (`src/test/setup.ts`).
* If `bun` is unavailable, `npx` works for one-off commands (`npx vitest run <path>`, `npx tsc --noEmit -p tsconfig.app.json`, `npx vite build`) — but do not install dependencies with `npm`/`yarn`; the `preinstall` guard (`scripts/abort-if-not-bun.cjs`) exists to keep a single lockfile (`bun.lockb`).
* Vitest owns `src/**/*.{test,spec}.{ts,tsx}`; Playwright owns `tests/*.spec.ts` (needs a real browser, e.g. universal-player invariants and route smoke). The two suites are mutually exclusive by config — don't add browser-dependent tests under `src/`.
* Run the smallest relevant verification first (a targeted `npx vitest run <path>` for the changed module).
* Run broader checks (`bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`) when the change affects wider parts of the system, matching `docs/CODE_REVIEW.md`.
* Add or update tests for changed logic when the repository has an applicable testing setup.
* Test edge cases and failure paths, not only the expected path — an assertion that would fail on a broken page (not just `should('be.visible')` on a blank page) is required per `docs/testing.md`.
* Report checks that could not be run and explain why.

## Security and Reliability

* Never commit secrets, credentials, access tokens, or private configuration. Only `.env*.local` and bare `.env` are gitignored — name backups `.env.backup.local`, not e.g. `.env.backup-2026`.
* Validate untrusted input at system boundaries.
* Avoid unsafe HTML rendering, command construction, and insecure storage.
* Handle errors explicitly and provide useful diagnostic information without exposing sensitive data.

## Reviews and Technical Decisions

When evaluating a diagnosis, implementation plan, or architectural decision:

1. State whether it is correct, incorrect, partially correct, unknown, or whether a better approach exists.
2. Explain the evidence from the repository.
3. Identify the smallest safe solution.
4. Note likely regressions, tradeoffs, and remaining uncertainty.

Do not agree with a technical claim merely because it was proposed by the user.

## Completion Summary

After modifying code, report:

* Root cause or implementation objective
* Files changed
* Important behavioral or architectural decisions
* Verification commands actually run
* Remaining risks or unresolved issues
