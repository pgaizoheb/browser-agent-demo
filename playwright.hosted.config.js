import { defineConfig, devices } from '@playwright/test'

// Hosted smoke: tests/e2e/backend.spec.js against the deployed GitHub Pages build and its hosted
// Supabase project, in Google Chrome with a clean profile per test (the PGA worker Chrome's shape).
// No global setup and no data reset: it signs in only as the read-only demo.viewer and ends each
// session locally. HOSTED_URL / HOSTED_BACKEND_URL / HOSTED_CHANNEL override the defaults.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /backend\.spec\.js$/,
  outputDir: './test-results/hosted',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  metadata: {
    hosted: true,
    backendUrl: process.env.HOSTED_BACKEND_URL || 'https://kmlmsvgwhnprvmxcwpdc.supabase.co',
  },
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.HOSTED_CHANNEL ?? 'chrome',
    baseURL: process.env.HOSTED_URL || 'https://pgaizoheb.github.io/browser-agent-demo/',
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
