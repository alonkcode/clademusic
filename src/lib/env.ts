/**
 * True when running under Vitest (import.meta.env.MODE) or another Node
 * test runner that sets NODE_ENV=test. Checked both ways because this
 * codebase's tests run through both Vite's own env (component/hook tests)
 * and plain Node (a couple of service-level tests) - either can be the one
 * that's actually set depending on how a given test file is executed.
 *
 * Was reimplemented inline in ~10 files (4 separate times within
 * EmbeddedPlayerDrawer.tsx alone) rather than shared - this is the one
 * place it should be checked from now on.
 */
export const isTestEnv: boolean =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE === 'test') ||
  (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test');
