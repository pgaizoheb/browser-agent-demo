// Demo backend (Supabase) start-up and sanitized diagnostics.
//
// A diagnostic carries only the backend host, an operation name derived from the request path,
// the HTTP status, and an error category. Never headers, bodies, query values (other than the
// fixed auth grant type), keys, tokens, or passwords.

const PREFIX = '[demo-backend]'
const KEPT = 20
const PROBE_TIMEOUT_MS = 5_000
const PROBE_REUSE_MS = 5_000
export const REQUEST_TIMEOUT_MS = 30_000

const CATEGORIES = {
  network_blocked: { code: 'DEMO_BACKEND_NETWORK_BLOCKED', label: 'network blocked', message: 'This browser blocked the connection to the demo database.' },
  cors_rejected: { code: 'DEMO_BACKEND_CORS_REJECTED', label: 'CORS rejected', message: "The demo database refused requests from this page's origin." },
  offline: { code: 'DEMO_BACKEND_OFFLINE', label: 'browser offline', message: 'This browser is offline. Check your connection and try again.' },
  unreachable: { code: 'DEMO_BACKEND_UNREACHABLE', label: 'DNS/unreachable', message: 'Cannot reach the demo database. Check your connection and try again.' },
  timeout: { code: 'DEMO_BACKEND_TIMEOUT', label: 'timeout', message: 'The demo database did not answer in time. Try again.' },
  unauthorized: { code: 'DEMO_BACKEND_UNAUTHORIZED', label: 'unauthorized', message: "The demo database rejected this build's public key." },
  config_missing: { code: 'DEMO_BACKEND_CONFIG_MISSING', label: 'config missing', message: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the demo Supabase project.' },
  config_invalid: { code: 'DEMO_BACKEND_CONFIG_INVALID', label: 'config invalid', message: 'VITE_SUPABASE_URL is not a valid http(s) URL.' },
  config_refused: { code: 'DEMO_BACKEND_CONFIG_REFUSED', label: 'config refused', message: 'Refusing to start: the configured backend looks like the production portal.' },
  init_failed: { code: 'DEMO_BACKEND_INIT_FAILED', label: 'Supabase initialization failed', message: 'The demo database client could not start.' },
}
const SOURCES = { 'page-csp': "this page's CSP", 'browser-policy': 'a browser/automation policy' }
const TAG = /\[(DEMO_BACKEND_[A-Z_]+) #(\d+)\]/
const NAME = /^[A-Za-z0-9_]{1,63}$/

const kept = new Map()
let lastId = 0

/** Records a diagnostic, logs one sanitized console line, and returns it. */
export function recordDiagnostic(category, { host = '', operation = '', status = 0, source = '' } = {}) {
  const diagnostic = { id: ++lastId, category, ...CATEGORIES[category], host, operation, status, source }
  kept.set(diagnostic.id, diagnostic)
  if (kept.size > KEPT) kept.delete(kept.keys().next().value)
  const fields = [`category=${category}`, host && `host=${host}`, operation && `op=${operation}`, `status=${status}`, source && `blocked-by=${source}`]
  console.warn(`${PREFIX} ${diagnostic.code} ${fields.filter(Boolean).join(' ')}`)
  return diagnostic
}

/** The diagnostic a backend failure refers to, from the tag in its (possibly re-wrapped) message. */
export function diagnosticIn(text) {
  const match = TAG.exec(String(text ?? ''))
  if (!match) return null
  const known = kept.get(Number(match[2]))
  if (known) return known
  const category = Object.keys(CATEGORIES).find((name) => CATEGORIES[name].code === match[1])
  return category ? { category, ...CATEGORIES[category], host: '', operation: '', status: 0, source: '' } : null
}

/** One code for any backend failure that was not diagnosed by the client's fetch. */
export const undiagnosed = (category) => ({ category, ...CATEGORIES[category], host: '', operation: '', status: 0, source: '' })

/** User-facing text: simple wording plus the diagnostic code. */
export const userMessage = (diagnostic) => `${diagnostic.message} (${diagnostic.code})`

/** Development-safe one-line summary: category, operation, backend host. */
export function diagnosticSummary(diagnostic) {
  const parts = [`DEMO BACKEND ERROR · ${diagnostic.label}${diagnostic.source ? ` by ${SOURCES[diagnostic.source]}` : ''}`]
  if (diagnostic.operation || diagnostic.host) parts.push([diagnostic.operation, diagnostic.host].filter(Boolean).join(' → '))
  if (diagnostic.status) parts.push(`HTTP ${diagnostic.status}`)
  return parts.join(' · ')
}

/** A stable operation name for a backend request: no identifiers, query values, or secrets. */
export function operationFor(url, method = 'GET') {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return 'unknown'
  }
  const safe = (part) => (NAME.test(part ?? '') ? part : '_')
  const [service, , resource, name] = parsed.pathname.split('/').filter(Boolean)
  if (service === 'auth') {
    const grant = parsed.searchParams.get('grant_type')
    return `auth.${safe(resource)}${grant && NAME.test(grant) ? `:${grant}` : ''}`
  }
  if (service === 'rest') return resource === 'rpc' ? `rpc.${safe(name)}` : `rest.${safe(resource)}`
  if (service === 'storage') return `storage.${safe(resource)}.${/^[A-Z]{1,10}$/i.test(method) ? method.toLowerCase() : '_'}`
  return 'other'
}

const normalizePolicy = (policy) => String(policy ?? '').trim().replace(/\s+/g, ' ').replace(/\s*;\s*/g, ';').replace(/;+$/, '')

function failure(diagnostic) {
  const message = `Failed to fetch [${diagnostic.code} #${diagnostic.id}]`
  // A timeout is an abort to callers: PostgREST must not retry it three more times.
  return diagnostic.category === 'timeout' ? new DOMException(message, 'AbortError') : new TypeError(message)
}

/**
 * A fetch for the Supabase client that turns an opaque "Failed to fetch" into a category:
 * blocked by a Content-Security-Policy (the page's own, or one a browser/automation layer added),
 * offline, CORS rejected (a no-cors probe reaches the backend), unreachable (it does not), or timeout.
 */
function diagnosingFetch({ origin, fetchImpl, doc, nav, timeoutMs }) {
  const host = new URL(origin).host
  let violations = 0
  let lastSource = ''
  let probe = null

  doc?.addEventListener?.('securitypolicyviolation', (event) => {
    if (event.disposition === 'report') return
    let blocked
    try {
      blocked = new URL(event.blockedURI).origin
    } catch {
      return
    }
    if (blocked !== origin) return
    const page = normalizePolicy(doc.querySelector('meta[http-equiv="Content-Security-Policy" i]')?.content)
    lastSource = page && normalizePolicy(event.originalPolicy) === page ? 'page-csp' : 'browser-policy'
    violations += 1
  })

  function reachable() {
    const now = Date.now()
    if (probe && now - probe.at < PROBE_REUSE_MS) return probe.result
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const result = Promise.resolve()
      .then(() => fetchImpl(`${origin}/auth/v1/health`, { mode: 'no-cors', credentials: 'omit', cache: 'no-store', signal: controller.signal }))
      .then(() => true, () => false)
      .finally(() => clearTimeout(timer))
    probe = { at: now, result }
    return result
  }

  async function classify(seen) {
    const reached = await reachable()
    await new Promise((resolve) => setTimeout(resolve, 0)) // violation events are queued as tasks
    if (violations > seen) return { category: 'network_blocked', source: lastSource }
    if (nav?.onLine === false) return { category: 'offline' }
    return { category: reached ? 'cors_rejected' : 'unreachable' }
  }

  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input)
    const operation = operationFor(url, String(init.method || input?.method || 'GET'))
    const seen = violations
    const caller = init.signal
    const controller = new AbortController()
    const forward = () => controller.abort(caller.reason)
    if (caller?.aborted) forward()
    else caller?.addEventListener('abort', forward, { once: true })
    let timedOut = false
    // Uploads (up to 5 MB) may legitimately take longer than one request's budget.
    const limit = /^storage\.object\.(post|put)$/.test(operation) ? 0 : timeoutMs
    const timer = limit ? setTimeout(() => { timedOut = true; controller.abort() }, limit) : undefined
    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal })
      if (response.status === 401) recordDiagnostic('unauthorized', { host, operation, status: 401 })
      return response
    } catch (error) {
      if (caller?.aborted) throw error // cancelled by the caller: not a backend problem
      const { category, source } = timedOut ? { category: 'timeout' } : await classify(seen)
      throw failure(recordDiagnostic(category, { host, operation, source }))
    } finally {
      clearTimeout(timer)
      caller?.removeEventListener('abort', forward)
    }
  }
}

/**
 * Validates the public configuration and creates the Supabase client with a diagnosing fetch.
 * Returns { client, error }; `error` is a diagnostic when the backend cannot start.
 */
export function createBackend({
  url,
  key,
  createClient,
  options = {},
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  document: doc = globalThis.document,
  navigator: nav = globalThis.navigator,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  // Values pasted into CI variables often carry a trailing newline; they are never meaningful.
  url = String(url ?? '').trim()
  key = String(key ?? '').trim()
  if (!url || !key) return { client: null, error: recordDiagnostic('config_missing', { operation: 'init' }) }
  let origin
  try {
    origin = new URL(url).origin
    if (!/^https?:/.test(origin)) throw new TypeError('not an http(s) origin')
  } catch {
    return { client: null, error: recordDiagnostic('config_invalid', { operation: 'init' }) }
  }
  const host = new URL(origin).host
  if (/medpointmanagement/i.test(url)) return { client: null, error: recordDiagnostic('config_refused', { host, operation: 'init' }) }
  const fetch = diagnosingFetch({ origin, fetchImpl, doc, nav, timeoutMs })
  try {
    const client = createClient(url, key, { ...options, global: { ...options.global, fetch } })
    console.info(`${PREFIX} init ok host=${host}`)
    return { client, error: null }
  } catch {
    return { client: null, error: recordDiagnostic('init_failed', { host, operation: 'init' }) }
  }
}
