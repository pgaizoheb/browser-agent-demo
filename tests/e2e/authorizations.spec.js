import { expect, test } from '@playwright/test'
import { apiAs, createAuthorization, must, ORG_MAIN, ORG_OTHER, transition } from './support/api.js'
import { app, authFile, settled } from './support/ui.js'

// Every mutable record here is created by the test itself (DEMO-AUTH-9xxxxx) and tagged with a
// unique synthetic summary, so the suite is order-independent and repeatable without a reset.

const ELIGIBLE_MEMBER = 'DEMO-MEM-000002'
const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const summaryText = (label) => `Synthetic E2E ${label} clinical summary ${unique()}`
// The database stamps decisions with its current_date (UTC on the local stack).
const todayUtc = () => {
  const [year, month, day] = new Date().toISOString().slice(0, 10).split('-')
  return `${month}/${day}/${year}`
}

const clients = new Map()
const api = (username) => {
  if (!clients.has(username)) clients.set(username, apiAs(username))
  return clients.get(username)
}

const detail = (page) => page.getByTestId('authorization-detail')
const detailValue = (page, key) => detail(page).locator(`[data-field="${key}"] dd`)
const timelineEvent = (page, action) => page.locator(`[data-testid="timeline-event"][data-action="${action}"]`)
const transitionDialog = (page) => page.getByTestId('transition-dialog')

async function openAuthorization(page, number) {
  await app(page, `/authorizations/${number}`)
  await expect(page.getByRole('heading', { name: `Authorization ${number}`, exact: true })).toBeVisible()
}

async function authNumberFromUrl(page) {
  await expect(page).toHaveURL(/#\/authorizations\/DEMO-AUTH-9\d{5}$/)
  return page.url().split('/').pop()
}

async function openRequestForm(page) {
  await app(page, '/authorization-request')
  await expect(page.getByRole('heading', { name: 'Submit Request', exact: true })).toBeVisible()
}

/** Fills every request field with valid synthetic values (overridable) and waits for the member card. */
async function fillRequest(page, { member = ELIGIBLE_MEMBER, units = 4, summary = summaryText('request') } = {}) {
  await page.locator('#req-member-number').fill(member)
  await page.getByTestId('find-member').click()
  await expect(page.getByTestId('member-card')).toContainText(member)
  await page.locator('#req-requested-provider-id').selectOption({ index: 1 })
  await page.locator('#req-service-code').selectOption('DEMO-S1003')
  await page.locator('#req-diagnosis-code').selectOption('DEMO-D2001')
  await page.locator('#req-place-of-service').selectOption('DEMO-P11')
  await page.locator('#req-units').fill(String(units))
  await page.locator('#req-clinical-summary').fill(summary)
}

/** Opens a transition dialog, fills it, and confirms. */
async function runTransition(page, status, { reason, units } = {}) {
  await page.getByTestId(`action-${status}`).click()
  const dialog = transitionDialog(page)
  await expect(dialog).toBeVisible()
  if (units !== undefined) await dialog.locator('#tr-approved-units').fill(String(units))
  if (reason !== undefined) await dialog.locator('#tr-reason').fill(reason)
  await dialog.getByTestId('confirm-transition').click()
  return dialog
}

/** Resubmits a deferred authorization through the save RPC, as the edit form does. */
function resubmit(client, auth, summary) {
  return must(client.rpc('mp_save_authorization', {
    p_org_id: ORG_MAIN,
    p_id: auth.id,
    p_submit: true,
    p_data: {
      member_id: auth.member_id,
      requested_provider_id: auth.requested_provider_id,
      referring_provider_id: auth.referring_provider_id,
      service_code: auth.service_code,
      diagnosis_code: auth.diagnosis_code,
      place_of_service: auth.place_of_service,
      units: auth.units,
      priority: auth.priority,
      clinical_summary: summary,
    },
  }))
}

async function summaryIsUnsaved(summary) {
  const user = await api('demo.user')
  expect(await must(user.from('mp_authorizations').select('id').eq('clinical_summary', summary))).toEqual([])
}

test.describe('request form validation', () => {
  test.use({ storageState: authFile('user') })

  test.beforeEach(async ({ page }) => {
    await openRequestForm(page)
  })

  test('an empty request flags every required field; drafts do not require a summary', async ({ page }) => {
    await page.getByTestId('submit-request').click()
    await expect(page.getByTestId('error-member-number')).toHaveText('Member ID is required.')
    await expect(page.getByTestId('error-requested-provider-id')).toHaveText('Requested provider is required.')
    await expect(page.getByTestId('error-service-code')).toHaveText('Service code is required.')
    await expect(page.getByTestId('error-diagnosis-code')).toHaveText('Diagnosis code is required.')
    await expect(page.getByTestId('error-place-of-service')).toHaveText('Place of service is required.')
    await expect(page.getByTestId('error-clinical-summary')).toHaveText('Clinical summary must be at least 20 characters to submit.')
    await expect(page.getByTestId('error-units')).toBeEmpty()
    await expect(page.locator('#req-member-number')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#req-member-number')).toBeFocused()

    await page.getByTestId('save-draft').click()
    await expect(page.getByTestId('error-clinical-summary')).toBeEmpty()
    await expect(page.getByTestId('error-member-number')).toHaveText('Member ID is required.')
    await expect(page).toHaveURL(/#\/authorization-request$/)
  })

  test('member IDs that are not in the current IPA are not found', async ({ page }) => {
    await page.locator('#req-member-number').fill(ELIGIBLE_MEMBER)
    await page.getByTestId('find-member').click()
    await expect(page.getByTestId('member-card')).toContainText(ELIGIBLE_MEMBER)
    // DEMO-MEM-001001 exists, but only in Demo Community Network.
    for (const number of ['DEMO-MEM-001001', 'DEMO-MEM-999999']) {
      await page.locator('#req-member-number').fill(number)
      await page.getByTestId('find-member').click()
      await expect(page.getByTestId('member-not-found')).toHaveText('No member with this ID exists in the current IPA.')
      await expect(page.getByTestId('member-card')).toHaveCount(0)
    }
    await page.getByTestId('save-draft').click()
    await expect(page.getByTestId('error-member-number')).toHaveText('No member with this ID exists in the current IPA.')
    await expect(page).toHaveURL(/#\/authorization-request$/)
  })

  test('an ineligible member blocks submission but can be saved as a draft', async ({ page }) => {
    const user = await api('demo.user')
    const [ineligible] = await must(user.from('mp_members').select('member_number')
      .eq('org_id', ORG_MAIN).eq('eligibility_status', 'ineligible').order('member_number').limit(1))
    const summary = summaryText('ineligible draft')
    await fillRequest(page, { member: ineligible.member_number, summary })
    await expect(page.getByTestId('member-card')).toHaveAttribute('data-eligibility', 'ineligible')

    await page.getByTestId('submit-request').click()
    await expect(page.getByTestId('error-member-number')).toHaveText('Member is not eligible on the request date.')
    await expect(page).toHaveURL(/#\/authorization-request$/)

    await page.getByTestId('save-draft').click()
    await expect(detail(page)).toHaveAttribute('data-status', 'draft')
    const number = await authNumberFromUrl(page)
    const id = await detail(page).getAttribute('data-record-id')
    try {
      await expect(detailValue(page, 'member')).toContainText(ineligible.member_number)
      await expect(page.getByTestId('clinical-summary')).toHaveText(summary)

      // Submitting the saved draft from its detail page must enforce eligibility too.
      const dialog = await runTransition(page, 'requested')
      await expect(dialog.getByTestId('transition-error')).toHaveText('Member is not eligible on the request date.')
      await openAuthorization(page, number)
      await expect(detail(page)).toHaveAttribute('data-status', 'draft')
    } finally {
      await user.rpc('mp_delete_authorization', { p_id: id })
    }
  })

  test('a clinical summary shorter than 20 characters (after trimming) blocks submission', async ({ page }) => {
    // 26 characters as typed, 14 once trimmed.
    const summary = `      Short note ${String(Date.now() % 1000).padStart(3, '0')}      `
    await fillRequest(page, { summary })
    await page.getByTestId('submit-request').click()
    await expect(page.getByTestId('error-clinical-summary')).toHaveText('Clinical summary must be at least 20 characters to submit.')
    await expect(page.locator('#req-clinical-summary')).toBeFocused()
    await expect(page).toHaveURL(/#\/authorization-request$/)
    await summaryIsUnsaved(summary.trim())
  })

  test('units outside 1–999 are rejected for drafts and submissions', async ({ page }) => {
    const summary = summaryText('units')
    await fillRequest(page, { summary })
    for (const units of ['0', '1000']) {
      for (const button of ['submit-request', 'save-draft']) {
        await page.locator('#req-units').fill(units)
        await page.getByTestId(button).click()
        await expect(page.getByTestId('error-units')).toHaveText('Units must be a whole number between 1 and 999.')
        await expect(page.locator('#req-units')).toHaveAttribute('aria-invalid', 'true')
      }
    }
    await expect(page.getByTestId('request-form')).toBeVisible()
    await summaryIsUnsaved(summary)
  })
})

test('the save RPC enforces validation server-side', async () => {
  const user = await api('demo.user')
  const other = await api('demo.other')
  const [ineligible] = await must(user.from('mp_members').select('id').eq('org_id', ORG_MAIN).eq('eligibility_status', 'ineligible').limit(1))
  const [foreignProvider] = await must(other.from('mp_providers').select('id').eq('org_id', ORG_OTHER).limit(1))
  const summary = `Short ${unique()}`.slice(0, 15)

  const bad = await user.rpc('mp_save_authorization', {
    p_org_id: ORG_MAIN,
    p_submit: true,
    p_data: {
      member_id: ineligible.id,
      requested_provider_id: foreignProvider.id,
      service_code: 'DEMO-D2001', // a diagnosis code is not a service code
      diagnosis_code: '',
      place_of_service: 'DEMO-P99',
      units: 1000,
      priority: 'stat',
      clinical_summary: summary,
    },
  })
  expect(bad.data).toBeNull()
  expect(bad.error.code).toBe('22023')
  const expected = [
    'Requested provider is required.',
    'Service code is required.',
    'Diagnosis code is required.',
    'Place of service is required.',
    'Units must be between 1 and 999.',
    'Priority must be routine or urgent.',
    'Clinical summary must be at least 20 characters to submit.',
    'Member is not eligible on the request date.',
  ]
  const fields = JSON.parse(bad.error.details)
  expect(fields).toHaveLength(expected.length)
  expect(fields).toEqual(expect.arrayContaining(expected))
  for (const sentence of expected) expect(bad.error.message).toContain(sentence)

  // Drafts skip the submit-only checks but still validate units.
  const [member] = await must(user.from('mp_members').select('id').eq('org_id', ORG_MAIN).eq('member_number', ELIGIBLE_MEMBER))
  const [provider] = await must(user.from('mp_providers').select('id').eq('org_id', ORG_MAIN).limit(1))
  const draft = await user.rpc('mp_save_authorization', {
    p_org_id: ORG_MAIN,
    p_submit: false,
    p_data: { member_id: member.id, requested_provider_id: provider.id, service_code: 'DEMO-S1003', diagnosis_code: 'DEMO-D2001',
      place_of_service: 'DEMO-P11', units: 0, clinical_summary: summary },
  })
  expect(draft.error.message).toBe('Validation failed: Units must be between 1 and 999.')
  await summaryIsUnsaved(summary)
})

test.describe('draft lifecycle', () => {
  test.use({ storageState: authFile('user') })

  test('save a draft, find it in My Requests, edit it, and submit it', async ({ page }) => {
    const summary = summaryText('draft lifecycle')
    await openRequestForm(page)
    await fillRequest(page, { units: 3, summary })
    await page.getByTestId('save-draft').click()
    await expect(detail(page)).toHaveAttribute('data-status', 'draft')
    const number = await authNumberFromUrl(page)
    await expect(page.getByTestId('toast')).toHaveText(`Request ${number} saved as draft.`)

    await page.reload()
    await expect(detail(page)).toHaveAttribute('data-status', 'draft')
    await expect(detailValue(page, 'units')).toHaveText('3')
    await expect(page.getByTestId('clinical-summary')).toHaveText(summary)
    await expect(detailValue(page, 'created_by')).toHaveText('Demo User')

    await settled(page, () => app(page, '/authorization-request/my?size=100'))
    const row = page.locator('[data-testid="results-table"] tbody tr', { has: page.getByRole('link', { name: number, exact: true }) })
    await expect(row).toHaveAttribute('data-status', 'draft')
    await row.getByRole('link', { name: number, exact: true }).click()

    await page.getByTestId('edit-draft').click()
    await expect(page.getByRole('heading', { name: `Edit Draft ${number}`, exact: true })).toBeVisible()
    await expect(page.locator('#req-units')).toHaveValue('3')
    await expect(page.getByTestId('member-card')).toContainText(ELIGIBLE_MEMBER)
    await page.locator('#req-units').fill('7')
    await page.getByTestId('save-draft').click()
    await expect(page).toHaveURL(new RegExp(`#/authorizations/${number}$`))
    await expect(detailValue(page, 'units')).toHaveText('7')
    await page.reload()
    await expect(detailValue(page, 'units')).toHaveText('7')
    await expect(detail(page)).toHaveAttribute('data-status', 'draft')

    const dialog = await runTransition(page, 'requested')
    await expect(dialog).toBeHidden()
    await expect(detail(page)).toHaveAttribute('data-status', 'requested')
    await expect(page.getByTestId('toast')).toHaveText(`${number} is now Requested.`)
    await page.reload()
    await expect(detailValue(page, 'status')).toHaveText('7 - Requested')
    await expect(page.getByTestId('edit-draft')).toHaveCount(0)
    await expect(page.getByTestId('delete-authorization')).toHaveCount(0)
    expect(await page.getByTestId('timeline-event').evaluateAll((items) => items.map((item) => item.dataset.action)))
      .toEqual(['submitted', 'draft_updated', 'draft_created'])
    await expect(timelineEvent(page, 'submitted')).toContainText('draft → requested')
  })

  test('Delete Draft asks for in-page confirmation, then removes the draft', async ({ page }) => {
    const draft = await createAuthorization(await api('demo.user'), { submit: false, summary: summaryText('delete draft') })
    await openAuthorization(page, draft.auth_number)
    const remove = page.getByTestId('delete-authorization')
    await expect(remove).toHaveText(/Delete Draft/)

    await remove.click()
    await expect(page.getByTestId('confirm-message')).toContainText(`Delete authorization ${draft.auth_number}`)
    await page.locator('[data-confirm="no"]').click()
    await expect(page.getByTestId('confirm-dialog')).toBeHidden()
    await page.reload()
    await expect(detail(page)).toHaveAttribute('data-status', 'draft')

    await settled(page, async () => {
      await page.getByTestId('delete-authorization').click()
      await page.getByTestId('confirm-yes').click()
    })
    await expect(page).toHaveURL(/#\/authorization-request\/my$/)
    await expect(page.getByTestId('toast')).toHaveText(`Deleted ${draft.auth_number}.`)
    await expect(page.locator('[data-testid="results-table"] tbody tr[data-record-id]').first()).toBeVisible()
    await expect(page.locator(`[data-testid="results-table"] tr[data-record-id="${draft.id}"]`)).toHaveCount(0)

    await app(page, `/authorizations/${draft.auth_number}`)
    await expect(page.getByTestId('page-error')).toContainText(`Authorization ${draft.auth_number} was not found in the current IPA.`)
  })
})

test.describe('decision workflow', () => {
  test.use({ storageState: authFile('user') })

  test('reviewer defers, provider resubmits with information, reviewer approves', async ({ page, browser, baseURL }) => {
    test.slow()
    const reviewerContext = await browser.newContext({ baseURL, storageState: authFile('reviewer') })
    try {
      const reviewer = await reviewerContext.newPage()
      const summary = summaryText('workflow')
      await openRequestForm(page)
      await fillRequest(page, { units: 5, summary })
      await page.getByTestId('submit-request').click()
      await expect(detail(page)).toHaveAttribute('data-status', 'requested')
      const number = await authNumberFromUrl(page)
      await expect(page.getByTestId('toast')).toHaveText(`Request ${number} submitted.`)

      // Reviewer defers; a reason is required first.
      await openAuthorization(reviewer, number)
      const dialog = await runTransition(reviewer, 'deferred')
      await expect(dialog.getByTestId('error-reason')).toHaveText('A reason is required.')
      await expect(detail(reviewer)).toHaveAttribute('data-status', 'requested')
      const deferReason = `Need synthetic lab results ${unique()}`
      await dialog.locator('#tr-reason').fill(deferReason)
      await dialog.getByTestId('confirm-transition').click()
      await expect(detail(reviewer)).toHaveAttribute('data-status', 'deferred')
      await expect(reviewer.getByTestId('decision-reason')).toHaveText(`Decision note: ${deferReason}`)

      // Provider resubmits with more information.
      await page.reload()
      await expect(detail(page)).toHaveAttribute('data-status', 'deferred')
      await expect(page.getByTestId('edit-draft')).toHaveCount(0)
      await page.getByTestId('resubmit').click()
      await expect(page.getByRole('heading', { name: `Resubmit ${number}`, exact: true })).toBeVisible()
      await expect(page.getByTestId('deferral-reason')).toHaveText(`Deferred: ${deferReason}`)
      await expect(page.getByTestId('save-draft')).toHaveCount(0)
      await expect(page.locator('#req-clinical-summary')).toHaveValue(summary)
      const amended = `${summary} Added synthetic lab results.`
      await page.locator('#req-clinical-summary').fill(amended)
      await page.getByTestId('submit-request').click()
      await expect(detail(page)).toHaveAttribute('data-status', 'requested')
      await expect(page.getByTestId('toast')).toHaveText(`Request ${number} resubmitted.`)
      await expect(page.getByTestId('clinical-summary')).toHaveText(amended)
      await expect(timelineEvent(page, 'resubmitted')).toContainText('Resubmitted')
      await expect(timelineEvent(page, 'resubmitted')).toContainText('deferred → requested')

      // Reviewer approves the resubmitted request.
      await reviewer.reload()
      await expect(detail(reviewer)).toHaveAttribute('data-status', 'requested')
      await reviewer.getByTestId('action-approved').click()
      await expect(dialog).toContainText('Approve all requested units?')
      await dialog.getByTestId('confirm-transition').click()
      await expect(detail(reviewer)).toHaveAttribute('data-status', 'approved')
      await expect(detailValue(reviewer, 'authorization_date')).toHaveText(todayUtc())
      await expect(detailValue(reviewer, 'approved_units')).toHaveText('5')
      await expect(detailValue(reviewer, 'units')).toHaveText('5')
      await expect(reviewer.getByTestId('decision-reason')).toHaveCount(0)
      await expect(reviewer.getByTestId('no-actions')).toBeVisible()

      await page.reload()
      await expect(detail(page)).toHaveAttribute('data-status', 'approved')
      await expect(page.getByTestId('resubmit')).toHaveCount(0)
      await expect(page.getByTestId('action-cancelled')).toHaveCount(0)
    } finally {
      await reviewerContext.close()
    }
  })
})

test.describe('reviewer decisions', () => {
  test.use({ storageState: authFile('reviewer') })

  test('approve with modification validates the unit range and persists approved units', async ({ page }) => {
    const user = await api('demo.user')
    const single = await createAuthorization(user, { units: 1, summary: summaryText('single unit') })
    await openAuthorization(page, single.auth_number)
    await expect(page.getByTestId('action-approved')).toBeVisible()
    await expect(page.getByTestId('action-modified')).toHaveCount(0) // nothing to reduce

    const auth = await createAuthorization(user, { units: 6, summary: summaryText('modify') })
    await openAuthorization(page, auth.auth_number)
    const reason = `Partial approval (synthetic) ${unique()}`

    let dialog = await runTransition(page, 'modified', { units: 4 })
    await expect(dialog.locator('label[for="tr-approved-units"]')).toHaveText('Approved units (requested 6)')
    await expect(dialog.getByTestId('error-reason')).toHaveText('A reason is required.')
    for (const units of ['', '0', '6', '2.5']) {
      await dialog.locator('[data-close]').click()
      await expect(dialog).toBeHidden()
      dialog = await runTransition(page, 'modified', { units, reason })
      await expect(dialog.getByTestId('error-approved-units')).toHaveText('Enter between 1 and 5 units.')
    }
    await expect(detail(page)).toHaveAttribute('data-status', 'requested')

    await dialog.locator('#tr-approved-units').fill('4')
    await dialog.getByTestId('confirm-transition').click()
    await expect(detail(page)).toHaveAttribute('data-status', 'modified')
    await page.reload()
    await expect(detailValue(page, 'status')).toHaveText('2 - Modified')
    await expect(detailValue(page, 'approved_units')).toHaveText('4')
    await expect(detailValue(page, 'units')).toHaveText('6')
    await expect(detailValue(page, 'authorization_date')).toHaveText(todayUtc())
    await expect(page.getByTestId('decision-reason')).toHaveText(`Decision note: ${reason}`)
  })

  test('deny requires a reason and shows it as the decision note', async ({ page }) => {
    const auth = await createAuthorization(await api('demo.user'), { units: 3, summary: summaryText('deny') })
    await openAuthorization(page, auth.auth_number)
    const dialog = await runTransition(page, 'denied')
    await expect(dialog.getByTestId('error-reason')).toHaveText('A reason is required.')
    await expect(detail(page)).toHaveAttribute('data-status', 'requested')

    const reason = `Not medically necessary (synthetic) ${unique()}`
    await dialog.locator('#tr-reason').fill(reason)
    await dialog.getByTestId('confirm-transition').click()
    await expect(detail(page)).toHaveAttribute('data-status', 'denied')
    await page.reload()
    await expect(page.getByTestId('decision-reason')).toHaveText(`Decision note: ${reason}`)
    await expect(detailValue(page, 'approved_units')).toHaveText('0')
    await expect(timelineEvent(page, 'denied')).toContainText(reason)
    await expect(page.getByTestId('no-actions')).toBeVisible()
  })

  test('a stale page gets a conflict on save and can reload the current status', async ({ page, context }) => {
    const auth = await createAuthorization(await api('demo.user'), { summary: summaryText('conflict') })
    const stale = await context.newPage()
    await openAuthorization(page, auth.auth_number)
    await openAuthorization(stale, auth.auth_number)

    await runTransition(page, 'approved')
    await expect(detail(page)).toHaveAttribute('data-status', 'approved')

    await expect(detail(stale)).toHaveAttribute('data-status', 'requested')
    const dialog = await runTransition(stale, 'denied', { reason: 'Stale denial attempt (synthetic)' })
    await expect(dialog.getByTestId('transition-error')).toContainText('This authorization changed since you opened it. Reload and try again.')
    await dialog.getByTestId('transition-error').getByRole('button', { name: 'Reload' }).click()
    await expect(dialog).toBeHidden()
    await expect(detail(stale)).toHaveAttribute('data-status', 'approved')
    await expect(stale.getByTestId('decision-reason')).toHaveCount(0)

    const [row] = await must((await api('demo.user')).from('mp_authorizations').select('status, decision_reason').eq('id', auth.id))
    expect(row).toEqual({ status: 'approved', decision_reason: '' })
  })

  test('terminal statuses offer no transitions and the RPC rejects illegal moves', async ({ page }) => {
    const user = await api('demo.user')
    const reviewer = await api('demo.reviewer')
    const requested = await createAuthorization(user, { summary: summaryText('illegal requested') })
    const denied = await createAuthorization(user, { summary: summaryText('illegal denied') })
    await transition(reviewer, denied.id, 'denied', 'Synthetic denial')
    const cancelled = await createAuthorization(user, { summary: summaryText('illegal cancelled') })
    await transition(user, cancelled.id, 'cancelled', 'Synthetic cancellation')

    const attempt = (client, id, toStatus) =>
      client.rpc('mp_transition_authorization', { p_id: id, p_to_status: toStatus, p_reason: 'E2E', p_approved_units: null })
    expect((await attempt(user, requested.id, 'draft')).error.message).toBe('Cannot change status from requested to draft.')
    expect((await attempt(reviewer, denied.id, 'approved')).error.message).toBe('Cannot change status from denied to approved.')
    expect((await attempt(user, cancelled.id, 'requested')).error.message).toBe('Cannot change status from cancelled to requested.')
    const rows = await must(user.from('mp_authorizations').select('id, status').in('id', [requested.id, denied.id, cancelled.id]))
    expect(Object.fromEntries(rows.map((row) => [row.id, row.status])))
      .toEqual({ [requested.id]: 'requested', [denied.id]: 'denied', [cancelled.id]: 'cancelled' })

    for (const [auth, status] of [[denied, 'denied'], [cancelled, 'cancelled']]) {
      await openAuthorization(page, auth.auth_number)
      await expect(detail(page)).toHaveAttribute('data-status', status)
      await expect(page.locator('[data-transition]')).toHaveCount(0)
      await expect(page.getByTestId('no-actions')).toBeVisible()
    }
  })
})

test.describe('cancellation', () => {
  test.use({ storageState: authFile('user') })

  test('a provider cancels a requested authorization with a reason', async ({ page }) => {
    const auth = await createAuthorization(await api('demo.user'), { summary: summaryText('provider cancel') })
    await openAuthorization(page, auth.auth_number)
    await expect(page.getByTestId('action-cancelled')).toHaveText(/Cancel Request/)
    const dialog = await runTransition(page, 'cancelled')
    await expect(dialog.getByTestId('error-reason')).toHaveText('A reason is required.')

    const reason = `Member chose another provider (synthetic) ${unique()}`
    await dialog.locator('#tr-reason').fill(reason)
    await dialog.getByTestId('confirm-transition').click()
    await expect(detail(page)).toHaveAttribute('data-status', 'cancelled')
    await page.reload()
    await expect(detailValue(page, 'status')).toHaveText('6 - Cancelled')
    await expect(page.getByTestId('decision-reason')).toHaveText(`Decision note: ${reason}`)
    await expect(page.getByTestId('no-actions')).toBeVisible()
  })

  test('only an administrator can cancel an approved authorization', async ({ page, browser, baseURL }) => {
    const auth = await createAuthorization(await api('demo.user'), { summary: summaryText('admin cancel') })
    await transition(await api('demo.reviewer'), auth.id, 'approved')

    await openAuthorization(page, auth.auth_number)
    await expect(detail(page)).toHaveAttribute('data-status', 'approved')
    await expect(page.getByTestId('action-cancelled')).toHaveCount(0)

    const reviewerContext = await browser.newContext({ baseURL, storageState: authFile('reviewer') })
    const adminContext = await browser.newContext({ baseURL, storageState: authFile('admin') })
    try {
      const reviewer = await reviewerContext.newPage()
      await openAuthorization(reviewer, auth.auth_number)
      await expect(detail(reviewer)).toHaveAttribute('data-status', 'approved')
      await expect(reviewer.getByTestId('action-cancelled')).toHaveCount(0)
      await expect(reviewer.getByTestId('no-actions')).toBeVisible()

      const admin = await adminContext.newPage()
      await openAuthorization(admin, auth.auth_number)
      await expect(admin.getByTestId('action-cancelled')).toHaveText(/Cancel Authorization/)
      const reason = `Retro-cancelled by administrator (synthetic) ${unique()}`
      const dialog = await runTransition(admin, 'cancelled', { reason })
      await expect(dialog).toBeHidden()
      await expect(detail(admin)).toHaveAttribute('data-status', 'cancelled')
      await expect(admin.getByTestId('decision-reason')).toHaveText(`Decision note: ${reason}`)
      await expect(timelineEvent(admin, 'cancelled')).toContainText('approved → cancelled')
      await expect(timelineEvent(admin, 'cancelled')).toContainText('Demo Admin')
    } finally {
      await reviewerContext.close()
      await adminContext.close()
    }
  })
})

test.describe('audit trail', () => {
  test.use({ storageState: authFile('viewer') })

  test('the activity timeline lists each workflow step with its actor', async ({ page }) => {
    const user = await api('demo.user')
    const reviewer = await api('demo.reviewer')
    const summary = summaryText('audit')
    const auth = await createAuthorization(user, { units: 2, summary })
    const deferReason = `Synthetic information request ${unique()}`
    await transition(reviewer, auth.id, 'deferred', deferReason)
    await resubmit(user, auth, `${summary} with the requested synthetic details.`)
    await transition(reviewer, auth.id, 'approved')

    await openAuthorization(page, auth.auth_number)
    const events = page.getByTestId('timeline-event')
    await expect(events).toHaveCount(4)
    expect(await events.evaluateAll((items) => items.map((item) => item.dataset.action)))
      .toEqual(['approved', 'resubmitted', 'deferred', 'submitted'])
    const expectations = {
      approved: ['Approved', 'requested → approved', 'Demo Reviewer'],
      resubmitted: ['Resubmitted', 'deferred → requested', 'Demo User'],
      deferred: ['Deferred', 'requested → deferred', 'Demo Reviewer', deferReason],
      submitted: ['Submitted', '— → requested', 'Demo User'],
    }
    for (const [action, fragments] of Object.entries(expectations)) {
      for (const fragment of fragments) await expect(timelineEvent(page, action)).toContainText(fragment)
    }
  })
})
