#!/usr/bin/env node
// Visual comparison between the supplied static mock and this Supabase-backed app.
//
//   MOCK_DIR="/path/to/MedPoint Local Mock" npm run test:visual
//
// Serves the mock on 127.0.0.1 (loopback only; safety-extension/ is never served),
// builds + previews the app against the local Supabase stack, signs in with a demo
// account, captures each observed page at the observed 1126px desktop width, and
// writes mock | app | diff composites plus mismatch ratios to visual-comparison/.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { chromium } from '@playwright/test'
import { localViteEnv } from './lib/local-supabase.mjs'

const MOCK_DIR = process.env.MOCK_DIR || join(homedir(), 'Desktop', 'MedPoint Local Mock')
const OUT = 'visual-comparison'
const VIEWPORT = { width: 1126, height: 800 }
const APP_PORT = 4195 // note: 4190 is a Fetch-spec blocked port
const APP_URL = process.env.APP_URL || `http://localhost:${APP_PORT}/browser-agent-demo/`

// [name, mock hash, app hash, optional interaction applied to both]
const PAGES = [
  ['home', '/', '/'],
  ['sign-in', '/sign-in', '/sign-in'],
  ['authorization-search', '/authorizations/search', '/authorizations/search'],
  ['authorization-more-options', '/authorizations/search', '/authorizations/search', (page) => page.click('#more')],
  ['claims-search', '/claims/search', '/claims/search'],
  ['members-search', '/members/search', '/members/search'],
  ['providers-search', '/providers/search', '/providers/search'],
  ['reference-search', '/references', '/references'],
  ['documents-search', '/documents/search', '/documents/search'],
  ['forms-and-manuals', '/forms', '/forms'],
]

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff': 'font/woff' }

function serveMock() {
  if (!existsSync(join(MOCK_DIR, 'index.html'))) throw new Error(`Mock not found at ${MOCK_DIR}. Set MOCK_DIR.`)
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = join(MOCK_DIR, path === '/' ? 'index.html' : path)
    if (!file.startsWith(MOCK_DIR) || file.includes('safety-extension') || !existsSync(file)) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(readFileSync(file))
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

async function startApp() {
  if (process.env.APP_URL) return null
  const child = spawn('sh', ['-c', `npx vite build && npx vite preview --port ${APP_PORT} --strictPort`], {
    env: { ...process.env, ...localViteEnv() }, stdio: 'ignore',
  })
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(APP_URL)).ok) return child } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  child.kill()
  throw new Error('app preview did not start')
}

async function signIn(page) {
  await page.goto(`${APP_URL}#/sign-in`)
  await page.getByTestId('fill-demo').click()
  await page.getByTestId('captcha-checkbox').check()
  await page.getByTestId('sign-in').click()
  await page.getByTestId('open-mailbox').click()
  const body = await page.locator('[data-latest="true"] [data-testid="mailbox-body"]').textContent()
  await page.locator('#modal [data-close]').click()
  await page.locator('#verify-code').fill(body.match(/\b(\d{6})\b/)[1])
  await page.getByTestId('verify-submit').click()
  await page.locator('nav.primary').waitFor()
}

async function capture(page, url, interact) {
  await page.goto(url)
  await page.waitForLoadState('networkidle')
  if (interact) await interact(page)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300) // let the floating-label transitions settle
  return page.screenshot()
}

async function compose(page, name, mock, app) {
  await page.setViewportSize({ width: VIEWPORT.width * 3 + 40, height: VIEWPORT.height + 60 })
  await page.setContent(`<body style="margin:0;font:14px sans-serif;background:#fff">
    <div style="display:flex;gap:20px;padding:0 0 4px"><b style="width:${VIEWPORT.width}px">Mock (supplied)</b><b style="width:${VIEWPORT.width}px">App (Supabase-backed)</b><b>Pixel difference</b></div>
    <div style="display:flex;gap:20px"><img id="a" src="data:image/png;base64,${mock.toString('base64')}"><img id="b" src="data:image/png;base64,${app.toString('base64')}"><canvas id="d"></canvas></div></body>`)
  const ratio = await page.evaluate(async () => {
    const [a, b] = [document.getElementById('a'), document.getElementById('b')]
    await Promise.all([a, b].map((img) => img.decode()))
    const w = Math.min(a.naturalWidth, b.naturalWidth)
    const h = Math.min(a.naturalHeight, b.naturalHeight)
    const read = (img) => { const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data }
    const [pa, pb] = [read(a), read(b)]
    const canvas = document.getElementById('d')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    const out = ctx.createImageData(w, h)
    let diff = 0
    for (let i = 0; i < pa.length; i += 4) {
      const delta = Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2])
      const changed = delta > 48
      if (changed) diff += 1
      out.data[i] = changed ? 220 : pa[i] * 0.3 + 178
      out.data[i + 1] = changed ? 30 : pa[i + 1] * 0.3 + 178
      out.data[i + 2] = changed ? 30 : pa[i + 2] * 0.3 + 178
      out.data[i + 3] = 255
    }
    ctx.putImageData(out, 0, 0)
    return diff / (w * h)
  })
  writeFileSync(join(OUT, `${name}.png`), await page.screenshot({ fullPage: true }))
  return ratio
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const server = await serveMock()
  const mockUrl = `http://127.0.0.1:${server.address().port}/`
  const preview = await startApp()
  const browser = await chromium.launch()
  const results = []
  try {
    const mockPage = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
    // Block anything that is not the loopback mock server, as an extra isolation guard.
    await mockPage.route('**/*', (route) => (route.request().url().startsWith(mockUrl) ? route.continue() : route.abort()))
    const anonPage = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
    const appPage = await (await browser.newContext({ viewport: VIEWPORT })).newPage()
    await signIn(appPage)
    const composer = await (await browser.newContext()).newPage()
    for (const [name, mockHash, appHash, interact] of PAGES) {
      const mock = await capture(mockPage, `${mockUrl}#${mockHash}`, interact)
      const app = await capture(name === 'sign-in' ? anonPage : appPage, `${APP_URL}#${appHash}`, interact)
      const ratio = await compose(composer, name, mock, app)
      results.push({ page: name, mismatch: `${(ratio * 100).toFixed(1)}%`, file: `${OUT}/${name}.png` })
    }
  } finally {
    await browser.close()
    server.close()
    preview?.kill()
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 2))
  console.table(results)
}

main().catch((error) => { console.error(error); process.exit(1) })
