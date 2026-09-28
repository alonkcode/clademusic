# Full Codebase Review, DRY Cleanup & Refactoring Plan

You are a senior software architect and refactoring engineer.

Your task is to perform a complete review of the entire codebase, identify technical debt, duplicated logic, spaghetti code, overly complex functions/methods, poor separation of concerns, and architectural problems, and then produce and execute a safe, systematic refactoring plan.

Do NOT start changing code immediately.

First understand the codebase as a whole, map its architecture, identify dependencies, and establish where the biggest problems are. Then propose the refactoring strategy before implementing it.

1. PRIMARY OBJECTIVES

Review the entire project with these goals:

Eliminate unnecessary duplication and improve DRYness.
Break apart spaghetti code.
Refactor overly large or complex functions/methods.
Improve separation of concerns.
Reduce coupling between modules/classes/functions.
Improve cohesion within modules/classes.
Remove dead, obsolete, unreachable, or redundant code.
Simplify overly complicated control flow.
Improve naming and consistency.
Consolidate repeated business logic.
Identify and remove unnecessary abstractions.
Improve error handling.
Improve dependency management.
Make the code easier to test.
Make the architecture easier to extend.
Preserve existing behavior unless a behavior change is explicitly justified.
Avoid premature abstraction and over-engineering.
Keep the resulting architecture understandable to a developer joining the project later.

The goal is NOT to make the code "clever."

The goal is:

simpler code + clearer responsibilities + less duplication + lower coupling + easier testing + preserved behavior.

2. FIRST: UNDERSTAND THE ENTIRE CODEBASE

Before modifying anything, inspect the repository comprehensively.

Review:

project structure
source directories
modules
packages
classes
functions/methods
utilities/helpers
services
controllers/routes
API clients
database/repository code
state management
configuration
constants
types/interfaces
models
tests
scripts
build configuration
dependency configuration
environment/configuration handling
documentation
entry points
background jobs/workers
CLI commands
integrations
event handlers
middleware
shared components

Determine:

What are the major architectural layers?
What are the major domains/features?
Where does business logic live?
Where does infrastructure logic live?
Where does presentation/API logic live?
Where are side effects occurring?
Where is state managed?
Where are dependencies injected?
Where are dependencies imported directly?
Which modules know too much about other modules?
Which modules have too many responsibilities?

Do not assume the current folder structure represents the actual architecture.

Infer the architecture from the code.

3. CREATE A CODEBASE MAP

Before refactoring, create a concise architecture map.

Include:

Entry points

Identify all application entry points.

Core modules

Identify the major functional/domain modules.

Dependency relationships

Describe which modules depend on which others.

Shared utilities

Identify shared helpers and determine whether they are genuinely shared abstractions or merely dumping grounds.

Business logic

Identify where important business rules currently live.

Side effects

Identify where the code performs:

database operations
network requests
filesystem operations
logging
caching
messaging
external API calls
environment access
global state mutation
UI/framework-specific operations
Risk areas

Identify the parts of the system that are:

highly coupled
highly duplicated
difficult to test
difficult to understand
frequently modified
overly complex
3.1 RECONCILE ARCHITECTURE DOCUMENTATION

Before creating the refactoring roadmap, compare the architecture documentation with the current implementation and tests.

Treat implementation, observable behavior, and tests as the source of truth. Documentation that conflicts with them is a finding, not a reason to alter behavior.

For each discrepancy, record:

Documentation location:
Observed implementation or test behavior:
Impact of the mismatch:
Documentation update required:
Related refactoring phase, if any:

Include undocumented modules, obsolete diagrams, outdated public API examples, and documented behavior with no implementation.

Do not update documentation during the read-only phase. Include reconciliation updates only in an approved phase, and do not use documentation cleanup to justify unrelated code changes.

4. PERFORM A DRY ANALYSIS

Search the ENTIRE codebase for duplication.

Look for:

duplicated functions
duplicated methods
repeated business rules
repeated validation
repeated conditionals
repeated API request logic
repeated database queries
repeated error handling
repeated transformations
repeated formatting
repeated serialization/deserialization
repeated permission checks
repeated configuration access
repeated logging
repeated retry logic
repeated null/undefined handling
repeated mapping/conversion logic
duplicated constants
duplicated types/interfaces
copy-pasted code with small variations
duplicated UI logic
duplicated test setup
duplicated mocks
duplicated utility logic

For every significant duplication, determine whether it should be:

extracted into a function
extracted into a module
extracted into a service
extracted into a domain abstraction
represented as configuration/data
replaced by an existing abstraction
left duplicated intentionally because abstraction would increase complexity

IMPORTANT:

Do NOT blindly apply DRY.

Recognize that two pieces of code that look similar may represent different business concepts.

Prefer semantic DRY over superficial textual DRY.

5. IDENTIFY SPAGHETTI CODE

Find code with excessive:

nesting
branching
conditionals
callbacks
mutable state
hidden side effects
shared state
cross-module knowledge
function calls that modify unrelated state
deeply coupled logic
circular dependencies
unclear execution flow
implicit assumptions
boolean flags controlling multiple behaviors
repeated early/late transformations
tangled validation and business logic
business logic mixed with I/O
framework logic mixed with domain logic

Pay particular attention to functions that:

do many unrelated things
have many parameters
have many branches
mutate many variables
call many unrelated services
perform validation + transformation + persistence + notification
contain nested loops and conditionals
have multiple responsibilities
require extensive comments just to explain the flow
6. INVENTORY MODULES; DEEPLY INSPECT ONLY EVIDENCE-BACKED CANDIDATES

Inventory all modules; deeply inspect only evidence-backed candidates for refactoring.

Consider:

function length
cyclomatic complexity
nesting depth
number of parameters
number of local variables
number of dependencies
number of side effects
number of responsibilities
number of branches
readability
testability
reuse potential

For each problematic function, determine:

Current responsibility

What does this function actually do?

Hidden responsibilities

What additional responsibilities are embedded inside it?

Extraction candidates

Which logical units should become separate functions/methods/classes/modules?

Proposed API

What should the new function/method signatures look like?

Dependency requirements

What should be passed in rather than accessed globally?

Side effects

Which side effects should be isolated?

Result

What should the refactored function be responsible for?

7. APPLY SINGLE RESPONSIBILITY PRINCIPLE

Find classes/modules/functions that violate SRP.

Look for components responsible for multiple unrelated concerns, such as:

validation
+
business logic
+
database access
+
HTTP requests
+
logging
+
formatting
+
notification

Separate responsibilities where doing so meaningfully improves the architecture.

Do NOT split every function into tiny functions.

A good function should represent a meaningful unit of behavior.

8. REVIEW COUPLING

Analyze coupling between modules.

Identify:

circular dependencies
bidirectional dependencies
modules importing implementation details
excessive use of global state
excessive dependency chains
unnecessary framework dependencies
infrastructure leaking into business logic
domain logic depending directly on UI/API/database details
modules knowing too much about each other's internals

For problematic dependencies, propose:

dependency inversion
interfaces
dependency injection
adapters
ports-and-adapters
service boundaries
domain abstractions

Use these only where they actually reduce complexity.

Do not introduce abstractions merely because they are theoretically possible.

9. REVIEW FUNCTION AND METHOD DESIGN

Look for:

vague names
misleading names
overly generic names
inconsistent naming
functions that return different types depending on conditions
functions with too many arguments
boolean parameter overload
hidden dependencies
implicit mutation
surprising side effects
inconsistent error behavior
unnecessary callbacks
unnecessary wrappers
unnecessary async/await
unnecessary Promise chains
methods that should be pure
methods that should not belong to their current class/module

Where appropriate:

simplify signatures
introduce meaningful parameter objects
introduce domain-specific types
split responsibilities
make functions pure
isolate side effects
improve naming

Avoid creating parameter objects simply to hide a bad API.

10. REVIEW CONTROL FLOW

Simplify:

deeply nested if statements
nested ternaries
switch statements with excessive responsibilities
repeated conditionals
duplicate branches
complicated boolean expressions
unnecessary loops
multiple passes over data where inappropriate
exception-driven control flow
convoluted async flows
deeply nested callbacks

Prefer clear control flow.

Use:

guard clauses
early returns
extracted predicates
strategy patterns
lookup tables/maps
small cohesive functions

only when they make the code clearer.

11. REVIEW ERROR HANDLING

Find inconsistent or duplicated error handling.

Analyze:

swallowed exceptions
overly broad catches
duplicated try/catch blocks
inconsistent error types
inconsistent error messages
errors used for normal control flow
missing context
logging duplication
errors leaking infrastructure details
improper error propagation

Design a consistent error-handling strategy.

Preserve externally observable error behavior unless a change is explicitly justified.

12. REVIEW STATE AND MUTABILITY

Identify:

global mutable state
shared mutable objects
unnecessary mutation
state modified from multiple places
hidden state changes
mutable singleton services
state that should be local
state that should be immutable
race-condition risks
order-dependent behavior

Reduce mutable state where doing so improves clarity and correctness.

Do not blindly convert everything to immutable patterns if the language/framework makes that less readable.

13. REVIEW CONSTANTS AND CONFIGURATION

Find:

magic numbers
magic strings
duplicated configuration
hard-coded paths
hard-coded URLs
duplicated environment variable access
configuration scattered across the application
environment-specific logic spread throughout the codebase

Centralize configuration appropriately.

Do not create a giant "constants" file containing unrelated values.

Group constants by domain/responsibility.

14. REVIEW UTILITIES / HELPERS

Pay special attention to files such as:

utils
helpers
common
shared
misc
tools
helpers.ts
common.ts
index.ts

These frequently become dumping grounds.

For every utility, determine:

Is it genuinely generic?
Is it domain-specific?
Does it belong closer to the domain that uses it?
Is it duplicated elsewhere?
Is it too generic?
Does it hide business logic?

Move domain-specific logic out of generic utility modules.

15. REVIEW DEAD CODE

Identify:

unused functions
unused methods
unused classes
unused imports
unreachable branches
obsolete compatibility code
deprecated APIs
unused configuration
stale comments
abandoned abstractions
duplicate implementations

Before deleting anything, verify that it is genuinely unused.

Consider dynamic imports/reflection/runtime registration.

Do not delete code solely because static analysis cannot find a reference.

16. REVIEW COMMENTS AND DOCUMENTATION

Find comments that:

explain obvious code
compensate for confusing implementation
describe outdated behavior
contain TODOs that are no longer relevant
contradict the implementation

Prefer improving the code over adding explanatory comments.

Keep comments where they explain:

non-obvious business rules
external constraints
unusual architectural decisions
important performance/security considerations
17. REVIEW TESTABILITY

For every major module, determine:

Can it be unit tested?
Does it require excessive mocking?
Does it depend on global state?
Does it require real infrastructure?
Are side effects isolated?
Are business rules testable independently?

Identify refactors that would make testing easier.

Do NOT rewrite the entire test suite unless necessary.

Before modifying behavior-heavy code, ensure there is sufficient test coverage or create focused characterization tests.

18. PRESERVE BEHAVIOR

This is extremely important.

The default objective is:

Refactor structure without changing behavior.

Before changing a complex area:

Understand its current behavior.
Identify existing tests.
Add characterization tests if necessary.
Refactor incrementally.
Run tests.
Compare behavior.

If you discover what appears to be a bug:

do not silently "fix" it during a structural refactor
document it separately
determine whether fixing it is within scope
preserve current behavior unless explicitly authorized to change it
19. AVOID OVER-ENGINEERING

Do NOT automatically introduce:

factories
repositories
interfaces
dependency injection containers
abstract base classes
event buses
CQRS
microservices
design patterns
generic frameworks
additional layers

unless the existing codebase has a concrete problem that the abstraction solves.

Use the simplest architecture that solves the problem.

20. REFACTORING PRIORITY

Classify findings into:

P0 — Critical

Problems that create:

correctness risks
severe coupling
security risks
major maintainability problems
high regression risk
P1 — High

Problems causing substantial:

duplication
complexity
difficult testing
architectural coupling
P2 — Medium

Problems improving:

readability
consistency
maintainability
P3 — Low

Minor cleanup that can safely wait.

Do not create numeric quality scores or arbitrary rankings.

Prioritize based on concrete engineering impact.

21. CREATE A REFACTORING ROADMAP

Before implementing changes, produce a roadmap.

For each refactor include:

Refactor:
Location:
Problem:
Why it is a problem:
Current responsibility:
Proposed responsibility:
Dependencies affected:
Functions/classes affected:
Potential regression risks:
Tests required:
Refactoring steps:
Expected result:
Priority:

Group the roadmap into logical phases.

For example:

Phase 1

Low-risk cleanup

Phase 2

Duplication removal

Phase 3

Function/method decomposition

Phase 4

Responsibility separation

Phase 5

Dependency/coupling reduction

Phase 6

Architectural cleanup

Phase 7

Final consistency pass

22. IMPLEMENT IN SMALL INCREMENTS

After creating the plan, implement the refactoring incrementally.

For each change:

Make one coherent change.
Run relevant tests.
Run type checking.
Run linting/static analysis.
Verify imports/dependencies.
Inspect the resulting diff.
Continue only when the previous step is stable.

Avoid huge rewrites.

Do not modify unrelated code.

Do not combine unrelated refactors into one change.

23. REFACTOR FUNCTIONS/METHODS SYSTEMATICALLY

For each large function:

Before

Document:

responsibilities
inputs
outputs
side effects
dependencies
branches
error behavior
During

Extract cohesive logical operations.

Example:

processOrder()
    ├── validateOrder()
    ├── calculateTotals()
    ├── reserveInventory()
    ├── persistOrder()
    └── publishOrderCreated()

Do not blindly create one function per line.

Each extracted function should represent a meaningful concept.

After

The top-level function should read approximately like a high-level description of the business operation.

24. IDENTIFY PATTERN-BASED PROBLEMS

Look for cases where an appropriate design pattern genuinely simplifies the code.

Potential examples:

Strategy
Factory
Adapter
Command
Builder
Observer
State
Template Method

But only introduce a pattern when it makes the code simpler and more maintainable.

Explicitly explain:

Current problem
Why simpler code is insufficient
Why this pattern helps
What complexity it introduces

If the pattern introduces more complexity than it removes, do not use it.

25. API AND PUBLIC INTERFACE SAFETY

Identify public APIs, exported functions/classes, and externally consumed interfaces.

Before changing them:

identify consumers
determine whether backward compatibility is required
avoid unnecessary breaking changes
preserve public behavior
document any required migration

Do not change public interfaces merely for aesthetic reasons.

26. PERFORMANCE

Do not optimize blindly.

Look for obvious performance problems caused by refactoring targets, including:

repeated expensive computation
unnecessary database queries
N+1 patterns
repeated network calls
unnecessary serialization
unnecessary allocations
inefficient loops
repeated parsing
redundant transformations

Do not sacrifice readability for theoretical performance gains.

Only optimize when there is a concrete reason.

27. SECURITY

During the review, identify obvious security risks such as:

unsafe input handling
injection risks
secrets in source code
insecure configuration
authorization checks duplicated or missing
sensitive information in logs
unsafe deserialization
path traversal
insecure external requests

Do not redesign the security architecture unless necessary.

Clearly distinguish security findings from ordinary refactoring findings.

28. FINAL CODE QUALITY REVIEW

After refactoring, perform another complete pass.

Verify:

DRY
Is meaningful duplication removed?
Did we avoid harmful abstraction?
Architecture
Are responsibilities clearer?
Is coupling reduced?
Is cohesion improved?
Functions
Are large functions decomposed?
Are functions understandable?
Are signatures reasonable?
Dependencies
Are dependency directions clearer?
Are circular dependencies removed?
Testing
Does test coverage remain intact?
Are important business rules easier to test?
Behavior
Has existing behavior been preserved?
Maintainability
Would a new developer understand the code more easily?
Complexity
Did the refactor actually reduce complexity?
29. REQUIRED FINAL REPORT

At the end, provide a final report containing:

Executive Summary

Briefly explain the overall state of the codebase.

Architecture Map

Describe the resulting architecture.

Major Problems Found

List the major issues and their locations.

DRY Improvements

Explain meaningful duplication that was removed.

Spaghetti-Code Improvements

Explain which tangled areas were simplified.

Function/Method Refactors

For each significant refactor:

Before:
After:
Why:
Dependency Improvements

Explain how coupling was reduced.

Dead Code Removed

List significant removals.

Tests

Report:

tests run
tests added
tests modified
tests passed
tests that could not be run and why
Static Analysis

Report:

type checking
linting
formatting
other relevant checks
Remaining Technical Debt

Do not pretend everything is perfect.

List important remaining issues.

Recommended Next Steps

Provide the next logical engineering tasks without unnecessary work.

30. IMPORTANT RULES

Follow these rules throughout the entire task:

Inspect before modifying.
Understand before abstracting.
Prefer simple solutions.
Do not refactor merely for stylistic preference.
Do not change behavior accidentally.
Do not introduce abstractions without a concrete reason.
Do not create giant utility modules.
Do not create tiny meaningless functions.
Do not rewrite stable code simply because it could look different.
Do not mix unrelated refactors.
Preserve public APIs unless there is a clear reason to change them.
Use tests as behavioral contracts.
Add characterization tests before risky refactors when needed.
Keep each refactor understandable and reviewable.
Prefer semantic duplication analysis over textual duplication analysis.
Prefer composition over unnecessary inheritance.
Prefer explicit dependencies over hidden dependencies.
Prefer pure business logic where practical.
Isolate side effects.
Keep domain/business logic independent from infrastructure when practical.
Do not over-engineer.
Do not optimize prematurely.
Do not silently fix unrelated bugs.
Do not remove code without verifying it is unused.
Do not stop after fixing the first obvious problems. Review the entire codebase.
31. MOST IMPORTANT EXPECTATION

I do NOT want a superficial code review.

I want you to think like a senior engineer taking ownership of an existing production codebase.

Look for problems that are not immediately obvious:

duplicated business concepts under different names
abstractions that are technically reusable but semantically wrong
functions that are short but have too many responsibilities
classes that appear cohesive but actually coordinate unrelated domains
utilities hiding business logic
dependency direction problems
unnecessary indirection
hidden state
implicit contracts
inconsistent error semantics
duplicated validation
duplicated transformations
repeated orchestration logic
accidental coupling
fragile code paths
abstractions that make future changes harder
code that is difficult to test because responsibilities are mixed

The objective is not to maximize the number of refactors.

The objective is to produce a codebase where:

each piece of code has a clear responsibility, dependencies are intentional, business rules are easy to locate, duplication is minimized, functions are understandable, side effects are isolated, and future changes require less effort and less risk.

Start with a complete inspection and analysis.

Do not make code changes until you have produced the initial codebase map and refactoring plan.

Add a safe execution boundary

Yes. I’d add a strict safe-execution boundary so the agent can inspect and plan freely, but cannot make broad/destructive changes without validation and explicit checkpoints.

Here is the section to append to the prompt:

Safe Execution Boundary
32. SAFE EXECUTION BOUNDARY

Refactoring must be performed inside a strict safety boundary.

The goal is to improve the codebase while minimizing the risk of:

accidental behavior changes
breaking public APIs
deleting required code
introducing regressions
corrupting configuration
changing database behavior
breaking integrations
modifying generated/vendor files
introducing unrelated changes
creating an unreviewable diff
32.1 INSPECTION IS SAFE — MODIFICATION IS CONTROLLED

You may freely:

inspect files
search the repository
analyze dependencies
trace call sites
inspect tests
inspect configuration
identify duplication
identify architectural problems
calculate complexity
build the refactoring plan

Do NOT modify code during the initial discovery phase.

The first phase must be read-only.

32.2 CREATE A BASELINE BEFORE CHANGES

Before modifying anything, establish the current state of the project.

Record:

current branch
repository status
existing uncommitted changes
build status
test status
type-check status
lint status
formatter status
relevant generated artifacts
relevant environment/configuration assumptions

If the repository already contains uncommitted changes:

DO NOT overwrite, reset, revert, or discard them.

Treat existing user changes as protected.

Clearly distinguish:

Pre-existing changes
vs.
Changes introduced by this refactor

Never use destructive commands to "clean up" the working tree.

32.3 PROTECTED FILES

Do not modify the following unless explicitly required by the refactoring plan:

secrets
.env files
credentials
certificates
production configuration
deployment configuration
infrastructure configuration
database migrations
generated files
lockfiles
vendor/third-party code
build artifacts
user data
production data
CI/CD configuration
Refactoring exclusions:
The following are not generic DRY or spaghetti-code refactoring targets. Change them only through a separately approved task with domain-specific validation:
generated Supabase type definitions
SQL schema bundles and migrations
seeded track data
shadcn UI primitives
lockfiles
deployment configuration
audio-analysis algorithms


If one of these files genuinely requires modification, stop and identify:

File:
Reason:
Risk:
Required change:
Alternative:

Do not silently modify it.

32.4 NO DESTRUCTIVE OPERATIONS

Never perform destructive operations such as:

deleting large groups of files
resetting the repository
reverting user changes
force checkout
force reset
rewriting git history
deleting branches
dropping databases
modifying production data
removing dependencies solely because they appear unused
deleting code without verifying all possible consumers

Do not use commands equivalent to:

git reset --hard
git clean -fd
git checkout -- .
git restore .

unless the user explicitly requests that exact destructive operation.

32.5 NO MASS REWRITE

Do not perform a broad search-and-replace refactor across the entire repository unless the transformation is:

deterministic,
mechanically safe,
reviewed before application,
covered by appropriate tests.

Prefer targeted, incremental edits.

Avoid replacing entire files when a small localized change is sufficient.

32.6 ONE COHERENT REFACTOR AT A TIME

Each refactoring step should have one clear purpose.

Examples:

Extract order validation

or:

Remove duplicated API error handling

or:

Separate persistence from business logic

Do not combine unrelated changes into the same modification.

32.7 VALIDATE AFTER EVERY SIGNIFICANT CHANGE

After each meaningful refactoring step:

Inspect the diff.
Run the most relevant tests.
Run type checking if applicable.
Run linting if applicable.
Run formatting checks if applicable.
Verify imports and dependency relationships.
Verify public interfaces.
Confirm that behavior remains consistent.

If validation fails:

STOP progressing in that refactoring area.

Investigate the failure before making additional structural changes.

Do not blindly modify more code to make the test pass.

32.8 STOP CONDITIONS

Immediately stop and report the issue if any of the following occurs:

tests unexpectedly fail
build unexpectedly fails
type checking introduces new errors
linting introduces significant new errors
behavior appears to change unexpectedly
a public API would break
a database migration appears necessary
production configuration must change
an external integration contract would change
a security-sensitive area requires architectural changes
the correct behavior is ambiguous
existing uncommitted user work would be affected
a refactor requires a destructive operation
the scope expands beyond the approved refactoring plan

Do not continue blindly.

32.9 BEHAVIORAL SAFETY

For every non-trivial refactor, explicitly identify:

Behavior being preserved:
Inputs:
Outputs:
Side effects:
Errors:
External interactions:
State changes:

If behavior cannot be confidently determined from the code/tests:

Do not invent the intended behavior.

Instead:

document the ambiguity,
create characterization tests if possible,
preserve current behavior,
flag the area for review.
32.10 TEST-FIRST BOUNDARY FOR RISKY CODE

If a refactoring target contains important business logic but has insufficient tests:

Do NOT immediately restructure it.

First create focused characterization tests that capture the current behavior.

Then refactor.

The sequence should be:

Current behavior
      ↓
Characterization tests
      ↓
Small refactor
      ↓
Tests
      ↓
Next refactor
32.11 PUBLIC API BOUNDARY

Before changing an exported/public:

function
class
method
type
interface
endpoint
event
command
configuration contract

identify all known consumers.

Default behavior:

Preserve the public contract.

If a breaking change appears necessary:

STOP and report:

Public API:
Current contract:
Proposed contract:
Consumers affected:
Why the change is necessary:
Migration required:
Risk:

Do not silently introduce breaking changes.

32.12 DATABASE SAFETY

Do not modify:

schemas
migrations
indexes
constraints
production data
seed behavior

as part of ordinary code refactoring unless explicitly included in the approved plan.

If database changes appear necessary, isolate them as a separate migration task.

Never execute destructive database operations against production.

32.13 DEPENDENCY SAFETY

Do not:

upgrade dependencies opportunistically
downgrade dependencies opportunistically
replace libraries merely because another library is preferred
remove dependencies solely because they appear unused
regenerate lockfiles unnecessarily

Dependency changes are separate changes unless required for the refactor.

If a dependency appears unnecessary:

Dependency:
Evidence:
Potential consumers:
Reason it may be removable:
Confidence:

Verify before removing it.

32.14 GENERATED CODE

Identify generated files before editing.

Do not manually modify generated output when the source generator should be changed instead.

If generated files change as a consequence of a source change:

identify them as generated
verify the generator output
include only expected generated changes
32.15 DIFF SIZE CONTROL

Prefer small, reviewable diffs.

If a proposed refactor produces an unexpectedly large diff:

STOP and investigate.

Determine whether the size is caused by:

formatting
generated files
line-ending changes
import sorting
mass replacement
accidental file rewriting
genuine architectural changes

Do not allow unrelated formatting churn to obscure the refactor.

32.16 ROLLBACK STRATEGY

Before each high-risk refactor, identify how the change can be safely reverted.

Prefer changes that can be reversed independently.

Do not rely on destructive repository resets as the rollback mechanism.

The refactoring should remain understandable and recoverable even if a later step fails.

32.17 NO UNRELATED IMPROVEMENTS

If you discover unrelated issues during the refactor:

Do not automatically fix them.

Add them to:

Deferred Technical Debt

with:

Location:
Problem:
Impact:
Suggested future action:

Only fix them if they are directly required for the current refactoring step.

32.18 FINAL SAFETY CHECK

Before declaring the refactoring complete, verify:

Repository
No user changes were overwritten.
No unexpected files were modified.
No destructive operations occurred.
Behavior
Existing behavior is preserved unless explicitly documented.
No unexplained test failures remain.
Interfaces
Public contracts remain compatible.
External integrations remain compatible.
Quality
Tests pass.
Type checking passes.
Linting passes where applicable.
Formatting is consistent.
Scope
No unrelated cleanup was mixed into the refactor.
Deferred issues are documented.
Diff
The final diff is explainable.
Every changed file has a reason.
Every significant change belongs to the approved refactoring plan.
33. EXECUTION PROTOCOL

Follow this exact sequence:

PHASE 1 — READ ONLY
    ↓
Inspect entire codebase
    ↓
Map architecture
    ↓
Reconcile architecture documentation
    ↓
Identify duplication
    ↓
Identify spaghetti code
    ↓
Identify complex functions
    ↓
Identify coupling
    ↓
Identify risks
    ↓
Create refactoring plan
    ↓
────────────────────────
SAFE EXECUTION CHECKPOINT
    ↓
PHASE 2 — BASELINE
    ↓
Run existing validation
    ↓
Record repository state
    ↓
────────────────────────
SAFE EXECUTION CHECKPOINT
    ↓
PHASE 3 — LOW-RISK REFACTORING
    ↓
One coherent change
    ↓
Validate
    ↓
Inspect diff
    ↓
Repeat
    ↓
PHASE 4 — STRUCTURAL REFACTORING
    ↓
Characterization tests where necessary
    ↓
Extract responsibilities
    ↓
Reduce coupling
    ↓
Validate after every significant step
    ↓
PHASE 5 — FINAL REVIEW
    ↓
Run full validation
    ↓
Inspect complete diff
    ↓
Verify behavior
    ↓
Produce final report
34. EXECUTION AUTHORIZATION RULE

The initial inspection and analysis are always authorized.

Code modification is allowed only after the analysis and refactoring plan have been completed.

For high-risk changes involving:

public APIs
database schemas
authentication/authorization
security-sensitive code
production configuration
external contracts
destructive operations

do not proceed automatically.

Stop at the boundary and clearly identify the required decision.

No code changes may be made until the user explicitly approves a named refactoring phase and target.

35. FINAL PRINCIPLE

Treat the codebase as production code even if it is currently under development.

Every change should satisfy:

Understand → Plan → Protect → Refactor → Validate → Inspect → Continue

Never:

Change everything → hope tests pass.

