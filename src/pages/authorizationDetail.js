import { attachmentRows, confirmDeleteDocument, handleUpload, uploadForm } from '../components/attachments.js'
import { approximationNotice, busy, closeModal, confirmDialog, errorState, openModal, statusBadge, toast } from '../components/feedback.js'
import { field, showFieldErrors } from '../components/field.js'
import { createNote, deleteNote, editNoteDialog, noteFields, noteList } from '../components/notes.js'
import { config } from '../config.js'
import { $, escapeHtml, icon } from '../lib/dom.js'
import { describeError } from '../lib/errors.js'
import { formatDate, formatDateTime, formatMoney, titleCase } from '../lib/format.js'
import { go } from '../lib/router.js'
import { can, role, session } from '../lib/session.js'
import { supabase, unwrap } from '../lib/supabase.js'

const text = (value) => escapeHtml(value ?? '')

export function detailGrid(items) {
  return `<dl class="detail-grid">${items.map(([label, value, key]) =>
    `<div class="detail-item" ${key ? `data-field="${key}"` : ''}><dt>${escapeHtml(label)}</dt><dd>${value === '' || value === null || value === undefined ? '<span class="muted">—</span>' : value}</dd></div>`).join('')}</dl>`
}

const TRANSITIONS = {
  requested: { label: 'Submit Request', icon: 'send', needsReason: false, confirm: 'Submit this draft request for review?' },
  approved: { label: 'Approve', icon: 'check_circle', needsReason: false, confirm: 'Approve all requested units?' },
  modified: { label: 'Approve with Modification', icon: 'rule', needsReason: true, units: true },
  denied: { label: 'Deny', icon: 'block', needsReason: true },
  deferred: { label: 'Defer / Request Information', icon: 'pending_actions', needsReason: true },
  cancelled: { label: 'Cancel Request', icon: 'cancel', needsReason: true },
}

function availableTransitions(auth) {
  const list = []
  const decide = can('decide')
  if (auth.status === 'draft' && can('createRequest')) list.push('requested')
  const modify = auth.units > 1 ? ['modified'] : []
  if (auth.status === 'requested' && decide) list.push('approved', ...modify, 'denied', 'deferred')
  if (auth.status === 'deferred' && decide) list.push('approved', ...modify, 'denied')
  if (['requested', 'deferred'].includes(auth.status) && can('cancelRequest')) list.push('cancelled')
  if (['approved', 'modified'].includes(auth.status) && role() === 'admin') list.push('cancelled')
  return list
}

async function loadCodeDescriptions(auth) {
  const rows = await unwrap(supabase.from('mp_reference_codes').select('code, description')
    .in('code', [auth.service_code, auth.diagnosis_code, auth.place_of_service]))
  return Object.fromEntries(rows.map((r) => [r.code, r.description]))
}

function transitionDialog(auth, toStatus, onDone) {
  const spec = TRANSITIONS[toStatus]
  const label = toStatus === 'cancelled' && ['approved', 'modified'].includes(auth.status) ? 'Cancel Authorization' : spec.label
  const dialog = openModal(`<h2 id="modal-title">${escapeHtml(label)} — ${escapeHtml(auth.auth_number)}</h2>
    ${spec.confirm ? `<p>${escapeHtml(spec.confirm)}</p>` : ''}
    <form id="transition-form" novalidate data-testid="transition-form"><div class="form-grid two">
      ${spec.units ? field({ name: 'approved_units', label: `Approved units (requested ${auth.units})`, type: 'number', min: 1, max: auth.units - 1, required: true, idPrefix: 'tr' }) : ''}
      ${field({ name: 'reason', label: spec.needsReason ? 'Reason (required)' : 'Note (optional)', type: 'textarea', rows: 3, maxlength: 2000, full: true, required: spec.needsReason, idPrefix: 'tr' })}
    </div><div class="error" role="alert" data-testid="transition-error"></div>
    <div class="actions"><button type="button" data-close>Close</button>
      <button type="submit" data-testid="confirm-transition">${icon(spec.icon)}${escapeHtml(label)}</button></div></form>`, { testId: 'transition-dialog' })
  const form = dialog.querySelector('form')
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const reason = form.elements.reason.value.trim()
    const units = spec.units ? Number(form.elements.approved_units.value) : null
    const errors = {}
    if (spec.needsReason && !reason) errors.reason = 'A reason is required.'
    if (spec.units && (!Number.isInteger(units) || units < 1 || units >= auth.units)) errors.approved_units = `Enter between 1 and ${auth.units - 1} units.`
    if (Object.keys(errors).length) { showFieldErrors(form, errors); return }
    const { error } = await busy(form.querySelector('[type=submit]'), () => supabase.rpc('mp_transition_authorization', {
      p_id: auth.id, p_to_status: toStatus, p_reason: reason, p_approved_units: units, p_expected_updated_at: auth.updated_at,
    }))
    if (error) {
      const described = describeError(error)
      form.querySelector('[data-testid="transition-error"]').innerHTML = `${escapeHtml(described.message)}${described.kind === 'conflict'
        ? ' <button type="button" class="text-button" data-reload>Reload</button>' : ''}`
      form.querySelector('[data-reload]')?.addEventListener('click', () => { closeModal(); onDone() })
      return
    }
    closeModal()
    toast(`${auth.auth_number} is now ${titleCase(toStatus)}.`)
    onDone()
  })
}

export async function renderAuthorizationDetail(ctx) {
  const { main, params } = ctx
  const auth = await unwrap(supabase.from('mp_authorization_list').select('*')
    .eq('org_id', session.orgId).eq('auth_number', params.number).maybeSingle())
  if (!ctx.isCurrent()) return
  if (!auth) {
    main.innerHTML = errorState(`Authorization ${params.number} was not found in the current IPA.`)
    return
  }
  const [codes, documents, notes, claims, events] = await Promise.all([
    loadCodeDescriptions(auth),
    unwrap(supabase.from('mp_documents').select('*').eq('authorization_id', auth.id).order('created_at', { ascending: false })),
    unwrap(supabase.from('mp_note_list').select('*').eq('authorization_id', auth.id).order('created_at', { ascending: false })),
    unwrap(supabase.from('mp_claim_list').select('claim_number, status, service_from, billed_amount, paid_amount').eq('authorization_id', auth.id).order('service_from')),
    unwrap(supabase.from('mp_activity_events').select('*').eq('related_authorization_id', auth.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(50)),
  ])
  if (!ctx.isCurrent()) return
  const refresh = () => renderAuthorizationDetail(ctx)
  const transitions = availableTransitions(auth)
  const codeLabel = (code) => `${text(code)}${codes[code] ? ` — ${text(codes[code])}` : ''}`
  const writer = can('writeNote')
  const actionButtons = [
    ...(auth.status === 'draft' && can('createRequest') ? [`<a class="text-button" href="#/authorization-request/${text(auth.auth_number)}/edit" data-testid="edit-draft">${icon('edit')}Edit Draft</a>`] : []),
    ...(auth.status === 'deferred' && can('createRequest') ? [`<a class="text-button" href="#/authorization-request/${text(auth.auth_number)}/edit" data-testid="resubmit">${icon('replay')}Resubmit with Information</a>`] : []),
    ...transitions.map((status) => `<button type="button" class="text-button" data-transition="${status}" data-testid="action-${status}">${icon(TRANSITIONS[status].icon)}${
      status === 'cancelled' && ['approved', 'modified'].includes(auth.status) ? 'Cancel Authorization' : TRANSITIONS[status].label}</button>`),
    ...((auth.status === 'draft' && can('createRequest')) || role() === 'admin'
      ? [`<button type="button" class="text-button danger" id="delete-auth" data-testid="delete-authorization">${icon('delete')}${auth.status === 'draft' ? 'Delete Draft' : 'Delete (admin)'}</button>`] : []),
  ]

  main.innerHTML = `${approximationNotice('Mock approximation: production authorization details were never opened. This layout and workflow are locally designed and backed by synthetic Supabase records.')}
    <section class="card detail-card" data-testid="authorization-detail" data-record-id="${auth.id}" data-status="${auth.status}">
      <div class="card-title-row"><h1>Authorization ${text(auth.auth_number)}</h1>${statusBadge(auth.status, auth.status_label)}</div>
      ${auth.decision_reason ? `<div class="warning" data-testid="decision-reason">Decision note: ${text(auth.decision_reason)}</div>` : ''}
      ${detailGrid([
        ['Reference No.', text(auth.reference_number), 'reference_number'],
        ['Status', text(auth.status_label), 'status'],
        ['Priority', text(titleCase(auth.priority)), 'priority'],
        ['Request Date', formatDate(auth.request_date), 'request_date'],
        ['Authorization Date', formatDate(auth.authorization_date), 'authorization_date'],
        ['Expiration Date', formatDate(auth.expiration_date), 'expiration_date'],
        ['Units Requested', text(auth.units), 'units'],
        ['Units Approved', text(auth.approved_units), 'approved_units'],
        ['Health Plan', text(auth.health_plan_name), 'health_plan'],
        ['Member', `<a href="#/members/${text(auth.member_number)}" data-testid="member-link">${text(auth.member_name)} (${text(auth.member_number)})</a>`, 'member'],
        ['Member DOB / Sex', `${formatDate(auth.member_birth_date)} / ${text(auth.member_sex)}`, 'member_dob'],
        ['Requested Provider', text(auth.requested_provider_name), 'requested_provider'],
        ['Referring Provider', text(auth.referring_provider_name), 'referring_provider'],
        ['Service', codeLabel(auth.service_code), 'service_code'],
        ['Diagnosis', codeLabel(auth.diagnosis_code), 'diagnosis_code'],
        ['Place of Service', codeLabel(auth.place_of_service), 'place_of_service'],
        ['Created By', text(auth.created_by_name || 'Demo Seed Process'), 'created_by'],
        ['Last Updated', formatDateTime(auth.updated_at), 'updated_at'],
      ])}
      <h2 class="section-title">Clinical Summary</h2><p class="clinical-summary" data-testid="clinical-summary">${text(auth.clinical_summary) || '<span class="muted">None provided.</span>'}</p>
      <div class="detail-actions" data-testid="authorization-actions">${actionButtons.join('') || `<span class="muted" data-testid="no-actions">No actions available for your role (${text(titleCase(role() || 'none'))}) at this status.</span>`}</div>
    </section>
    <section class="card" data-testid="attachments-section"><h2>Attachments</h2><div id="attachments">${attachmentRows(documents)}</div>
      ${can('upload') ? uploadForm({ idPrefix: 'auth-upload' }) : ''}</section>
    <section class="card" data-testid="notes-section"><h2>Consult Notes</h2>
      ${writer ? `<form id="note-form" class="note-form" novalidate data-testid="note-form"><div class="form-grid two">${noteFields()}</div>
        <div class="actions"><button type="submit" data-testid="add-note">${icon('note_add')}Add Note</button></div></form>` : ''}
      <div id="notes">${noteList(notes)}</div></section>
    <section class="card" data-testid="claims-section"><h2>Related Claims</h2>${claims.length
      ? `<div class="table-wrap"><table data-testid="related-claims"><thead><tr><th>Claim No.</th><th>Status</th><th>Service Date</th><th>Billed</th><th>Paid</th></tr></thead><tbody>${claims.map((c) =>
        `<tr><td><a href="#/claims/${text(c.claim_number)}">${text(c.claim_number)}</a></td><td>${statusBadge(c.status, titleCase(c.status))}</td><td>${formatDate(c.service_from)}</td><td>${formatMoney(c.billed_amount)}</td><td>${formatMoney(c.paid_amount)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No claims reference this authorization.</p>'}</section>
    <section class="card" data-testid="timeline-section"><h2>Activity</h2>${events.length
      ? `<ol class="timeline" data-testid="activity-timeline">${events.map((e) => `<li data-action="${text(e.action)}" data-testid="timeline-event">
        <strong>${text(titleCase(e.action))}</strong>${e.to_status ? ` <span class="muted">${text(e.from_status || '—')} → ${text(e.to_status)}</span>` : ''}
        ${e.entity_type !== 'authorization' ? ` <span class="muted">(${text(e.entity_label)})</span>` : ''}
        <div class="muted">${text(e.actor_name)} · ${formatDateTime(e.created_at)}</div>${e.note ? `<div>${text(e.note)}</div>` : ''}</li>`).join('')}</ol>`
      : '<p class="muted">No activity recorded.</p>'}</section>`

  main.querySelectorAll('[data-transition]').forEach((button) =>
    button.addEventListener('click', () => transitionDialog(auth, button.dataset.transition, refresh)))

  $('#delete-auth')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Delete authorization ${auth.auth_number}, its notes, and its attachments? This cannot be undone.`))) return
    const { data: paths, error } = await supabase.rpc('mp_delete_authorization', { p_id: auth.id })
    if (error) { toast(describeError(error).message, 'error'); return }
    if (paths?.length) await supabase.storage.from(config.bucket).remove(paths)
    toast(`Deleted ${auth.auth_number}.`)
    go('/authorization-request/my')
  })

  main.querySelector('.upload-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (await handleUpload(event.currentTarget, { authorizationId: auth.id })) refresh()
  })
  $('#attachments').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete-doc]')
    const doc = button && documents.find((d) => d.id === button.dataset.deleteDoc)
    if (doc && await confirmDeleteDocument(doc)) refresh()
  })

  $('#note-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (await createNote({ authorizationId: auth.id, memberId: auth.member_id, form: event.currentTarget })) refresh()
  })
  $('#notes').addEventListener('click', async (event) => {
    const editId = event.target.closest('[data-edit-note]')?.dataset.editNote
    const deleteId = event.target.closest('[data-delete-note]')?.dataset.deleteNote
    if (editId) editNoteDialog(notes.find((n) => n.id === editId), refresh)
    if (deleteId && await deleteNote(notes.find((n) => n.id === deleteId))) refresh()
  })
}
