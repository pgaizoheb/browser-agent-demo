import logoUrl from '../assets/portal-logo.svg'
import { busy, diagnosticLine, toast } from '../components/feedback.js'
import { field } from '../components/field.js'
import { config, demoAccounts, demoPassword } from '../config.js'
import { $, escapeHtml, icon } from '../lib/dom.js'
import { describeError } from '../lib/errors.js'
import { clearSession, loadStatus, session } from '../lib/session.js'
import { supabase } from '../lib/supabase.js'
import { showHelp, showMailbox } from './help.js'

function card(content) {
  return `<main class="login-page"><section class="login-card" data-testid="login-card">
    <img class="login-logo" src="${logoUrl}" alt="MedPoint — LOCAL MOCK / DEMO">
    <p class="login-note">LOCAL MOCK / DEMO · Synthetic demo accounts only</p>${content}</section></main>`
}

function credentialsStage(message = '', diagnostic = null) {
  const fill = demoPassword ? `<div class="demo-fill">
      <label for="demo-account" class="muted">Demo account</label>
      <select id="demo-account" data-testid="demo-account">${demoAccounts.map((a) => `<option value="${a.username}">${escapeHtml(a.label)}</option>`).join('')}</select>
      <button type="button" class="text-button" id="fill-demo" data-testid="fill-demo">Fill demo credentials</button></div>` : ''
  return card(`<form id="login-form" novalidate>${fill}
    <div class="field login-field"><label for="demo-user">Username</label><input id="demo-user" name="username" placeholder=" " autocomplete="username" data-testid="username"></div>
    <div class="field login-field password"><label for="demo-password">Password or reset code</label>
      <input id="demo-password" name="password" type="password" placeholder=" " autocomplete="current-password" data-testid="password">
      <button type="button" id="password-eye" class="password-eye" aria-label="Show password">${icon('visibility')}</button></div>
    <div id="captcha" class="captcha hidden" data-testid="captcha">
      <input id="demo-captcha" type="checkbox" aria-label="I'm not a robot (demo test CAPTCHA)" data-testid="captcha-checkbox">
      <label for="demo-captcha">I'm not a robot</label>
      <small>DEMO TEST CAPTCHA<br>Not a real challenge</small></div>
    <div id="login-error" class="error" role="alert" data-testid="login-error">${escapeHtml(message)}</div>
    <div id="login-diagnostic">${diagnosticLine(diagnostic)}</div>
    <div class="login-actions"><div class="login-action-row">
        <button type="submit" data-testid="sign-in">${icon('input')}Sign in</button>
        <button type="button" data-help>${icon('help')}I forgot my password.</button></div>
      <button type="button" data-help>${icon('person_add')}Request an account</button>
      <div class="need-help"><a href="#/sign-in" data-help>Need Help?</a></div></div>
  </form>`)
}

function verificationStage(info) {
  return card(`<h2 class="verify-title">Email verification</h2>
    <p data-testid="verification-message">A 6-digit verification code was sent to <strong>${escapeHtml(info.masked_email || 'your demo address')}</strong>.</p>
    <div class="warning" data-testid="test-mode-notice">TEST MODE — no e-mail is sent. Read the code from the demo test mailbox.</div>
    <button type="button" class="text-button" id="open-mailbox" data-testid="open-mailbox">${icon('mail')}Open demo test mailbox</button>
    <form id="verify-form" novalidate>
      ${field({ name: 'code', label: 'Verification code', maxlength: 6, autocomplete: 'one-time-code', idPrefix: 'verify' })}
      <div id="verify-error" class="error" role="alert" data-testid="verify-error"></div>
      <div class="actions"><button type="submit" data-testid="verify-submit">Verify and continue</button>
        <button type="button" id="resend" data-testid="resend-code">Resend code</button></div>
    </form>
    <button type="button" class="text-button" id="cancel-sign-in" data-testid="cancel-sign-in">${icon('arrow_back')}Use a different account</button>`)
}

export async function renderSignIn({ app, query, onVerified }) {
  if (session.auth && session.status?.verified) return onVerified(query.get('next'))
  if (session.auth) return showVerification({ app, query, onVerified })
  showCredentials({ app, query, onVerified })
}

function showCredentials({ app, query, onVerified }, message = '', diagnostic = null) {
  app.innerHTML = credentialsStage(message, diagnostic)
  const form = $('#login-form')
  const password = $('#demo-password')
  const captcha = $('#captcha')
  const error = $('#login-error')
  const diagnosticSlot = $('#login-diagnostic')
  app.querySelectorAll('[data-help]').forEach((el) => el.addEventListener('click', (event) => { event.preventDefault(); showHelp() }))
  $('#fill-demo')?.addEventListener('click', () => {
    $('#demo-user').value = $('#demo-account').value
    password.value = demoPassword
    captcha.classList.remove('hidden')
  })
  password.addEventListener('input', () => captcha.classList.toggle('hidden', !password.value))
  $('#password-eye').addEventListener('click', () => {
    password.type = password.type === 'password' ? 'text' : 'password'
    $('#password-eye').setAttribute('aria-label', password.type === 'password' ? 'Show password' : 'Hide password')
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    diagnosticSlot.innerHTML = ''
    const username = $('#demo-user').value.trim()
    if (!username) { error.textContent = 'Enter your username.'; $('#demo-user').focus(); return }
    if (!password.value) { error.textContent = 'Enter your password.'; password.focus(); return }
    if (!$('#demo-captcha').checked) { error.textContent = 'Complete the test CAPTCHA.'; return }
    error.textContent = ''
    const email = username.includes('@') ? username : `${username}@${config.loginDomain}`
    const { error: signInError } = await busy(form.querySelector('[type=submit]'),
      () => supabase.auth.signInWithPassword({ email, password: password.value }), 'Signing in…')
    if (signInError) {
      $('#demo-captcha').checked = false
      if (/invalid login credentials/i.test(signInError.message)) {
        error.textContent = 'Invalid username or password.'
        return
      }
      const described = describeError(signInError)
      error.textContent = described.message
      diagnosticSlot.innerHTML = diagnosticLine(described.diagnostic)
      return
    }
    const { data } = await supabase.auth.getSession()
    session.auth = data.session
    showVerification({ app, query, onVerified })
  })
}

async function showVerification({ app, query, onVerified }) {
  const { data: info, error } = await supabase.rpc('mp_begin_verification', { p_resend: false })
  if (error) {
    await supabase.auth.signOut({ scope: 'local' })
    clearSession()
    const described = describeError(error)
    return showCredentials({ app, query, onVerified }, described.message, described.diagnostic)
  }
  if (info.verified) {
    await loadStatus()
    return onVerified(query.get('next'))
  }
  app.innerHTML = verificationStage(info)
  const form = $('#verify-form')
  const message = $('#verify-error')
  $('#open-mailbox').addEventListener('click', showMailbox)
  $('#cancel-sign-in').addEventListener('click', async () => {
    await supabase.auth.signOut({ scope: 'local' })
    clearSession()
    showCredentials({ app, query, onVerified })
  })
  $('#resend').addEventListener('click', async (event) => {
    const { error: resendError } = await busy(event.currentTarget, () => supabase.rpc('mp_begin_verification', { p_resend: true }), 'Sending…')
    if (resendError) { message.textContent = describeError(resendError).message; return }
    message.textContent = ''
    form.reset()
    toast('A new test code was delivered to the demo test mailbox. No e-mail was sent.')
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const code = form.elements.code.value.trim()
    if (!/^\d{6}$/.test(code)) { message.textContent = 'Enter the 6-digit verification code.'; return }
    const { data, error: verifyError } = await busy(form.querySelector('[type=submit]'),
      () => supabase.rpc('mp_verify_login_code', { p_code: code }), 'Verifying…')
    if (verifyError) { message.textContent = describeError(verifyError).message; return }
    if (!data.verified) {
      message.textContent = data.attempts_remaining !== undefined && data.reason === 'incorrect'
        ? `${data.message} ${data.attempts_remaining} attempt${data.attempts_remaining === 1 ? '' : 's'} remaining.`
        : data.message
      form.elements.code.select()
      return
    }
    await loadStatus()
    onVerified(query.get('next'))
  })
}
