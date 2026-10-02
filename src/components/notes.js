import { escapeHtml, icon } from '../lib/dom.js'
import { describeError } from '../lib/errors.js'
import { formatDateTime, titleCase } from '../lib/format.js'
import { can, role, session, userId } from '../lib/session.js'
import { supabase } from '../lib/supabase.js'
import { busy, closeModal, confirmDialog, openModal, toast } from './feedback.js'
import { field, showFieldErrors } from './field.js'

export const NOTE_TYPES = [
  { value: 'consult', label: 'Consult' },
  { value: 'clinical', label: 'Clinical' },
  { value: 'administrative', label: 'Administrative' },
]

export const canEditNote = (note) => can('writeNote') && (note.author_user_id === userId() || role() === 'admin')

export function noteFields(note = {}, { includeAuthNumber = false } = {}) {
  return `${includeAuthNumber ? field({ name: 'auth_number', label: 'Authorization No.', value: note.auth_number || '', required: true, full: true, idPrefix: 'note' }) : ''}
    ${field({ name: 'note_type', label: 'Note type', type: 'select', options: NOTE_TYPES, value: note.note_type || 'consult', idPrefix: 'note' })}
    ${field({ name: 'subject', label: 'Subject', value: note.subject || '', required: true, maxlength: 200, idPrefix: 'note' })}
    ${field({ name: 'body', label: 'Note', type: 'textarea', value: note.body || '', required: true, maxlength: 8000, rows: 5, full: true, idPrefix: 'note' })}`
}

export function validateNote(form) {
  const errors = {}
  if (form.elements.auth_number && !form.elements.auth_number.value.trim()) errors.auth_number = 'Authorization No. is required.'
  if (!form.elements.subject.value.trim()) errors.subject = 'Subject is required.'
  if (!form.elements.body.value.trim()) errors.body = 'Note text is required.'
  return errors
}

export function noteList(notes) {
  if (!notes.length) return '<p class="muted" data-testid="notes-empty">No consult notes yet.</p>'
  return `<ul class="note-list" data-testid="note-list">${notes.map((note) => `<li class="note" data-record-id="${note.id}" data-testid="note-item">
      <div class="note-head"><strong data-testid="note-subject">${escapeHtml(note.subject)}</strong>
        <span class="badge">${escapeHtml(titleCase(note.note_type))}</span>
        <span class="muted">${escapeHtml(note.author_name || 'Unknown')} · ${formatDateTime(note.created_at)}${note.updated_at && note.updated_at !== note.created_at ? ' · edited' : ''}</span></div>
      <p class="note-body" data-testid="note-body">${escapeHtml(note.body)}</p>
      ${canEditNote(note) ? `<div class="note-actions"><button type="button" class="text-button" data-edit-note="${note.id}">${icon('edit')}Edit</button>
        <button type="button" class="text-button" data-delete-note="${note.id}">${icon('delete')}Delete</button></div>` : ''}
    </li>`).join('')}</ul>`
}

export async function createNote({ authorizationId, memberId, form }) {
  const errors = validateNote(form)
  if (Object.keys(errors).length) { showFieldErrors(form, errors); return null }
  showFieldErrors(form, {})
  const { data, error } = await busy(form.querySelector('[type=submit]'), () => supabase.from('mp_consult_notes').insert({
    org_id: session.orgId, authorization_id: authorizationId, member_id: memberId,
    note_type: form.elements.note_type.value, subject: form.elements.subject.value.trim(), body: form.elements.body.value.trim(),
  }).select().single())
  if (error) { showFieldErrors(form, { subject: describeError(error).message }); return null }
  toast('Consult note saved.')
  form.reset()
  return data
}

export function editNoteDialog(note, onSaved) {
  const dialog = openModal(`<h2 id="modal-title">Edit Consult Note</h2>
    <form id="edit-note-form" novalidate><div class="form-grid two">${noteFields(note)}</div>
    <div class="actions"><button type="button" data-close>Cancel</button><button type="submit" data-testid="save-note">${icon('save')}Save Note</button></div></form>`)
  const form = dialog.querySelector('form')
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const errors = validateNote(form)
    if (Object.keys(errors).length) { showFieldErrors(form, errors); return }
    const { data, error } = await busy(form.querySelector('[type=submit]'), () => supabase.from('mp_consult_notes').update({
      note_type: form.elements.note_type.value, subject: form.elements.subject.value.trim(), body: form.elements.body.value.trim(),
    }).eq('id', note.id).select())
    if (error || !data.length) {
      showFieldErrors(form, { subject: error ? describeError(error).message : 'You do not have permission to edit this note.' })
      return
    }
    closeModal()
    toast('Consult note updated.')
    onSaved()
  })
}

export async function deleteNote(note) {
  if (!(await confirmDialog(`Delete consult note "${note.subject}"?`))) return false
  const { data, error } = await supabase.from('mp_consult_notes').delete().eq('id', note.id).select('id')
  if (error || !data.length) {
    toast(error ? describeError(error).message : 'You do not have permission to delete this note.', 'error')
    return false
  }
  toast('Consult note deleted.')
  return true
}
