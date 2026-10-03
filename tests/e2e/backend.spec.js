import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { localSupabaseEnv } from '../../scripts/lib/local-supabase.mjs'
import { app, readCodeFromMailbox } from './support/ui.js'

// Runs against the local preview (playwright.config.js) and against the deployed GitHub Pages build
// (playwright.hosted.config.js, Google Chrome, clean profile). Hosted runs sign in only as the
// read-only demo.viewer and end each session locally.

const metadata = () => test.info().config.metadata ?? {}
const backendOrigin = () => new URL(metadata().backendUrl ?? localSupabaseEnv().API_URL).origin
const pageOrigin = (page) => new URL(page.url()).origin

/** Fill demo.viewer with the page's own demo helper (its password matches the deployment's seed), tick the CAPTCHA, sign in. */
async function signInAsViewer(page) {
  await page.getByTestId('demo-account').selectOption('demo.viewer')
  await page.getByTestId('fill-demo').click()
  const password = await page.getByTestId('password').inputValue()
  await page.getByTestId('captcha-checkbox').check()
  await page.getByTestId('sign-in').click()
  return password
}

/** What the PGA worker's network guard adds to every document it serves: connect-src held to its session hosts. */
async function narrowConnectSrcLikeTheWorker(page, hosts) {
  const policy = `connect-src ${hosts.flatMap((host) => ['http', 'https', 'ws', 'wss'].map((scheme) => `${scheme}://${host}:*`)).join(' ')}`
  await page.route(() => true, async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback()
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } })
  })
}

function connectSources(policy) {
  const directive = policy.split(';').map((part) => part.trim()).find((part) => part.startsWith('connect-src '))
  return directive.split(/\s+/).slice(1)
}

test.describe('demo backend reachability', () => {
  test('the page CSP lets it connect only to itself and the configured backend', async ({ page }) => {
    await app(page, '/sign-in')
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
    expect(connectSources(policy)).toEqual(["'self'", backendOrigin()])
  })

  test('a clean profile signs in past the CAPTCHA, contacting only the page origin and the backend', async ({ page }) => {
    const origins = new Set()
    const problems = []
    page.on('request', (request) => { if (/^https?:/.test(request.url())) origins.add(new URL(request.url()).origin) })
    page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text()) })
    const ready = page.waitForEvent('console', (message) => message.text().startsWith('[demo-backend] init ok'))
    await app(page, '/sign-in')
    expect((await ready).text()).toBe(`[demo-backend] init ok host=${new URL(backendOrigin()).host}`)

    const token = page.waitForResponse((response) => response.url().startsWith(`${backendOrigin()}/auth/v1/token`) && response.request().method() === 'POST')
    await signInAsViewer(page)
    expect((await token).status()).toBe(200)
    await expect(page.getByTestId('verification-message')).toBeVisible()
    await page.getByTestId('cancel-sign-in').click()
    await expect(page.getByTestId('login-card')).toBeVisible()

    expect([...origins].sort()).toEqual([pageOrigin(page), backendOrigin()].sort())
    expect(problems).toEqual([])
  })

  test('a browser policy that omits the backend host gives a deterministic, secret-free diagnostic', async ({ page, baseURL }) => {
    const lines = []
    page.on('console', (message) => lines.push(message.text()))
    await narrowConnectSrcLikeTheWorker(page, [new URL(baseURL).host])
    await app(page, '/sign-in')
    const password = await signInAsViewer(page)

    await expect(page.getByTestId('login-error')).toHaveText('This browser blocked the connection to the demo database. (DEMO_BACKEND_NETWORK_BLOCKED)')
    const diagnostic = page.getByTestId('backend-diagnostic')
    await expect(diagnostic).toHaveAttribute('data-code', 'DEMO_BACKEND_NETWORK_BLOCKED')
    await expect(diagnostic).toHaveText(`DEMO BACKEND ERROR · network blocked by a browser/automation policy · auth.token:password → ${new URL(backendOrigin()).host}`)
    expect(lines).toContainEqual(expect.stringMatching(/^\[demo-backend\] DEMO_BACKEND_NETWORK_BLOCKED category=network_blocked .*op=auth\.token:password status=0 blocked-by=browser-policy$/))

    const surfaced = [...lines, await page.locator('#app').innerText()].join('\n')
    expect(surfaced).not.toContain(password)
    expect(surfaced).not.toMatch(/sb_publishable_|sb_secret_|eyJ[\w-]{10,}\.|Bearer|apikey/i)
  })

  test('a backend blocked below the page (proxy, extension, host filter) is reported unreachable, not as a CSP block', async ({ page }) => {
    await page.route((url) => url.origin === backendOrigin(), (route) => route.abort('blockedbyclient'))
    await app(page, '/sign-in')
    await signInAsViewer(page)
    await expect(page.getByTestId('login-error')).toHaveText('Cannot reach the demo database. Check your connection and try again. (DEMO_BACKEND_UNREACHABLE)')
    await expect(page.getByTestId('backend-diagnostic')).toHaveAttribute('data-code', 'DEMO_BACKEND_UNREACHABLE')
  })

  test('a stale stored session and IPA from an old profile fall back to sign-in, and signing in works', async ({ page }) => {
    const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const expired = 1_700_000_000
    const user = { id: '00000000-0000-4000-a000-00000000dead', aud: 'authenticated', role: 'authenticated', email: 'demo.viewer@example.invalid' }
    const stale = JSON.stringify({
      access_token: `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: user.id, role: 'authenticated', exp: expired })}.c3RhbGU`,
      token_type: 'bearer', expires_in: 3600, expires_at: expired, refresh_token: 'stale-refresh-token', user,
    })
    await page.addInitScript((value) => {
      if (sessionStorage.getItem('stale-seeded')) return
      localStorage.setItem('mp-demo-auth', value)
      localStorage.setItem('mp-demo-current-org', '0a000000-0000-4000-a000-0000000000ff')
      sessionStorage.setItem('stale-seeded', '1')
    }, stale)

    await app(page, '/')
    await expect(page.getByTestId('login-card')).toBeVisible()
    await signInAsViewer(page)
    await expect(page.getByTestId('verification-message')).toBeVisible()
    await page.locator('#verify-code').fill(await readCodeFromMailbox(page))
    await page.getByTestId('verify-submit').click()
    await expect(page.locator('nav.primary')).toBeVisible()
    await expect(page.getByTestId('ipa-select')).not.toHaveValue('0a000000-0000-4000-a000-0000000000ff')
    await page.getByTestId('logout-button').click()
    await expect(page.getByTestId('login-card')).toBeVisible()
  })

  test('every host the deployed page may contact is documented', async ({ page }) => {
    test.skip(!metadata().hosted, 'documents the hosted deployment only')
    await app(page, '/sign-in')
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
    const hosts = [new URL(page.url()).host, ...connectSources(policy).filter((source) => source !== "'self'").map((source) => new URL(source).host)]
    const readme = readFileSync('README.md', 'utf8')
    const section = readme.slice(readme.indexOf('## External hosts'), readme.indexOf('\n## ', readme.indexOf('## External hosts') + 1))
    const documented = [...section.matchAll(/^\| `([a-z0-9.-]+)` \|/gm)].map((match) => match[1])
    expect(documented.sort()).toEqual(hosts.sort())
  })
})
