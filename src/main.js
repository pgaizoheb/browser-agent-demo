import { createClient } from '@supabase/supabase-js'
import './styles.css'

const config = {
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  simulatorEnabled: import.meta.env.VITE_SIMULATOR_ENABLED === 'true',
}

const app = document.querySelector('#app')
const injectedClient = window.__TEST_SUPABASE__
const supabase = injectedClient || (
  config.url && config.anonKey
    ? createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null
)

let session = null
let realtimeChannel = null
let simulatorTimer = null
let renderGeneration = 0
let actionNotice = null

const statuses = ['new', 'pending_review', 'needs_information', 'approved', 'denied', 'submitted', 'closed']
const priorityOrder = { high: 0, normal: 1, low: 2 }
const actions = [
  ['approve', 'Approve', ''],
  ['deny', 'Deny', 'danger'],
  ['request_information', 'Request more information', 'secondary'],
  ['submit', 'Submit', 'secondary'],
  ['move_pending', 'Move to pending review', 'secondary'],
  ['close', 'Close', 'secondary'],
]

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character])
}

function label(value) {
  return String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function displayDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? escapeHtml(value) : date.toLocaleString()
}

function route() {
  const raw = location.hash.slice(1) || '/dashboard'
  const [path, search = ''] = raw.split('?')
  return { path, params: new URLSearchParams(search) }
}

function go(path) {
  if (location.hash === `#${path}`) renderRoute()
  else location.hash = path
}

function page(content, title, authenticated = false) {
  document.title = `${title} · Prior Authorization Demo`
  const account = authenticated && session
    ? `<div class="account"><span data-testid="current-user">${escapeHtml(session.user.email)}</span><button class="link-button" data-testid="logout-button" type="button">Log out</button></div>`
    : ''
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/dashboard">Prior Authorization Demo</a>
      ${account}
    </header>
    <main class="container">${content}</main>
  `
  app.querySelector('[data-testid="logout-button"]')?.addEventListener('click', logout)
}

function alert(message, testId = 'page-error') {
  return `<div class="alert" role="alert" data-testid="${testId}">${escapeHtml(message)}</div>`
}

function loading(message = 'Loading…') {
  page(`<p class="loading" role="status" data-testid="loading">${escapeHtml(message)}</p>`, 'Loading', Boolean(session))
}

function renderConfigError() {
  page(`
    <section class="auth-card">
      <p class="eyebrow">Configuration required</p>
      <h1>Supabase is not configured</h1>
      ${alert('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before starting or building the site.')}
    </section>
  `, 'Configuration')
}

function renderLogin(errorMessage = '') {
  page(`
    <section class="auth-card" aria-labelledby="login-heading">
      <p class="eyebrow">Secure demo access</p>
      <h1 id="login-heading">Log in</h1>
      <p>Enter an existing Supabase demo-user email to receive a verification code.</p>
      ${errorMessage ? alert(errorMessage, 'login-error') : ''}
      <form data-testid="login-form">
        <label for="login-email">Email</label>
        <input id="login-email" name="email" type="email" autocomplete="email" required data-testid="login-email">
        <button type="submit" data-testid="send-otp">Send verification code</button>
      </form>
    </section>
  `, 'Log in')

  app.querySelector('[data-testid="login-form"]').addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = event.currentTarget.querySelector('button')
    const email = new FormData(event.currentTarget).get('email').trim().toLowerCase()
    button.disabled = true
    button.textContent = 'Sending…'
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    if (error) {
      renderLogin(error.message || 'Could not send verification code.')
      return
    }
    sessionStorage.setItem('pendingOtpEmail', email)
    go('/otp')
  })
}

function renderOtp(errorMessage = '') {
  const email = sessionStorage.getItem('pendingOtpEmail')
  if (!email) {
    go('/login')
    return
  }
  page(`
    <section class="auth-card" aria-labelledby="otp-heading">
      <p class="eyebrow">Email verification</p>
      <h1 id="otp-heading">Enter verification code</h1>
      <p>An eight-digit code was sent to <strong>${escapeHtml(email)}</strong>.</p>
      ${errorMessage ? alert(errorMessage, 'otp-error') : ''}
      <form data-testid="otp-form">
        <label for="otp-code">One-time code</label>
        <input id="otp-code" name="code" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" autocomplete="one-time-code" required data-testid="otp-code">
        <button type="submit" data-testid="verify-otp">Verify and log in</button>
      </form>
    </section>
  `, 'Verification')

  app.querySelector('[data-testid="otp-form"]').addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = event.currentTarget.querySelector('button')
    const token = new FormData(event.currentTarget).get('code').trim()
    button.disabled = true
    button.textContent = 'Verifying…'
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    if (error || !data.session) {
      renderOtp(error?.message || 'Invalid or expired verification code.')
      return
    }
    session = data.session
    sessionStorage.removeItem('pendingOtpEmail')
    go('/dashboard')
  })
}

async function logout() {
  await supabase.auth.signOut()
  session = null
  sessionStorage.removeItem('pendingOtpEmail')
  stopRealtime()
  stopSimulator()
  go('/login')
}

function statusBadge(status, testId = '') {
  const testAttribute = testId ? ` data-testid="${testId}"` : ''
  return `<span class="status status-${escapeHtml(status)}"${testAttribute}>${escapeHtml(label(status))}</span>`
}

function subscribeToChanges(caseId = null) {
  stopRealtime()
  const generation = renderGeneration
  const channelName = caseId ? `case-${caseId}` : 'dashboard-cases'
  realtimeChannel = supabase.channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cases', ...(caseId ? { filter: `id=eq.${caseId}` } : {}) }, () => {
      if (generation === renderGeneration) renderRoute()
    })
  if (caseId) {
    realtimeChannel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'case_events', filter: `case_id=eq.${caseId}` }, () => {
      if (generation === renderGeneration) renderRoute()
    })
  }
  realtimeChannel.subscribe((state) => {
    const indicator = document.querySelector('[data-testid="realtime-status"]')
    if (indicator && state === 'SUBSCRIBED') indicator.textContent = 'Realtime connected'
  })
}

function stopRealtime() {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel)
  realtimeChannel = null
}

async function renderDashboard() {
  loading('Loading cases…')
  const activeStatus = route().params.get('status') || 'all'
  const { data: cases, error } = await supabase.from('cases').select('*').order('updated_at', { ascending: false })
  if (error) {
    page(alert(error.message || 'Could not load cases.'), 'Dashboard', true)
    return
  }

  cases.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9))
  const counts = Object.fromEntries(statuses.map((status) => [status, cases.filter((item) => item.status === status).length]))
  const visible = activeStatus === 'all' ? cases : cases.filter((item) => item.status === activeStatus)
  const filters = ['all', ...statuses].map((status) => {
    const count = status === 'all' ? cases.length : counts[status]
    const href = status === 'all' ? '#/dashboard' : `#/dashboard?status=${status}`
    return `<a href="${href}" ${activeStatus === status ? 'aria-current="page"' : ''} data-testid="filter-${status.replaceAll('_', '-')}">${escapeHtml(label(status))} <b>${count}</b></a>`
  }).join('')
  const cards = visible.map((item) => `
    <article class="case-card" data-testid="case-card" data-record-id="${escapeHtml(item.id)}" data-status="${escapeHtml(item.status)}">
      <div class="card-top"><span class="priority priority-${escapeHtml(item.priority)}" data-testid="case-priority">${escapeHtml(label(item.priority))} priority</span>${statusBadge(item.status, 'case-status')}</div>
      <h2><a href="#/cases/${encodeURIComponent(item.id)}" data-testid="case-link">${escapeHtml(item.patient_name)}</a></h2>
      <p class="service" data-testid="case-service">${escapeHtml(item.medication_or_procedure)}</p>
      <dl>
        <div><dt>Patient ID</dt><dd data-testid="case-patient-id">${escapeHtml(item.patient_id)}</dd></div>
        <div><dt>Request ID</dt><dd data-testid="case-request-id">${escapeHtml(item.request_id)}</dd></div>
        <div><dt>Payer</dt><dd>${escapeHtml(item.payer)}</dd></div>
        <div><dt>Submitted</dt><dd>${escapeHtml(item.submitted_date)}</dd></div>
      </dl>
      <p class="notes">${escapeHtml(item.notes)}</p>
      <a class="secondary-button" href="#/cases/${encodeURIComponent(item.id)}" data-action="inspect" data-record-id="${escapeHtml(item.id)}">Inspect case</a>
    </article>
  `).join('')

  page(`
    <div class="page-heading" data-testid="dashboard">
      <div><p class="eyebrow">Work queue</p><h1>Prior authorization cases</h1><p>Review the facts and choose the appropriate next action.</p></div>
      <div class="live-indicator" data-testid="realtime-status"><span></span>Connecting realtime…</div>
    </div>
    <nav class="filters" aria-label="Case status filters">${filters}</nav>
    <section class="case-grid" aria-label="Cases" data-testid="case-list">${cards || '<p class="empty" data-testid="empty-state">No cases match this filter.</p>'}</section>
  `, 'Dashboard', true)
  subscribeToChanges()
}

async function renderCase(caseId, actionError = '') {
  const actionMessage = actionNotice?.caseId === caseId ? actionNotice.message : ''
  loading('Loading case…')
  const [{ data: caseData, error: caseError }, { data: events, error: eventError }] = await Promise.all([
    supabase.from('cases').select('*').eq('id', caseId).single(),
    supabase.from('case_events').select('*').eq('case_id', caseId).order('created_at', { ascending: false }),
  ])
  if (caseError || eventError || !caseData) {
    page(alert(caseError?.message || eventError?.message || 'Case not found.'), 'Case', true)
    return
  }

  const actionButtons = actions.map(([value, text, className]) => `<button name="action" value="${value}" class="${className}" data-testid="case-action" data-action="${value.replaceAll('_', '-')}">${text}</button>`).join('')
  const history = events.map((event) => `
    <tr data-testid="history-event">
      <td>${displayDate(event.created_at)}</td><td>${escapeHtml(label(event.previous_status))}</td><td>${escapeHtml(label(event.new_status))}</td>
      <td>${escapeHtml(label(event.action))}</td><td>${escapeHtml(event.note || '—')}</td><td>${escapeHtml(event.actor)}</td>
    </tr>
  `).join('')

  page(`
    <a class="back-link" href="#/dashboard" data-testid="back-dashboard">← Back to dashboard</a>
    <div class="detail-heading" data-record-id="${escapeHtml(caseData.id)}" data-testid="case-detail">
      <div><p class="eyebrow" data-testid="detail-request-id">${escapeHtml(caseData.request_id)}</p><h1>${escapeHtml(caseData.patient_name)}</h1><p data-testid="detail-service">${escapeHtml(caseData.medication_or_procedure)}</p></div>
      ${statusBadge(caseData.status, 'detail-status')}
    </div>
    <div class="detail-grid">
      <section class="panel" aria-labelledby="facts-heading" data-testid="case-facts">
        <h2 id="facts-heading">Case facts</h2>
        <dl class="facts">
          <div><dt>Patient ID</dt><dd data-testid="detail-patient-id">${escapeHtml(caseData.patient_id)}</dd></div><div><dt>Request ID</dt><dd>${escapeHtml(caseData.request_id)}</dd></div>
          <div><dt>Provider</dt><dd data-testid="detail-provider">${escapeHtml(caseData.provider_name)}</dd></div><div><dt>Provider reference</dt><dd data-testid="detail-provider-reference">${escapeHtml(caseData.provider_reference)}</dd></div>
          <div><dt>Payer</dt><dd>${escapeHtml(caseData.payer)}</dd></div><div><dt>Submitted</dt><dd>${escapeHtml(caseData.submitted_date)}</dd></div>
          <div><dt>Priority</dt><dd data-testid="detail-priority">${escapeHtml(label(caseData.priority))}</dd></div><div><dt>Current status</dt><dd data-testid="detail-current-status">${escapeHtml(label(caseData.status))}</dd></div>
        </dl>
        <h3>Current notes</h3><p class="preline" data-testid="case-notes">${escapeHtml(caseData.notes)}</p>
        <h3>Diagnosis / procedure context</h3><p data-testid="diagnosis-context">${escapeHtml(caseData.diagnosis_context)}</p>
        <h3>Clinical facts</h3><p data-testid="clinical-facts">${escapeHtml(caseData.clinical_facts)}</p>
        <h3>Policy facts</h3><p data-testid="policy-facts">${escapeHtml(caseData.policy_facts)}</p>
      </section>
      <aside class="panel actions" aria-labelledby="actions-heading">
        <h2 id="actions-heading">Take action</h2>
        <p>The application exposes controls but does not recommend an action. Denials and information requests require a reason.</p>
        ${actionError ? alert(actionError, 'action-error') : ''}
        ${actionMessage ? '<div class="success" role="status" data-testid="action-success">Case updated successfully.</div>' : ''}
        <form data-testid="action-form">
          <label for="action-note">Reason or note <span>(required for denial and information requests)</span></label>
          <textarea id="action-note" name="note" rows="3" data-testid="action-note"></textarea>
          <div class="action-buttons">${actionButtons}</div>
        </form>
      </aside>
    </div>
    <section class="panel history" aria-labelledby="history-heading" data-testid="activity-history">
      <h2 id="history-heading">Activity history</h2>
      <div class="table-wrap"><table><thead><tr><th>Timestamp</th><th>Previous</th><th>New</th><th>Action</th><th>Note</th><th>Actor</th></tr></thead><tbody>${history}</tbody></table></div>
    </section>
  `, caseData.request_id, true)

  app.querySelector('[data-testid="action-form"]').addEventListener('submit', async (event) => {
    event.preventDefault()
    const action = event.submitter?.value
    const note = new FormData(event.currentTarget).get('note').trim()
    actionNotice = null
    if (['deny', 'request_information'].includes(action) && !note) {
      renderCase(caseId, 'A reason is required for this action.')
      return
    }
    for (const button of event.currentTarget.querySelectorAll('button')) button.disabled = true
    const { error } = await supabase.rpc('perform_case_action', { p_case_id: caseId, p_action: action, p_note: note })
    actionNotice = null
    if (error) {
      renderCase(caseId, error.message || 'Could not update the case.')
      return
    }
    actionNotice = { caseId, message: 'Case updated successfully.' }
    await renderCase(caseId)
  })
  subscribeToChanges(caseId)
}

function stopSimulator() {
  clearTimeout(simulatorTimer)
  simulatorTimer = null
}

function scheduleSimulator() {
  if (!config.simulatorEnabled || !session || simulatorTimer) return
  const delay = 20_000 + Math.floor(Math.random() * 40_001)
  simulatorTimer = setTimeout(async () => {
    simulatorTimer = null
    await supabase.rpc('simulate_case_change')
    scheduleSimulator()
  }, delay)
}

async function renderRoute() {
  const generation = ++renderGeneration
  stopRealtime()
  if (!supabase) {
    renderConfigError()
    return
  }
  const current = route()
  if (!current.path.startsWith('/cases/')) actionNotice = null
  if (!session && !['/login', '/otp'].includes(current.path)) {
    go('/login')
    return
  }
  if (session && ['/login', '/otp'].includes(current.path)) {
    go('/dashboard')
    return
  }
  if (current.path === '/login') renderLogin()
  else if (current.path === '/otp') renderOtp()
  else if (current.path === '/dashboard') await renderDashboard()
  else if (current.path.startsWith('/cases/')) await renderCase(decodeURIComponent(current.path.slice('/cases/'.length)))
  else go(session ? '/dashboard' : '/login')
  if (generation === renderGeneration) scheduleSimulator()
}

async function start() {
  if (!supabase) {
    renderConfigError()
    return
  }
  const { data } = await supabase.auth.getSession()
  session = data.session
  supabase.auth.onAuthStateChange((_event, nextSession) => {
    session = nextSession
  })
  await renderRoute()
}

window.addEventListener('hashchange', renderRoute)
start()
