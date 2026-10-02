import { openModal } from '../components/feedback.js'
import { escapeHtml } from '../lib/dom.js'
import { describeError } from '../lib/errors.js'
import { formatDateTime } from '../lib/format.js'
import { supabase } from '../lib/supabase.js'

export function showHelp() {
  openModal(`<h2 id="modal-title">Demo help</h2>
    <p>This is a LOCAL MOCK / DEMO portal backed by a synthetic Supabase dataset. Password resets, account requests, e-mail, and help links are simulated only.</p>
    <p>No production account or credentials are needed or accepted.</p>
    <div class="actions"><button type="button" data-close>Close</button></div>`, { testId: 'help-dialog' })
}

/** Test-mode mailbox: verification "emails" are stored in mp_demo_outbox, never sent. */
export async function showMailbox() {
  const dialog = openModal(`<h2 id="modal-title">Demo test mailbox</h2>
    <p class="muted">TEST MODE — messages below were never e-mailed. Only the signed-in demo account can read its own mailbox.</p>
    <div data-testid="mailbox" role="status">Loading…</div>
    <div class="actions"><button type="button" data-close>Close</button></div>`, { testId: 'mailbox-dialog', wide: true })
  const container = dialog.querySelector('[data-testid="mailbox"]')
  const { data, error } = await supabase.from('mp_demo_outbox').select('id, to_address, subject, body, created_at')
    .order('id', { ascending: false }).limit(10)
  container.removeAttribute('role')
  if (error) {
    container.innerHTML = `<p class="error" role="alert">${escapeHtml(describeError(error).message)}</p>`
    return
  }
  container.innerHTML = data.length
    ? data.map((message, index) => `<article class="mail-message" data-testid="mailbox-message" ${index === 0 ? 'data-latest="true"' : ''}>
        <div class="mail-head"><strong>${escapeHtml(message.subject)}</strong><span class="muted">To ${escapeHtml(message.to_address)} · ${formatDateTime(message.created_at)}</span></div>
        <pre data-testid="mailbox-body">${escapeHtml(message.body)}</pre></article>`).join('')
    : '<p class="muted" data-testid="mailbox-empty">No test messages yet.</p>'
}
