// Backend start-up and fetch diagnostics, exercised through the real supabase-js client so the
// diagnostic survives auth-js / postgrest-js error wrapping exactly as in the browser.
import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { createBackend, diagnosticSummary, operationFor } from '../../src/lib/backend.js'
import { describeError } from '../../src/lib/errors.js'

const URL_ = 'https://demo-ref.supabase.co'
const KEY = 'sb_publishable_unit-test-key-000000000000'
const PASSWORD = 'unit-test-password-1234'
const PAGE_CSP = "default-src 'self'; connect-src 'self' https://demo-ref.supabase.co"
const WORKER_CSP = 'connect-src https://pages.example:* wss://pages.example:*'

let logged
beforeEach((t) => {
  logged = []
  for (const level of ['info', 'warn', 'error', 'log']) t.mock.method(console, level, (...args) => logged.push(args.join(' ')))
})

/** A document whose page CSP is PAGE_CSP and that can report violations the way Chrome does (queued). */
function fakeDocument() {
  const doc = new EventTarget()
  doc.querySelector = () => ({ content: PAGE_CSP })
  doc.violate = (blockedURI, originalPolicy) => setTimeout(() => {
    doc.dispatchEvent(Object.assign(new Event('securitypolicyviolation'), { blockedURI, originalPolicy, disposition: 'enforce' }))
  }, 0)
  return doc
}

/** A backend whose network is `behave(url, init)`; returns the real supabase-js client. */
function backendWith(behave, { document = fakeDocument(), navigator = { onLine: true }, timeoutMs } = {}) {
  const { client, error } = createBackend({
    url: URL_, key: KEY, createClient, document, navigator, timeoutMs,
    options: { auth: { persistSession: false, autoRefreshToken: false } },
    fetch: async (input, init) => behave(String(input), init ?? {}, document),
  })
  assert.equal(error, null)
  return client
}

const signIn = (client) => client.auth.signInWithPassword({ email: 'demo.viewer@example.invalid', password: PASSWORD })

/** A request that never answers until its signal aborts, as fetch behaves. */
const hang = (init) => new Promise((resolve, reject) => {
  const fail = () => reject(new DOMException('aborted', 'AbortError'))
  if (init.signal.aborted) fail()
  else init.signal.addEventListener('abort', fail)
})

describe('start-up', () => {
  test('missing, invalid, and production config fail with a deterministic code and no client', () => {
    const cases = [
      [{ url: '', key: KEY }, 'DEMO_BACKEND_CONFIG_MISSING'],
      [{ url: URL_, key: '  \r\n' }, 'DEMO_BACKEND_CONFIG_MISSING'],
      [{ url: 'not a url', key: KEY }, 'DEMO_BACKEND_CONFIG_INVALID'],
      [{ url: 'javascript:alert(1)', key: KEY }, 'DEMO_BACKEND_CONFIG_INVALID'],
      [{ url: 'https://portal.medpointmanagement.com', key: KEY }, 'DEMO_BACKEND_CONFIG_REFUSED'],
    ]
    for (const [config, code] of cases) {
      let created = false
      const { client, error } = createBackend({ ...config, createClient: () => { created = true } })
      assert.equal(client, null)
      assert.equal(error.code, code, JSON.stringify(config.url))
      assert.equal(created, false)
    }
  })

  test('a client that throws while starting is reported as init failed without the key', () => {
    const { client, error } = createBackend({ url: URL_, key: KEY, createClient: () => { throw new Error(`bad key ${KEY}`) } })
    assert.equal(client, null)
    assert.equal(error.code, 'DEMO_BACKEND_INIT_FAILED')
    assert.equal(error.host, 'demo-ref.supabase.co')
    assert.ok(!logged.join('\n').includes(KEY))
  })

  test('a CI variable pasted with a trailing CRLF is trimmed before the client sees it', async () => {
    const seen = []
    const { error } = createBackend({ url: ` ${URL_}\n`, key: `${KEY}\r\n`, createClient: (url, key) => seen.push([url, key]) })
    assert.equal(error, null)
    assert.deepEqual(seen, [[URL_, KEY]])
    assert.match(logged.join('\n'), /\[demo-backend\] init ok host=demo-ref\.supabase\.co/)
  })
})

describe('operation names', () => {
  test('name the endpoint, never identifiers, filters, tokens, or file names', () => {
    assert.equal(operationFor(`${URL_}/auth/v1/token?grant_type=password`, 'POST'), 'auth.token:password')
    assert.equal(operationFor(`${URL_}/auth/v1/token?grant_type=refresh_token&refresh_token=abc`, 'POST'), 'auth.token:refresh_token')
    assert.equal(operationFor(`${URL_}/rest/v1/rpc/mp_begin_verification`, 'POST'), 'rpc.mp_begin_verification')
    assert.equal(operationFor(`${URL_}/rest/v1/mp_members?member_number=eq.DEMO-M-1&apikey=secret`, 'GET'), 'rest.mp_members')
    assert.equal(operationFor(`${URL_}/storage/v1/object/mp-demo-documents/org/file name.pdf`, 'POST'), 'storage.object.post')
    assert.equal(operationFor(`${URL_}/rest/v1/rpc/drop table;--`, 'POST'), 'rpc._')
  })
})

describe('a failed backend request is categorized through supabase-js', () => {
  test('blocked by a policy a browser or automation layer added (the PGA worker case)', async () => {
    const client = backendWith((url, init, doc) => {
      doc.violate(url, WORKER_CSP)
      throw new TypeError('Failed to fetch')
    })
    const { error } = await signIn(client)
    const described = describeError(error)
    assert.equal(described.kind, 'network')
    assert.equal(described.diagnostic.code, 'DEMO_BACKEND_NETWORK_BLOCKED')
    assert.equal(described.diagnostic.source, 'browser-policy')
    assert.equal(described.diagnostic.operation, 'auth.token:password')
    assert.equal(described.message, 'This browser blocked the connection to the demo database. (DEMO_BACKEND_NETWORK_BLOCKED)')
    assert.equal(diagnosticSummary(described.diagnostic),
      'DEMO BACKEND ERROR · network blocked by a browser/automation policy · auth.token:password → demo-ref.supabase.co')
  })

  test("blocked by the page's own CSP (a deployment whose CSP omits the backend)", async () => {
    const client = backendWith((url, init, doc) => {
      doc.violate(url, PAGE_CSP)
      throw new TypeError('Failed to fetch')
    })
    const { error } = await client.rpc('mp_session_status')
    const described = describeError(error)
    assert.equal(described.diagnostic.code, 'DEMO_BACKEND_NETWORK_BLOCKED')
    assert.equal(described.diagnostic.source, 'page-csp')
    assert.equal(described.diagnostic.operation, 'rpc.mp_session_status')
  })

  test('CORS rejected when a no-cors probe reaches the backend, unreachable when it does not', async () => {
    const cors = backendWith((url, init) => {
      if (init.mode === 'no-cors') return new Response(null, { status: 200 })
      throw new TypeError('Failed to fetch')
    })
    assert.equal(describeError((await signIn(cors)).error).diagnostic.code, 'DEMO_BACKEND_CORS_REJECTED')

    const down = backendWith(() => { throw new TypeError('Failed to fetch') })
    assert.equal(describeError((await signIn(down)).error).diagnostic.code, 'DEMO_BACKEND_UNREACHABLE')

    const offline = backendWith(() => { throw new TypeError('Failed to fetch') }, { navigator: { onLine: false } })
    assert.equal(describeError((await signIn(offline)).error).diagnostic.code, 'DEMO_BACKEND_OFFLINE')
  })

  test('a request that never answers times out as an abort, so PostgREST does not retry it', async () => {
    let calls = 0
    const client = backendWith((url, init) => { calls += 1; return hang(init) }, { timeoutMs: 20 })
    const { error } = await client.from('mp_members').select('id')
    assert.equal(describeError(error).diagnostic.code, 'DEMO_BACKEND_TIMEOUT')
    assert.equal(calls, 1)
  })

  test("the caller's own abort of an in-flight request passes through undiagnosed", async () => {
    let started
    const inFlight = new Promise((resolve) => { started = resolve })
    const client = backendWith((url, init) => { started(); return hang(init) })
    const controller = new AbortController()
    const pending = client.from('mp_members').select('id').abortSignal(controller.signal).then((result) => result)
    await inFlight
    controller.abort()
    const { error } = await pending
    assert.doesNotMatch(error.message, /DEMO_BACKEND_/)
    assert.ok(!logged.some((line) => line.includes('[demo-backend] DEMO_BACKEND_')))
  })

  test('a 401 answer is returned to the caller and logged as unauthorized', async () => {
    const client = backendWith(() => new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401, headers: { 'content-type': 'application/json' } }))
    const { error } = await client.rpc('mp_session_status')
    assert.equal(error.message, 'Invalid API key')
    assert.match(logged.join('\n'), /DEMO_BACKEND_UNAUTHORIZED .*op=rpc\.mp_session_status status=401/)
    const auth = await signIn(client)
    assert.equal(describeError(auth.error).message, "The demo database rejected this build's public key. (DEMO_BACKEND_UNAUTHORIZED)")
  })
})

test('no key, token, or password reaches a diagnostic, its log line, or the UI text', async () => {
  const token = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.c2lnbmF0dXJl'
  const client = backendWith((url, init, doc) => {
    doc.violate(`${url}&access_token=${token}`, WORKER_CSP)
    throw new TypeError(`Failed to fetch ${url} with ${JSON.stringify(init.headers)}`)
  })
  const { error } = await signIn(client)
  const described = describeError(error)
  const surfaced = [described.message, diagnosticSummary(described.diagnostic), JSON.stringify(described.diagnostic), ...logged].join('\n')
  for (const secret of [KEY, PASSWORD, token, 'Bearer']) assert.ok(!surfaced.includes(secret), `leaked ${secret.slice(0, 12)}…`)
})
