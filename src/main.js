import './styles.css'
import { closeModal, errorState, openModal } from './components/feedback.js'
import { wireFileActions } from './components/files.js'
import { mountShell, refreshOrgSelect, titleForPath, updateShell } from './components/shell.js'
import { clearLookups } from './lib/data.js'
import { $, escapeHtml } from './lib/dom.js'
import { describeError } from './lib/errors.js'
import { currentRoute, go, matchPath } from './lib/router.js'
import { ROLE_LABELS, clearSession, currentMembership, loadStatus, session, setOrg } from './lib/session.js'
import { configError, supabase } from './lib/supabase.js'
import { renderAuthorizationDetail } from './pages/authorizationDetail.js'
import { showHelp, showMailbox } from './pages/help.js'
import { renderHome } from './pages/home.js'
import { renderClaimDetail, renderMemberDetail, renderProviderDetail } from './pages/recordDetails.js'
import { REPORTS, renderReport } from './pages/reports.js'
import { renderRequestForm } from './pages/requestForm.js'
import { renderSearch } from './pages/search.js'
import { SEARCH_CONFIGS } from './pages/searchConfigs.js'
import { renderSignIn } from './pages/signIn.js'
import { renderConsultNotes, renderForms, renderHospitalAdmin } from './pages/workflows.js'

const app = $('#app')
let main = null
let generation = 0

const ROUTES = [
  ['/', renderHome, 'Home'],
  ...Object.entries(SEARCH_CONFIGS).map(([path, config]) => [path, (ctx) => renderSearch(ctx, config), config.title]),
  ...Object.entries(REPORTS).map(([path, config]) => [path, (ctx) => renderReport(ctx, config), config.title]),
  ['/authorization-request', renderRequestForm, 'Submit Request'],
  ['/authorization-request/:number/edit', renderRequestForm, 'Edit Request'],
  ['/hospital-admin', renderHospitalAdmin, 'Hospital Admin'],
  ['/my-data/consult-notes', renderConsultNotes, 'Consult Notes'],
  ['/forms', renderForms, 'Forms and Manuals'],
  ['/authorizations/:number', renderAuthorizationDetail, 'Authorization'],
  ['/members/:number', renderMemberDetail, 'Member'],
  ['/claims/:number', renderClaimDetail, 'Claim'],
  ['/providers/:npi', renderProviderDetail, 'Provider'],
]

function resolve(path) {
  for (const [pattern, render, title] of ROUTES) {
    const params = matchPath(pattern, path)
    if (params) return { render, params, title }
  }
  return null
}

function onVerified(next) {
  main = null
  go(next || '/')
}

async function signOut() {
  await supabase.auth.signOut({ scope: 'local' })
  clearSession()
  main = null
  go('/sign-in')
}

function showAccount() {
  const membership = currentMembership()
  const dialog = openModal(`<h2 id="modal-title">Demo account</h2>
    <dl class="detail-grid single">
      <div class="detail-item"><dt>Name</dt><dd data-testid="account-display-name">${escapeHtml(session.status?.display_name)}</dd></div>
      <div class="detail-item"><dt>Username</dt><dd>${escapeHtml(session.status?.username)}</dd></div>
      <div class="detail-item"><dt>Current IPA</dt><dd>${escapeHtml(membership?.name)}</dd></div>
      <div class="detail-item"><dt>Role</dt><dd data-testid="account-role">${escapeHtml(ROLE_LABELS[membership?.role] || 'None')}</dd></div>
    </dl>
    <p class="muted">Synthetic demo account. No production session is used.</p>
    <div class="actions"><a class="text-button" href="#/activity" data-close>Activity log</a>
      <button type="button" class="text-button" id="account-mailbox">Demo test mailbox</button>
      <button type="button" class="text-button" id="account-help">Help</button>
      <button type="button" data-close>Close</button></div>`, { testId: 'account-dialog' })
  dialog.querySelector('#account-mailbox').addEventListener('click', showMailbox)
  dialog.querySelector('#account-help').addEventListener('click', showHelp)
}

function changeOrg(orgId) {
  setOrg(orgId)
  clearLookups()
  refreshOrgSelect()
  renderRoute()
}

async function renderRoute() {
  const current = ++generation
  const { path, query } = currentRoute()
  closeModal()

  if (path === '/sign-in') {
    main = null
    document.title = 'Sign-in • MedPoint LOCAL MOCK / DEMO'
    return renderSignIn({ app, query, onVerified })
  }
  if (!session.auth || !session.status?.verified) {
    const target = location.hash.slice(1)
    return go('/sign-in', target && target !== '/' ? { next: target } : undefined)
  }
  if (!main || !app.contains(main)) {
    main = mountShell(app, { onOrgChange: changeOrg, onLogout: signOut, onAccount: showAccount })
  }
  updateShell(path)
  const route = resolve(path)
  window.scrollTo(0, 0)
  document.title = `${route?.title || titleForPath(path) || 'Not found'} • MedPoint LOCAL MOCK / DEMO`
  if (!route) {
    main.innerHTML = errorState(`Page ${path} does not exist in this demo portal.`)
    return
  }
  const ctx = { main, path, query, params: route.params, isCurrent: () => current === generation }
  main.setAttribute('aria-busy', 'true')
  try {
    await route.render(ctx)
  } catch (error) {
    const described = describeError(error)
    if (described.kind === 'session') return signOut()
    if (ctx.isCurrent()) main.innerHTML = errorState(described.message)
  } finally {
    if (ctx.isCurrent()) main.removeAttribute('aria-busy')
  }
}

async function start() {
  if (configError) {
    app.innerHTML = `<main class="login-page"><section class="login-card">${errorState(configError)}</section></main>`
    return
  }
  wireFileActions(document)
  const { data } = await supabase.auth.getSession()
  session.auth = data.session
  if (session.auth) {
    try {
      await loadStatus()
    } catch {
      await supabase.auth.signOut({ scope: 'local' })
      clearSession()
    }
  }
  supabase.auth.onAuthStateChange((event, nextSession) => {
    session.auth = nextSession
    if (event === 'SIGNED_OUT' && currentRoute().path !== '/sign-in') {
      clearSession()
      main = null
      go('/sign-in')
    }
  })
  window.addEventListener('hashchange', renderRoute)
  renderRoute()
}

start()
