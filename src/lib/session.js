import { supabase } from './supabase.js'

const ORG_KEY = 'mp-demo-current-org'

export const session = { auth: null, status: null, orgId: null }

export const ROLE_LABELS = {
  admin: 'IPA Administrator',
  reviewer: 'Utilization Reviewer',
  provider_staff: 'Provider Office Staff',
  read_only: 'Read-only',
}

// UI affordances only. Supabase RLS and RPC checks are the enforcement boundary.
const CAPABILITIES = {
  createRequest: ['admin', 'provider_staff'],
  decide: ['admin', 'reviewer'],
  cancelRequest: ['admin', 'provider_staff'],
  upload: ['admin', 'reviewer', 'provider_staff'],
  writeNote: ['admin', 'reviewer', 'provider_staff'],
  hospitalAdmin: ['admin'],
  adminDelete: ['admin'],
}

export async function loadStatus() {
  const { data, error } = await supabase.rpc('mp_session_status')
  if (error) throw error
  session.status = data
  const memberships = data?.memberships || []
  const saved = localStorage.getItem(ORG_KEY)
  session.orgId = memberships.find((m) => m.org_id === saved)?.org_id || memberships[0]?.org_id || null
  return data
}

export function clearSession() {
  session.auth = null
  session.status = null
  session.orgId = null
}

export function setOrg(orgId) {
  localStorage.setItem(ORG_KEY, orgId)
  session.orgId = orgId
}

export const memberships = () => session.status?.memberships || []
export const currentMembership = () => memberships().find((m) => m.org_id === session.orgId)
export const role = () => currentMembership()?.role
export const can = (capability) => CAPABILITIES[capability]?.includes(role()) ?? false
export const isVerified = () => Boolean(session.auth && session.status?.verified)
export const userId = () => session.auth?.user?.id
