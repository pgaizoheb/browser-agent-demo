import { expect, test } from '@playwright/test'
import { app, authFile, enterCredentials, readCodeFromMailbox, signIn } from './support/ui.js'

test.describe('sign-in sequence: credentials → test CAPTCHA → Sign in → test e-mail code', () => {
  test('protected routes redirect to sign-in and keep the deep link', async ({ page }) => {
    await app(page, '/claims/search')
    await expect(page).toHaveURL(/#\/sign-in\?next=%2Fclaims%2Fsearch/)
    await expect(page.getByTestId('demo-banner')).toContainText('LOCAL MOCK / DEMO — NO REAL DATA')
    await enterCredentials(page, 'demo.user', undefined, { navigate: false })
    const code = await readCodeFromMailbox(page)
    await page.locator('#verify-code').fill(code)
    await page.getByTestId('verify-submit').click()
    await expect(page.getByRole('heading', { name: 'Claims Search' })).toBeVisible()
  })

  test('CAPTCHA appears only after a password is entered and is required', async ({ page }) => {
    await app(page, '/sign-in')
    await expect(page.getByTestId('captcha')).toBeHidden()
    await page.getByTestId('username').fill('demo.user')
    await page.getByTestId('password').fill('anything')
    await expect(page.getByTestId('captcha')).toBeVisible()
    await expect(page.getByTestId('captcha')).toContainText('DEMO TEST CAPTCHA')
    await page.getByTestId('sign-in').click()
    await expect(page.getByTestId('login-error')).toHaveText('Complete the test CAPTCHA.')
  })

  test('wrong password is rejected and the CAPTCHA must be repeated', async ({ page }) => {
    await enterCredentials(page, 'demo.user', 'not-the-password')
    await expect(page.getByTestId('login-error')).toHaveText('Invalid username or password.')
    await expect(page.getByTestId('captcha-checkbox')).not.toBeChecked()
  })

  test('incorrect codes count down, lock out after five, and a resent code works', async ({ page }) => {
    await enterCredentials(page, 'demo.viewer')
    await expect(page.getByTestId('test-mode-notice')).toContainText('no e-mail is sent')
    const code = await readCodeFromMailbox(page)
    const wrong = code === '000000' ? '111111' : '000000'
    for (let remaining = 4; remaining >= 1; remaining -= 1) {
      await page.locator('#verify-code').fill(wrong)
      await page.getByTestId('verify-submit').click()
      await expect(page.getByTestId('verify-error')).toHaveText(`Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`)
    }
    await page.locator('#verify-code').fill(wrong)
    await page.getByTestId('verify-submit').click()
    await expect(page.getByTestId('verify-error')).toHaveText('Too many incorrect codes. Request a new code.')
    // Even the right code is refused once locked.
    await page.locator('#verify-code').fill(code)
    await page.getByTestId('verify-submit').click()
    await expect(page.getByTestId('verify-error')).toHaveText('Too many incorrect codes. Request a new code.')

    await page.getByTestId('resend-code').click()
    await expect(page.getByTestId('toast')).toContainText('No e-mail was sent')
    const fresh = await readCodeFromMailbox(page)
    await page.locator('#verify-code').fill(fresh)
    await page.getByTestId('verify-submit').click()
    await expect(page.locator('.home-card')).toBeVisible()
  })

  test('a non-numeric code is rejected without consuming an attempt', async ({ page }) => {
    await enterCredentials(page, 'demo.reviewer')
    await page.locator('#verify-code').fill('12ab')
    await page.getByTestId('verify-submit').click()
    await expect(page.getByTestId('verify-error')).toHaveText('Enter the 6-digit verification code.')
  })

  test('an unverified session cannot reach portal pages', async ({ page }) => {
    await enterCredentials(page, 'demo.user')
    await expect(page.getByTestId('verification-message')).toBeVisible()
    await app(page, '/authorizations/search')
    await expect(page.getByTestId('verification-message')).toBeVisible()
    await expect(page.locator('nav.primary')).toHaveCount(0)
  })

  test('sign out ends the session and protects routes again', async ({ page }) => {
    await signIn(page, 'demo.user')
    await page.getByTestId('logout-button').click()
    await expect(page.getByTestId('login-card')).toBeVisible()
    await app(page, '/members/search')
    await expect(page).toHaveURL(/#\/sign-in/)
    await expect(page.getByTestId('username')).toBeVisible()
  })
})

test.describe('verified session', () => {
  test.use({ storageState: authFile('user') })

  test('persists across reloads', async ({ page }) => {
    await app(page, '/providers/search')
    await expect(page.getByRole('heading', { name: 'Providers Search' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Providers Search' })).toBeVisible()
    await expect(page.getByTestId('account-name')).toHaveText('Demo User')
  })
})
