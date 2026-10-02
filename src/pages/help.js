import { openModal } from '../components/feedback.js'
import { escapeHtml } from '../lib/dom.js'
import { describeError } from '../lib/errors.js'
import { formatDateTime } from '../lib/format.js'
import { session } from '../lib/session.js'
import { supabase } from '../lib/supabase.js'

function currentSessionId() {
  try {
    const payload = session.auth.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)).session_id
  } catch {
    return null
  }
}

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
  const { data, error } = await supabase.from('mp_demo_outbox').select('id, session_id, to_address, subject, body, created_at')
    .order('id', { ascending: false }).limit(10)
  container.removeAttribute('role')
  if (error) {
    container.innerHTML = `<p class="error" role="alert">${escapeHtml(describeError(error).message)}</p>`
    return
  }
  // Other sign-ins of the same demo account share this mailbox; mark the codes issued to this session.
  const currentSession = currentSessionId()
  const latest = data.find((message) => message.session_id === currentSession) || data[0]
  container.innerHTML = data.length
    ? data.map((message) => `<article class="mail-message" data-testid="mailbox-message" data-session="${message.session_id === currentSession ? 'current' : 'other'}" ${message === latest ? 'data-latest="true"' : ''}>
        <div class="mail-head"><strong>${escapeHtml(message.subject)}${message.session_id === currentSession ? ' <span class="badge">This sign-in</span>' : ''}</strong><span class="muted">To ${escapeHtml(message.to_address)} · ${formatDateTime(message.created_at)}</span></div>
        <pre data-testid="mailbox-body">${escapeHtml(message.body)}</pre></article>`).join('')
    : '<p class="muted" data-testid="mailbox-empty">No test messages yet.</p>'
}
