import { expect, test } from '@playwright/test'
import { apiAs, must, ORG_EMPTY, ORG_LARGE, ORG_MAIN } from './support/api.js'
import { app, authFile, columnValues, settled } from './support/ui.js'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const resultRows = (page) => page.locator('[data-testid="results-table"] tbody tr[data-record-id]')
const pageRange = (page) => page.getByTestId('page-range')
const recordIds = (page) => resultRows(page).evaluateAll((rows) => rows.map((row) => row.dataset.recordId))
const rowStatuses = (page) => resultRows(page).evaluateAll((rows) => rows.map((row) => row.dataset.status))
const hashParams = (page) => new URLSearchParams(new URL(page.url()).hash.split('?')[1] || '')
const totalOf = async (page) => Number((await pageRange(page).textContent()).match(/of (\d+)$/)[1])

const open = (page, hashPath) => settled(page, () => app(page, hashPath))
const submit = (page) => settled(page, () => page.getByTestId('search-submit').click())
const switchIpa = (page, label) => settled(page, () => page.getByTestId('ipa-select').selectOption({ label }))

/** Local calendar date `days` ago as YYYY-MM-DD (same computation the app uses for presets). */
function localDate(days = 0) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
/** MM/DD/YYYY (table display) → YYYY-MM-DD. */
const iso = (shown) => {
  const [month, day, year] = shown.trim().split('/')
  return `${year}-${month}-${day}`
}

function expectAllWithin(dates, from, to) {
  expect(dates.length).toBeGreaterThan(0)
  for (const date of dates) {
    expect(date >= from && date <= to, `${date} should be within ${from}..${to}`).toBe(true)
  }
}

function expectMonotonic(values, direction) {
  for (let i = 1; i < values.length; i += 1) {
    const ok = direction === 'asc' ? values[i - 1] <= values[i] : values[i - 1] >= values[i]
    expect(ok, `${values[i - 1]} then ${values[i]} should be ${direction}`).toBe(true)
  }
}

// Authorization search columns: 1 Auth. No., 2 Status, 3 Member ID, 4 Member Name, 5 Sex, 6 DOB,
// 7 Health Plan, 8 Provider, 9 Auth. Date, 10 Req. Date, 11 Actions.

test.describe('authorizations search', () => {
  test.use({ storageState: authFile('user') })

  test('stays idle and queries nothing until Search is pressed', async ({ page }) => {
    const listQueries = []
    page.on('request', (request) => {
      if (request.url().includes('/rest/v1/mp_authorization_list')) listQueries.push(request.url())
    })
    await open(page, '/authorizations/search')
    await expect(page.getByTestId('table-idle')).toHaveText('No results. Use Search to load synthetic examples.')
    await expect(resultRows(page)).toHaveCount(0)
    await expect(pageRange(page)).toHaveText('0–0 of 0')
    await expect(page.getByTestId('next-page')).toBeDisabled()
    expect(listQueries).toHaveLength(0)

    await submit(page)
    await expect(page).toHaveURL(/#\/authorizations\/search\?searched=1$/)
    await expect(resultRows(page)).toHaveCount(10)
    await expect(pageRange(page)).toHaveText(/^1–10 of \d+$/)
    expect(listQueries.length).toBeGreaterThan(0)
  })

  test('Status filter returns only rows with that status', async ({ page }) => {
    await open(page, '/authorizations/search?size=100')
    await page.locator('#f-status').selectOption({ label: '4 - Deferred' })
    await submit(page)
    expect(hashParams(page).get('status')).toBe('deferred')
    const statuses = await rowStatuses(page)
    expect(statuses.length).toBeGreaterThanOrEqual(26) // 26 seeded deferred requests
    expect(new Set(statuses)).toEqual(new Set(['deferred']))
    expect(new Set(await resultRows(page).getByTestId('status-badge').allTextContents())).toEqual(new Set(['4 - Deferred']))
  })

  test('Member Last Name is a case-insensitive partial match', async ({ page }) => {
    await open(page, '/authorizations/search?size=100')
    await page.locator('#f-member-last-name').fill('wOOd')
    await submit(page)
    const lastNames = new Set((await columnValues(page, 4)).map((name) => name.split(',')[0]))
    for (const lastName of lastNames) expect(lastName.toLowerCase()).toContain('wood')
    // A mid-word fragment matches more than one surname.
    expect([...lastNames].sort()).toEqual(['Samplewood', 'Testwood'])
  })

  test('Member Id filter returns only that member', async ({ page }) => {
    await open(page, '/authorizations/search')
    await page.locator('#f-member-number').fill('DEMO-MEM-000100')
    await submit(page)
    expect(new Set(await columnValues(page, 3))).toEqual(new Set(['DEMO-MEM-000100']))
    expect(await columnValues(page, 1)).toEqual(expect.arrayContaining(['DEMO-AUTH-000117', 'DEMO-AUTH-000237']))
  })

  test('More Options reveals and hides the advanced filters', async ({ page }) => {
    await open(page, '/authorizations/search')
    const more = page.getByTestId('more-options')
    const advanced = page.getByTestId('advanced-filters')
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await expect(more).toHaveText(/More Options/)
    await expect(advanced).toBeHidden()

    await more.click()
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(more).toHaveText(/Less Options/)
    await expect(advanced).toBeVisible()
    await expect(page.locator('#f-request-date')).toBeVisible()
    await expect(page.locator('#f-referring-provider-id')).toBeVisible()
    await expect(page.locator('#f-provider-last-name')).toBeVisible()

    await more.click()
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await expect(advanced).toBeHidden()
  })

  test("Request Date 'Last 30 Days' keeps only requests from the last 30 days", async ({ page }) => {
    await open(page, '/authorizations/search?size=100')
    await submit(page)
    const unfilteredTotal = await totalOf(page)

    await page.getByTestId('more-options').click()
    await page.locator('#f-request-date').selectOption({ label: 'Last 30 Days' })
    await expect(page.getByLabel('Request Date from', { exact: true })).toBeHidden()
    await submit(page)
    expect(hashParams(page).get('request_date')).toBe('30')
    expect(hashParams(page).has('request_date_from')).toBe(false)
    // Active advanced filters stay expanded after the search.
    await expect(page.getByTestId('more-options')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('#f-request-date')).toHaveValue('30')

    expectAllWithin((await columnValues(page, 10)).map(iso), localDate(30), localDate(0))
    expect(await totalOf(page)).toBeLessThan(unfilteredTotal)
  })

  test("Request Date 'Custom' shows from/to inputs and filters to that range", async ({ page }) => {
    await open(page, '/authorizations/search?size=100')
    await page.getByTestId('more-options').click()
    const from = page.getByLabel('Request Date from', { exact: true })
    const to = page.getByLabel('Request Date to', { exact: true })
    await expect(from).toBeHidden()
    await expect(to).toBeHidden()

    await page.locator('#f-request-date').selectOption('custom')
    await expect(from).toBeVisible()
    await expect(to).toBeVisible()
    await from.fill(localDate(20))
    await to.fill(localDate(10))
    await submit(page)

    const params = hashParams(page)
    expect([params.get('request_date'), params.get('request_date_from'), params.get('request_date_to')])
      .toEqual(['custom', localDate(20), localDate(10)])
    expectAllWithin((await columnValues(page, 10)).map(iso), localDate(20), localDate(10))
    await expect(from).toHaveValue(localDate(20))
    await expect(to).toHaveValue(localDate(10))

    // Leaving Custom hides the inputs and drops their stale values from the query.
    await page.locator('#f-request-date').selectOption({ label: 'Last 7 Days' })
    await expect(from).toBeHidden()
    await submit(page)
    expect(hashParams(page).get('request_date')).toBe('7')
    expect(hashParams(page).has('request_date_from')).toBe(false)
    expect(hashParams(page).has('request_date_to')).toBe(false)
    const lastWeek = (await columnValues(page, 10)).map(iso)
    for (const date of lastWeek) expect(date >= localDate(7) && date <= localDate(0), date).toBe(true)
  })

  test('Referring Provider filter returns only requests referred by that provider', async ({ page }) => {
    const client = await apiAs('demo.user')
    const [provider] = await must(client.from('mp_providers').select('id, first_name, last_name')
      .eq('org_id', ORG_MAIN).eq('npi', 'DEMO-NPI-000003'))

    await open(page, '/authorizations/search?size=100')
    await page.getByTestId('more-options').click()
    const select = page.locator('#f-referring-provider-id')
    await expect(select.locator('option')).toHaveCount(25) // All + 24 providers
    await expect(select.locator(`option[value="${provider.id}"]`)).toHaveText(new RegExp(`^Dr\\. ${provider.first_name} ${provider.last_name} — `))
    await select.selectOption(provider.id)
    await submit(page)
    expect(hashParams(page).get('referring_provider_id')).toBe(provider.id)

    const ids = await recordIds(page)
    expect(ids.length).toBeGreaterThanOrEqual(11) // 11 seeded referrals from DEMO-NPI-000003
    // Seeded rows are never deleted; other agents' rows deleted mid-test just drop out of the lookup.
    const visible = await must(client.from('mp_authorizations').select('id, referring_provider_id').in('id', ids))
    expect(visible.length).toBeGreaterThanOrEqual(11)
    expect(new Set(visible.map((row) => row.referring_provider_id))).toEqual(new Set([provider.id]))
  })

  test('Requested Provider Last Name filter matches the requested provider surname', async ({ page }) => {
    await open(page, '/authorizations/search?size=100')
    await page.getByTestId('more-options').click()
    await page.locator('#f-provider-last-name').fill('aMPLe')
    await submit(page)
    const surnames = new Set((await columnValues(page, 8)).map((name) => name.trim().split(' ').at(-1)))
    expect(surnames.size).toBeGreaterThanOrEqual(2)
    for (const surname of surnames) expect(surname.toLowerCase()).toContain('ample')
  })

  test('sorting by Auth. No. is server-side, toggles direction, and updates aria-sort', async ({ page }) => {
    await open(page, '/authorizations/search')
    await submit(page)
    const authHeader = page.locator('th', { has: page.getByTestId('sort-auth_number') })
    await expect(page.locator('th', { has: page.getByTestId('sort-request_date') })).toHaveAttribute('aria-sort', 'descending')
    await expect(authHeader).toHaveAttribute('aria-sort', 'none')

    await settled(page, () => page.getByTestId('sort-auth_number').click())
    expect(hashParams(page).get('sort')).toBe('auth_number.asc')
    await expect(authHeader).toHaveAttribute('aria-sort', 'ascending')
    await expect(page.locator('th', { has: page.getByTestId('sort-request_date') })).toHaveAttribute('aria-sort', 'none')
    const ascending = await columnValues(page, 1)
    expect(ascending[0]).toBe('DEMO-AUTH-000001')
    expectMonotonic(ascending, 'asc')

    // The order continues across pages, so it comes from the server, not the visible page.
    await settled(page, () => page.getByTestId('next-page').click())
    const secondPage = await columnValues(page, 1)
    expect(secondPage[0]).toBe('DEMO-AUTH-000011')
    expectMonotonic(secondPage, 'asc')

    await settled(page, () => page.getByTestId('sort-auth_number').click())
    expect(hashParams(page).get('sort')).toBe('auth_number.desc')
    expect(hashParams(page).has('page')).toBe(false)
    await expect(authHeader).toHaveAttribute('aria-sort', 'descending')
    await expect(pageRange(page)).toHaveText(/^1–10 of \d+$/)
    const descending = await columnValues(page, 1)
    expect(descending[0] >= 'DEMO-AUTH-000260').toBe(true)
    expectMonotonic(descending, 'desc')
  })

  test('pagination, page size, URL state after reload, and Reset', async ({ page }) => {
    await open(page, '/authorizations/search')
    await page.locator('#f-status').selectOption('approved')
    await submit(page)
    await settled(page, () => page.getByTestId('sort-auth_number').click())
    await expect(pageRange(page)).toHaveText(/^1–10 of \d+$/)
    await expect(page.getByTestId('previous-page')).toBeDisabled()
    const total = await totalOf(page)
    expect(total).toBeGreaterThanOrEqual(78) // seeded approved requests
    // Seeded approved numbers are n % 10 in {0, 4, 9}: 4, 9, 10, 14, ...
    const firstPage = await columnValues(page, 1)
    expect(firstPage.slice(0, 4)).toEqual(['DEMO-AUTH-000004', 'DEMO-AUTH-000009', 'DEMO-AUTH-000010', 'DEMO-AUTH-000014'])

    await settled(page, () => page.getByTestId('next-page').click())
    await expect(pageRange(page)).toHaveText(/^11–20 of \d+$/)
    await expect(page.getByTestId('page-count')).toHaveText(/^Page 2 of \d+$/)
    const secondPage = await columnValues(page, 1)
    expect(secondPage[0]).toBe('DEMO-AUTH-000039')
    expect(secondPage.filter((number) => firstPage.includes(number))).toEqual([])

    await settled(page, () => page.getByTestId('previous-page').click())
    await expect(pageRange(page)).toHaveText(/^1–10 of \d+$/)
    expect(await columnValues(page, 1)).toEqual(firstPage)

    await settled(page, () => page.locator('#page-size').selectOption('25'))
    await expect(pageRange(page)).toHaveText(/^1–25 of \d+$/)
    await expect(resultRows(page)).toHaveCount(25)
    await settled(page, () => page.getByTestId('next-page').click())
    await expect(pageRange(page)).toHaveText(/^26–50 of \d+$/)
    const params = hashParams(page)
    expect(Object.fromEntries(['status', 'page', 'size', 'sort'].map((key) => [key, params.get(key)])))
      .toEqual({ status: 'approved', page: '1', size: '25', sort: 'auth_number.asc' })
    const beforeReload = await recordIds(page)
    expect((await columnValues(page, 1))[0]).toBe('DEMO-AUTH-000089')

    await settled(page, () => page.reload())
    await expect(pageRange(page)).toHaveText(/^26–50 of \d+$/)
    expect(await recordIds(page)).toEqual(beforeReload)
    await expect(page.locator('#f-status')).toHaveValue('approved')
    await expect(page.locator('#page-size')).toHaveValue('25')
    await expect(page.locator('th', { has: page.getByTestId('sort-auth_number') })).toHaveAttribute('aria-sort', 'ascending')

    await settled(page, () => page.getByTestId('search-reset').click())
    await expect(page).toHaveURL(/#\/authorizations\/search$/)
    await expect(page.getByTestId('table-idle')).toBeVisible()
    await expect(page.locator('#f-status')).toHaveValue('')
    await expect(pageRange(page)).toHaveText('0–0 of 0')
  })

  test('a query with no matches shows the empty message', async ({ page }) => {
    await open(page, '/authorizations/search')
    await page.locator('#f-member-last-name').fill('zz-no-such-member')
    await submit(page)
    await expect(page.getByTestId('table-empty')).toHaveText('No matching synthetic records.')
    await expect(resultRows(page)).toHaveCount(0)
    await expect(pageRange(page)).toHaveText('0–0 of 0')
    await expect(page.getByTestId('next-page')).toBeDisabled()
  })
})

// Claims columns: 1 Claim. No., 2 Member ID, 3 Member Name, 4 Provider, 5 Service Date, 6 Status.
test.describe('claims search', () => {
  test.use({ storageState: authFile('user') })

  test('empty criteria return all 300 synthetic claims', async ({ page }) => {
    await open(page, '/claims/search')
    await submit(page)
    await expect(pageRange(page)).toHaveText('1–10 of 300')
    await expect(page.getByTestId('page-count')).toHaveText('Page 1 of 30')
  })

  test('Status filter returns only claims with that status', async ({ page }) => {
    await open(page, '/claims/search?size=50')
    await page.locator('#f-status').selectOption({ label: 'Pending' })
    await submit(page)
    await expect(pageRange(page)).toHaveText('1–43 of 43')
    expect(new Set(await rowStatuses(page))).toEqual(new Set(['pending']))
  })

  test('Member Id filter returns only that member', async ({ page }) => {
    await open(page, '/claims/search')
    await page.locator('#f-member-number').fill('DEMO-MEM-000011')
    await submit(page)
    const members = await columnValues(page, 2)
    expect(members.length).toBeGreaterThan(0)
    expect(new Set(members)).toEqual(new Set(['DEMO-MEM-000011']))
  })

  test('Health Plan advanced filter matches the plan of every claim', async ({ page }) => {
    const client = await apiAs('demo.user')
    const { count, error } = await client.from('mp_claims').select('id', { count: 'exact', head: true })
      .eq('org_id', ORG_MAIN).eq('health_plan', 'DEMO-HP-MA')
    expect(error).toBeNull()

    await open(page, '/claims/search?size=100')
    await page.getByTestId('more-options').click()
    await page.locator('#f-health-plan').selectOption({ label: 'Demo Medicare Advantage' })
    await submit(page)
    expect(hashParams(page).get('health_plan')).toBe('DEMO-HP-MA')
    await expect(pageRange(page)).toHaveText(`1–${Math.min(count, 100)} of ${count}`)
    expect(count).toBeLessThan(300)
    const numbers = await columnValues(page, 1)
    const plans = await must(client.from('mp_claims').select('health_plan').eq('org_id', ORG_MAIN).in('claim_number', numbers))
    expect(plans).toHaveLength(numbers.length)
    expect(new Set(plans.map((row) => row.health_plan))).toEqual(new Set(['DEMO-HP-MA']))
  })

  test('Service From/To dates bound the service dates', async ({ page }) => {
    const from = localDate(40)
    const to = localDate(20)
    const client = await apiAs('demo.user')
    const { count, error } = await client.from('mp_claims').select('id', { count: 'exact', head: true })
      .eq('org_id', ORG_MAIN).gte('service_from', from).lte('service_to', to)
    expect(error).toBeNull()

    await open(page, '/claims/search?size=100')
    await page.getByTestId('more-options').click()
    await page.locator('#f-service-from').fill(from)
    await page.locator('#f-service-to').fill(to)
    await submit(page)
    await expect(pageRange(page)).toHaveText(`1–${Math.min(count, 100)} of ${count}`)
    expectAllWithin((await columnValues(page, 5)).map(iso), from, to)
  })

  test('claim number links to the claim detail', async ({ page }) => {
    await open(page, '/claims/search')
    await page.locator('#f-claim-number').fill('DEMO-CLM-000123')
    await submit(page)
    await expect(resultRows(page)).toHaveCount(1)
    await resultRows(page).getByTestId('record-link').click()
    await expect(page).toHaveURL(/#\/claims\/DEMO-CLM-000123$/)
    await expect(page.getByTestId('claim-detail')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Claim DEMO-CLM-000123' })).toBeVisible()
    await expect(page.locator('[data-field="claim_number"] dd')).toHaveText('DEMO-CLM-000123')
  })
})

// Members columns: 1 Eligibility, 2 Name, 3 Member ID, 4 SSN, 5 Sex, 6 Birth Date, 7 Health Plan, 8 PCP, 9 Options.
test.describe('members search', () => {
  test.use({ storageState: authFile('user') })

  test('empty criteria return all 120 members', async ({ page }) => {
    await open(page, '/members/search')
    await submit(page)
    await expect(pageRange(page)).toHaveText('1–10 of 120')
  })

  test('Sex and Health Plan filters combine', async ({ page }) => {
    await open(page, '/members/search?size=25')
    await page.locator('#f-sex').selectOption('X')
    await submit(page)
    await expect(pageRange(page)).toHaveText('1–17 of 17')
    expect(new Set(await columnValues(page, 5))).toEqual(new Set(['X']))

    await page.locator('#f-health-plan').selectOption({ label: 'Demo Medicare Advantage' })
    await submit(page)
    await expect(pageRange(page)).toHaveText('1–4 of 4')
    expect(new Set(await columnValues(page, 5))).toEqual(new Set(['X']))
    expect(new Set(await columnValues(page, 7))).toEqual(new Set(['Demo Medicare Advantage']))
  })

  test('Health Plan filter alone', async ({ page }) => {
    await open(page, '/members/search?size=50')
    await page.locator('#f-health-plan').selectOption({ label: 'Demo Health Plan Silver' })
    await submit(page)
    await expect(pageRange(page)).toHaveText('1–30 of 30')
    expect(new Set(await columnValues(page, 7))).toEqual(new Set(['Demo Health Plan Silver']))
  })

  test('Birth Date matches exactly', async ({ page }) => {
    await open(page, '/members/search')
    await page.locator('#f-member-number').fill('DEMO-MEM-000030')
    await submit(page)
    const [shown] = await columnValues(page, 6)
    expect(shown).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)

    await settled(page, () => page.getByTestId('search-reset').click())
    await page.locator('#f-birth-date').fill(iso(shown))
    await submit(page)
    expect(hashParams(page).get('birth_date')).toBe(iso(shown))
    expect(new Set(await columnValues(page, 6))).toEqual(new Set([shown]))
    expect(await columnValues(page, 3)).toContain('DEMO-MEM-000030')
  })

  test('eligibility badges reflect each member status', async ({ page }) => {
    await open(page, '/members/search?sort=member_number.asc&size=25')
    await submit(page)
    const badge = (memberNumber) => resultRows(page).filter({ hasText: memberNumber }).getByTestId('status-badge')
    await expect(badge('DEMO-MEM-000001')).toBeVisible()
    await expect(badge('DEMO-MEM-000001')).toHaveAttribute('data-status', 'eligible')
    await expect(badge('DEMO-MEM-000001')).toHaveText('Eligible')
    await expect(badge('DEMO-MEM-000013')).toHaveAttribute('data-status', 'ineligible')
    await expect(badge('DEMO-MEM-000013')).toHaveText('Ineligible')
    await expect(badge('DEMO-MEM-000017')).toHaveAttribute('data-status', 'pending')
    await expect(badge('DEMO-MEM-000017')).toHaveText('Pending')
  })

  test('Options opens the member detail with related authorizations', async ({ page }) => {
    await open(page, '/members/search')
    await page.locator('#f-member-number').fill('DEMO-MEM-000100')
    await submit(page)
    await expect(resultRows(page)).toHaveCount(1)
    await resultRows(page).getByTestId('view-record').click()
    await expect(page).toHaveURL(/#\/members\/DEMO-MEM-000100$/)
    await expect(page.getByTestId('member-detail')).toBeVisible()
    await expect(page.locator('[data-field="member_number"] dd')).toHaveText('DEMO-MEM-000100')
    const related = page.getByTestId('member-authorizations')
    await expect(related.getByRole('link', { name: 'DEMO-AUTH-000117', exact: true })).toBeVisible()
    await expect(related.getByRole('link', { name: 'DEMO-AUTH-000237', exact: true })).toBeVisible()

    // "View all" runs the authorization search for this member only.
    await settled(page, () => page.getByRole('link', { name: 'View all' }).first().click())
    await expect(page).toHaveURL(/#\/authorizations\/search\?searched=1&member_number=DEMO-MEM-000100$/)
    expect(new Set(await columnValues(page, 3))).toEqual(new Set(['DEMO-MEM-000100']))
  })
})

// Providers columns: 1 Name, 2 Specialty, 3 Group, 4 Phone, 5 Email, 6 Address, 7 Hospitals.
test.describe('providers search', () => {
  test.use({ storageState: authFile('user') })

  test('empty criteria return all 24 providers', async ({ page }) => {
    await open(page, '/providers/search')
    await submit(page)
    await expect(pageRange(page)).toHaveText('1–10 of 24')
  })

  test('Specialty filter', async ({ page }) => {
    await open(page, '/providers/search')
    await page.locator('#f-specialty').selectOption('Cardiology')
    await submit(page)
    await expect(pageRange(page)).toHaveText('1–3 of 3')
    expect(new Set(await columnValues(page, 2))).toEqual(new Set(['Cardiology']))
  })

  test('Hospital filter matches any hospital in the provider list', async ({ page }) => {
    await open(page, '/providers/search')
    await page.locator('#f-hospital').selectOption('Mockingbird Regional (Demo)')
    await submit(page)
    await expect(pageRange(page)).toHaveText('1–8 of 8')
    const hospitals = await columnValues(page, 7)
    for (const list of hospitals) expect(list.split(', ')).toContain('Mockingbird Regional (Demo)')
    // Contains, not equals: some providers list it as their second hospital.
    expect(hospitals.some((list) => list.split(', ')[1] === 'Mockingbird Regional (Demo)')).toBe(true)
  })

  test('NPI is a case-insensitive partial match', async ({ page }) => {
    await open(page, '/providers/search')
    await page.locator('#f-npi').fill('npi-00002')
    await submit(page)
    await expect(pageRange(page)).toHaveText('1–5 of 5')
    const hrefs = await resultRows(page).getByTestId('record-link').evaluateAll((links) => links.map((a) => a.getAttribute('href')))
    expect(hrefs.sort()).toEqual(['20', '21', '22', '23', '24'].map((n) => `#/providers/DEMO-NPI-0000${n}`))
  })
})

test.describe('reference search', () => {
  test.use({ storageState: authFile('user') })

  test('is idle until searched', async ({ page }) => {
    await open(page, '/references')
    await expect(page.getByTestId('table-idle')).toHaveText('No references to display.')
    await expect(page.getByRole('radio', { name: 'Service', exact: true })).toBeChecked()
  })

  test('each reference type returns its global code set', async ({ page }) => {
    await open(page, '/references?size=25')
    await submit(page)
    await expect(pageRange(page)).toHaveText('1–20 of 20')
    const services = await columnValues(page, 1)
    expect(services[0]).toBe('DEMO-S1001')
    for (const code of services) expect(code).toMatch(/^DEMO-S10\d\d$/)

    await page.getByRole('radio', { name: 'Place of Service' }).check()
    await submit(page)
    expect(hashParams(page).get('type')).toBe('place_of_service')
    await expect(pageRange(page)).toHaveText('1–8 of 8')

    await page.getByRole('radio', { name: 'Modifier' }).check()
    await submit(page)
    await expect(pageRange(page)).toHaveText('1–6 of 6')
    for (const code of await columnValues(page, 1)) expect(code).toMatch(/^DEMO-M0\d$/)
  })

  test('Diagnosis search by description text', async ({ page }) => {
    await open(page, '/references')
    await page.getByRole('radio', { name: 'Diagnosis' }).check()
    await page.locator('#f-q').fill('PAIN')
    await submit(page)
    await expect(resultRows(page)).toHaveCount(1)
    expect(await columnValues(page, 1)).toEqual(['DEMO-D2001'])
    expect((await columnValues(page, 2))[0]).toContain('low back pain')
  })
})

// Document search columns: 1 Select, 2 Type, 3 Status, 4 Category, 5 Inbox, 6 Description, 7 Sent Date, 8 Download, 9 View.
test.describe('document search', () => {
  test.use({ storageState: authFile('user') })

  test('page size defaults to 25', async ({ page }) => {
    await open(page, '/documents/search')
    await expect(page.locator('#page-size')).toHaveValue('25')
    await submit(page)
    await expect(page.locator('#page-size')).toHaveValue('25')
    await expect(pageRange(page)).toHaveText(/^1–25 of \d+$/)
    await expect(resultRows(page)).toHaveCount(25)
  })

  test('Category filter', async ({ page }) => {
    await open(page, '/documents/search?size=100')
    await page.locator('#f-category').selectOption('Clinical')
    await submit(page)
    const categories = await columnValues(page, 4)
    expect(categories.length).toBeGreaterThanOrEqual(5) // seeded Clinical documents
    expect(new Set(categories)).toEqual(new Set(['Clinical']))
  })

  test("'Inbox Name or Tax ID' matches by tax id", async ({ page }) => {
    await open(page, '/documents/search?size=100')
    await page.locator('#f-inbox').fill('DEMO-TIN-000001')
    await submit(page)
    const inboxes = await columnValues(page, 5)
    expect(inboxes.length).toBeGreaterThanOrEqual(30)
    expect(new Set(inboxes)).toEqual(new Set(['Demo IPA Inbox']))

    // Another IPA's tax id matches nothing here.
    await page.locator('#f-inbox').fill('demo-tin-000002')
    await submit(page)
    await expect(page.getByTestId('table-empty')).toBeVisible()
  })

  test("Sent Date 'Last 7 Days'", async ({ page }) => {
    await open(page, '/documents/search?size=100')
    await page.locator('#f-sent-date').selectOption({ label: 'Last 7 Days' })
    await submit(page)
    expect(hashParams(page).get('sent_date')).toBe('7')
    expectAllWithin((await columnValues(page, 7)).map(iso), localDate(7), localDate(0))
  })
})

test.describe('large dataset IPA', () => {
  test.use({ storageState: authFile('admin') })

  test('6000 authorizations and claims paginate and sort quickly', async ({ page }) => {
    await open(page, '/authorizations/search')
    await switchIpa(page, 'Demo Large Volume IPA (load test)')
    await expect(page.getByTestId('ipa-select')).toHaveValue(ORG_LARGE)
    await submit(page)
    await expect(pageRange(page)).toHaveText('1–10 of 6000')

    await settled(page, () => page.locator('#page-size').selectOption('100'))
    await expect(pageRange(page)).toHaveText('1–100 of 6000', { timeout: 5_000 })
    await expect(resultRows(page)).toHaveCount(100)
    const seen = new Set(await recordIds(page))
    for (const start of [101, 201, 301]) {
      const startedAt = Date.now()
      await settled(page, () => page.getByTestId('next-page').click())
      await expect(pageRange(page)).toHaveText(`${start}–${start + 99} of 6000`)
      expect(Date.now() - startedAt, `page starting at ${start} rendered quickly`).toBeLessThan(5_000)
      const ids = await recordIds(page)
      expect(ids).toHaveLength(100)
      for (const id of ids) expect(seen.has(id), 'pages do not overlap').toBe(false)
      ids.forEach((id) => seen.add(id))
    }

    await settled(page, () => page.getByTestId('sort-member_last_name').click())
    const nameHeader = page.locator('th', { has: page.getByTestId('sort-member_last_name') })
    await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    await expect(pageRange(page)).toHaveText('1–100 of 6000')
    expectMonotonic((await columnValues(page, 4)).map((name) => name.split(',')[0]), 'asc')
    await settled(page, () => page.getByTestId('sort-member_last_name').click())
    await expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
    expectMonotonic((await columnValues(page, 4)).map((name) => name.split(',')[0]), 'desc')

    // The IPA choice persists for this browser context across pages.
    await open(page, '/claims/search')
    await expect(page.getByTestId('ipa-select')).toHaveValue(ORG_LARGE)
    await submit(page)
    await expect(pageRange(page)).toHaveText('1–10 of 6000')
  })
})

test.describe('empty IPA', () => {
  test.use({ storageState: authFile('user') })

  test('searches return no records in the empty IPA', async ({ page }) => {
    await open(page, '/authorizations/search')
    await switchIpa(page, 'Demo Empty IPA (no records)')
    await expect(page.getByTestId('ipa-select')).toHaveValue(ORG_EMPTY)
    await submit(page)
    await expect(page.getByTestId('table-empty')).toHaveText('No matching synthetic records.')
    await expect(pageRange(page)).toHaveText('0–0 of 0')

    await open(page, '/members/search')
    await submit(page)
    await expect(page.getByTestId('table-empty')).toHaveText('No matching synthetic records.')
    await expect(pageRange(page)).toHaveText('0–0 of 0')

    // Stored per browser context: survives a reload.
    await settled(page, () => page.reload())
    await expect(page.getByTestId('ipa-select')).toHaveValue(ORG_EMPTY)
    await expect(page.getByTestId('table-empty')).toBeVisible()
  })
})
