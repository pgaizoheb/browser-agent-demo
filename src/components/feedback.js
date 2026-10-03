import { diagnosticSummary } from '../lib/backend.js'
import { $, escapeHtml, icon } from '../lib/dom.js'

export function openModal(html, { wide = false, testId = 'modal' } = {}) {
  const dialog = $('#modal')
  dialog.className = wide ? 'wide' : ''
  dialog.dataset.testid = testId
  dialog.innerHTML = html
  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()))
  if (!dialog.open) dialog.showModal()
  dialog.querySelector('[autofocus], input, select, textarea, button:not([data-close])')?.focus()
  return dialog
}

export function closeModal() {
  const dialog = $('#modal')
  if (dialog.open) dialog.close()
}

let toastTimer
export function toast(text, kind = 'success') {
  const region = $('#toast-region')
  region.innerHTML = `<div class="notice ${kind}" data-testid="toast" data-kind="${kind}">${escapeHtml(text)}</div>`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { region.innerHTML = '' }, 5000)
}

export const approximationNotice = (text = 'Mock approximation: this production page was not inspected. Labels, records, and behavior below are locally designed and backed by synthetic Supabase data.') =>
  `<div class="warning" data-testid="approximation-notice">${escapeHtml(text)}</div>`


/** In-page confirmation (no native dialogs, so agents and tests interact with normal DOM). */
export function confirmDialog(message, { confirmLabel = 'Delete', title = 'Please confirm' } = {}) {
  return new Promise((resolve) => {
    const dialog = openModal(`<h2 id="modal-title">${escapeHtml(title)}</h2><p data-testid="confirm-message">${escapeHtml(message)}</p>
      <div class="actions"><button type="button" data-confirm="no">Cancel</button>
      <button type="button" class="danger" data-confirm="yes" data-testid="confirm-yes">${escapeHtml(confirmLabel)}</button></div>`, { testId: 'confirm-dialog' })
    const finish = (answer) => { dialog.removeEventListener('close', onClose); closeModal(); resolve(answer) }
    const onClose = () => resolve(false)
    dialog.addEventListener('close', onClose, { once: true })
    dialog.querySelector('[data-confirm="no"]').addEventListener('click', () => finish(false))
    dialog.querySelector('[data-confirm="yes"]').addEventListener('click', () => finish(true))
  })
}
export const loadingState = (text = 'Loading synthetic records…') =>
  `<div class="state-panel" role="status" data-testid="loading">${escapeHtml(text)}</div>`

/** Markup for a backend diagnostic line (development-safe: category, operation, host). */
export const diagnosticLine = (diagnostic) => diagnostic
  ? `<small class="diagnostic" data-testid="backend-diagnostic" data-code="${escapeHtml(diagnostic.code)}">${escapeHtml(diagnosticSummary(diagnostic))}</small>`
  : ''

export const errorState = (text, diagnostic = null) =>
  `<div class="state-panel error-state" role="alert" data-testid="page-error">${icon('error_outline')} ${escapeHtml(text)}${diagnosticLine(diagnostic)}</div>`

export const permissionState = (text) =>
  `<div class="state-panel permission-state" role="alert" data-testid="permission-denied">${icon('lock')} ${escapeHtml(text)}</div>`

export const emptyState = (text) =>
  `<div class="state-panel" data-testid="empty-state">${escapeHtml(text)}</div>`

export function statusBadge(status, label) {
  return `<span class="badge status-${escapeHtml(status)}" data-testid="status-badge" data-status="${escapeHtml(status)}">${escapeHtml(label || status)}</span>`
}

/** Disables a submit button while an async action runs; returns the action result. */
export async function busy(button, run, busyText = 'Saving…') {
  if (!button) return run()
  const original = button.innerHTML
  button.disabled = true
  button.setAttribute('aria-busy', 'true')
  button.textContent = busyText
  try {
    return await run()
  } finally {
    button.disabled = false
    button.removeAttribute('aria-busy')
    button.innerHTML = original
  }
}
