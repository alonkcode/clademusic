import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    // Was http://localhost:5173/cladeai - stale project name and a port
    // nothing here actually serves on (dev:e2e runs on 127.0.0.1:8090
    // under /clademusic, matching how this app is actually deployed).
    // Every scheduled qa-hourly.yml run failed 100% of the time trying to
    // reach this: no dev server was even started first, and this URL
    // wouldn't have been reachable regardless.
    baseUrl: 'http://127.0.0.1:8090/clademusic',
    viewportWidth: 1280,
    viewportHeight: 720,
    video: false,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 10000,
    requestTimeout: 10000,
    responseTimeout: 30000,
    retries: {
      runMode: 2,
      openMode: 0,
    },
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
    supportFile: 'cypress/support/e2e.ts',
  },
  component: {
    devServer: {
      framework: 'react',
      bundler: 'vite',
    },
  },
});