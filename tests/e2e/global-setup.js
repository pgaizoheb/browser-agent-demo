import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { AUTH_DIR, authFile, ROLES, signIn } from './support/ui.js'

export default async function globalSetup(config) {
  if (process.env.E2E_BASE_URL && !process.env.E2E_ALLOW_REMOTE) {
    throw new Error('E2E against a remote URL is disabled by default. Set E2E_ALLOW_REMOTE=1 deliberately.')
  }
  // Deterministic fixtures: reset ONLY the synthetic MedPoint demo dataset on the local stack.
  if (!process.env.E2E_SKIP_RESET && !process.env.E2E_BASE_URL) {
    execFileSync('node', ['scripts/demo-dataset.mjs', 'reset'], { stdio: 'inherit' })
  }
  mkdirSync(AUTH_DIR, { recursive: true })
  const { baseURL } = config.projects[0].use
  const browser = await chromium.launch()
  try {
    await Promise.all(ROLES.map(async (role) => {
      const context = await browser.newContext({ baseURL })
      const page = await context.newPage()
      await signIn(page, `demo.${role}`)
      await context.storageState({ path: authFile(role) })
      await context.close()
    }))
  } finally {
    await browser.close()
  }
}
