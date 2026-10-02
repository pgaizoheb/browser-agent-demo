export function currentRoute() {
  const raw = location.hash.slice(1) || '/'
  const index = raw.indexOf('?')
  const path = index === -1 ? raw : raw.slice(0, index)
  const query = new URLSearchParams(index === -1 ? '' : raw.slice(index + 1))
  return { path: decodeURIComponent(path) || '/', query }
}

export function href(path, query) {
  const params = query instanceof URLSearchParams ? query : new URLSearchParams(query || {})
  const qs = params.toString()
  return `#${path}${qs ? `?${qs}` : ''}`
}

export function go(path, query) {
  const target = href(path, query)
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'))
  else location.hash = target
}

/** Matches "/authorizations/:number" style patterns. Returns params or null. */
export function matchPath(pattern, path) {
  const a = pattern.split('/')
  const b = path.split('/')
  if (a.length !== b.length) return null
  const params = {}
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i])
    else if (a[i] !== b[i]) return null
  }
  return params
}
