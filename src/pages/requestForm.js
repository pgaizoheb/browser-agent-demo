import { ACCEPT } from '../components/attachments.js'
import { approximationNotice, busy, errorState, permissionState, statusBadge, toast } from '../components/feedback.js'
import { field, showFieldErrors } from '../components/field.js'
import { loadProviders, loadReferenceCodes, uploadDocument, validateUpload } from '../lib/data.js'
import { $, escapeHtml, icon } from '../lib/dom.js'
import { describeError } from '../lib/errors.js'
import { formatDate, titleCase, today } from '../lib/format.js'
import { go } from '../lib/router.js'
import { can, session } from '../lib/session.js'
import { supabase } from '../lib/supabase.js'

const choose = (label, options) => [{ value: '', label }, ...options]

// Maps server validation sentences to form fields.
const SERVER_FIELD_HINTS = [
  [/^Member is not eligible/, 'member_number'], [/^Member/, 'member_number'], [/^Requested provider/, 'requested_provider_id'],
  [/^Referring provider/, 'referring_provider_id'], [/^Service code/, 'service_code'], [/^Diagnosis/, 'diagnosis_code'],
  [/^Place of service/, 'place_of_service'], [/^Units/, 'units'], [/^Priority/, 'priority'], [/^Clinical summary/, 'clinical_summary'],
]

async function findMember(number) {
  const { data, error } = await supabase.from('mp_member_list')
    .select('id, member_number, member_name, birth_date, health_plan_name, eligibility_status, pcp_name')
    .eq('org_id', session.orgId).eq('member_number', number.trim().toUpperCase()).maybeSingle()
  if (error) throw error
  return data
}

function memberCard(member) {
  if (!member) return ''
  return `<div class="member-card" data-testid="member-card" data-eligibility="${member.eligibility_status}">
    <strong>${escapeHtml(member.member_name)}</strong> · ${escapeHtml(member.member_number)} · DOB ${formatDate(member.birth_date)}
    · ${escapeHtml(member.health_plan_name)} · ${statusBadge(member.eligibility_status, titleCase(member.eligibility_status))}
    ${member.pcp_name ? ` · PCP ${escapeHtml(member.pcp_name)}` : ''}</div>`
}

function clientErrors(values, member, submit) {
  const errors = {}
  if (!values.member_number) errors.member_number = 'Member ID is required.'
  else if (!member) errors.member_number = 'No member with this ID exists in the current IPA.'
  else if (submit && member.eligibility_status !== 'eligible') errors.member_number = 'Member is not eligible on the request date.'
  if (!values.requested_provider_id) errors.requested_provider_id = 'Requested provider is required.'
  if (!values.service_code) errors.service_code = 'Service code is required.'
  if (!values.diagnosis_code) errors.diagnosis_code = 'Diagnosis code is required.'
  if (!values.place_of_service) errors.place_of_service = 'Place of service is required.'
  const units = Number(values.units)
  if (!Number.isInteger(units) || units < 1 || units > 999) errors.units = 'Units must be a whole number between 1 and 999.'
  if (!values.request_date) errors.request_date = 'Request date is required.'
  if (submit && values.clinical_summary.trim().length < 20) errors.clinical_summary = 'Clinical summary must be at least 20 characters to submit.'
  return errors
}

export async function renderRequestForm(ctx) {
  const { main, params, query } = ctx
  const editing = Boolean(params.number)
  if (!can('createRequest')) {
    main.innerHTML = `${approximationNotice()}${permissionState('Submitting authorization requests requires the Provider Office Staff or IPA Administrator role.')}`
    return
  }

  const [providers, services, diagnoses, places] = await Promise.all([
    loadProviders(), loadReferenceCodes('service'), loadReferenceCodes('diagnosis'), loadReferenceCodes('place_of_service'),
  ])
  let existing = null
  if (editing) {
    const { data, error } = await supabase.from('mp_authorization_list').select('*')
      .eq('org_id', session.orgId).eq('auth_number', params.number).maybeSingle()
    if (error) throw error
    if (!ctx.isCurrent()) return
    if (!data) { main.innerHTML = errorState(`Authorization ${params.number} was not found in the current IPA.`); return }
    if (!['draft', 'deferred'].includes(data.status)) {
      main.innerHTML = errorState(`Authorization ${params.number} is ${data.status_label} and can no longer be edited.`)
      return
    }
    existing = data
  }
  if (!ctx.isCurrent()) return

  const values = existing || { member_number: query.get('member') || '', units: 1, priority: 'routine', request_date: today(), clinical_summary: '' }
  const resubmit = existing?.status === 'deferred'
  const title = resubmit ? `Resubmit ${existing.auth_number}` : editing ? `Edit Draft ${existing.auth_number}` : 'Submit Request'

  main.innerHTML = `${approximationNotice('Mock approximation: the production request form was never opened. This form, its validation, and its workflow are designed for testing and write only to the synthetic Supabase dataset.')}
    <section class="card request-card"><h1>${escapeHtml(title)}</h1>
    ${resubmit ? `<div class="warning" data-testid="deferral-reason">Deferred: ${escapeHtml(existing.decision_reason)}</div>` : ''}
    <div class="alert hidden" role="alert" data-testid="form-error" id="form-error"></div>
    <form id="request-form" novalidate data-testid="request-form">
      <div class="form-grid request-grid">
        <div class="member-lookup">${field({ name: 'member_number', label: 'Member ID', value: values.member_number, required: true, idPrefix: 'req' })}
          <button type="button" class="text-button" id="find-member" data-testid="find-member">${icon('person_search')}Find</button></div>
        ${field({ name: 'requested_provider_id', label: 'Requested Provider', type: 'select', options: choose('Select a provider', providers), value: values.requested_provider_id, required: true, idPrefix: 'req' })}
        ${field({ name: 'referring_provider_id', label: 'Referring Provider', type: 'select', options: choose('None', providers), value: values.referring_provider_id, idPrefix: 'req' })}
        ${field({ name: 'service_code', label: 'Service Code', type: 'select', options: choose('Select a service', services), value: values.service_code, required: true, idPrefix: 'req' })}
        ${field({ name: 'diagnosis_code', label: 'Diagnosis Code', type: 'select', options: choose('Select a diagnosis', diagnoses), value: values.diagnosis_code, required: true, idPrefix: 'req' })}
        ${field({ name: 'place_of_service', label: 'Place of Service', type: 'select', options: choose('Select a place of service', places), value: values.place_of_service, required: true, idPrefix: 'req' })}
        ${field({ name: 'units', label: 'Units', type: 'number', min: 1, max: 999, value: values.units, required: true, idPrefix: 'req' })}
        ${field({ name: 'priority', label: 'Priority', type: 'select', options: [{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }], value: values.priority, idPrefix: 'req' })}
        ${field({ name: 'request_date', label: 'Request Date', type: 'date', value: values.request_date, required: true, idPrefix: 'req' })}
        <div id="member-card-slot" class="full"></div>
        ${field({ name: 'clinical_summary', label: 'Clinical Summary (synthetic; 20+ characters to submit)', type: 'textarea', value: values.clinical_summary, maxlength: 4000, rows: 5, full: true, idPrefix: 'req' })}
        ${field({ name: 'attachments', label: 'Attachments (synthetic test files: PDF, TXT, PNG, JPEG; max 5 MB each)', type: 'file', accept: ACCEPT, multiple: true, full: true, idPrefix: 'req' })}
      </div>
      <div class="actions"><a class="text-button" href="#${editing ? `/authorizations/${escapeHtml(existing.auth_number)}` : '/authorization-request/my'}">${icon('arrow_back')}Cancel</a>
        <div class="right-actions">
          ${resubmit ? '' : `<button type="submit" value="draft" data-testid="save-draft">${icon('save')}Save Draft</button>`}
          <button type="submit" value="submit" data-testid="submit-request">${icon('send')}${resubmit ? 'Resubmit Request' : 'Submit Request'}</button>
        </div></div>
    </form></section>`

  const form = $('#request-form')
  const formError = $('#form-error')
  let member = null

  async function lookup() {
    const number = form.elements.member_number.value.trim()
    member = null
    $('#member-card-slot').innerHTML = ''
    if (!number) return null
    try {
      member = await findMember(number)
      $('#member-card-slot').innerHTML = member ? memberCard(member) : '<p class="error" data-testid="member-not-found">No member with this ID exists in the current IPA.</p>'
    } catch (error) {
      $('#member-card-slot').innerHTML = `<p class="error">${escapeHtml(describeError(error).message)}</p>`
    }
    return member
  }
  $('#find-member').addEventListener('click', lookup)
  form.elements.member_number.addEventListener('change', lookup)
  if (values.member_number) lookup()

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const submit = event.submitter?.value !== 'draft'
    formError.classList.add('hidden')
    const data = Object.fromEntries(new FormData(form).entries())
    if (!member || member.member_number !== data.member_number.trim().toUpperCase()) await lookup()
    const errors = clientErrors(data, member, submit)
    const files = [...form.elements.attachments.files]
    const badFile = files.map(validateUpload).find(Boolean)
    if (badFile) errors.attachments = badFile
    if (Object.keys(errors).length) { showFieldErrors(form, errors); return }
    showFieldErrors(form, {})

    const payload = {
      member_id: member.id, requested_provider_id: data.requested_provider_id, referring_provider_id: data.referring_provider_id || null,
      service_code: data.service_code, diagnosis_code: data.diagnosis_code, place_of_service: data.place_of_service,
      units: Number(data.units), priority: data.priority, request_date: data.request_date, clinical_summary: data.clinical_summary.trim(),
    }
    const { data: saved, error } = await busy(event.submitter, () => supabase.rpc('mp_save_authorization', {
      p_org_id: session.orgId, p_data: payload, p_id: existing?.id || null, p_submit: submit,
    }), submit ? 'Submitting…' : 'Saving…')
    if (error) {
      const described = describeError(error)
      formError.textContent = described.message
      formError.classList.remove('hidden')
      const fieldErrors = {}
      for (const sentence of described.fields || []) {
        const match = SERVER_FIELD_HINTS.find(([pattern]) => pattern.test(sentence))
        if (match && !fieldErrors[match[1]]) fieldErrors[match[1]] = sentence
      }
      showFieldErrors(form, fieldErrors)
      return
    }
    let failedUploads = 0
    for (const file of files) {
      try { await uploadDocument({ authorizationId: saved.id, file, category: 'Authorization', description: 'Attached with request' }) } catch { failedUploads += 1 }
    }
    toast(`Request ${saved.auth_number} ${submit ? (resubmit ? 'resubmitted' : 'submitted') : 'saved as draft'}.${failedUploads ? ` ${failedUploads} attachment(s) failed to upload.` : ''}`,
      failedUploads ? 'error' : 'success')
    go(`/authorizations/${saved.auth_number}`)
  })
}
