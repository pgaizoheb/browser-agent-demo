import { dataTable, nextSort, wireTable } from '../components/dataTable.js'
import { approximationNotice, busy, closeModal, errorState, openModal, permissionState, toast } from '../components/feedback.js'
import { field, showFieldErrors } from '../components/field.js'
import { downloadButton, viewButton } from '../components/files.js'
import { createNote, deleteNote, editNoteDialog, noteFields, canEditNote } from '../components/notes.js'
import { fetchPage } from '../lib/data.js'
import { $, escapeHtml, icon } from '../lib/dom.js'
import { describeError } from '../lib/errors.js'
import { formatDate, formatDateTime, titleCase } from '../lib/format.js'
import { go } from '../lib/router.js'
import { can, session } from '../lib/session.js'
import { supabase, unwrap } from '../lib/supabase.js'
import { HOSPITALS } from './searchConfigs.js'

const text = (value) => escapeHtml(value ?? '')

function listState(query, defaultSort) {
  return {
    size: Number(query.get('size')) || 10,
    page: Math.max(Number(query.get('page')) || 0, 0),
    sort: query.get('sort') || defaultSort,
  }
}

function wireListNavigation(container, { path, query, sort }) {
  const update = (changes) => {
    const next = new URLSearchParams(query)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    go(path, next)
  }
  wireTable(container, {
    onSort: (key) => update({ sort: nextSort(sort, key), page: null }),
    onPage: (n) => update({ page: String(n) }),
    onSize: (n) => update({ size: String(n), page: null }),
  })
}

// ---------------------------------------------------------------------------
// Consult Notes (approximation)
// ---------------------------------------------------------------------------

const noteColumns = [
  { label: 'Date', sort: 'created_at', render: (n) => formatDateTime(n.created_at) },
  { label: 'Subject', sort: 'subject', render: (n) => `<span data-testid="note-subject">${text(n.subject)}</span>` },
  { label: 'Type', sort: 'note_type', render: (n) => text(titleCase(n.note_type)) },
  { label: 'Auth. No.', sort: 'auth_number', render: (n) => (n.auth_number ? `<a href="#/authorizations/${text(n.auth_number)}">${text(n.auth_number)}</a>` : '') },
  { label: 'Member', sort: 'member_name', render: (n) => text(n.member_name) },
  { label: 'Author', sort: 'author_name', render: (n) => text(n.author_name) },
  { label: 'Actions', render: (n) => `<button type="button" class="text-button" data-view-note="${n.id}" data-testid="view-note">${icon('visibility')}View</button>
    ${canEditNote(n) ? `<button type="button" class="text-button" data-edit-note="${n.id}" data-testid="edit-note">${icon('edit')}Edit</button>
    <button type="button" class="text-button" data-delete-note="${n.id}" data-testid="delete-note">${icon('delete')}Delete</button>` : ''}` },
]

export async function renderConsultNotes(ctx) {
  const { main, query, path } = ctx
  const { size, page, sort } = listState(query, 'created_at.desc')
  const filters = [{ name: 'q', label: 'Subject', column: 'subject', op: 'ilike' }]
  const options = { columns: noteColumns, page, size, sort, emptyText: 'No consult notes in this IPA.' }
  main.innerHTML = `${approximationNotice()}
    <section class="card report-card"><div class="card-title-row"><h1>Consult Notes</h1><div class="toolbar">
      ${can('writeNote') ? `<button type="button" class="text-button" id="new-note" data-testid="new-note">${icon('note_add')}New Consult Note</button>` : ''}</div></div>
      <form id="report-filters" class="report-filters" novalidate>${field({ name: 'q', label: 'Subject', value: query.get('q') || '' })}
        <div class="actions"><button type="submit" data-testid="filter-apply">${icon('filter_list')}Apply</button></div></form>
      <div id="results" data-testid="results">${dataTable({ ...options, state: 'loading' })}</div></section>`
  $('#report-filters').addEventListener('submit', (event) => {
    event.preventDefault()
    const next = new URLSearchParams(query)
    next.delete('page')
    const value = event.currentTarget.elements.q.value.trim()
    if (value) next.set('q', value)
    else next.delete('q')
    go(path, next)
  })
  const results = $('#results')
  wireListNavigation(results, { path, query, sort })
  let rows = []
  const reload = () => go(path, query)

  $('#new-note')?.addEventListener('click', () => {
    const dialog = openModal(`<h2 id="modal-title">New Consult Note</h2>
      <form id="new-note-form" novalidate><div class="form-grid two">${noteFields({}, { includeAuthNumber: true })}</div>
      <div class="actions"><button type="button" data-close>Cancel</button><button type="submit" data-testid="save-note">${icon('save')}Save Note</button></div></form>`, { wide: true })
    const form = dialog.querySelector('form')
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      const number = form.elements.auth_number.value.trim().toUpperCase()
      let auth = null
      if (number) {
        auth = await unwrap(supabase.from('mp_authorizations').select('id, member_id').eq('org_id', session.orgId).eq('auth_number', number).maybeSingle())
          .catch(() => null)
        if (!auth) { showFieldErrors(form, { auth_number: `Authorization ${number} was not found in the current IPA.` }); return }
      }
      if (await createNote({ authorizationId: auth?.id, memberId: auth?.member_id, form })) { closeModal(); reload() }
    })
  })

  results.addEventListener('click', async (event) => {
    const find = (attr) => rows.find((n) => n.id === event.target.closest(`[${attr}]`)?.getAttribute(attr))
    const viewing = find('data-view-note')
    if (viewing) {
      openModal(`<h2 id="modal-title">${text(viewing.subject)}</h2><p class="muted">${text(titleCase(viewing.note_type))} · ${text(viewing.author_name)} · ${formatDateTime(viewing.created_at)}</p>
        <p data-testid="note-body" class="note-body">${text(viewing.body)}</p><div class="actions"><button type="button" data-close>Close</button></div>`, { testId: 'note-dialog' })
    }
    const editing = find('data-edit-note')
    if (editing) editNoteDialog(editing, reload)
    const deleting = find('data-delete-note')
    if (deleting && await deleteNote(deleting)) reload()
  })

  try {
    const result = await fetchPage({ source: 'mp_note_list', filters, params: query, sort, page, size })
    if (!ctx.isCurrent()) return
    rows = result.rows
    results.innerHTML = dataTable({ ...options, rows, total: result.total, state: 'ready' })
  } catch (error) {
    if (ctx.isCurrent()) results.innerHTML = dataTable({ ...options, state: 'error', errorText: describeError(error).message })
  }
}

// ---------------------------------------------------------------------------
// Hospital Admin (approximation, administrators only)
// ---------------------------------------------------------------------------

export async function renderHospitalAdmin(ctx) {
  const { main, query, path } = ctx
  if (!can('hospitalAdmin')) {
    main.innerHTML = `${approximationNotice()}${permissionState('Hospital Admin is restricted to IPA administrators. Your role in this IPA does not include access.')}`
    return
  }
  const { size, page, sort } = listState(query, 'hospitalized_since.desc')
  const columns = [
    { label: 'Member', sort: 'last_name', render: (m) => `<a href="#/members/${text(m.member_number)}">${text(m.member_name)}</a>` },
    { label: 'Member ID', sort: 'member_number', render: (m) => text(m.member_number) },
    { label: 'Hospital', sort: 'hospital_name', render: (m) => text(m.hospital_name) },
    { label: 'Admitted', sort: 'hospitalized_since', render: (m) => formatDate(m.hospitalized_since) },
    { label: 'Actions', render: (m) => `<button type="button" class="text-button" data-discharge="${m.id}" data-testid="record-discharge">${icon('logout')}Record discharge</button>` },
  ]
  const options = { columns, page, size, sort, emptyText: 'No members are currently hospitalized in this IPA.' }
  main.innerHTML = `${approximationNotice('Mock approximation: the production Hospital Admin control was locked and never activated. This inpatient census workflow is locally designed.')}
    <section class="card"><h1>Hospital Admin — Inpatient Census</h1>
      <form id="admit-form" class="report-filters" novalidate data-testid="admit-form">
        ${field({ name: 'member_number', label: 'Member ID', required: true, idPrefix: 'admit' })}
        ${field({ name: 'hospital', label: 'Hospital', type: 'select', options: HOSPITALS, idPrefix: 'admit' })}
        <div class="actions"><button type="submit" data-testid="record-admission">${icon('local_hospital')}Record admission</button></div></form>
      <div id="results" data-testid="results">${dataTable({ ...options, state: 'loading' })}</div></section>`
  const results = $('#results')
  wireListNavigation(results, { path, query, sort })
  $('#admit-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const number = form.elements.member_number.value.trim().toUpperCase()
    if (!number) { showFieldErrors(form, { member_number: 'Member ID is required.' }); return }
    const member = await unwrap(supabase.from('mp_members').select('id').eq('org_id', session.orgId).eq('member_number', number).maybeSingle()).catch(() => null)
    if (!member) { showFieldErrors(form, { member_number: `Member ${number} was not found in the current IPA.` }); return }
    const { error } = await busy(form.querySelector('[type=submit]'), () => supabase.rpc('mp_set_member_admission', { p_member_id: member.id, p_hospital: form.elements.hospital.value }))
    if (error) { showFieldErrors(form, { member_number: describeError(error).message }); return }
    toast(`Admission recorded for ${number}.`)
    go(path, query)
  })
  results.addEventListener('click', async (event) => {
    const id = event.target.closest('[data-discharge]')?.dataset.discharge
    if (!id) return
    const { error } = await supabase.rpc('mp_set_member_admission', { p_member_id: id, p_hospital: null })
    if (error) { toast(describeError(error).message, 'error'); return }
    toast('Discharge recorded.')
    go(path, query)
  })
  try {
    const result = await fetchPage({ source: 'mp_member_list', params: query, fixed: (q) => q.eq('hospitalized', true), sort, page, size })
    if (ctx.isCurrent()) results.innerHTML = dataTable({ ...options, rows: result.rows, total: result.total, state: 'ready' })
  } catch (error) {
    if (ctx.isCurrent()) results.innerHTML = dataTable({ ...options, state: 'error', errorText: describeError(error).message })
  }
}

// ---------------------------------------------------------------------------
// Forms and Manuals (observed folder labels; synthetic files)
// ---------------------------------------------------------------------------

export async function renderForms(ctx) {
  const { main } = ctx
  const load = async () => {
    const rows = await unwrap(supabase.from('mp_forms_manuals').select('*').order('sort_order'))
    if (!ctx.isCurrent()) return
    const folders = [...new Set(rows.map((r) => r.folder))]
    $('#forms-tree').innerHTML = folders.map((folder) => `<details class="folder" data-folder="${text(folder)}"><summary>${icon('folder')} ${text(folder)}</summary>
      ${rows.filter((r) => r.folder === folder).map((r) => `<div class="file-item" data-testid="form-file">${icon('insert_drive_file')}<span>${text(r.title)}</span>
        ${downloadButton({ storage_path: r.storage_path, file_name: r.title, mime_type: r.mime_type })}
        ${viewButton({ storage_path: r.storage_path, file_name: r.title, mime_type: r.mime_type })}</div>`).join('')}</details>`).join('')
  }
  main.innerHTML = `<section class="card forms-card"><div class="forms-title"><h1>Forms and Manuals</h1>
      <button type="button" class="text-button" id="refresh-forms" data-testid="refresh-forms">${icon('refresh')}Refresh</button></div>
    <div id="forms-tree" data-testid="forms-tree" role="status">Loading…</div>
    <p class="muted">Folder labels were observed. All file entries are synthetic files served from the demo Supabase bucket; no production documents were copied.</p></section>`
  $('#refresh-forms').addEventListener('click', async () => {
    try { await load(); toast('Forms index refreshed.') } catch (error) { toast(describeError(error).message, 'error') }
  })
  try { await load() } catch (error) { if (ctx.isCurrent()) $('#forms-tree').innerHTML = errorState(describeError(error).message) }
}
