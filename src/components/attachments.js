import { escapeHtml, icon } from '../lib/dom.js'
import { describeError } from '../lib/errors.js'
import { deleteDocument, uploadDocument, validateUpload } from '../lib/data.js'
import { formatBytes, formatDate } from '../lib/format.js'
import { can, role, userId } from '../lib/session.js'
import { busy, confirmDialog, toast } from './feedback.js'
import { field, showFieldErrors } from './field.js'
import { downloadButton, viewButton } from './files.js'

export const CATEGORIES = ['Authorization', 'Clinical', 'Correspondence', 'Eligibility', 'Claims', 'Remittance']
export const ACCEPT = '.pdf,.txt,.png,.jpg,.jpeg,application/pdf,text/plain,image/png,image/jpeg'

export function canDeleteDocument(doc) {
  return can('upload') && (doc.uploaded_by === userId() || role() === 'admin')
}

export function uploadForm({ idPrefix = 'upload', defaultCategory = 'Authorization' } = {}) {
  return `<form class="upload-form" data-testid="upload-form" novalidate>
    <div class="form-grid">
      ${field({ name: 'file', label: 'Synthetic test file (PDF, TXT, PNG, JPEG; max 5 MB)', type: 'file', accept: ACCEPT, idPrefix, required: true })}
      ${field({ name: 'category', label: 'Category', type: 'select', options: CATEGORIES, value: defaultCategory, idPrefix })}
      ${field({ name: 'description', label: 'Description', maxlength: 500, idPrefix })}
    </div>
    <p class="muted">Upload synthetic test files only. Files are stored in the demo Supabase bucket and are visible to this IPA.</p>
    <div class="actions"><button type="submit" data-testid="upload-submit">${icon('cloud_upload')}Upload Attachment</button></div>
  </form>`
}

/** Validates, uploads, and reports. Returns the created document row or null. */
export async function handleUpload(form, { authorizationId = null } = {}) {
  const file = form.elements.file.files[0]
  const problem = validateUpload(file)
  if (problem) {
    showFieldErrors(form, { file: problem })
    return null
  }
  showFieldErrors(form, {})
  try {
    const doc = await busy(form.querySelector('[type=submit]'), () => uploadDocument({
      authorizationId, file, category: form.elements.category.value, description: form.elements.description.value.trim(),
    }), 'Uploading…')
    toast(`Uploaded ${doc.file_name}.`)
    form.reset()
    return doc
  } catch (error) {
    const described = describeError(error)
    showFieldErrors(form, { file: described.message })
    return null
  }
}

export function attachmentRows(docs) {
  if (!docs.length) return '<p class="muted" data-testid="attachments-empty">No attachments yet.</p>'
  return `<div class="table-wrap"><table data-testid="attachments-table"><thead><tr><th>File</th><th>Category</th><th>Uploaded</th><th>By</th><th>Size</th><th>Download</th><th>View</th><th>Delete</th></tr></thead><tbody>
    ${docs.map((doc) => `<tr data-record-id="${doc.id}" data-file-name="${escapeHtml(doc.file_name)}">
      <td>${escapeHtml(doc.file_name)}</td><td>${escapeHtml(doc.category)}</td><td>${formatDate(doc.sent_date)}</td>
      <td>${escapeHtml(doc.uploaded_by_name || '')}</td><td>${formatBytes(doc.size_bytes)}</td>
      <td>${downloadButton(doc)}</td><td>${viewButton(doc)}</td>
      <td>${canDeleteDocument(doc) ? `<button type="button" class="icon-button" data-delete-doc="${doc.id}" aria-label="Delete ${escapeHtml(doc.file_name)}" data-testid="delete-file">${icon('delete')}</button>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`
}

export async function confirmDeleteDocument(doc) {
  if (!(await confirmDialog(`Delete synthetic file "${doc.file_name}"? This cannot be undone.`))) return false
  try {
    await deleteDocument(doc)
    toast(`Deleted ${doc.file_name}.`)
    return true
  } catch (error) {
    toast(describeError(error).message, 'error')
    return false
  }
}
