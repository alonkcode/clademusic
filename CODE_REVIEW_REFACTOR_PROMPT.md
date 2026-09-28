# Comprehensive Code Review & Refactoring Prompt

## Project: Clade (clademusic)

### Objective
Perform a **full codebase review** to identify and fix:
1. **Non-DRY code** (duplicated logic, repeated patterns)
2. **Spaghetti code** (tangled dependencies, unclear ownership, circular references)
3. **Architectural inconsistencies** (violations of separation of concerns, mixed responsibilities)
4. **Type safety gaps** (any usage, missing types, implicit any)
5. **Plan a systematic refactor** of functions/methods with clear ownership boundaries

---

## Codebase Structure Overview

```
src/
├── api/              # API layer (Supabase, external services)
├── components/       # React components (UI + some logic)
│   ├── ui/           # Primitive UI components
│   ├── notifications/
│   └── layout/
├── hooks/            # React hooks (state + business logic mixed)
│   └── api/          # TanStack Query hooks
├── lib/              # Core utilities & domain logic
│   ├── harmony/      # Harmonic analysis (chords, sections, tempo, key)
│   ├── liveAnalysis/ # Live analysis server integration
│   ├── connectors/   # External service adapters (Spotify, YouTube)
│   └── *.ts          # Utilities, formatters, constants
├── pages/            # Route-level pages
├── player/           # Audio player system
│   ├── universal/    # Universal player (YouTube/Spotify switching)
│   ├── embeddedPlayer/ # Embedded player hooks & components
│   ├── providers/    # Provider implementations
│   └── controller/   # Player controller interfaces
├── services/         # Business logic services
├── types/            # TypeScript types
└── test/             # Test utilities & integration tests
```

---

## Phase 1: Discovery & Audit (Read-Only)

### 1.1 Non-DRY Detection
Search for and catalog:
- **Duplicate functions** across `lib/`, `services/`, `hooks/`, `components/`
- **Repeated patterns**: same validation, same transformation, same API call patterns
- **Copy-pasted React hooks** with minor variations
- **Repeated type definitions** (interfaces/types defined in multiple files)
- **Duplicate constants** or magic numbers
- **Similar component prop interfaces** that could be unified

**Tools**: Use `grep` with patterns like:
- `export function`, `export const.*=.*=>` across directories
- Common utility patterns: `formatTime`, `formatDuration`, `clamp`, `debounce`
- API call patterns: `supabase.from`, `fetch`, `axios`
- Type patterns: `interface.*Track`, `type.*Section`, `ChordData`

### 1.2 Spaghetti Code Detection
Identify:
- **Circular dependencies** (import cycles between `hooks/` ↔ `services/` ↔ `lib/` ↔ `components/`)
- **God objects/files** (>500 lines, >10 exports, mixed responsibilities)
- **Cross-layer violations**:
  - Components importing from `services/` directly (should use hooks)
  - Hooks importing from `components/` (upward dependency)
  - `lib/harmony/` importing from `hooks/` or `components/`
  - `services/` importing from `hooks/` or `components/`
- **Implicit global state** (context overuse, window/global mutations)
- **Props drilling** >3 levels
- **Event bus / pub-sub misuse** as replacement for proper data flow

### 1.3 Architecture Violations
Check against `AGENTS.md` rules:
- Harmony stored **relatively** (Roman numerals) — never persist absolute chords as primary
- Audio pipeline data flow: analyser → section boundaries → chord spans → coverage windows
- UI rendering (`components/`, `pages/`) separated from harmonic/audio logic (`lib/harmony/`, `player/`)
- Data access (`services/`, `api/`, `integrations/`) separated from state management (`hooks/`, TanStack Query)
- No `navigate()` during render
- 44px minimum touch targets on mobile
- `dvh` not `vh` for layout heights

### 1.4 Type Safety Gaps
- `any` usage (grep for `\bany\b` in type positions)
- Implicit `any` from missing annotations
- `unknown` not narrowed before use
- Missing return types on exported functions
- Type assertions (`as Type`) without guards

---

## Phase 2: Categorization & Prioritization

Create a **Refactor Register** (markdown file) with:

| Category | File/Location | Issue | Severity | Effort | Risk | Owner |
|----------|---------------|-------|----------|--------|------|-------|
| DRY | `lib/utils.ts` + `hooks/useX.ts` | Duplicate `formatTime` | High | Low | Low | - |
| Spaghetti | `hooks/useHarmonicAnalysis.ts` | Imports `services/harmonicAnalysis` + `lib/harmony/*` + components | Critical | Medium | High | - |
| Arch | `components/TrackSections.tsx` | Direct `supabase` call | High | Low | Medium | - |
| Types | `services/similarityEngine.ts` | Multiple `any` in signatures | Medium | Medium | Low | - |

**Severity**: Critical (blocks correctness), High (maintainability), Medium (tech debt), Low (nit)
**Risk**: High (touches harmonic analysis/audio pipeline), Medium (UI/logic), Low (util/test)

---

## Phase 3: Refactor Planning (Per Category)

### 3.1 DRY Consolidation Plan
For each duplicate cluster:
1. **Identify canonical location** (prefer `lib/` for pure functions, `hooks/` for React-specific)
2. **Extract shared function** with proper types
3. **Update all callers** to use canonical version
4. **Add unit test** for canonical function
5. **Delete duplicates**

**Priority targets** (likely candidates):
- Time formatting: `lib/timeFormat.ts` vs `lib/utils.ts` vs component inline
- Track/section transformations: `lib/sections.ts` vs `services/trackService.ts` vs hooks
- Supabase query builders: repeated `.select()`, `.eq()` patterns in `api/` and `services/`
- Chord/section type guards: `lib/harmony/theory.ts` vs `types/harmony.ts` vs component inline
- Provider adapters: `lib/connectors/` vs `player/providers/`

### 3.2 Spaghetti Untangling Plan
For each tangle:
1. **Map dependency graph** (use `madge` or manual trace)
2. **Define clear layer boundaries**:
   ```
   pages → components → hooks/api → services → lib/harmony → types
   ```
3. **Introduce interfaces/contracts** at layer boundaries
4. **Move logic to correct layer**:
   - Pure harmonic logic → `lib/harmony/`
   - Business logic → `services/`
   - React state → `hooks/`
   - UI only → `components/`
5. **Break circular deps** with:
   - Dependency inversion (interfaces in `types/` or `lib/`)
   - Event callbacks instead of direct imports
   - Context providers for cross-cutting concerns

**Critical untangles** (investigate first):
- `hooks/useHarmonicAnalysis.ts` → likely imports from `services/`, `lib/harmony/`, `components/`
- `player/embeddedPlayer/usePlayerHarmony.ts` → likely crosses player ↔ harmony boundary
- `components/TrackSections.tsx` → likely mixes UI + data fetching + harmonic logic
- `services/harmonicAnalysis.ts` → likely imports from `lib/harmony/` AND `hooks/`

### 3.3 Function/Method Refactor Plan
For each **god function** (>50 lines, >3 responsibilities):
1. **Extract pure sub-functions** to `lib/` with single responsibility
2. **Add JSDoc** describing input/output/contract
3. **Add unit tests** for each extracted function
4. **Replace original** with composed calls

**Target files** (investigate):
- `services/harmonicAnalysis.ts` — likely large
- `services/similarityEngine.ts` — likely complex
- `hooks/useHarmonicAnalysis.ts` — likely mixes concerns
- `hooks/useAnalyzeTrack.ts` — likely large
- `player/PlayerContext.tsx` — likely god component
- `components/TrackSections.tsx` — likely large
- `components/UnifiedPlayer.tsx` — likely large
- `lib/harmony/chordDetection.ts` — core algorithm, verify purity
- `lib/harmony/sectionDetection.ts` — core algorithm, verify purity

---

## Phase 4: Verification Strategy

### 4.1 Pre-Refactor Baseline
Run **before any changes**:
```bash
bun run test              # All vitest tests
bun run lint              # ESLint
bun run typecheck         # tsc --noEmit
bun run build             # Vite build
bun run test:e2e:smoke    # Playwright smoke tests
```
Document pass/fail counts.

### 4.2 Per-Change Verification
After **each logical group** of changes:
1. Run targeted test: `npx vitest run <path/to/changed.test.ts>`
2. Run typecheck: `npx tsc --noEmit -p tsconfig.app.json`
3. Run lint on changed files: `npx eslint <changed-files>`

### 4.3 Harmonic Analysis Validation (CRITICAL)
For ANY change touching `lib/harmony/`, `services/harmonicAnalysis.ts`, `services/similarityEngine.ts`:
- Run against **known reference tracks/fixtures** (existing detection-run test fixtures)
- Compare chord/section detection output against recorded expectations
- Verify relative harmony storage (Roman numerals) unchanged
- Verify absolute key derivation for display only

### 4.4 Post-Refactor Full Suite
```bash
bun run test
bun run lint
bun run typecheck
bun run build
bun run test:e2e
```

---

## Phase 5: Execution Rules (From AGENTS.md)

### Mandatory
- **Fix bugs with smallest possible change** — no opportunistic refactoring
- **Trace implementation** before changing harmonic analysis/similarity logic
- **Test against reference tracks** after analysis logic changes
- **Run `bun run test`** (not `bun test`) — uses Vitest with jsdom
- **Never claim a check passed unless actually run**

### Forbidden
- ❌ Multiple agents on same bug/refactor area
- ❌ Changing harmonic algorithms before confirming audio pipeline data flow
- ❌ Refactoring unrelated code as part of a fix
- ❌ Introducing dependencies/patterns without concrete need
- ❌ Using `any` unless external boundary requires it (document why)
- ❌ `navigate()` during render
- ❌ Committing without explicit user request

### Preferred Workflow
1. **Investigate** → confirm root cause with code evidence
2. **Plan** → smallest complete fix, document in Refactor Register
3. **Implement** → one logical change at a time
4. **Verify** → targeted test → broader checks
5. **Report** → root cause, files changed, decisions, commands run, risks

---

## Deliverables

1. **`REFACTOR_REGISTER.md`** — Living document tracking all issues, prioritization, status
2. **`DEPENDENCY_GRAPH.md`** — Layer boundaries, import cycles found, resolution plan
3. **`DRY_INVENTORY.md`** — Duplicate clusters, canonical locations, migration status
4. **`TYPE_SAFETY_AUDIT.md`** — `any` locations, migration plan
5. **Refactored code** — Incremental PRs per logical group

---

## Starting Commands

```bash
# 1. Get test baseline
bun run test 2>&1 | tail -30

# 2. Find duplicate patterns
grep -r "export function\|export const.*=.*=>" src/lib src/services src/hooks --include="*.ts" --include="*.tsx" | wc -l

# 3. Find circular deps (install madge if needed)
npx madge --circular --extensions ts,tsx src/

# 4. Find 'any' usage
grep -rn "\bany\b" src/ --include="*.ts" --include="*.tsx" | grep -v ".test." | grep -v "node_modules" | head -50

# 5. Find large files
find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | head -30

# 6. Check layer violations
grep -rn "from ['\"]@/services" src/components/ --include="*.tsx"
grep -rn "from ['\"]@/hooks" src/lib/ --include="*.ts"
grep -rn "from ['\"]@/components" src/hooks/ --include="*.ts"
```

---

## Notes for Implementer

- **Harmony is the source of truth** — behavior over variable names
- **Relative harmony storage** is architectural invariant
- **Audio pipeline data flow** must be verified before algorithm changes
- **One agent owns implementation** per area — no concurrent edits to `lib/harmony/`, `services/harmonicAnalysis.ts`, `services/similarityEngine.ts`
- **Sequential workflow**: Investigate → Implement → Validate
- **Small, verified steps** over big bang refactor