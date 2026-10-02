import { expect, test } from '@playwright/test'
import { ORG_MAIN } from './support/api.js'
import { app, authFile, settled } from './support/ui.js'

// Navigation contract of src/components/shell.js NAV, asserted independently of the source.
const PRIMARY = ['Home', 'Authorizations', 'Claims', 'Members', 'Providers', 'Reference', 'Documents']

const search = (title) => ({ kind: 'search', title })
const report = (title) => ({ kind: 'report', title })

const GROUPS = {
  Authorizations: [
    ['Submit Request', '/authorization-request', report('Submit Request')],
    ['My Requests', '/authorization-request/my', report('My Requests')],
    ['Search', '/authorizations/search', search('Authorizations Search')],
    // demo.user is provider_staff: the page explains the restriction instead of rendering the census.
    ['Hospital Admin', '/hospital-admin', { kind: 'denied', title: 'Hospital Admin' }],
    ['Recently Updated', '/my-data/recently-updated-authorizations', report('Recently Updated')],
    ['Recent Attachments', '/my-data/recent-authorization-attachments', report('Recent Attachments')],
    ['Consult Notes', '/my-data/consult-notes', report('Consult Notes')],
  ],
  Claims: [['Search', '/claims/search', search('Claims Search')]],
  Members: [
    ['Eligibility', '/members/search', search('Members Search')],
    ['My Members', '/my-data/my-members', report('My Members')],
    ['Members Approaching 65', '/my-data/members-approaching-65', report('Members Approaching 65')],
    ['Members Hospitalized', '/my-data/members-hospitalized-pcp', report('Members Hospitalized')],
    ['Members Without Visits in the Past Year', '/my-data/members-without-pcp-visits-in-the-past-year', report('Members Without Visits in the Past Year')],
    ['Members Without Visits Since Enrollment', '/my-data/members-without-pcp-visits-since-enrollment', report('Members Without Visits Since Enrollment')],
  ],
  Providers: [['Search', '/providers/search', search('Providers Search')]],
  Documents: [
    ['My Documents', '/documents', report('My Documents')],
    ['Search', '/documents/search', search('Document Search')],
    ['Forms and Manuals', '/forms', { kind: 'forms', title: 'Forms and Manuals' }],
  ],
}

const FORM_FOLDERS = ['Eligibility Inquiry Forms', 'Fact Sheets', 'Forms', 'Images', 'News', 'PDR Fillable Forms',
  'Provider Manuals', 'Training', 'User Guides']

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const routeUrl = (path) => new RegExp(`#${escapeRegExp(path)}$`)

const primaryNav = (page) => page.locator('nav.primary')
const secondaryNav = (page) => page.locator('nav.secondary')
const groupButton = (page, label) => primaryNav(page).locator(`button[data-nav="${label}"]`)
const secondaryLink = (page, label) => secondaryNav(page).getByRole('link', { name: label, exact: true })

async function expectSecondaryLinks(page, labels) {
  const links = secondaryNav(page).getByRole('link')
  await expect(links).toHaveCount(labels.length)
  for (const [index, label] of labels.entries()) await expect(links.nth(index)).toHaveAccessibleName(label)
}

/** Only `label` is expanded; every other disclosure button is collapsed. */
async function expectExpandedGroup(page, label) {
  for (const group of Object.keys(GROUPS)) {
    await expect(groupButton(page, group)).toHaveAttribute('aria-expanded', String(group === label))
  }
}

/** Every portal page keeps the demo banner and a LOCAL MOCK / DEMO document title. */
async function expectDemoChrome(page, title) {
  await expect(page.getByTestId('demo-banner')).toBeVisible()
  await expect(page.getByTestId('demo-banner')).toContainText('LOCAL MOCK / DEMO — NO REAL DATA')
  await expect(page).toHaveTitle(title ? `${title} • MedPoint LOCAL MOCK / DEMO` : /LOCAL MOCK \/ DEMO/)
}

async function expectPage(page, expected) {
  const notice = page.getByTestId('approximation-notice')
  if (expected.kind === 'search') {
    await expect(page.locator('h1.panel-title')).toHaveAccessibleName(expected.title)
    await expect(notice).toHaveCount(0)
  } else if (expected.kind === 'report') {
    await expect(notice).toBeVisible()
    await expect(page.locator('#page h1')).toHaveText(expected.title)
  } else if (expected.kind === 'forms') {
    await expect(page.locator('#page h1')).toHaveText(expected.title)
    await expect(page.getByTestId('forms-tree')).toBeVisible()
  } else if (expected.kind === 'denied') {
    await expect(notice).toBeVisible()
    await expect(page.getByTestId('permission-denied')).toContainText('restricted to IPA administrators')
  }
}

async function openHome(page) {
  await app(page, '/')
  await expect(page.locator('.home-card')).toBeVisible()
}

test.use({ storageState: authFile('user') })

test.describe('primary navigation', () => {
  test('Home and Reference are links; the other groups are collapsed disclosure buttons', async ({ page }) => {
    await openHome(page)
    const items = primaryNav(page).locator('.nav-item')
    await expect(items).toHaveCount(PRIMARY.length)
    for (const [index, label] of PRIMARY.entries()) await expect(items.nth(index)).toHaveAccessibleName(label)

    const links = primaryNav(page).getByRole('link')
    await expect(links).toHaveCount(2)
    await expect(links.nth(0)).toHaveAccessibleName('Home')
    await expect(links.nth(1)).toHaveAccessibleName('Reference')
    await expect(primaryNav(page).getByRole('button')).toHaveCount(Object.keys(GROUPS).length)
    await expectExpandedGroup(page, null)
    await expect(primaryNav(page).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    await expect(secondaryNav(page).getByRole('link')).toHaveCount(0)

    await primaryNav(page).getByRole('link', { name: 'Reference' }).click()
    await expect(page).toHaveURL(routeUrl('/references'))
    await expect(page.locator('h1.panel-title')).toHaveAccessibleName('Reference Search')
    await expect(primaryNav(page).getByRole('link', { name: 'Reference' })).toHaveAttribute('aria-current', 'page')
    await expect(primaryNav(page).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page')
    await expect(secondaryNav(page).getByRole('link')).toHaveCount(0)
    await expectDemoChrome(page, 'Reference Search')

    await primaryNav(page).getByRole('link', { name: 'Home' }).click()
    await expect(page).toHaveURL(routeUrl('/'))
    await expect(page.locator('.home-card')).toBeVisible()
    await expect(primaryNav(page).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    await expectDemoChrome(page, 'Home')
  })

  test('group buttons toggle aria-expanded and swap the secondary menu without navigating', async ({ page }) => {
    await openHome(page)
    await groupButton(page, 'Authorizations').click()
    await expectExpandedGroup(page, 'Authorizations')
    await expectSecondaryLinks(page, GROUPS.Authorizations.map(([label]) => label))

    await groupButton(page, 'Claims').click()
    await expectExpandedGroup(page, 'Claims')
    await expectSecondaryLinks(page, ['Search'])

    await groupButton(page, 'Claims').click()
    await expectExpandedGroup(page, null)
    await expect(secondaryNav(page).getByRole('link')).toHaveCount(0)
    await expect(page).toHaveURL(routeUrl('/'))
    await expect(page.locator('.home-card')).toBeVisible()
  })

  for (const [group, items] of Object.entries(GROUPS)) {
    test(`${group} menu: every secondary link renders its page and becomes aria-current`, async ({ page }) => {
      await openHome(page)
      await groupButton(page, group).click()
      await expectSecondaryLinks(page, items.map(([label]) => label))

      for (const [label, path, expected] of items) {
        await secondaryLink(page, label).click()
        await expect(page).toHaveURL(routeUrl(path))
        await expectPage(page, expected)
        await expectExpandedGroup(page, group)
        await expect(secondaryLink(page, label)).toHaveAttribute('aria-current', 'page')
        await expect(secondaryNav(page).locator('a[aria-current="page"]')).toHaveCount(1)
        await expectDemoChrome(page, expected.title)
      }
    })
  }
})

test.describe('Hospital Admin for administrators', () => {
  test.use({ storageState: authFile('admin') })

  test('the Authorizations menu opens the inpatient census', async ({ page }) => {
    await openHome(page)
    await groupButton(page, 'Authorizations').click()
    await secondaryLink(page, 'Hospital Admin').click()
    await expect(page).toHaveURL(routeUrl('/hospital-admin'))
    await expect(page.getByTestId('approximation-notice')).toBeVisible()
    await expect(page.locator('#page h1')).toHaveText('Hospital Admin — Inpatient Census')
    await expect(page.getByTestId('admit-form')).toBeVisible()
    await expect(page.getByTestId('permission-denied')).toHaveCount(0)
    await expect(secondaryLink(page, 'Hospital Admin')).toHaveAttribute('aria-current', 'page')
  })
})

test.describe('deep links', () => {
  const DETAILS = [
    { path: '/authorizations/DEMO-AUTH-000005', group: 'Authorizations', testId: 'authorization-detail', heading: 'Authorization DEMO-AUTH-000005' },
    { path: '/members/DEMO-MEM-000005', group: 'Members', testId: 'member-detail', heading: /DEMO-MEM-000005/ },
    { path: '/claims/DEMO-CLM-000005', group: 'Claims', testId: 'claim-detail', heading: 'Claim DEMO-CLM-000005' },
    { path: '/providers/DEMO-NPI-000005', group: 'Providers', testId: 'provider-detail', heading: 'Dr. Morgan Mockley' },
  ]

  for (const detail of DETAILS) {
    test(`${detail.path} opens the ${detail.group} group with no secondary item current`, async ({ page }) => {
      await app(page, detail.path)
      await expect(page.getByTestId(detail.testId).locator('h1')).toHaveText(detail.heading)
      await expectExpandedGroup(page, detail.group)
      await expectSecondaryLinks(page, GROUPS[detail.group].map(([label]) => label))
      await expect(secondaryNav(page).locator('a[aria-current="page"]')).toHaveCount(0)
      await expectDemoChrome(page)
    })
  }

  test('an authorization deep link renders the record fetched from Supabase for the current IPA', async ({ page }) => {
    const fetched = page.waitForResponse((response) => response.request().method() === 'GET'
      && response.url().includes('/rest/v1/mp_authorization_list')
      && response.url().includes('auth_number=eq.DEMO-AUTH-000005'))
    await app(page, '/authorizations/DEMO-AUTH-000005')
    const response = await fetched
    expect(response.status()).toBe(200)
    expect(new URL(response.url()).searchParams.get('org_id')).toBe(`eq.${ORG_MAIN}`)
    const [row] = [].concat(await response.json())
    expect(row).toMatchObject({ auth_number: 'DEMO-AUTH-000005', status: 'modified' })

    const detail = page.getByTestId('authorization-detail')
    await expect(detail).toHaveAttribute('data-status', row.status)
    await expect(detail).toHaveAttribute('data-record-id', row.id)
    await expect(detail.locator('h1')).toHaveText('Authorization DEMO-AUTH-000005')
    await expect(detail.locator('[data-field="reference_number"] dd')).toHaveText(row.reference_number)
    await expect(detail.getByTestId('status-badge')).toHaveText(row.status_label)
  })

  test('an unknown route shows the page-error state inside the shell', async ({ page }) => {
    await app(page, '/no-such-page')
    await expect(page.getByTestId('page-error')).toHaveText(/Page \/no-such-page does not exist in this demo portal\./)
    await expect(primaryNav(page)).toBeVisible()
    await expectExpandedGroup(page, null)
    await expect(secondaryNav(page).getByRole('link')).toHaveCount(0)
    await expectDemoChrome(page, 'Not found')
  })
})

test.describe('account and help dialogs', () => {
  test('account dialog shows the provider staff identity and links to the activity log', async ({ page }) => {
    await openHome(page)
    await page.getByTestId('account-button').click()
    const dialog = page.getByTestId('account-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('account-display-name')).toHaveText('Demo User')
    await expect(dialog.getByTestId('account-role')).toHaveText('Provider Office Staff')
    await expect(dialog.locator('.detail-item').filter({ hasText: 'Current IPA' }).locator('dd'))
      .toHaveText('DEMO IPA — SYNTHETIC ORGANIZATION')

    await settled(page, () => dialog.getByRole('link', { name: 'Activity log' }).click())
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(routeUrl('/activity'))
    await expect(page.locator('#page h1')).toHaveText('Activity Log')
    await expect(page.getByTestId('approximation-notice')).toContainText('Demo audit trail')
    await expect(page.getByTestId('table-error')).toHaveCount(0)
    await expectDemoChrome(page, 'Activity Log')
  })

  test('help dialog opens from the home page "e-mail us." link and closes', async ({ page }) => {
    await openHome(page)
    await page.getByRole('button', { name: 'e-mail us.' }).click()
    const dialog = page.getByTestId('help-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Demo help' })).toBeVisible()
    await expect(dialog).toContainText('LOCAL MOCK / DEMO portal')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('reviewer account', () => {
  test.use({ storageState: authFile('reviewer') })

  test('account dialog shows the reviewer role label', async ({ page }) => {
    await openHome(page)
    await page.getByTestId('account-button').click()
    const dialog = page.getByTestId('account-dialog')
    await expect(dialog.getByTestId('account-display-name')).toHaveText('Demo Reviewer')
    await expect(dialog.getByTestId('account-role')).toHaveText('Utilization Reviewer')
  })
})

test.describe('home page', () => {
  test('matches the mock copy: heading, welcome text, and four News and Updates entries', async ({ page }) => {
    await openHome(page)
    const home = page.locator('.home-card')
    await expect(home.getByRole('heading', { level: 2 })).toHaveText('MedPOINT Management Provider Portal')
    await expect(home).toContainText('Welcome to the MedPOINT Provider Web Portal!')
    await expect(home).toContainText('Thank You!The Web Portal Team')

    const news = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'News and Updates' }) }).locator('section.news')
    await expect(news.locator('h3')).toHaveText(['Web Portal Update', 'Web Portal Maintenance', 'Web Portal Update', 'Annual Provider Training'])
    await expect(news.locator('time')).toHaveText(['08/04/2026', '08/03/2026', '07/29/2026', '06/15/2026'])
    await expect(news.getByRole('button', { name: 'Read More...' })).toHaveCount(4)

    await home.getByRole('link', { name: 'User Guide' }).click()
    await expect(page).toHaveURL(routeUrl('/forms'))
    await expect(page.locator('#page h1')).toHaveText('Forms and Manuals')
    await expectExpandedGroup(page, 'Documents')
  })
})

test.describe('Forms and Manuals', () => {
  test('lists the nine observed folders in order, each holding two synthetic files', async ({ page }) => {
    await app(page, '/forms')
    const folders = page.locator('[data-testid="forms-tree"] details.folder')
    await expect(folders).toHaveCount(FORM_FOLDERS.length)
    expect(await folders.evaluateAll((nodes) => nodes.map((node) => node.dataset.folder))).toEqual(FORM_FOLDERS)
    await expect(page.getByTestId('form-file')).toHaveCount(FORM_FOLDERS.length * 2)

    const folder = page.locator('[data-testid="forms-tree"] details.folder[data-folder="Training"]')
    const files = folder.getByTestId('form-file')
    await expect(files.first()).toBeHidden()
    await folder.locator('summary').click()
    await expect(folder).toHaveAttribute('open', '')
    await expect(files).toHaveText([/Demo Training Guide\.pdf/, /Demo Training Checklist\.txt/])
    await expect(files.nth(0)).toBeVisible()
    await expect(files.nth(1)).toBeVisible()
  })

  test('Refresh reloads the index and confirms with a toast', async ({ page }) => {
    await app(page, '/forms')
    const folders = page.locator('[data-testid="forms-tree"] details.folder')
    await expect(folders).toHaveCount(FORM_FOLDERS.length)
    const reloaded = page.waitForResponse((response) => response.url().includes('/rest/v1/mp_forms_manuals') && response.ok())
    await page.getByTestId('refresh-forms').click()
    await reloaded
    await expect(page.getByTestId('toast')).toHaveText('Forms index refreshed.')
    await expect(folders).toHaveCount(FORM_FOLDERS.length)
  })
})

test.describe('content security policy', () => {
  test('served index.html allows only the Supabase origin for connect-src and pages load without violations', async ({ page, request }) => {
    const html = await (await request.get('./')).text()
    const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1]
    expect(policy, 'index.html must carry a CSP meta tag').toBeTruthy()
    const directives = Object.fromEntries(policy.split(';').map((part) => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]))
    expect(policy).not.toContain('*')

    const violations = []
    page.on('console', (message) => {
      if (message.type() === 'error' && /Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text())
    })
    await page.addInitScript(() => {
      window.__cspViolations = []
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`)
      })
    })

    const supabaseCall = page.waitForResponse((response) => response.url().includes('/rest/v1/') && response.ok())
    await openHome(page)
    const supabaseOrigin = new URL((await supabaseCall).url()).origin
    expect(supabaseOrigin).not.toBe(new URL(page.url()).origin)
    expect(directives['connect-src']).toEqual(["'self'", supabaseOrigin])

    await settled(page, () => app(page, '/authorizations/search?searched=1'))
    await expect(page.locator('[data-testid="results-table"] tbody tr[data-record-id]').first()).toBeVisible()
    await page.locator('[data-testid="results-table"] [data-testid="record-link"]').first().click()
    await expect(page.getByTestId('authorization-detail')).toBeVisible()
    await primaryNav(page).getByRole('button', { name: 'Documents' }).click()
    await secondaryLink(page, 'Forms and Manuals').click()
    await expect(page.locator('[data-testid="forms-tree"] details.folder')).toHaveCount(FORM_FOLDERS.length)

    expect(violations).toEqual([])
    expect(await page.evaluate(() => window.__cspViolations)).toEqual([])
  })
})
