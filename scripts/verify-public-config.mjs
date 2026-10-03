#!/usr/bin/env node
// Deploy guard for the public browser configuration baked into the GitHub Pages build.
// Prints only the backend host and the key's kind; never the key.
const failures = []
const url = process.env.VITE_SUPABASE_URL || ''
const key = process.env.VITE_SUPABASE_ANON_KEY || ''

let host = ''
try {
  const parsed = new URL(url.trim())
  host = parsed.host
  if (parsed.protocol !== 'https:') failures.push('VITE_SUPABASE_URL must use https.')
  if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$|\.local$/i.test(parsed.hostname)) failures.push('VITE_SUPABASE_URL points at a local-only host.')
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) failures.push('VITE_SUPABASE_URL must be the project origin only.')
  if (/medpointmanagement/i.test(parsed.hostname)) failures.push('VITE_SUPABASE_URL points at the production portal.')
} catch {
  failures.push('VITE_SUPABASE_URL is missing or not a URL.')
}

const trimmed = key.trim()
let kind = 'missing'
if (!trimmed) failures.push('VITE_SUPABASE_ANON_KEY is missing.')
else if (/^sb_secret_/.test(trimmed)) failures.push('VITE_SUPABASE_ANON_KEY is a secret key; only the publishable/anon key may ship to the browser.')
else if (/^sb_publishable_/.test(trimmed)) kind = 'publishable'
else {
  try {
    const role = JSON.parse(Buffer.from(trimmed.split('.')[1], 'base64url').toString()).role
    if (role !== 'anon') failures.push(`VITE_SUPABASE_ANON_KEY is a "${role}" JWT; only the anon key may ship to the browser.`)
    kind = 'anon JWT'
  } catch {
    failures.push('VITE_SUPABASE_ANON_KEY is neither a publishable key nor a JWT.')
  }
}
// The app trims both values, so stray whitespace is only reported.
if (key !== trimmed || url !== url.trim()) console.warn('warning: a public Supabase variable has surrounding whitespace (often a pasted newline); the app trims it.')

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`public config: backend host ${host}, ${kind} key`)
