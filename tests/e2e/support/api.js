// Node-side Supabase helpers for e2e setup. They act exactly like a browser user:
// anon key + password sign-in + test-mode verification code from the demo mailbox.
// No service-role key is used here.
import { createClient } from '@supabase/supabase-js'
import { localSupabaseEnv } from '../../../scripts/lib/local-supabase.mjs'

export const DEMO_PASSWORD = process.env.MP_DEMO_PASSWORD || 'MedPointDemo!2026'
export const ORG_MAIN = '0a000000-0000-4000-a000-000000000001'
export const ORG_OTHER = '0a000000-0000-4000-a000-000000000002'
export const ORG_LARGE = '0a000000-0000-4000-a000-000000000003'
export const ORG_EMPTY = '0a000000-0000-4000-a000-000000000004'

let env
function connection() {
  env ??= localSupabaseEnv()
  return { url: env.API_URL, key: env.ANON_KEY }
}

/** Returns a verified Supabase client for a demo username (e.g. "demo.user"). */
export async function apiAs(username) {
  const { url, key } = connection()
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInWithPassword({ email: `${username}@example.invalid`, password: DEMO_PASSWORD })
  if (error) throw error
  await must(client.rpc('mp_begin_verification', { p_resend: false }))
  const [message] = await must(client.from('mp_demo_outbox').select('body').order('id', { ascending: false }).limit(1))
  const code = message.body.match(/\b(\d{6})\b/)[1]
  const result = await must(client.rpc('mp_verify_login_code', { p_code: code }))
  if (!result.verified) throw new Error(`verification failed for ${username}`)
  return client
}

export async function must(promise) {
  const { data, error } = await promise
  if (error) throw new Error(`${error.code || ''} ${error.message}`)
  return data
}

let lookups
async function requestDefaults(client) {
  lookups ??= Promise.all([
    must(client.from('mp_members').select('id, member_number').eq('org_id', ORG_MAIN).eq('eligibility_status', 'eligible').order('member_number').limit(40)),
    must(client.from('mp_providers').select('id').eq('org_id', ORG_MAIN).order('npi').limit(5)),
  ])
  const [members, providers] = await lookups
  return { members, providers }
}

/**
 * Creates a fresh synthetic authorization in the main demo IPA as `client`
 * (default demo.user). status: 'draft' | 'requested'. Returns the row.
 */
export async function createAuthorization(client, { submit = true, units = 4, summary, memberIndex = 0 } = {}) {
  const { members, providers } = await requestDefaults(client)
  const member = members[memberIndex % members.length]
  return must(client.rpc('mp_save_authorization', {
    p_org_id: ORG_MAIN,
    p_submit: submit,
    p_data: {
      member_id: member.id,
      requested_provider_id: providers[0].id,
      referring_provider_id: providers[1].id,
      service_code: 'DEMO-S1003',
      diagnosis_code: 'DEMO-D2001',
      place_of_service: 'DEMO-P11',
      units,
      priority: 'routine',
      clinical_summary: summary || 'Synthetic e2e clinical summary with enough detail to submit for review.',
    },
  }))
}

export async function transition(client, id, toStatus, reason = '', approvedUnits = null) {
  return must(client.rpc('mp_transition_authorization', { p_id: id, p_to_status: toStatus, p_reason: reason, p_approved_units: approvedUnits }))
}
