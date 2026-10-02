import { CATEGORIES, canDeleteDocument, confirmDeleteDocument, handleUpload, uploadForm } from '../components/attachments.js'
import { dataTable, nextSort, wireTable } from '../components/dataTable.js'
import { approximationNotice, closeModal, openModal, statusBadge, toast } from '../components/feedback.js'
import { field, wireDateRanges } from '../components/field.js'
import { downloadButton, viewButton } from '../components/files.js'
import { fetchPage } from '../lib/data.js'
import { $, escapeHtml, icon } from '../lib/dom.js'
import { describeError } from '../lib/errors.js'
import { AUTH_STATUSES, DRAFT_STATUS, formatDate, formatDateTime, titleCase } from '../lib/format.js'
import { go } from '../lib/router.js'
import { can, session, userId } from '../lib/session.js'
import { supabase } from '../lib/supabase.js'
import { memberColumns } from './searchConfigs.js'

const text = (value) => escapeHtml(value ?? '')
const authLink = (number) => (number ? `<a href="#/authorizations/${text(number)}" data-testid="record-link">${text(number)}</a>` : '')
const all = (options) => [{ value: '', label: 'All' }, ...options]
const isoDaysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString()

const requestColumns = [
  { label: 'Auth. No.', sort: 'auth_number', render: (r) => authLink(r.auth_number) },
  { label: 'Status', sort: 'status', render: (r) => statusBadge(r.status, r.status_label) },
  { label: 'Member ID', sort: 'member_number', render: (r) => text(r.member_number) },
  { label: 'Member Name', sort: 'member_last_name', render: (r) => text(r.member_name) },
  { label: 'Provider', sort: 'requested_provider_last_name', render: (r) => text(r.requested_provider_name) },
  { label: 'Req. Date', sort: 'request_date', render: (r) => formatDate(r.request_date) },
]

const viewAuth = { label: 'Actions', render: (r) => `<a class="text-button" href="#/authorizations/${text(r.auth_number)}" data-testid="view-record">${icon('visibility')}View</a>
  ${['draft', 'deferred'].includes(r.status) && can('createRequest') ? `<a class="text-button" href="#/authorization-request/${text(r.auth_number)}/edit" data-testid="edit-record">${icon('edit')}${r.status === 'draft' ? 'Edit' : 'Resubmit'}</a>` : ''}` }

const memberReport = (title, flag, extra) => ({
  title,
  source: 'mp_member_list',
  defaultSort: 'last_name.asc',
  fixed: flag ? (q) => q.eq(flag, true) : null,
  columns: [...memberColumns.slice(0, -1), ...extra, memberColumns.at(-1)],
})

const documentActions = {
  label: 'Actions',
  render: (r) => `${can('upload') && r.status !== 'read' ? `<button type="button" class="text-button" data-doc-status="read" data-doc-id="${r.id}">${icon('drafts')}Mark read</button>` : ''}
    ${can('upload') && r.status !== 'archived' ? `<button type="button" class="text-button" data-doc-status="archived" data-doc-id="${r.id}">${icon('archive')}Archive</button>` : ''}
    ${canDeleteDocument(r) ? `<button type="button" class="text-button" data-delete-doc="${r.id}" data-testid="delete-file">${icon('delete')}Delete</button>` : ''}`,
}

export const REPORTS = {
  '/authorization-request/my': {
    title: 'My Requests',
    source: 'mp_authorization_list',
    defaultSort: 'updated_at.desc',
    fixed: (q) => q.eq('created_by', userId()),
    filters: [{ name: 'status', label: 'Status', type: 'select', column: 'status', op: 'eq', options: all([DRAFT_STATUS, ...AUTH_STATUSES]) }],
    toolbar: () => (can('createRequest') ? `<a class="text-button" href="#/authorization-request" data-testid="create-request">${icon('add')}Create Demo Request</a>` : ''),
    emptyText: 'You have not created any synthetic requests in this IPA.',
    columns: [...requestColumns, { label: 'Updated', sort: 'updated_at', render: (r) => formatDateTime(r.updated_at) }, viewAuth],
  },
  '/my-data/recently-updated-authorizations': {
    title: 'Recently Updated',
    source: 'mp_authorization_list',
    defaultSort: 'updated_at.desc',
    fixed: (q) => q.gte('updated_at', isoDaysAgo(30)),
    filters: [{ name: 'status', label: 'Status', type: 'select', column: 'status', op: 'eq', options: all(AUTH_STATUSES) }],
    columns: [...requestColumns, { label: 'Updated', sort: 'updated_at', render: (r) => formatDateTime(r.updated_at) }, viewAuth],
  },
  '/my-data/recent-authorization-attachments': {
    title: 'Recent Attachments',
    source: 'mp_document_list',
    defaultSort: 'created_at.desc',
    fixed: (q) => q.not('authorization_id', 'is', null),
    columns: [
      { label: 'Document Name', sort: 'file_name', render: (r) => text(r.file_name) },
      { label: 'Auth. No.', sort: 'auth_number', render: (r) => authLink(r.auth_number) },
      { label: 'Type', sort: 'doc_type', render: (r) => text(r.doc_type) },
      { label: 'Date', sort: 'created_at', render: (r) => formatDate(r.created_at) },
      { label: 'Uploaded By', render: (r) => text(r.uploaded_by_name) },
      { label: 'Actions', render: (r) => `${downloadButton(r)}${viewButton(r)}` },
    ],
  },
  '/my-data/my-members': {
    ...memberReport('My Members', null, []),
    filters: [{ name: 'q', label: 'Last Name', column: 'last_name', op: 'ilike' }],
  },
  '/my-data/members-approaching-65': memberReport('Members Approaching 65', 'approaching_65',
    [{ label: 'Age', sort: 'birth_date', render: (r) => text(r.age_years) }]),
  '/my-data/members-hospitalized-pcp': memberReport('Members Hospitalized', 'hospitalized',
    [{ label: 'Hospital', sort: 'hospital_name', render: (r) => text(r.hospital_name) },
      { label: 'Since', sort: 'hospitalized_since', render: (r) => formatDate(r.hospitalized_since) }]),
  '/my-data/members-without-pcp-visits-in-the-past-year': memberReport('Members Without Visits in the Past Year', 'no_visit_past_year',
    [{ label: 'Last PCP Visit', sort: 'last_pcp_visit', render: (r) => formatDate(r.last_pcp_visit) || 'None' }]),
  '/my-data/members-without-pcp-visits-since-enrollment': memberReport('Members Without Visits Since Enrollment', 'no_visit_since_enrollment',
    [{ label: 'Enrolled', sort: 'enrolled_on', render: (r) => formatDate(r.enrolled_on) }]),
  '/documents': {
    title: 'My Documents',
    source: 'mp_document_list',
    defaultSort: 'sent_date.desc',
    filters: [
      { name: 'status', label: 'Status', type: 'select', column: 'status', op: 'eq', options: all(['new', 'read', 'archived'].map((s) => ({ value: s, label: titleCase(s) }))) },
      { name: 'category', label: 'Category', type: 'select', column: 'category', op: 'eq', options: all(CATEGORIES) },
    ],
    toolbar: () => (can('upload') ? `<button type="button" class="text-button" id="upload-document" data-testid="upload-document">${icon('cloud_upload')}Upload Demo Document</button>` : ''),
    columns: [
      { label: 'Document', sort: 'file_name', render: (r) => `${text(r.file_name)}<br><small class="muted">${text(r.description)}</small>` },
      { label: 'Category', sort: 'category', render: (r) => text(r.category) },
      { label: 'Status', sort: 'status', render: (r) => statusBadge(r.status, titleCase(r.status)) },
      { label: 'Auth. No.', sort: 'auth_number', render: (r) => authLink(r.auth_number) },
      { label: 'Sent Date', sort: 'sent_date', render: (r) => formatDate(r.sent_date) },
      { label: 'Download', render: (r) => downloadButton(r) },
      { label: 'View', render: (r) => viewButton(r) },
      documentActions,
    ],
  },
  '/activity': {
    title: 'Activity Log',
    notice: 'Demo audit trail: every workflow change made through this portal is recorded in Supabase (mp_activity_events). Not a production feature.',
    source: 'mp_activity_events',
    orgScoped: false,
    fixed: (q) => q.or(`org_id.eq.${session.orgId},org_id.is.null`),
    defaultSort: 'created_at.desc',
    filters: [{ name: 'entity', label: 'Entity', type: 'select', column: 'entity_type', op: 'eq',
      options: all(['authorization', 'document', 'note', 'member', 'session'].map((s) => ({ value: s, label: titleCase(s) }))) }],
    columns: [
      { label: 'When', sort: 'created_at', render: (r) => formatDateTime(r.created_at) },
      { label: 'Entity', sort: 'entity_type', render: (r) => text(titleCase(r.entity_type)) },
      { label: 'Record', render: (r) => (r.entity_type === 'authorization' && r.action !== 'deleted' ? authLink(r.entity_label) : text(r.entity_label)) },
      { label: 'Action', sort: 'action', render: (r) => text(titleCase(r.action)) },
      { label: 'Status Change', render: (r) => (r.to_status || r.from_status ? text(`${r.from_status || '—'} → ${r.to_status || '—'}`) : '') },
      { label: 'Note', render: (r) => text(r.note) },
      { label: 'Actor', sort: 'actor_name', render: (r) => text(r.actor_name) },
    ],
  },
}

export async function renderReport(ctx, config) {
  const { main, query, path } = ctx
  const size = Number(query.get('size')) || 10
  const page = Math.max(Number(query.get('page')) || 0, 0)
  const sort = query.get('sort') || config.defaultSort
  const filters = config.filters || []
  const tableOptions = { columns: config.columns, page, size, sort, emptyText: config.emptyText || 'No matching synthetic records.' }

  main.innerHTML = `${approximationNotice(config.notice)}
    <section class="card report-card"><div class="card-title-row"><h1>${escapeHtml(config.title)}</h1><div class="toolbar">${config.toolbar?.() || ''}</div></div>
      ${filters.length ? `<form id="report-filters" class="report-filters" novalidate data-testid="report-filters">${filters.map((def) =>
        field({ name: def.name, label: def.label, type: def.type || 'text', options: def.options, value: query.get(def.name) || '' })).join('')}
        <div class="actions"><button type="submit" data-testid="filter-apply">${icon('filter_list')}Apply</button>
        <button type="button" id="filter-reset" data-testid="filter-reset">${icon('clear')}Reset</button></div></form>` : ''}
      <div id="results" data-testid="results">${dataTable({ ...tableOptions, state: 'loading' })}</div></section>`

  const update = (changes) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    go(path, next)
  }
  const form = $('#report-filters')
  if (form) {
    wireDateRanges(form)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const changes = { page: null }
      for (const def of filters) changes[def.name] = form.elements[def.name].value.trim()
      update(changes)
    })
    $('#filter-reset').addEventListener('click', () => go(path))
  }

  const results = $('#results')
  let rows = []
  wireTable(results, {
    onSort: (key) => update({ sort: nextSort(sort, key), page: null }),
    onPage: (n) => update({ page: String(n) }),
    onSize: (n) => update({ size: String(n), page: null }),
  })
  results.addEventListener('click', async (event) => {
    const statusButton = event.target.closest('[data-doc-status]')
    if (statusButton) {
      const { error } = await supabase.from('mp_documents').update({ status: statusButton.dataset.docStatus }).eq('id', statusButton.dataset.docId)
      if (error) toast(describeError(error).message, 'error')
      else { toast(`Document marked ${statusButton.dataset.docStatus}.`); go(path, query) }
      return
    }
    const deleteButton = event.target.closest('[data-delete-doc]')
    if (deleteButton) {
      const doc = rows.find((row) => row.id === deleteButton.dataset.deleteDoc)
      if (doc && await confirmDeleteDocument(doc)) go(path, query)
    }
  })
  $('#upload-document')?.addEventListener('click', () => {
    const dialog = openModal(`<h2 id="modal-title">Upload Demo Document</h2>${uploadForm({ idPrefix: 'doc-upload', defaultCategory: 'Correspondence' })}
      <div class="actions"><button type="button" data-close>Close</button></div>`, { wide: true, testId: 'upload-dialog' })
    dialog.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault()
      if (await handleUpload(event.currentTarget)) { closeModal(); go(path, query) }
    })
  })

  try {
    const result = await fetchPage({ source: config.source, filters, params: query, fixed: config.fixed, sort, page, size,
      orgScoped: config.orgScoped !== false })
    if (!ctx.isCurrent()) return
    rows = result.rows
    results.innerHTML = dataTable({ ...tableOptions, rows, total: result.total, state: 'ready' })
  } catch (error) {
    if (!ctx.isCurrent()) return
    results.innerHTML = dataTable({ ...tableOptions, state: 'error', errorText: describeError(error).message })
  }
}
