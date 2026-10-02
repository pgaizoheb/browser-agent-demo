import { createClient } from '@supabase/supabase-js'
import { config } from '../config.js'

const productionPortal = /medpointmanagement/i.test(config.supabaseUrl)

export const configError = !config.supabaseUrl || !config.supabaseKey
  ? 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the demo Supabase project.'
  : productionPortal
    ? 'Refusing to start: the configured backend looks like the production portal.'
    : ''

export const supabase = configError
  ? null
  : createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'mp-demo-auth' },
    })

/** Unwraps a Supabase response, throwing its error so callers can use try/catch. */
export async function unwrap(promise) {
  const { data, error, count } = await promise
  if (error) throw error
  return count === undefined || count === null ? data : { data, count }
}
