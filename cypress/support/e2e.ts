/// <reference types="cypress" />

// Import commands
import './commands';

// Global before each hook
beforeEach(() => {
  // Clear any existing auth state
  cy.clearLocalStorage();
  cy.clearCookies();
});

// Handle uncaught exceptions
Cypress.on('uncaught:exception', (err, runnable) => {
  // Ignore ResizeObserver errors (common in React apps)
  if (err.message.includes('ResizeObserver')) {
    return false;
  }
  // Ignore network errors during tests
  if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
    return false;
  }
  return true;
});

// Stub console.error so tests can assert on it (e.g. "should not have any
// console errors on load" does `expect(win.console.error).to.not.be.called`).
// This used to also call cy.log() from inside .callsFake() - cy commands are
// queued/async, but the stub's callback runs synchronously the instant the
// app calls console.error, which is a genuinely common thing for it to do
// (a CORS-blocked background fetch, a React warning, etc.) - Cypress detects
// that mismatch and throws "you returned a promise from a command while also
// invoking cy commands" from *whatever command happened to be running next*,
// which is why this was surfacing as bizarre, unrelated-looking failures
// (null subjects, wrong assertion types) in totally different tests. The
// stub alone is enough for assertions against it; a plain console.warn (a
// real, unwrapped console method, not a queued Cypress command) is enough
// for local debugging without corrupting the command queue.
Cypress.on('window:before:load', (win) => {
  cy.stub(win.console, 'error').callsFake((msg) => {
    console.warn(`[app console.error] ${msg}`);
  });
});
