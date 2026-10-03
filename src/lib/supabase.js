import { createClient } from '@supabase/supabase-js'
import { config } from '../config.js'
import { createBackend } from './backend.js'

const backend = createBackend({
  url: config.supabaseUrl,
  key: config.supabaseKey,
  createClient,
  options: { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'mp-demo-auth' } },
})

/** A diagnostic when the backend cannot start (config missing/invalid/refused, init failed); otherwise null. */
export const configError = backend.error
export const supabase = backend.client

/** Unwraps a Supabase response, throwing its error so callers can use try/catch. */
export async function unwrap(promise) {
  const { data, error, count } = await promise
  if (error) throw error
  return count === undefined || count === null ? data : { data, count }
}
