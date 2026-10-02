import { expect, test } from '@playwright/test'
import { apiAs, createAuthorization, must, ORG_MAIN, ORG_OTHER } from './support/api.js'
import { app, authFile, columnValues, settled } from './support/ui.js'

// UI hides controls by role; Supabase RLS and RPC checks are the enforcement boundary.
// Both sides are asserted. Mutations only touch records/members restored or created here.

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const todayUtc = () => {
  const [year, month, day] = new Date().toISOString().slice(0, 10).split('-')
  return `${month}/${day}/${year}`
}
const authNumbers = (from, count) => Array.from({ length: count }, (_, i) => `DEMO-AUTH-${String(from + i).padStart(6, '0')}`)

const clients = new Map()
const api = (username) => {
  if (!clients.has(username)) clients.set(username, apiAs(username))
  return clients.get(username)
}

// One synthetic requested authorization per worker; tests here only read it or attempt
// changes that must be refused.
let requestedAuth
const sharedRequested = () => (requestedAuth ??= api('demo.user').then((user) =>
  createAuthorization(user, { units: 4, summary: `Synthetic E2E role checks clinical summary ${unique()}` })))

const detail = (page) => page.getByTestId('authorization-detail')
const DECISIONS = ['approved', 'modified', 'denied', 'deferred']
const attemptTransition = (client, id, toStatus) =>
  client.rpc('mp_transition_authorization', { p_id: id, p_to_status: toStatus, p_reason: 'E2E role check', p_approved_units: null })

async function openAuthorization(page, number) {
  await app(page, `/authorizations/${number}`)
  await expect(page.getByRole('heading', { name: `Authorization ${number}`, exact: true })).toBeVisible()
}

async function expectRequestFormDenied(page) {
  await app(page, '/authorization-request')
  await expect(page.getByTestId('permission-denied')).toContainText('requires the Provider Office Staff or IPA Administrator role')
  await expect(page.getByTestId('request-form')).toHaveCount(0)
}

async function expectHospitalAdminDenied(page) {
  await app(page, '/hospital-admin')
  await expect(page.getByTestId('permission-denied')).toContainText('Hospital Admin is restricted to IPA administrators.')
  await expect(page.getByTestId('admit-form')).toHaveCount(0)
}

test.describe('read-only viewer', () => {
  test.use({ storageState: authFile('viewer') })

  test('cannot open the request form or Hospital Admin', async ({ page }) => {
    await expectRequestFormDenied(page)
    await expectHospitalAdminDenied(page)
  })

  test('sees authorization details without actions, upload form, or note form', async ({ page }) => {
    const auth = await sharedRequested()
    await openAuthorization(page, auth.auth_number)
    await expect(detail(page)).toHaveAttribute('data-status', 'requested')
    await expect(page.getByTestId('no-actions')).toHaveText('No actions available for your role (Read Only) at this status.')
    await expect(page.locator('[data-transition]')).toHaveCount(0)
    await expect(page.getByTestId('delete-authorization')).toHaveCount(0)
    await expect(page.getByTestId('attachments-section')).toBeVisible()
    await expect(page.getByTestId('upload-form')).toHaveCount(0)
    await expect(page.getByTestId('notes-section')).toBeVisible()
    await expect(page.getByTestId('note-form')).toHaveCount(0)
  })

  test('Documents page lists documents without upload or status controls', async ({ page }) => {
    await settled(page, () => app(page, '/documents'))
    await expect(page.getByRole('heading', { name: 'My Documents', exact: true })).toBeVisible()
    await expect(page.locator('[data-testid="results-table"] tbody tr[data-record-id]').first()).toBeVisible()
    await expect(page.getByTestId('upload-document')).toHaveCount(0)
    await expect(page.locator('[data-doc-status]')).toHaveCount(0)
    await expect(page.getByTestId('delete-file')).toHaveCount(0)
  })
})

test.describe('utilization reviewer', () => {
  test.use({ storageState: authFile('reviewer') })

  test('cannot open the request form', async ({ page }) => {
    await expectRequestFormDenied(page)
  })

  test('sees Approve/Deny/Defer but not Cancel Request; the database refuses a cancel', async ({ page }) => {
    const auth = await sharedRequested()
    await openAuthorization(page, auth.auth_number)
    await expect(detail(page)).toHaveAttribute('data-status', 'requested')
    for (const status of DECISIONS) await expect(page.getByTestId(`action-${status}`)).toBeVisible()
    await expect(page.getByTestId('action-cancelled')).toHaveCount(0)
    await expect(page.getByTestId('delete-authorization')).toHaveCount(0)

    const { error } = await attemptTransition(await api('demo.reviewer'), auth.id, 'cancelled')
    expect(error.message).toBe('You do not have permission to submit or cancel requests.')
  })
})

test.describe('provider office staff', () => {
  test.use({ storageState: authFile('user') })

  test('sees Cancel Request but no decisions; the database refuses an approval', async ({ page }) => {
    const auth = await sharedRequested()
    await openAuthorization(page, auth.auth_number)
    await expect(detail(page)).toHaveAttribute('data-status', 'requested')
    await expect(page.getByTestId('action-cancelled')).toHaveText(/Cancel Request/)
    for (const status of DECISIONS) await expect(page.getByTestId(`action-${status}`)).toHaveCount(0)

    const { error } = await attemptTransition(await api('demo.user'), auth.id, 'approved')
    expect(error.message).toBe('Only reviewers or administrators can record authorization decisions.')
  })

  test('cannot open Hospital Admin', async ({ page }) => {
    await expectHospitalAdminDenied(page)
  })
})

test.describe('IPA administrator', () => {
  test.use({ storageState: authFile('admin') })

  test('Hospital Admin lists exactly the hospitalized members of the current IPA', async ({ page }) => {
    const admin = await api('demo.admin')
    const hospitalized = await must(admin.from('mp_members').select('member_number')
      .eq('org_id', ORG_MAIN).not('hospitalized_since', 'is', null).order('member_number'))
    expect(hospitalized.length).toBeGreaterThan(0)

    await settled(page, () => app(page, '/hospital-admin?size=100'))
    await expect(page.getByRole('heading', { name: 'Hospital Admin — Inpatient Census', exact: true })).toBeVisible()
    expect((await columnValues(page, 2)).sort()).toEqual(hospitalized.map((m) => m.member_number))
    for (const hospital of await columnValues(page, 3)) expect(hospital).not.toBe('')
  })

  test('records an admission and then a discharge', async ({ page }) => {
    const admin = await api('demo.admin')
    const [member] = await must(admin.from('mp_members').select('id, member_number')
      .eq('org_id', ORG_MAIN).is('hospitalized_since', null).order('member_number', { ascending: false }).limit(1))
    const row = page.locator(`[data-testid="results-table"] tr[data-record-id="${member.id}"]`)
    try {
      await settled(page, () => app(page, '/hospital-admin'))
      await expect(row).toHaveCount(0)

      await page.locator('#admit-member-number').fill(member.member_number)
      await page.locator('#admit-hospital').selectOption('Example Community Hospital')
      await settled(page, () => page.getByTestId('record-admission').click())
      await expect(page.getByTestId('toast')).toHaveText(`Admission recorded for ${member.member_number}.`)
      await expect(row).toContainText('Example Community Hospital')
      await expect(row).toContainText(todayUtc())

      await settled(page, () => page.reload())
      await expect(row).toBeVisible()
      await settled(page, () => row.getByTestId('record-discharge').click())
      await expect(page.getByTestId('toast')).toHaveText('Discharge recorded.')
      await expect(row).toHaveCount(0)
      await settled(page, () => page.reload())
      await expect(row).toHaveCount(0)
    } finally {
      await must(admin.rpc('mp_set_member_admission', { p_member_id: member.id, p_hospital: null }))
    }
  })

  test('switching the IPA re-scopes search results and persists across reloads', async ({ page }) => {
    const ipa = page.getByTestId('ipa-select')
    const authNumbersShown = () => columnValues(page, 1)
    await settled(page, () => app(page, '/authorizations/search?searched=1&sort=auth_number.asc'))
    await expect(ipa.locator('option:checked')).toHaveText('DEMO IPA — SYNTHETIC ORGANIZATION')
    expect(await authNumbersShown()).toEqual(authNumbers(1, 10))

    await settled(page, () => ipa.selectOption({ label: 'Demo Community Network' }))
    expect(await authNumbersShown()).toEqual(authNumbers(1001, 10))
    await settled(page, () => page.reload())
    await expect(ipa.locator('option:checked')).toHaveText('Demo Community Network')
    expect(await authNumbersShown()).toEqual(authNumbers(1001, 10))

    await settled(page, () => ipa.selectOption({ label: 'DEMO IPA — SYNTHETIC ORGANIZATION' }))
    expect(await authNumbersShown()).toEqual(authNumbers(1, 10))
  })
})

test.describe('organization isolation', () => {
  test.use({ storageState: authFile('other') })

  test('a Demo Community Network user cannot see Demo IPA authorizations', async ({ page }) => {
    await app(page, '/authorizations/DEMO-AUTH-000001')
    await expect(page.getByTestId('page-error')).toContainText('Authorization DEMO-AUTH-000001 was not found in the current IPA.')
    await expect(page.getByTestId('ipa-select').locator('option')).toHaveText(['Demo Community Network'])

    await settled(page, () => app(page, '/authorizations/search?searched=1&sort=auth_number.asc&size=100'))
    const shown = await columnValues(page, 1)
    // Seeded rows are exactly this IPA's DEMO-AUTH-0010xx; anything else must be a new (9xxxxx) record of this IPA.
    expect(shown.filter((number) => !/^DEMO-AUTH-9\d{5}$/.test(number))).toEqual(authNumbers(1001, 40))
    const admin = await api('demo.admin')
    const otherIpa = await must(admin.from('mp_authorizations').select('auth_number').eq('org_id', ORG_OTHER).order('auth_number').limit(100))
    expect(shown).toEqual(otherIpa.map((row) => row.auth_number))

    await settled(page, () => app(page, '/authorizations/search?searched=1&auth_number=DEMO-AUTH-0000'))
    await expect(page.getByTestId('table-empty')).toBeVisible()
  })

  test('row-level security and RPC role checks block cross-IPA and read-only writes', async () => {
    const [other, viewer, reviewer] = await Promise.all([api('demo.other'), api('demo.viewer'), api('demo.reviewer')])
    const auth = await sharedRequested()

    expect(await must(other.from('mp_authorizations').select('id').eq('org_id', ORG_MAIN))).toEqual([])
    expect(await must(other.from('mp_authorization_list').select('id').eq('org_id', ORG_MAIN))).toEqual([])
    expect(await must(other.from('mp_members').select('id').eq('org_id', ORG_MAIN))).toEqual([])
    expect((await attemptTransition(other, auth.id, 'cancelled')).error.message).toBe('Authorization not found.')

    const payload = {
      member_id: auth.member_id, requested_provider_id: auth.requested_provider_id, service_code: auth.service_code,
      diagnosis_code: auth.diagnosis_code, place_of_service: auth.place_of_service, units: 2,
      clinical_summary: `Synthetic E2E read-only attempt ${unique()}`,
    }
    const viewerSave = await viewer.rpc('mp_save_authorization', { p_org_id: ORG_MAIN, p_submit: true, p_data: payload })
    expect(viewerSave.error.code).toBe('42501')
    expect(viewerSave.error.message).toBe('You do not have permission to create or edit authorization requests.')
    const otherSave = await other.rpc('mp_save_authorization', { p_org_id: ORG_MAIN, p_submit: true, p_data: payload })
    expect(otherSave.error.code).toBe('42501')
    expect(await must(reviewer.from('mp_authorizations').select('id').eq('clinical_summary', payload.clinical_summary))).toEqual([])

    const [otherMember] = await must(other.from('mp_members').select('id').eq('org_id', ORG_OTHER).limit(1))
    const subject = `E2E cross-IPA note ${unique()}`
    const note = await reviewer.from('mp_consult_notes')
      .insert({ org_id: ORG_OTHER, member_id: otherMember.id, subject, body: 'Synthetic cross-IPA write attempt.' })
    expect(note.error.code).toBe('42501')
    expect(await must(other.from('mp_consult_notes').select('id').eq('subject', subject))).toEqual([])
  })
})
