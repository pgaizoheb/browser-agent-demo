import logoUrl from '../assets/portal-logo.svg'
import { $, escapeHtml, icon } from '../lib/dom.js'
import { memberships, session } from '../lib/session.js'

export const NAV = [
  { label: 'Home', icon: 'home', path: '/' },
  {
    label: 'Authorizations', icon: 'edit', prefixes: ['/authorizations/', '/authorization-request', '/hospital-admin',
      '/my-data/recently-updated-authorizations', '/my-data/recent-authorization-attachments', '/my-data/consult-notes'],
    items: [
      ['Submit Request', '/authorization-request', 'input'],
      ['My Requests', '/authorization-request/my', 'list'],
      ['Search', '/authorizations/search', 'search'],
      ['Hospital Admin', '/hospital-admin', 'lock'],
      ['Recently Updated', '/my-data/recently-updated-authorizations', 'access_time'],
      ['Recent Attachments', '/my-data/recent-authorization-attachments', 'access_time'],
      ['Consult Notes', '/my-data/consult-notes', 'access_time'],
    ],
  },
  { label: 'Claims', icon: 'library_books', prefixes: ['/claims/'], items: [['Search', '/claims/search', 'search']] },
  {
    label: 'Members', icon: 'group', prefixes: ['/members/', '/my-data/my-members', '/my-data/members-'],
    items: [
      ['Eligibility', '/members/search', 'check'],
      ['My Members', '/my-data/my-members', 'people'],
      ['Members Approaching 65', '/my-data/members-approaching-65', 'perm_contact_calendar'],
      ['Members Hospitalized', '/my-data/members-hospitalized-pcp', 'local_hospital'],
      ['Members Without Visits in the Past Year', '/my-data/members-without-pcp-visits-in-the-past-year', 'history'],
      ['Members Without Visits Since Enrollment', '/my-data/members-without-pcp-visits-since-enrollment', 'event_busy'],
    ],
  },
  { label: 'Providers', icon: 'person', prefixes: ['/providers/'], items: [['Search', '/providers/search', 'search']] },
  { label: 'Reference', icon: 'book', path: '/references' },
  {
    label: 'Documents', icon: 'description', prefixes: ['/documents', '/forms'],
    items: [['My Documents', '/documents', 'folder'], ['Search', '/documents/search', 'search'], ['Forms and Manuals', '/forms', 'picture_as_pdf']],
  },
]

let expanded = ''
let currentPath = '/'

export function groupForPath(path) {
  return NAV.find((group) => group.items?.some(([, itemPath]) => itemPath === path))
    || NAV.find((group) => group.prefixes?.some((prefix) => path.startsWith(prefix)))
}

export function titleForPath(path) {
  for (const group of NAV) {
    const item = group.items?.find(([, itemPath]) => itemPath === path)
    if (item) return item[0]
  }
  return ''
}

function primaryNav() {
  return NAV.map((group) => group.items
    ? `<button type="button" class="nav-item ${expanded === group.label ? 'active' : ''}" data-nav="${group.label}" aria-expanded="${expanded === group.label}">${icon(group.icon)}${group.label}${icon(expanded === group.label ? 'expand_less' : 'expand_more')}</button>`
    : `<a class="nav-item ${currentPath === group.path ? 'active' : ''}" href="#${group.path}" ${currentPath === group.path ? 'aria-current="page"' : ''}>${icon(group.icon)}${group.label}</a>`).join('')
}

function secondaryNav() {
  const menu = NAV.find((group) => group.label === expanded)
  return menu?.items?.map(([label, path, itemIcon]) =>
    `<a class="${currentPath === path ? 'active' : ''}" href="#${path}" ${currentPath === path ? 'aria-current="page"' : ''}>${icon(itemIcon)}${label}</a>`).join('') || ''
}

function renderNav() {
  const primary = $('nav.primary')
  const secondary = $('nav.secondary')
  if (!primary) return
  primary.innerHTML = primaryNav()
  secondary.innerHTML = secondaryNav()
  secondary.classList.toggle('empty', !secondary.innerHTML)
}

export function mountShell(app, { onOrgChange, onLogout, onAccount }) {
  const name = session.status?.display_name || 'Demo User'
  app.innerHTML = `<header class="top-header">
      <a href="#/" class="logo-link"><img src="${logoUrl}" alt="MedPoint — LOCAL MOCK / DEMO"></a>
      <div class="ipa field select-field"><label for="ipa">Current IPA</label><select id="ipa" data-testid="ipa-select"></select></div>
      <div class="account"><span data-testid="account-name">${escapeHtml(name)}</span>
        <button type="button" id="account" aria-label="Demo account menu" data-testid="account-button">${icon('account_circle')}</button>
        <button type="button" id="logout" aria-label="Sign out" data-testid="logout-button">${icon('exit_to_app')}</button></div>
    </header>
    <nav class="primary" aria-label="Primary navigation"></nav>
    <nav class="secondary empty" aria-label="Secondary navigation"></nav>
    <main class="page" id="page" tabindex="-1"></main>`
  $('nav.primary').addEventListener('click', (event) => {
    const button = event.target.closest('[data-nav]')
    if (!button) return
    expanded = expanded === button.dataset.nav ? '' : button.dataset.nav
    renderNav()
  })
  $('#ipa').addEventListener('change', (event) => onOrgChange(event.target.value))
  $('#logout').addEventListener('click', onLogout)
  $('#account').addEventListener('click', onAccount)
  refreshOrgSelect()
  return $('#page')
}

export function refreshOrgSelect() {
  const select = $('#ipa')
  if (!select) return
  select.innerHTML = memberships().map((m) =>
    `<option value="${m.org_id}" ${m.org_id === session.orgId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')
}

export function updateShell(path) {
  currentPath = path
  expanded = groupForPath(path)?.label || ''
  renderNav()
}
