import { expect, test } from '@playwright/test'
import { app, authFile, settled } from './support/ui.js'

// Runs only in the `mobile` project (390x844, see playwright.config.js).

/** The page never scrolls sideways and the layout viewport stays at device width. */
async function expectFitsViewport(page) {
  const width = page.viewportSize().width
  const metrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
  expect(metrics.innerWidth, 'layout viewport is not widened by overflowing content').toBe(width)
  expect(metrics.scrollWidth, 'no page-level horizontal overflow').toBeLessThanOrEqual(metrics.innerWidth + 1)
}

async function expectDemoBanner(page) {
  const banner = page.getByTestId('demo-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toBeInViewport()
  await expect(banner).toContainText('LOCAL MOCK / DEMO')
}

/** Two form fields sit in one column: same left edge, second below the first. */
async function expectStacked(first, second) {
  const a = await first.boundingBox()
  const b = await second.boundingBox()
  expect(Math.abs(a.x - b.x), 'fields share a left edge').toBeLessThanOrEqual(1)
  expect(b.y, 'second field is below the first').toBeGreaterThanOrEqual(a.y + a.height - 1)
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('sign-in fits the phone viewport', async ({ page }) => {
    await app(page, '/sign-in')
    const card = page.getByTestId('login-card')
    await expect(card).toBeVisible()
    await page.getByTestId('username').fill('demo.user')
    await page.getByTestId('password').fill('x')
    await expect(page.getByTestId('captcha')).toBeVisible()
    const box = await card.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width)
    await expectFitsViewport(page)
    await expectDemoBanner(page)
  })
})

test.describe('signed in as provider staff', () => {
  test.use({ storageState: authFile('user') })

  test('home: primary nav scrolls horizontally inside itself and every item is reachable', async ({ page }) => {
    await app(page, '/')
    await expect(page.locator('.home-card')).toBeVisible()
    await expectFitsViewport(page)
    await expectDemoBanner(page)

    const nav = page.locator('nav.primary')
    const overflow = await nav.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowX: getComputedStyle(el).overflowX }))
    expect(overflow.scrollWidth, 'nav content is wider than the phone').toBeGreaterThan(overflow.clientWidth)
    expect(['auto', 'scroll']).toContain(overflow.overflowX)

    const items = nav.locator('.nav-item')
    await expect(items).toHaveCount(7)
    for (let index = 0; index < 7; index += 1) {
      await items.nth(index).scrollIntoViewIfNeeded()
      await expect(items.nth(index), 'nav item is fully reachable (sub-pixel tolerance)').toBeInViewport({ ratio: 0.99 })
    }
    expect(await nav.evaluate((el) => el.scrollLeft), 'the nav itself scrolled').toBeGreaterThan(0)
    expect(await page.evaluate(() => window.scrollX), 'the page did not scroll sideways').toBe(0)

    await items.last().click()
    await expect(items.last()).toHaveAttribute('aria-expanded', 'true')
    await page.locator('nav.secondary').getByRole('link', { name: 'Forms and Manuals' }).click()
    await expect(page.locator('#page h1')).toHaveText('Forms and Manuals')
  })

  test('authorizations search: fields stack and the results table scrolls inside .table-wrap', async ({ page }) => {
    await settled(page, () => app(page, '/authorizations/search?searched=1'))
    await expect(page.locator('[data-testid="results-table"] tbody tr[data-record-id]').first()).toBeVisible()

    await expectStacked(page.locator('[data-field="auth_number"]'), page.locator('[data-field="reference_number"]'))

    const wrap = page.locator('#results .table-wrap')
    const box = await wrap.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width)
    const scroll = await wrap.evaluate((el) => {
      el.scrollLeft = 200
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollLeft: el.scrollLeft }
    })
    expect(scroll.scrollWidth, 'table is wider than its wrapper').toBeGreaterThan(scroll.clientWidth)
    expect(scroll.scrollLeft, 'wrapper scrolls horizontally').toBeGreaterThan(0)

    await expectFitsViewport(page)
    await expectDemoBanner(page)
  })

  test('authorization detail fits the phone viewport', async ({ page }) => {
    await app(page, '/authorizations/DEMO-AUTH-000005')
    await expect(page.getByTestId('authorization-detail')).toBeVisible()
    await expect(page.getByTestId('timeline-section')).toBeVisible()
    await expectFitsViewport(page)
    await expectDemoBanner(page)
  })

  test('request form fields stack and fit the phone viewport', async ({ page }) => {
    await app(page, '/authorization-request')
    await expect(page.getByTestId('request-form')).toBeVisible()
    await expectStacked(page.locator('[data-field="member_number"]'), page.locator('[data-field="requested_provider_id"]'))
    await expectFitsViewport(page)
    await expectDemoBanner(page)
  })

  test('forms and manuals fit with a folder expanded', async ({ page }) => {
    await app(page, '/forms')
    const folder = page.locator('[data-testid="forms-tree"] details.folder[data-folder="PDR Fillable Forms"]')
    await folder.locator('summary').click()
    await expect(folder.getByTestId('form-file')).toHaveCount(2)
    await expect(folder.getByTestId('form-file').first()).toBeVisible()
    await expectFitsViewport(page)
    await expectDemoBanner(page)
  })
})
