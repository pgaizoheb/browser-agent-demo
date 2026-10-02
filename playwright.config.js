import { defineConfig, devices } from '@playwright/test'

// Runs against the production build (vite preview) so the deployed CSP is exercised.
// The web server reads public local-stack values via scripts/with-local-env.mjs.
const PORT = Number(process.env.E2E_PORT || 4173)
const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${PORT}/browser-agent-demo/`

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './tests/e2e/global-setup.js',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } }, testIgnore: /responsive\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }, testMatch: /responsive\.spec/ },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `node scripts/with-local-env.mjs sh -c "vite build && vite preview --port ${PORT} --strictPort"`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
