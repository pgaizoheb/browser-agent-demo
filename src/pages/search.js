import { dataTable, nextSort, wireTable } from '../components/dataTable.js'
import { toast } from '../components/feedback.js'
import { dateRangeField, field, wireDateRanges } from '../components/field.js'
import { fetchPage } from '../lib/data.js'
import { $, escapeHtml, icon } from '../lib/dom.js'
import { describeError } from '../lib/errors.js'
import { go } from '../lib/router.js'
import { can } from '../lib/session.js'
import { supabase } from '../lib/supabase.js'
import { REFERENCE_TYPES } from './searchConfigs.js'

function renderField(def, query) {
  if (def.type === 'dateRange') {
    return dateRangeField({ name: def.name, label: def.label, full: def.full, preset: query.get(def.name) || '',
      from: query.get(`${def.name}_from`) || '', to: query.get(`${def.name}_to`) || '' })
  }
  return field({ name: def.name, label: def.label, type: def.type || 'text', options: def.options || def.resolvedOptions,
    value: query.get(def.name) || '', full: def.full })
}

function referenceFields(query) {
  const selected = query.get('type') || 'service'
  return `<div class="reference-fields"><fieldset><legend>Reference Type</legend>${REFERENCE_TYPES.map((t) =>
    `<label><input type="radio" name="type" value="${t.value}" ${t.value === selected ? 'checked' : ''}>${t.label}</label>`).join('')}</fieldset>
    ${field({ name: 'q', label: 'Code or Description', value: query.get('q') || '' })}</div>`
}

/** Builds the next URL query from the submitted form, dropping empty values. */
function queryFromForm(form, config, query) {
  const next = new URLSearchParams()
  const data = new FormData(form)
  const rangeNames = new Set([...config.fields, ...(config.advanced || [])].filter((def) => def.type === 'dateRange').map((def) => def.name))
  for (const [key, value] of data.entries()) {
    const trimmed = String(value).trim()
    if (!trimmed) continue
    // Custom from/to inputs of a date-range filter only count when that filter is set to Custom.
    const rangeBase = key.replace(/_(from|to)$/, '')
    if (rangeNames.has(rangeBase) && key !== rangeBase && data.get(rangeBase) !== 'custom') continue
    next.set(key, trimmed)
  }
  next.set('searched', '1')
  if (query.get('size')) next.set('size', query.get('size'))
  if (query.get('sort')) next.set('sort', query.get('sort'))
  return next
}

export async function renderSearch(ctx, config) {
  const { main, query, path } = ctx
  const searched = query.get('searched') === '1'
  const size = Number(query.get('size')) || config.pageSize || 10
  const page = Math.max(Number(query.get('page')) || 0, 0)
  const sort = query.get('sort') || config.defaultSort
  const defs = [...config.fields, ...(config.advanced || [])]

  await Promise.all(defs.filter((def) => def.optionsLoader).map(async (def) => { def.resolvedOptions = await def.optionsLoader() }))
  if (!ctx.isCurrent()) return

  const advancedOpen = (config.advanced || []).some((def) => query.get(def.name))
  const isReference = config.kind === 'references'
  const tableOptions = { columns: config.columns, page, size, sort, idleText: config.idleText, emptyText: config.emptyText,
    className: isReference ? 'reference-table' : '' }

  main.innerHTML = `<section class="search-panel ${isReference ? 'reference-panel' : ''}" data-testid="search-panel">
      <h1 class="panel-title"><button type="button" class="panel-heading" id="collapse" aria-expanded="true" aria-controls="search-form">${escapeHtml(config.title)}${icon('expand_less')}</button></h1>
      <form id="search-form" class="panel-body" novalidate data-testid="search-form">
        ${isReference ? referenceFields(query) : `<div class="form-grid">${config.fields.map((def) => renderField(def, query)).join('')}</div>`}
        ${config.advanced ? `<div class="form-grid advanced ${advancedOpen ? '' : 'hidden'}" id="advanced" data-testid="advanced-filters">${config.advanced.map((def) => renderField(def, query)).join('')}</div>` : ''}
        <div class="actions"><button type="submit" data-testid="search-submit">${icon('search')}Search</button>
          <div class="right-actions">${config.advanced ? `<button type="button" id="more" aria-expanded="${advancedOpen}" aria-controls="advanced" data-testid="more-options">${icon(advancedOpen ? 'expand_less' : 'expand_more')}${advancedOpen ? 'Less Options' : 'More Options'}</button>` : ''}
          <button type="button" id="reset-search" data-testid="search-reset">${icon('clear')}Reset</button></div></div>
      </form></section>
    ${config.bulkRead && can('upload') ? `<div class="bulk-bar"><button type="button" class="text-button" id="bulk-read" disabled data-testid="bulk-mark-read">${icon('drafts')}Mark selected as read</button></div>` : ''}
    <section id="results" aria-label="Search results" data-testid="results">${dataTable({ ...tableOptions, state: searched ? 'loading' : 'idle' })}</section>`

  const form = $('#search-form')
  wireDateRanges(form)
  $('#collapse').addEventListener('click', () => {
    form.classList.toggle('hidden')
    $('#collapse').setAttribute('aria-expanded', String(!form.classList.contains('hidden')))
  })
  $('#more')?.addEventListener('click', () => {
    const advanced = $('#advanced')
    advanced.classList.toggle('hidden')
    const open = !advanced.classList.contains('hidden')
    $('#more').innerHTML = `${icon(open ? 'expand_less' : 'expand_more')}${open ? 'Less Options' : 'More Options'}`
    $('#more').setAttribute('aria-expanded', String(open))
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    go(path, queryFromForm(form, config, query))
  })
  $('#reset-search').addEventListener('click', () => go(path))

  const results = $('#results')
  const update = (changes) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    go(path, next)
  }
  wireTable(results, {
    onSort: (key) => update({ sort: nextSort(sort, key), page: null, searched: '1' }),
    onPage: (n) => update({ page: String(n) }),
    onSize: (n) => update({ size: String(n), page: null }),
  })

  if (config.bulkRead) {
    const bulk = $('#bulk-read')
    results.addEventListener('change', () => {
      if (bulk) bulk.disabled = !results.querySelector('[data-select-doc]:checked')
    })
    bulk?.addEventListener('click', async () => {
      const ids = [...results.querySelectorAll('[data-select-doc]:checked')].map((box) => box.dataset.selectDoc)
      const { error } = await supabase.from('mp_documents').update({ status: 'read' }).in('id', ids)
      if (error) { toast(describeError(error).message, 'error'); return }
      toast(`Marked ${ids.length} document${ids.length === 1 ? '' : 's'} as read.`)
      go(path, query)
    })
  }

  if (!searched) return
  try {
    const params = new URLSearchParams(query)
    if (isReference && !params.get('type')) params.set('type', 'service')
    const { rows, total } = await fetchPage({ source: config.source, filters: [...defs, ...(config.hiddenFilters || [])],
      params, sort, page, size, orgScoped: config.orgScoped !== false })
    if (!ctx.isCurrent()) return
    results.innerHTML = dataTable({ ...tableOptions, rows, total, state: 'ready' })
  } catch (error) {
    if (!ctx.isCurrent()) return
    results.innerHTML = dataTable({ ...tableOptions, state: 'error', errorText: describeError(error).message })
  }
}
