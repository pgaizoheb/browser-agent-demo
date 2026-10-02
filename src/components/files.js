import { escapeHtml, icon } from '../lib/dom.js'
import { describeError } from '../lib/errors.js'
import { downloadFile, fetchFile } from '../lib/data.js'
import { openModal, toast } from './feedback.js'

export function downloadButton(doc, label = '') {
  return `<button type="button" class="icon-button" data-download-path="${escapeHtml(doc.storage_path)}" data-file-name="${escapeHtml(doc.file_name || doc.title)}"
    aria-label="Download ${escapeHtml(doc.file_name || doc.title)}" data-testid="download-file">${icon('file_download')}${label}</button>`
}

export function viewButton(doc, label = '') {
  return `<button type="button" class="icon-button" data-view-path="${escapeHtml(doc.storage_path)}" data-file-name="${escapeHtml(doc.file_name || doc.title)}"
    data-mime="${escapeHtml(doc.mime_type)}" aria-label="View ${escapeHtml(doc.file_name || doc.title)}" data-testid="view-file">${icon('visibility')}${label}</button>`
}

let previewUrl = ''

async function preview(button) {
  const { viewPath: path, fileName, mime } = button.dataset
  const dialog = openModal(`<h2 id="modal-title">${escapeHtml(fileName)}</h2><div class="file-preview" data-testid="file-preview" role="status">Loading synthetic file…</div>
    <div class="actions"><button type="button" data-close>Close</button></div>`, { wide: true, testId: 'file-preview-dialog' })
  const container = dialog.querySelector('.file-preview')
  try {
    const blob = await fetchFile(path)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    if (mime === 'text/plain') {
      container.innerHTML = `<pre data-testid="file-text">${escapeHtml(await blob.text())}</pre>`
    } else {
      previewUrl = URL.createObjectURL(blob)
      container.innerHTML = mime.startsWith('image/')
        ? `<img src="${previewUrl}" alt="Synthetic attachment preview">`
        : `<iframe src="${previewUrl}" title="Synthetic PDF preview" data-testid="file-frame"></iframe>`
    }
    container.removeAttribute('role')
  } catch (error) {
    container.innerHTML = `<p class="error" role="alert">${escapeHtml(describeError(error).message)}</p>`
  }
}

/** One delegated listener handles download/view buttons rendered anywhere in the app. */
export function wireFileActions(root) {
  root.addEventListener('click', async (event) => {
    const download = event.target.closest('[data-download-path]')
    if (download) {
      try {
        await downloadFile(download.dataset.downloadPath, download.dataset.fileName)
        toast(`Downloaded ${download.dataset.fileName}.`)
      } catch (error) {
        toast(describeError(error).message, 'error')
      }
      return
    }
    const view = event.target.closest('[data-view-path]')
    if (view) preview(view)
  })
}
