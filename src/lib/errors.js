/** Classifies Supabase/PostgREST/Storage errors into UI states with readable text. */
export function describeError(error) {
  if (!error) return { kind: 'error', message: 'Unknown error.' }
  const code = error.code || ''
  const status = Number(error.statusCode || error.status || 0)
  const message = error.message || String(error)

  if (error.name === 'TypeError' || /Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return { kind: 'network', message: 'Cannot reach the demo database. Check your connection and try again.' }
  }
  if (code === '42501' || status === 403 || /row-level security|permission denied/i.test(message)) {
    const readable = /row-level security|permission denied/i.test(message)
      ? 'You do not have permission to perform this action.'
      : message
    return { kind: 'permission', message: readable }
  }
  if (code === 'PGRST301' || code === 'PGRST303' || /JWT expired/i.test(message)) {
    return { kind: 'session', message: 'Your session expired. Sign in again.' }
  }
  if (code === 'P0002' || code === 'PGRST116') return { kind: 'not_found', message: message || 'Record not found.' }
  if (code === '40001') return { kind: 'conflict', message }
  if (code === '22023' || code === '23514' || code === '23502') {
    let fields = []
    try { fields = JSON.parse(error.details || '[]') } catch { fields = [] }
    return { kind: 'validation', message: message.replace(/^Validation failed:\s*/, ''), fields }
  }
  if (status === 413 || /exceeded the maximum allowed size|Payload too large/i.test(message)) {
    return { kind: 'validation', message: 'The file exceeds the 5 MB demo upload limit.' }
  }
  if (status === 415 || /mime type .* is not supported|invalid_mime_type/i.test(message)) {
    return { kind: 'validation', message: 'Only PDF, TXT, PNG, or JPEG files can be uploaded.' }
  }
  return { kind: 'error', message }
}
