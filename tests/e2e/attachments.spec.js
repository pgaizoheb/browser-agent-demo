import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { apiAs, createAuthorization, must, ORG_MAIN } from './support/api.js'
import { app, authFile } from './support/ui.js'

const BUCKET = 'mp-demo-documents'
const PDF_NAME = 'synthetic-attachment.pdf'
const TXT_NAME = 'synthetic-attachment.txt'
const PDF_PATH = `tests/fixtures/${PDF_NAME}`
const TXT_PATH = `tests/fixtures/${TXT_NAME}`
const pdfBytes = readFileSync(PDF_PATH)
const txtBytes = readFileSync(TXT_PATH)
const BANNER = 'LOCAL MOCK / DEMO - NO REAL DATA'

// One verified API session per demo account per worker keeps sign-ins (and mailbox codes) to a minimum.
const clients = new Map()
function as(username) {
  if (!clients.has(username)) {
    clients.set(username, apiAs(username).catch((error) => { clients.delete(username); throw error }))
  }
  return clients.get(username)
}

const marker = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/** Uploads a synthetic object + document row exactly like the app does (used for setup only). */
async function apiUpload(client, { name, bytes = txtBytes, mime = 'text/plain', category = 'Correspondence', description = '' }) {
  const id = randomUUID()
  const path = `${ORG_MAIN}/${id}/${name}`
  await must(client.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false }))
  return must(client.from('mp_documents').insert({
    id, org_id: ORG_MAIN, doc_type: mime === 'application/pdf' ? 'PDF' : 'TXT', category, file_name: name, description,
    storage_path: path, mime_type: mime, size_bytes: bytes.length,
  }).select().single())
}

async function apiRemoveDocuments(client, docs) {
  if (!docs.length) return
  await must(client.from('mp_documents').delete().in('id', docs.map((doc) => doc.id)))
  await must(client.storage.from(BUCKET).remove(docs.map((doc) => doc.storage_path)))
}

/** Creates a fresh authorization as demo.user and opens its detail page. */
async function openOwnAuthorization(page) {
  const auth = await createAuthorization(await as('demo.user'), { summary: `E2E attachments ${marker()} synthetic clinical summary.` })
  await app(page, `/authorizations/${auth.auth_number}`)
  await expect(page.getByTestId('authorization-detail')).toHaveAttribute('data-record-id', auth.id)
  return auth
}

const attachmentRow = (page, fileName) =>
  page.getByTestId('attachments-table').locator(`tr[data-file-name="${fileName}"]`)

async function uploadOnDetail(page, file) {
  await page.locator('#auth-upload-file').setInputFiles(file)
  await page.getByTestId('upload-submit').click()
}

test.use({ storageState: authFile('user') })

test.describe('authorization attachments', () => {
  test('uploading a PDF lists it, persists after reload, and records a timeline event', async ({ page }) => {
    await openOwnAuthorization(page)
    await expect(page.getByTestId('attachments-empty')).toBeVisible()

    await uploadOnDetail(page, PDF_PATH)
    const row = attachmentRow(page, PDF_NAME)
    await expect(row).toBeVisible()
    await expect(row).toContainText('Authorization')
    await expect(row).toContainText('Demo User')
    await expect(row).toContainText(`${pdfBytes.length} B`)

    await page.reload()
    await expect(attachmentRow(page, PDF_NAME)).toBeVisible()
    const event = page.locator('[data-testid="timeline-event"][data-action="document_created"]')
    await expect(event).toHaveCount(1)
    await expect(event).toContainText('Document Created')
    await expect(event).toContainText(PDF_NAME)
  })

  test('downloading an attachment returns the exact uploaded bytes', async ({ page }) => {
    await openOwnAuthorization(page)
    await uploadOnDetail(page, PDF_PATH)
    const row = attachmentRow(page, PDF_NAME)
    await expect(row).toBeVisible()

    const downloadEvent = page.waitForEvent('download')
    await row.getByTestId('download-file').click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toBe(PDF_NAME)
    expect(readFileSync(await download.path())).toEqual(pdfBytes)
  })

  test('viewing a TXT attachment shows its synthetic contents', async ({ page }) => {
    await openOwnAuthorization(page)
    await uploadOnDetail(page, TXT_PATH)
    await attachmentRow(page, TXT_NAME).getByTestId('view-file').click()
    await expect(page.getByTestId('file-preview-dialog')).toBeVisible()
    await expect(page.getByTestId('file-text')).toContainText('Synthetic e2e attachment')
    await expect(page.getByTestId('file-text')).toContainText(BANNER)
  })

  test('deleting an attachment after confirmation removes the row and the stored object', async ({ page }) => {
    await openOwnAuthorization(page)
    await uploadOnDetail(page, TXT_PATH)
    const row = attachmentRow(page, TXT_NAME)
    const storagePath = await row.getByTestId('download-file').getAttribute('data-download-path')
    expect(storagePath).toMatch(new RegExp(`^${ORG_MAIN}/[0-9a-f-]{36}/${TXT_NAME.replace('.', '\\.')}$`))
    const user = await as('demo.user')
    const before = await user.storage.from(BUCKET).download(storagePath)
    expect(before.error).toBeNull()

    await row.getByTestId('delete-file').click()
    await expect(page.getByTestId('confirm-message')).toHaveText(`Delete synthetic file "${TXT_NAME}"? This cannot be undone.`)
    await page.getByTestId('confirm-yes').click()
    await expect(page.getByTestId('attachments-empty')).toBeVisible()
    await expect(page.getByTestId('toast')).toHaveText(`Deleted ${TXT_NAME}.`)

    await page.reload()
    await expect(page.getByTestId('authorization-detail')).toBeVisible()
    await expect(page.getByTestId('attachments-empty')).toBeVisible()
    const after = await user.storage.from(BUCKET).download(storagePath)
    expect(after.data).toBeNull()
    expect(after.error?.message).toMatch(/not found/i)
  })

  test('client-side validation rejects a missing file, an unsupported type, and files over 5 MB', async ({ page }) => {
    await openOwnAuthorization(page)
    const form = page.getByTestId('upload-form')
    const error = form.getByTestId('error-file')

    await page.getByTestId('upload-submit').click()
    await expect(error).toHaveText('Choose a synthetic test file to upload.')

    await page.locator('#auth-upload-file').setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') })
    await page.getByTestId('upload-submit').click()
    await expect(error).toHaveText('Only PDF, TXT, PNG, or JPEG files can be uploaded.')

    await page.locator('#auth-upload-file').setInputFiles({ name: 'too-large.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 0x20) })
    await page.getByTestId('upload-submit').click()
    await expect(error).toContainText('5 MB')

    await page.reload()
    await expect(page.getByTestId('attachments-empty')).toBeVisible()
  })
})

test.describe('storage enforcement (server side)', () => {
  test('a read-only member cannot upload into the IPA folder that a provider can', async () => {
    const path = () => `${ORG_MAIN}/${randomUUID()}/e2e-${marker()}.txt`
    const viewer = await as('demo.viewer')
    const denied = await viewer.storage.from(BUCKET).upload(path(), txtBytes, { contentType: 'text/plain' })
    expect(denied.data).toBeNull()
    expect(denied.error?.message).toMatch(/row-level security/i)

    const user = await as('demo.user')
    const allowedPath = path()
    const allowed = await user.storage.from(BUCKET).upload(allowedPath, txtBytes, { contentType: 'text/plain' })
    expect(allowed.error).toBeNull()
    await must(user.storage.from(BUCKET).remove([allowedPath]))
  })

  test('a user from another IPA cannot download a main-IPA object', async () => {
    const user = await as('demo.user')
    const path = `${ORG_MAIN}/${randomUUID()}/e2e-${marker()}.txt`
    await must(user.storage.from(BUCKET).upload(path, txtBytes, { contentType: 'text/plain' }))
    try {
      const own = await user.storage.from(BUCKET).download(path)
      expect(own.error).toBeNull()
      const other = await as('demo.other')
      const foreign = await other.storage.from(BUCKET).download(path)
      expect(foreign.data).toBeNull()
      expect(foreign.error).not.toBeNull()
    } finally {
      await must(user.storage.from(BUCKET).remove([path]))
    }
  })

  test('the bucket rejects disallowed MIME types even for writers', async () => {
    const user = await as('demo.user')
    const result = await user.storage.from(BUCKET).upload(`${ORG_MAIN}/${randomUUID()}/e2e-${marker()}.csv`, Buffer.from('a,b\n'), { contentType: 'text/csv' })
    expect(result.data).toBeNull()
    expect(result.error?.message).toMatch(/mime type text\/csv is not supported/i)
  })
})

test.describe('request form attachments', () => {
  test('a TXT attached while submitting a request is listed on the new authorization', async ({ page }) => {
    const user = await as('demo.user')
    const [member] = await must(user.from('mp_members').select('member_number').eq('org_id', ORG_MAIN)
      .eq('eligibility_status', 'eligible').order('member_number').limit(1))
    const summary = `E2E request attachment ${marker()} synthetic clinical summary.`

    await app(page, '/authorization-request')
    await page.locator('#req-member-number').fill(member.member_number)
    await page.getByTestId('find-member').click()
    await expect(page.getByTestId('member-card')).toHaveAttribute('data-eligibility', 'eligible')
    await page.locator('#req-requested-provider-id').selectOption({ index: 1 })
    await page.locator('#req-service-code').selectOption('DEMO-S1003')
    await page.locator('#req-diagnosis-code').selectOption('DEMO-D2001')
    await page.locator('#req-place-of-service').selectOption('DEMO-P11')
    await page.locator('#req-units').fill('2')
    await page.locator('#req-clinical-summary').fill(summary)
    await page.locator('#req-attachments').setInputFiles(TXT_PATH)
    await page.getByTestId('submit-request').click()

    await expect(page).toHaveURL(/#\/authorizations\/DEMO-AUTH-\d+$/)
    await expect(page.getByTestId('clinical-summary')).toHaveText(summary)
    await expect(page.getByTestId('authorization-detail')).toHaveAttribute('data-status', 'requested')
    const row = attachmentRow(page, TXT_NAME)
    await expect(row).toBeVisible()
    await expect(row).toContainText('Authorization')
  })
})

test.describe('My Documents and Document Search', () => {
  test('upload, mark read, archive, and delete a document from My Documents', async ({ page }) => {
    const fileName = `e2e-doc-${marker()}.txt`
    // Category filter + large page keep the new (today-dated) row on the first page.
    await app(page, '/documents?category=Correspondence&size=100')
    await expect(page.getByTestId('results-table')).toHaveAttribute('aria-busy', 'false')
    await page.getByTestId('upload-document').click()
    const dialog = page.getByTestId('upload-dialog')
    await expect(dialog.locator('#doc-upload-category')).toHaveValue('Correspondence')
    await dialog.locator('#doc-upload-file').setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: txtBytes })
    await dialog.locator('#doc-upload-description').fill('E2E My Documents upload')
    await dialog.getByTestId('upload-submit').click()
    await expect(dialog).toBeHidden()

    const row = page.getByTestId('results-table').locator('tr[data-record-id]', { hasText: fileName })
    await expect(row).toHaveCount(1)
    await expect(row).toHaveAttribute('data-status', 'new')
    await expect(row.getByTestId('status-badge')).toHaveText('New')
    await expect(row).toContainText('Correspondence')

    await row.getByRole('button', { name: 'Mark read' }).click()
    await expect(row.getByTestId('status-badge')).toHaveText('Read')
    await expect(row.getByRole('button', { name: 'Mark read' })).toHaveCount(0)

    await row.getByRole('button', { name: 'Archive' }).click()
    await expect(row.getByTestId('status-badge')).toHaveText('Archived')
    await expect(row.getByRole('button', { name: 'Archive' })).toHaveCount(0)

    await row.getByTestId('delete-file').click()
    await page.getByTestId('confirm-yes').click()
    await expect(page.getByTestId('toast')).toHaveText(`Deleted ${fileName}.`)
    await expect(row).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('results-table')).toHaveAttribute('aria-busy', 'false')
    await expect(row).toHaveCount(0)
  })

  test('bulk "Mark selected as read" updates only the selected documents', async ({ page }) => {
    const user = await as('demo.user')
    const stamp = `e2e-bulk-${marker()}`
    const docs = []
    try {
      for (const suffix of ['a', 'b', 'c']) docs.push(await apiUpload(user, { name: `${stamp}-${suffix}.txt` }))

      await app(page, '/documents/search')
      await page.locator('#f-name').fill(stamp)
      await page.getByTestId('search-submit').click()
      const rows = page.getByTestId('results-table').locator('tr[data-record-id]')
      await expect(rows).toHaveCount(3)
      await expect(page.getByTestId('results-table').locator('tr[data-record-id][data-status="new"]')).toHaveCount(3)
      const bulk = page.getByTestId('bulk-mark-read')
      await expect(bulk).toBeDisabled()

      const rowFor = (doc) => page.locator(`tr[data-record-id="${doc.id}"]`)
      await rowFor(docs[0]).locator('[data-select-doc]').check()
      await rowFor(docs[2]).locator('[data-select-doc]').check()
      await expect(bulk).toBeEnabled()
      await bulk.click()
      await expect(page.getByTestId('toast')).toHaveText('Marked 2 documents as read.')

      await expect(rowFor(docs[0])).toHaveAttribute('data-status', 'read')
      await expect(rowFor(docs[2])).toHaveAttribute('data-status', 'read')
      await expect(rowFor(docs[1])).toHaveAttribute('data-status', 'new')
      await expect(rowFor(docs[0]).getByTestId('status-badge')).toHaveText('Read')
    } finally {
      await apiRemoveDocuments(user, docs)
    }
  })

  test('a seeded TXT document can be viewed from Document Search', async ({ page }) => {
    await app(page, '/documents/search')
    await page.locator('#f-name').fill('demo-')
    await page.getByTestId('search-submit').click()
    const view = page.getByTestId('results-table')
      .locator('[data-testid="view-file"][data-mime="text/plain"][data-file-name^="demo-"]').first()
    const fileName = await view.getAttribute('data-file-name')
    await view.click()
    await expect(page.getByTestId('file-preview-dialog')).toBeVisible()
    await expect(page.getByTestId('file-text')).toContainText(BANNER)
    await expect(page.getByTestId('file-text')).toContainText(`File: ${fileName}`)
  })
})

test.describe('Forms and Manuals', () => {
  test('lists every synthetic folder, downloads a PDF, and previews a TXT checklist', async ({ page }) => {
    await app(page, '/forms')
    const tree = page.getByTestId('forms-tree')
    await expect(tree.locator('details.folder')).toHaveCount(9)
    await expect(tree.getByTestId('form-file')).toHaveCount(18)

    const folder = tree.locator('details[data-folder="Forms"]')
    await folder.locator('summary').click()
    const guide = folder.getByTestId('form-file').filter({ hasText: 'Demo Forms Guide.pdf' })
    const downloadEvent = page.waitForEvent('download')
    await guide.getByTestId('download-file').click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toBe('Demo Forms Guide.pdf')
    const bytes = readFileSync(await download.path())
    expect(bytes.length).toBeGreaterThan(0)
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(bytes.toString('latin1')).toContain('Folder: Forms')

    await folder.getByTestId('form-file').filter({ hasText: 'Demo Forms Checklist.txt' }).getByTestId('view-file').click()
    await expect(page.getByTestId('file-text')).toContainText(BANNER)
    await expect(page.getByTestId('file-text')).toContainText('Demo Forms Checklist.txt')
    await expect(page.getByTestId('file-text')).toContainText('Folder: Forms')
  })
})
