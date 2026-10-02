import { execFileSync } from 'node:child_process'

/** Reads connection values for the local Supabase CLI stack (never printed). */
export function localSupabaseEnv() {
  let output
  try {
    output = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    throw new Error('local Supabase is not running. Start it with `npm run supabase:start`.')
  }
  return Object.fromEntries(output.split('\n').filter((line) => line.includes('=')).map((line) => {
    const index = line.indexOf('=')
    return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')]
  }))
}

/** Public browser configuration for the local stack. */
export function localViteEnv() {
  const env = localSupabaseEnv()
  return { VITE_SUPABASE_URL: env.API_URL, VITE_SUPABASE_ANON_KEY: env.ANON_KEY }
}
