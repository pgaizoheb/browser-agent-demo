import { expect, test } from '@playwright/test'
import { apiAs, createAuthorization, must, ORG_MAIN } from './support/api.js'
import { app, authFile } from './support/ui.js'

// One verified API session per demo account per worker keeps sign-ins (and mailbox codes) to a minimum.
const clients = new Map()
function as(username) {
  if (!clients.has(username)) {
    clients.set(username, apiAs(username).catch((error) => { clients.delete(username); throw error }))
  }
  return clients.get(username)
}

const marker = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const newAuthorization = async () =>
  createAuthorization(await as('demo.user'), { summary: `E2E notes ${marker()} synthetic clinical summary.` })

/** Inserts a consult note on `auth` as `client` (setup only; the UI paths are exercised separately). */
async function apiNote(client, auth, { subject = `E2E note ${marker()}`, body = 'Synthetic e2e note body.', noteType = 'consult' } = {}) {
  return must(client.from('mp_consult_notes').insert({
    org_id: ORG_MAIN, authorization_id: auth.id, member_id: auth.member_id, note_type: noteType, subject, body,
  }).select().single())
}

async function openAuthorization(page, auth) {
  await app(page, `/authorizations/${auth.auth_number}`)
  await expect(page.getByTestId('authorization-detail')).toHaveAttribute('data-record-id', auth.id)
}

const noteItem = (page, note) => page.locator(`[data-testid="note-item"][data-record-id="${note.id}"]`)
const noteItemBySubject = (page, subject) => page.getByTestId('note-item').filter({ hasText: subject })

test.describe('consult notes on an authorization (provider staff)', () => {
  test.use({ storageState: authFile('user') })

  test('validates required fields, then saves a note that persists and is audited', async ({ page }) => {
    const auth = await newAuthorization()
    await openAuthorization(page, auth)
    const form = page.getByTestId('note-form')
    await expect(page.getByTestId('notes-empty')).toBeVisible()

    await form.getByTestId('add-note').click()
    await expect(form.getByTestId('error-subject')).toHaveText('Subject is required.')
    await expect(form.getByTestId('error-body')).toHaveText('Note text is required.')
    await expect(page.getByTestId('notes-empty')).toBeVisible()

    const subject = `E2E note ${marker()}`
    await form.locator('#note-note-type').selectOption('clinical')
    await form.locator('#note-subject').fill(subject)
    await form.locator('#note-body').fill('Synthetic clinical follow-up for e2e coverage.')
    await form.getByTestId('add-note').click()

    const item = noteItemBySubject(page, subject)
    await expect(item).toBeVisible()
    await expect(item.getByTestId('note-body')).toHaveText('Synthetic clinical follow-up for e2e coverage.')
    await expect(item).toContainText('Clinical')
    await expect(item).toContainText('Demo User')

    await page.reload()
    await expect(noteItemBySubject(page, subject)).toBeVisible()
    const event = page.locator('[data-testid="timeline-event"][data-action="note_created"]')
    await expect(event).toHaveCount(1)
    await expect(event).toContainText('Note Created')
    await expect(event).toContainText(subject)
  })

  test('the author can edit and then delete their own note', async ({ page }) => {
    const auth = await newAuthorization()
    const note = await apiNote(await as('demo.user'), auth)
    await openAuthorization(page, auth)
    const item = noteItem(page, note)
    await expect(item.getByTestId('note-body')).toHaveText(note.body)

    await item.locator('[data-edit-note]').click()
    const dialog = page.getByTestId('modal')
    await expect(dialog.locator('#note-subject')).toHaveValue(note.subject)
    const updated = `Edited synthetic body ${marker()}`
    await dialog.locator('#note-body').fill(updated)
    await dialog.getByTestId('save-note').click()
    await expect(dialog).toBeHidden()
    await expect(item.getByTestId('note-body')).toHaveText(updated)
    await expect(item).toContainText('edited')

    await page.reload()
    await expect(item.getByTestId('note-body')).toHaveText(updated)

    await item.locator('[data-delete-note]').click()
    await expect(page.getByTestId('confirm-message')).toHaveText(`Delete consult note "${note.subject}"?`)
    await page.getByTestId('confirm-yes').click()
    await expect(page.getByTestId('toast')).toHaveText('Consult note deleted.')
    await expect(item).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('authorization-detail')).toBeVisible()
    await expect(item).toHaveCount(0)
  })
})

test.describe('note controls by role', () => {
  test.describe('reviewer', () => {
    test.use({ storageState: authFile('reviewer') })

    test('cannot edit or delete another user\'s note but can manage their own', async ({ page }) => {
      const auth = await newAuthorization()
      const userNote = await apiNote(await as('demo.user'), auth, { subject: `E2E user note ${marker()}` })
      const reviewerNote = await apiNote(await as('demo.reviewer'), auth, { subject: `E2E reviewer note ${marker()}` })
      await openAuthorization(page, auth)

      const own = noteItem(page, reviewerNote)
      await expect(own.locator('[data-edit-note]')).toBeVisible()
      await expect(own.locator('[data-delete-note]')).toBeVisible()
      const foreign = noteItem(page, userNote)
      await expect(foreign).toBeVisible()
      await expect(foreign.locator('[data-edit-note]')).toHaveCount(0)
      await expect(foreign.locator('[data-delete-note]')).toHaveCount(0)
    })
  })

  test.describe('admin', () => {
    test.use({ storageState: authFile('admin') })

    test('can edit and delete another user\'s note', async ({ page }) => {
      const auth = await newAuthorization()
      const userNote = await apiNote(await as('demo.user'), auth)
      await openAuthorization(page, auth)
      const item = noteItem(page, userNote)
      await expect(item).toContainText('Demo User')
      await expect(item.locator('[data-edit-note]')).toBeVisible()
      await expect(item.locator('[data-delete-note]')).toBeVisible()
    })
  })
})

test.describe('Consult Notes page', () => {
  test.describe('provider staff', () => {
    test.use({ storageState: authFile('user') })

    test('lists a note filtered by subject and shows its body in the View dialog', async ({ page }) => {
      const auth = await newAuthorization()
      const body = `Synthetic consult body ${marker()}`
      const note = await apiNote(await as('demo.user'), auth, { body })

      await app(page, '/my-data/consult-notes')
      await page.locator('#f-q').fill(note.subject)
      await page.getByTestId('filter-apply').click()
      await expect(page).toHaveURL(/[?&]q=/)
      const rows = page.getByTestId('results-table').locator('tr[data-record-id]')
      await expect(rows).toHaveCount(1)
      const row = rows.first()
      await expect(row).toHaveAttribute('data-record-id', note.id)
      await expect(row.getByTestId('note-subject')).toHaveText(note.subject)
      await expect(row.getByRole('link', { name: auth.auth_number })).toBeVisible()

      await row.getByTestId('view-note').click()
      const dialog = page.getByTestId('note-dialog')
      await expect(dialog.getByRole('heading', { name: note.subject })).toBeVisible()
      await expect(dialog.getByTestId('note-body')).toHaveText(body)
    })

    test('New Consult Note rejects an authorization outside the IPA and attaches to one inside it', async ({ page }) => {
      const auth = await newAuthorization()
      const subject = `E2E consult page note ${marker()}`

      await app(page, '/my-data/consult-notes')
      await page.getByTestId('new-note').click()
      const dialog = page.getByTestId('modal')
      // DEMO-AUTH-001001 exists, but only in Demo Community Network.
      await dialog.locator('#note-auth-number').fill('demo-auth-001001')
      await dialog.locator('#note-subject').fill(subject)
      await dialog.locator('#note-body').fill('Synthetic note created from the Consult Notes page.')
      await dialog.getByTestId('save-note').click()
      await expect(dialog.getByTestId('error-auth-number')).toHaveText('Authorization DEMO-AUTH-001001 was not found in the current IPA.')
      await expect(dialog).toBeVisible()

      await dialog.locator('#note-auth-number').fill(auth.auth_number)
      await dialog.getByTestId('save-note').click()
      await expect(dialog).toBeHidden()
      await expect(page.getByTestId('toast')).toHaveText('Consult note saved.')

      await page.locator('#f-q').fill(subject)
      await page.getByTestId('filter-apply').click()
      const row = page.getByTestId('results-table').locator('tr[data-record-id]', { hasText: subject })
      await expect(row).toHaveCount(1)
      await expect(row.getByRole('link', { name: auth.auth_number })).toBeVisible()

      await row.getByRole('link', { name: auth.auth_number }).click()
      await expect(page.getByTestId('authorization-detail')).toHaveAttribute('data-record-id', auth.id)
      await expect(noteItemBySubject(page, subject)).toBeVisible()
    })
  })

  test.describe('read-only viewer', () => {
    test.use({ storageState: authFile('viewer') })

    test('can browse notes but has no New Consult Note, Edit, or Delete controls', async ({ page }) => {
      const auth = await newAuthorization()
      const note = await apiNote(await as('demo.user'), auth)
      await app(page, `/my-data/consult-notes?q=${encodeURIComponent(note.subject)}`)
      const row = page.getByTestId('results-table').locator(`tr[data-record-id="${note.id}"]`)
      await expect(row.getByTestId('view-note')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Consult Notes' })).toBeVisible()
      await expect(page.getByTestId('new-note')).toHaveCount(0)
      await expect(row.getByTestId('edit-note')).toHaveCount(0)
      await expect(row.getByTestId('delete-note')).toHaveCount(0)
    })
  })
})

test.describe('note row-level security (API)', () => {
  test('a reviewer cannot update or delete a provider\'s note', async () => {
    const auth = await newAuthorization()
    const user = await as('demo.user')
    const note = await apiNote(user, auth)
    const reviewer = await as('demo.reviewer')

    // The reviewer can read the note (same IPA)…
    const visible = await must(reviewer.from('mp_consult_notes').select('id').eq('id', note.id))
    expect(visible).toHaveLength(1)
    // …but RLS filters it out of writes: zero rows change.
    const updated = await reviewer.from('mp_consult_notes').update({ body: 'Tampered by reviewer' }).eq('id', note.id).select()
    expect(updated.error === null ? updated.data : []).toEqual([])
    const deleted = await reviewer.from('mp_consult_notes').delete().eq('id', note.id).select()
    expect(deleted.error === null ? deleted.data : []).toEqual([])

    const after = await must(user.from('mp_consult_notes').select('subject, body, updated_at').eq('id', note.id).single())
    expect(after).toEqual({ subject: note.subject, body: note.body, updated_at: note.updated_at })
  })
})
