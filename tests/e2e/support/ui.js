import { expect } from '@playwright/test'
import { DEMO_PASSWORD } from './api.js'

export const ROLES = ['user', 'reviewer', 'admin', 'viewer', 'other']
// Storage state is origin-bound, so keep one set per preview port.
export const AUTH_DIR = `tests/e2e/.auth/${process.env.E2E_PORT || 4173}`
export const authFile = (role) => `${AUTH_DIR}/${role}.json`

/** Navigates to a hash route inside the app, e.g. app(page, '/claims/search'). */
export async function app(page, hashPath = '/') {
  await page.goto(`./#${hashPath}`)
}

/** Reads the newest code from the in-app demo test mailbox (no e-mail is sent). */
export async function readCodeFromMailbox(page) {
  await page.getByTestId('open-mailbox').click()
  const body = page.locator('[data-latest="true"] [data-testid="mailbox-body"]')
  await expect(body).toBeVisible()
  const code = (await body.textContent()).match(/\b(\d{6})\b/)[1]
  await page.locator('#modal [data-close]').click()
  return code
}

/** Completes credentials + test CAPTCHA, leaving the page on the verification step. */
export async function enterCredentials(page, username, password = DEMO_PASSWORD, { navigate = true } = {}) {
  if (navigate) await app(page, '/sign-in')
  await page.getByTestId('username').fill(username)
  await page.getByTestId('password').fill(password)
  await page.getByTestId('captcha-checkbox').check()
  await page.getByTestId('sign-in').click()
}

/** Full UI sign-in: username/password → test CAPTCHA → Sign in → test-mode e-mail code. */
export async function signIn(page, username) {
  await enterCredentials(page, username)
  await expect(page.getByTestId('verification-message')).toBeVisible()
  const code = await readCodeFromMailbox(page)
  await page.locator('#verify-code').fill(code)
  await page.getByTestId('verify-submit').click()
  await expect(page.locator('nav.primary')).toBeVisible()
}

/** Waits until a results table has finished loading. */
export async function resultsReady(page) {
  await expect(page.getByTestId('table-loading')).toHaveCount(0)
}

export async function columnValues(page, columnIndex) {
  return page.locator(`[data-testid="results-table"] tbody tr[data-record-id] td:nth-child(${columnIndex})`).allTextContents()
}

/**
 * Runs an action that re-renders results (search, sort, paging, navigation) and waits for a
 * FRESH, fully loaded results table, so assertions never read the previous table's rows.
 */
export async function settled(page, action) {
  await page.evaluate(() => document.querySelectorAll('[data-testid="results-table"]').forEach((el) => { el.dataset.stale = '1' }))
  await action()
  await expect(page.locator('[data-testid="results-table"]:not([data-stale])')).toBeVisible()
  await resultsReady(page)
}
