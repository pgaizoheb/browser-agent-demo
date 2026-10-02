import { escapeHtml, icon } from '../lib/dom.js'

export const PAGE_SIZES = [10, 25, 50, 100]

/**
 * Server-paginated table matching the mock's table + paginator.
 * columns: [{ label, sort?: dbColumn, render(row) -> html, className? }]
 * state: 'idle' | 'loading' | 'error' | 'ready'
 */
export function dataTable({
  columns, rows = [], total = 0, page = 0, size = 10, sort = '', state = 'ready',
  emptyText = 'No matching synthetic records.', idleText = 'No results. Use Search to load synthetic examples.',
  errorText = '', className = '', testId = 'results-table', rowId = (row) => row.id, paginate = true,
}) {
  const [sortKey, sortDir] = sort.split('.')
  const head = columns.map((column) => {
    if (!column.sort) return `<th scope="col">${escapeHtml(column.label)}</th>`
    const active = column.sort === sortKey
    const ariaSort = active ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'
    const arrow = active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''
    return `<th scope="col" aria-sort="${ariaSort}"><button type="button" data-sort-key="${column.sort}" data-testid="sort-${column.sort}">${escapeHtml(column.label)}${arrow}</button></th>`
  }).join('')

  let body
  if (state === 'loading') {
    body = `<tr class="empty-row"><td colspan="${columns.length}" role="status" data-testid="table-loading">Loading synthetic records…</td></tr>`
  } else if (state === 'error') {
    body = `<tr class="empty-row error-row"><td colspan="${columns.length}" role="alert" data-testid="table-error">${escapeHtml(errorText)}</td></tr>`
  } else if (state === 'idle') {
    body = `<tr class="empty-row"><td colspan="${columns.length}" data-testid="table-idle">${escapeHtml(idleText)}</td></tr>`
  } else if (!rows.length) {
    body = `<tr class="empty-row"><td colspan="${columns.length}" data-testid="table-empty">${escapeHtml(emptyText)}</td></tr>`
  } else {
    body = rows.map((row) => `<tr data-record-id="${escapeHtml(rowId(row))}"${row.status ? ` data-status="${escapeHtml(row.status)}"` : ''}>${
      columns.map((column) => `<td${column.className ? ` class="${column.className}"` : ''}>${column.render(row)}</td>`).join('')}</tr>`).join('')
  }

  const first = total ? page * size + 1 : 0
  const last = Math.min((page + 1) * size, total)
  const pages = Math.max(Math.ceil(total / size), 1)
  const paginator = paginate ? `<div class="paginator" data-testid="paginator">
      <label for="page-size">Items per page:</label>
      <select id="page-size" data-page-size>${PAGE_SIZES.map((n) => `<option ${n === size ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <span data-testid="page-range">${first}–${last} of ${total}</span>
      <span class="page-count" data-testid="page-count">Page ${Math.min(page + 1, pages)} of ${pages}</span>
      <button type="button" data-page="${page - 1}" aria-label="Previous page" data-testid="previous-page" ${page <= 0 || state !== 'ready' ? 'disabled' : ''}>${icon('chevron_left')}</button>
      <button type="button" data-page="${page + 1}" aria-label="Next page" data-testid="next-page" ${last >= total || state !== 'ready' ? 'disabled' : ''}>${icon('chevron_right')}</button>
    </div>` : ''

  return `<div class="table-wrap ${className}"><table data-testid="${testId}" aria-busy="${state === 'loading'}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${paginator}`
}

/** Delegated handlers for sort headers and paginator controls inside container. */
export function wireTable(container, { onSort, onPage, onSize }) {
  container.addEventListener('click', (event) => {
    const sortButton = event.target.closest('[data-sort-key]')
    if (sortButton && onSort) onSort(sortButton.dataset.sortKey)
    const pageButton = event.target.closest('[data-page]')
    if (pageButton && !pageButton.disabled && onPage) onPage(Number(pageButton.dataset.page))
  })
  container.addEventListener('change', (event) => {
    if (event.target.matches('[data-page-size]') && onSize) onSize(Number(event.target.value))
  })
}

export function nextSort(current, key) {
  const [currentKey, dir] = (current || '').split('.')
  return `${key}.${currentKey === key && dir === 'asc' ? 'desc' : 'asc'}`
}
