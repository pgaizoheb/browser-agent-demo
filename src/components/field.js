import { escapeHtml, slug } from '../lib/dom.js'

export const DATE_PRESETS = [
  { value: '', label: 'Any' },
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 Days' },
  { value: '30', label: 'Last 30 Days' },
  { value: 'custom', label: 'Custom' },
]

function normalizeOptions(options = []) {
  return options.map((option) => (typeof option === 'string' ? { value: option, label: option } : option))
}

/**
 * Material-style underline field matching the mock markup.
 * type: text | number | date | select | textarea | file
 */
export function field({
  name, label, type = 'text', value = '', options, full = false, required = false, hint = '',
  min, max, maxlength, rows = 4, accept, multiple = false, idPrefix = 'f', extraClass = '', autocomplete = 'off',
}) {
  const id = `${idPrefix}-${slug(name)}`
  const isSelect = type === 'select'
  const raisedLabel = isSelect || type === 'date' || type === 'textarea' || type === 'file'
  const classes = ['field', full && 'full', isSelect && 'select-field', raisedLabel && !isSelect && 'date-field',
    type === 'textarea' && 'textarea-field', type === 'file' && 'file-field', extraClass].filter(Boolean).join(' ')
  const describedBy = `${id}-error${hint ? ` ${id}-hint` : ''}`
  const common = `id="${id}" name="${escapeHtml(name)}" aria-describedby="${describedBy}" ${required ? 'required aria-required="true"' : ''}`
  let control
  if (isSelect) {
    control = `<select ${common}>${normalizeOptions(options).map((o) =>
      `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(value ?? '') ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`
  } else if (type === 'textarea') {
    control = `<textarea ${common} rows="${rows}" ${maxlength ? `maxlength="${maxlength}"` : ''} placeholder=" ">${escapeHtml(value)}</textarea>`
  } else if (type === 'file') {
    control = `<input ${common} type="file" ${accept ? `accept="${escapeHtml(accept)}"` : ''} ${multiple ? 'multiple' : ''}>`
  } else {
    control = `<input ${common} type="${type}" value="${escapeHtml(value)}" placeholder=" " autocomplete="${autocomplete}"
      ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} ${maxlength ? `maxlength="${maxlength}"` : ''}>`
  }
  return `<div class="${classes}" data-field="${escapeHtml(name)}"><label for="${id}">${escapeHtml(label)}</label>${control}
    ${hint ? `<small class="field-hint" id="${id}-hint">${escapeHtml(hint)}</small>` : ''}
    <div class="field-error" id="${id}-error" data-testid="error-${slug(name)}" role="alert"></div></div>`
}

/** Select with Any/Today/Last 7/Last 30/Custom; Custom reveals from/to date inputs. */
export function dateRangeField({ name, label, full = false, preset = '', from = '', to = '' }) {
  const id = `f-${slug(name)}`
  const custom = preset === 'custom'
  return `<div class="field select-field date-range ${full ? 'full' : ''}" data-date-range="${escapeHtml(name)}">
    <label for="${id}">${escapeHtml(label)}</label>
    <div class="date-range-row">
      <select id="${id}" name="${escapeHtml(name)}">${DATE_PRESETS.map((o) =>
        `<option value="${o.value}" ${o.value === preset ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
      <input type="date" class="date-custom ${custom ? '' : 'hidden'}" name="${escapeHtml(name)}_from" value="${escapeHtml(from)}" aria-label="${escapeHtml(label)} from">
      <input type="date" class="date-custom ${custom ? '' : 'hidden'}" name="${escapeHtml(name)}_to" value="${escapeHtml(to)}" aria-label="${escapeHtml(label)} to">
    </div>
  </div>`
}

/** Wires date-range selects inside root so Custom toggles the extra inputs. */
export function wireDateRanges(root) {
  root.querySelectorAll('[data-date-range] select').forEach((select) => {
    select.addEventListener('change', () => {
      select.parentElement.querySelectorAll('.date-custom').forEach((input) => {
        input.classList.toggle('hidden', select.value !== 'custom')
      })
    })
  })
}

export function showFieldErrors(form, errors) {
  form.querySelectorAll('.field-error').forEach((el) => { el.textContent = '' })
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'))
  for (const [name, message] of Object.entries(errors)) {
    const wrapper = form.querySelector(`[data-field="${name}"]`)
    if (!wrapper) continue
    wrapper.querySelector('.field-error').textContent = message
    wrapper.querySelector('input, select, textarea')?.setAttribute('aria-invalid', 'true')
  }
  const first = Object.keys(errors)[0]
  if (first) form.querySelector(`[data-field="${first}"] input, [data-field="${first}"] select, [data-field="${first}"] textarea`)?.focus()
}
