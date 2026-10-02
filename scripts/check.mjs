#!/usr/bin/env node
// Static checks: JS syntax, safety guards, and a production build.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const failures = []
const SKIP = new Set(['node_modules', '.git', 'dist', 'test-results', 'playwright-report', 'visual-comparison'])
const walk = (dir) => readdirSync(dir).filter((name) => !SKIP.has(name) && !name.startsWith('dist-e2e-')).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : [path]
})

const sources = [...walk('src'), ...walk('scripts'), ...walk('tests')].filter((file) => /\.(m?js)$/.test(file))
for (const file of sources) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    failures.push(`${file}: syntax error\n${error.stderr}`)
  }
}

// The browser bundle must never reference the production portal or privileged keys.
for (const file of walk('src').filter((f) => /\.(js|css|html)$/.test(f)).concat('index.html')) {
  const text = readFileSync(file, 'utf8')
  if (/medpointmanagement\.com/i.test(text) && !file.endsWith('supabase.js')) failures.push(`${file}: references the production portal domain`)
  if (/service_role|SERVICE_ROLE|sb_secret_/i.test(text)) failures.push(`${file}: references a privileged Supabase key`)
}

// The observation-only safety extension from the mock must not ship.
if (walk('.').some((f) => f.includes('safety-extension'))) {
  failures.push('safety-extension/ must not be part of this repository')
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`check: ${sources.length} JS files parsed; safety guards passed`)
execFileSync('npx', ['vite', 'build'], {
  stdio: 'inherit',
  env: { VITE_SUPABASE_URL: 'https://example-ref.supabase.co', VITE_SUPABASE_ANON_KEY: 'public-anon-key-placeholder', ...process.env },
})
