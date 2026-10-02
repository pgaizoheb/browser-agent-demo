#!/usr/bin/env node
// Runs a command with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY pointed at the local
// Supabase CLI stack, e.g. `node scripts/with-local-env.mjs vite`.
import { spawn } from 'node:child_process'
import { localViteEnv } from './lib/local-supabase.mjs'

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('usage: with-local-env.mjs <command> [...args]')
  process.exit(1)
}
let env
try {
  env = localViteEnv()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' })
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0))
