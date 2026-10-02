import { config } from '../config.js'
import { daysAgo, today } from './format.js'
import { session } from './session.js'
import { supabase, unwrap } from './supabase.js'

export function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Converts a date preset (today/7/30/custom) into an inclusive [from, to] range. */
export function dateRange(preset, from, to) {
  if (preset === 'today') return [today(), today()]
  if (preset === '7') return [daysAgo(7), today()]
  if (preset === '30') return [daysAgo(30), today()]
  if (preset === 'custom') return [from || null, to || null]
  return [null, null]
}

/** Applies filter definitions to a PostgREST query using values from URLSearchParams. */
export function applyFilters(query, filters, params) {
  for (const filter of filters) {
    if (filter.type === 'dateRange') {
      const [from, to] = dateRange(params.get(filter.name), params.get(`${filter.name}_from`), params.get(`${filter.name}_to`))
      if (from) query = query.gte(filter.column, from)
      if (to) query = query.lte(filter.column, to)
      continue
    }
    const value = (params.get(filter.name) || '').trim()
    if (!value) continue
    switch (filter.op) {
      case 'ilike': query = query.ilike(filter.column, `%${escapeLike(value)}%`); break
      case 'ilike-lower': query = query.ilike(filter.column, `%${escapeLike(value.toLowerCase())}%`); break
      case 'gte': query = query.gte(filter.column, value); break
      case 'lte': query = query.lte(filter.column, value); break
      case 'contains': query = query.contains(filter.column, [value]); break
      default: query = query.eq(filter.column, value)
    }
  }
  return query
}

/** Runs a paginated, sorted, counted list query. */
export async function fetchPage({ source, select = '*', filters = [], params, fixed, sort, page, size, orgScoped = true }) {
  let query = supabase.from(source).select(select, { count: 'exact' })
  if (orgScoped) query = query.eq('org_id', session.orgId)
  if (fixed) query = fixed(query)
  query = applyFilters(query, filters, params)
  const [column, direction] = sort.split('.')
  query = query.order(column, { ascending: direction !== 'desc', nullsFirst: false })
  if (column !== 'id') query = query.order('id', { ascending: true })
  query = query.range(page * size, page * size + size - 1)
  const { data, count, error } = await query
  if (error) throw error
  return { rows: data, total: count ?? 0 }
}

const lookupCache = new Map()
async function cached(key, loader) {
  if (!lookupCache.has(key)) lookupCache.set(key, loader().catch((error) => { lookupCache.delete(key); throw error }))
  return lookupCache.get(key)
}
export function clearLookups() { lookupCache.clear() }

export const loadProviders = () => cached(`providers:${session.orgId}`, async () => {
  const rows = await unwrap(supabase.from('mp_providers').select('id, npi, first_name, last_name, specialty')
    .eq('org_id', session.orgId).order('last_name').order('first_name'))
  return rows.map((p) => ({ value: p.id, label: `Dr. ${p.first_name} ${p.last_name} — ${p.specialty}`, npi: p.npi }))
})

export const loadHealthPlans = () => cached('plans', async () => {
  const rows = await unwrap(supabase.from('mp_health_plans').select('code, name').order('sort_order'))
  return rows.map((p) => ({ value: p.code, label: p.name }))
})

export const loadReferenceCodes = (codeType) => cached(`ref:${codeType}`, async () => {
  const rows = await unwrap(supabase.from('mp_reference_codes').select('code, description').eq('code_type', codeType).order('code'))
  return rows.map((r) => ({ value: r.code, label: `${r.code} — ${r.description}` }))
})

// ---------------------------------------------------------------------------
// Synthetic files (private Storage bucket; access enforced by storage policies)
// ---------------------------------------------------------------------------

export function validateUpload(file) {
  if (!file) return 'Choose a synthetic test file to upload.'
  if (!config.allowedUploadTypes.includes(file.type)) return 'Only PDF, TXT, PNG, or JPEG files can be uploaded.'
  if (file.size > config.maxUploadBytes) return 'The file exceeds the 5 MB demo upload limit.'
  if (file.size === 0) return 'The selected file is empty.'
  return ''
}

const DOC_TYPES = { 'application/pdf': 'PDF', 'text/plain': 'TXT', 'image/png': 'PNG', 'image/jpeg': 'JPG' }

export async function uploadDocument({ authorizationId = null, file, category, description = '' }) {
  const problem = validateUpload(file)
  if (problem) throw Object.assign(new Error(problem), { code: '22023' })
  const id = crypto.randomUUID()
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'upload'
  const path = `${session.orgId}/${id}/${safeName}`
  const { error: uploadError } = await supabase.storage.from(config.bucket).upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) throw uploadError
  const { data, error } = await supabase.from('mp_documents').insert({
    id, org_id: session.orgId, authorization_id: authorizationId, doc_type: DOC_TYPES[file.type], category,
    file_name: file.name.slice(0, 200), description, storage_path: path, mime_type: file.type, size_bytes: file.size,
  }).select().single()
  if (error) {
    await supabase.storage.from(config.bucket).remove([path])
    throw error
  }
  return data
}

export async function deleteDocument(doc) {
  const { data, error } = await supabase.from('mp_documents').delete().eq('id', doc.id).select('id')
  if (error) throw error
  if (!data.length) throw Object.assign(new Error('You do not have permission to delete this document.'), { code: '42501' })
  await supabase.storage.from(config.bucket).remove([doc.storage_path])
}

export async function fetchFile(path) {
  const { data, error } = await supabase.storage.from(config.bucket).download(path)
  if (error) throw error
  return data
}

export async function downloadFile(path, fileName) {
  const blob = await fetchFile(path)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.dataset.testid = 'download-anchor'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
