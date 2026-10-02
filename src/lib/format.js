export function formatDate(value) {
  if (!value) return ''
  const [year, month, day] = String(value).slice(0, 10).split('-')
  return year && month && day ? `${month}/${day}/${year}` : String(value)
}

export function formatDateTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function formatMoney(value) {
  if (value === null || value === undefined) return ''
  return Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function today() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export function daysAgo(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export const AUTH_STATUSES = [
  { value: 'approved', label: '1 - Approved' },
  { value: 'modified', label: '2 - Modified' },
  { value: 'denied', label: '3 - Denied' },
  { value: 'deferred', label: '4 - Deferred' },
  { value: 'cancelled', label: '6 - Cancelled' },
  { value: 'requested', label: '7 - Requested' },
]
export const DRAFT_STATUS = { value: 'draft', label: '0 - Draft (mock)' }

export const CLAIM_STATUSES = [
  { value: 'received', label: 'Received' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'adjusted', label: 'Adjusted' },
  { value: 'denied', label: 'Denied' },
]

export function authStatusLabel(status) {
  return [...AUTH_STATUSES, DRAFT_STATUS].find((s) => s.value === status)?.label || status
}

export function titleCase(value) {
  return String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
