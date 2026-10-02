import { expect, test } from '@playwright/test'
import { apiAs, createAuthorization, must, transition } from './support/api.js'
import { app, authFile, columnValues, settled } from './support/ui.js'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const resultRows = (page) => page.locator('[data-testid="results-table"] tbody tr[data-record-id]')
const pageRange = (page) => page.getByTestId('page-range')
const recordIds = (page) => resultRows(page).evaluateAll((rows) => rows.map((row) => row.dataset.recordId))
const hashParams = (page) => new URLSearchParams(new URL(page.url()).hash.split('?')[1] || '')
const open = (page, hashPath) => settled(page, () => app(page, hashPath))
const applyFilters = (page) => settled(page, () => page.getByTestId('filter-apply').click())
const rowWithLink = (page, label) => resultRows(page).filter({ has: page.getByRole('link', { name: label, exact: true }) })
const summary = (what) => `Synthetic e2e ${what} ${Date.now()} with enough clinical detail to submit for review.`

/** MM/DD/YYYY (table display) → YYYY-MM-DD. */
const iso = (shown) => {
  const [month, day, year] = shown.trim().split('/')
  return `${year}-${month}-${day}`
}

/** Local calendar date one year ago as YYYY-MM-DD. */
function oneYearAgo() {
  const date = new Date()
  date.setFullYear(date.getFullYear() - 1)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

async function userId(client) {
  const { data, error } = await client.auth.getUser()
  if (error) throw error
  return data.user.id
}

/** "MM/DD/YYYY, HH:MM AM" (formatDateTime, en-US) → epoch ms in local time. */
function parseDateTime(shown) {
  const [, month, day, year, hour, minute, half] = shown.replace(/[\u202f\u00a0]/g, ' ')
    .match(/^(\d{2})\/(\d{2})\/(\d{4}),? (\d{2}):(\d{2}) ([AP]M)$/)
  return new Date(Number(year), Number(month) - 1, Number(day), (Number(hour) % 12) + (half === 'PM' ? 12 : 0), Number(minute)).getTime()
}

// Request report columns: 1 Auth. No., 2 Status, 3 Member ID, 4 Member Name, 5 Provider, 6 Req. Date, 7 Updated, 8 Actions.

test.describe('My Requests', () => {
  test.use({ storageState: authFile('user') })

  test('lists only requests created by the signed-in user', async ({ page }) => {
    const user = await apiAs('demo.user')
    const admin = await apiAs('demo.admin')
    const mine = await createAuthorization(user, { summary: summary('my-requests own') })
    const theirs = await createAuthorization(admin, { summary: summary('my-requests admin') })

    await open(page, '/authorization-request/my?size=100')
    await expect(page.getByRole('heading', { name: 'My Requests' })).toBeVisible()
    const numbers = await columnValues(page, 1)
    expect(numbers).toContain(mine.auth_number)
    expect(numbers).not.toContain(theirs.auth_number)

    // No visible row belongs to another creator (rows deleted concurrently simply drop out of the lookup).
    const ids = await recordIds(page)
    const foreign = await must(user.from('mp_authorizations').select('id, created_by').in('id', ids)
      .or(`created_by.is.null,created_by.neq.${await userId(user)}`))
    expect(foreign).toEqual([])
  })

  test("Status filter 'Draft' shows only drafts, including a new one", async ({ page }) => {
    const user = await apiAs('demo.user')
    const draft = await createAuthorization(user, { submit: false, summary: summary('my-requests draft') })
    expect(draft.status).toBe('draft')

    await open(page, '/authorization-request/my?size=100')
    await page.locator('#f-status').selectOption({ label: '0 - Draft (mock)' })
    await applyFilters(page)
    expect(hashParams(page).get('status')).toBe('draft')
    const statuses = await resultRows(page).evaluateAll((rows) => rows.map((row) => row.dataset.status))
    expect(new Set(statuses)).toEqual(new Set(['draft']))
    await expect(rowWithLink(page, draft.auth_number)).toHaveCount(1)
    await expect(rowWithLink(page, draft.auth_number).getByTestId('edit-record')).toHaveText(/Edit/)
  })

  test('Create Demo Request link is offered to provider staff', async ({ page }) => {
    await open(page, '/authorization-request/my')
    const create = page.getByTestId('create-request')
    await expect(create).toBeVisible()
    await expect(create).toHaveAttribute('href', '#/authorization-request')
  })
})

test.describe('My Requests as read-only viewer', () => {
  test.use({ storageState: authFile('viewer') })

  test('has no Create Demo Request link and no own requests', async ({ page }) => {
    await open(page, '/authorization-request/my')
    await expect(page.getByRole('heading', { name: 'My Requests' })).toBeVisible()
    await expect(page.getByTestId('create-request')).toHaveCount(0)
    await expect(page.getByTestId('table-empty')).toHaveText('You have not created any synthetic requests in this IPA.')
  })
})

test.describe('Recently Updated', () => {
  test.use({ storageState: authFile('user') })

  test('a freshly approved request is listed newest-first', async ({ page }) => {
    const user = await apiAs('demo.user')
    const reviewer = await apiAs('demo.reviewer')
    const created = await createAuthorization(user, { summary: summary('recently-updated') })
    await transition(reviewer, created.id, 'approved')

    await open(page, '/my-data/recently-updated-authorizations?size=25')
    const ids = await recordIds(page)
    expect(ids).toContain(created.id)
    await expect(rowWithLink(page, created.auth_number)).toHaveAttribute('data-status', 'approved')

    // Displayed Updated times are newest-first, so every row above ours changed after it.
    const times = (await columnValues(page, 7)).map(parseDateTime)
    for (let i = 1; i < times.length; i += 1) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i])
    expect(Date.now() - times[ids.indexOf(created.id)]).toBeLessThan(5 * 60000)

    // Oldest-first shows the window edge: seeded updates span ~60 days, only the last 30 are listed.
    await settled(page, () => page.getByTestId('sort-updated_at').click())
    expect(hashParams(page).get('sort')).toBe('updated_at.asc')
    const [oldest] = (await columnValues(page, 7)).map(parseDateTime)
    const day = 86400000
    expect(oldest).toBeGreaterThanOrEqual(Date.now() - 30 * day - 5 * 60000)
    expect(oldest).toBeLessThan(Date.now() - 25 * day)
  })
})

// Member report columns: 1 Eligibility, 2 Name, 3 Member ID, 4 SSN, 5 Sex, 6 Birth Date, 7 Health Plan, 8 PCP,
// then report-specific columns, then Options.

test.describe('member reports', () => {
  test.use({ storageState: authFile('user') })

  test('Members Approaching 65 lists only 64-year-olds', async ({ page }) => {
    await open(page, '/my-data/members-approaching-65?size=25')
    await expect(pageRange(page)).toHaveText('1–9 of 9')
    expect(new Set(await columnValues(page, 9))).toEqual(new Set(['64']))
  })

  test('Members Without Visits Since Enrollment have no PCP visit on record', async ({ page }) => {
    await open(page, '/my-data/members-without-pcp-visits-since-enrollment?size=25')
    await expect(pageRange(page)).toHaveText('1–20 of 20')
    const members = await columnValues(page, 3)
    const client = await apiAs('demo.user')
    const visits = await must(client.from('mp_members').select('member_number, last_pcp_visit').in('member_number', members))
    expect(visits).toHaveLength(20)
    expect(new Set(visits.map((row) => row.last_pcp_visit))).toEqual(new Set([null]))

    await resultRows(page).first().getByTestId('view-record').click()
    await expect(page.getByTestId('member-detail')).toBeVisible()
    await expect(page.locator('[data-field="last_pcp_visit"] dd')).toHaveText('None on record')
  })

  test('Members Without Visits in the Past Year have no visit or one older than a year', async ({ page }) => {
    await open(page, '/my-data/members-without-pcp-visits-in-the-past-year?size=50')
    await expect(pageRange(page)).toHaveText('1–40 of 40')
    const visits = await columnValues(page, 9)
    const cutoff = oneYearAgo()
    for (const visit of visits) {
      expect(visit === 'None' || iso(visit) < cutoff, `${visit} should be None or before ${cutoff}`).toBe(true)
    }
    // Both kinds of member qualify.
    expect(visits).toContain('None')
    expect(visits.some((visit) => visit !== 'None')).toBe(true)
  })

  test('Members Hospitalized all show a hospital', async ({ page }) => {
    await open(page, '/my-data/members-hospitalized-pcp?size=25')
    const hospitals = await columnValues(page, 9)
    const since = await columnValues(page, 10)
    expect(hospitals.length).toBeGreaterThanOrEqual(6)
    for (const hospital of hospitals) expect(hospital.trim()).not.toBe('')
    for (const date of since) expect(date).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
    expect(await columnValues(page, 3)).toEqual(expect.arrayContaining(
      ['DEMO-MEM-000019', 'DEMO-MEM-000038', 'DEMO-MEM-000057', 'DEMO-MEM-000076', 'DEMO-MEM-000095', 'DEMO-MEM-000114']))
  })

  test('My Members lists all 120 members and filters by last name', async ({ page }) => {
    await open(page, '/my-data/my-members')
    await expect(pageRange(page)).toHaveText('1–10 of 120')
    await page.locator('#f-q').fill('SAMPLEw')
    await applyFilters(page)
    expect(hashParams(page).get('q')).toBe('SAMPLEw')
    await expect(pageRange(page)).toHaveText('1–7 of 7')
    for (const name of await columnValues(page, 2)) expect(name).toMatch(/^Samplewood, /)

    await settled(page, () => page.getByTestId('filter-reset').click())
    await expect(pageRange(page)).toHaveText('1–10 of 120')
    await expect(page.locator('#f-q')).toHaveValue('')
  })
})

test.describe('Recent Attachments', () => {
  test.use({ storageState: authFile('user') })

  // Columns: 1 Document Name, 2 Auth. No., 3 Type, 4 Date, 5 Uploaded By, 6 Actions.
  test('lists only documents linked to an authorization', async ({ page }) => {
    await open(page, '/my-data/recent-authorization-attachments?size=100')
    const rows = resultRows(page)
    const count = await rows.count()
    expect(count).toBeGreaterThanOrEqual(15) // seeded documents attached to requests
    await expect(rows.locator('td:nth-child(2) a[data-testid="record-link"]')).toHaveCount(count)
    for (const number of await columnValues(page, 2)) expect(number).toMatch(/^DEMO-AUTH-\d{6}$/)

    const names = await columnValues(page, 1)
    expect(names).toContain('demo-correspondence-2.pdf')
    expect(names).not.toContain('demo-clinical-1.pdf') // seeded document with no authorization
    const attached = resultRows(page).filter({ hasText: 'demo-correspondence-2.pdf' })
    await expect(attached.getByRole('link', { name: 'DEMO-AUTH-000006', exact: true })).toHaveAttribute('href', '#/authorizations/DEMO-AUTH-000006')
  })
})

// Activity columns: 1 When, 2 Entity, 3 Record, 4 Action, 5 Status Change, 6 Note, 7 Actor.
test.describe('Activity log', () => {
  test.use({ storageState: authFile('user') })

  test('records a newly submitted request', async ({ page }) => {
    const user = await apiAs('demo.user')
    const created = await createAuthorization(user, { summary: summary('activity') })

    await open(page, '/activity?size=100')
    await expect(page.getByRole('heading', { name: 'Activity Log' })).toBeVisible()
    const event = rowWithLink(page, created.auth_number)
    await expect(event).toHaveCount(1)
    await expect(event.locator('td:nth-child(2)')).toHaveText('Authorization')
    await expect(event.locator('td:nth-child(4)')).toHaveText('Submitted')
    await expect(event.locator('td:nth-child(5)')).toHaveText('— → requested')
    await expect(event.locator('td:nth-child(7)')).toHaveText('Demo User')
  })

  test("Entity filter 'Session' shows the user's sign-in events", async ({ page }) => {
    await open(page, '/activity')
    await page.locator('#f-entity').selectOption({ label: 'Session' })
    await applyFilters(page)
    expect(hashParams(page).get('entity')).toBe('session')
    const entities = await columnValues(page, 2)
    expect(entities.length).toBeGreaterThan(0)
    expect(new Set(entities)).toEqual(new Set(['Session']))
    expect(new Set(await columnValues(page, 3))).toEqual(new Set(['Sign-in']))
    expect(new Set(await columnValues(page, 4))).toEqual(new Set(['Login Verified']))
    expect(new Set(await columnValues(page, 7))).toEqual(new Set(['Demo User']))
  })
})
