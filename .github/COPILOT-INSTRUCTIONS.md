# Copilot Instructions — clademusic

Follow **[`AGENTS.md`](../AGENTS.md)** at the repo root for all project rules
(scope control, verification commands, the harmonic-analysis invariants,
security, and the rest). This file adds only what's specific to Copilot's own
editing behavior — it must not restate or override `AGENTS.md`.

## Copilot-specific behavior

- Cite repo-relative paths in suggestions (e.g. `src/services/harmonicAnalysis.ts`),
  not absolute ones.
- No whitespace-only diffs.

That's it. Everything else — what counts as in-scope, how much to change, which
commands to run, the player/harmony invariants — comes from `AGENTS.md`.
