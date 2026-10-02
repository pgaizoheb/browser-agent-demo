import { downloadButton, viewButton } from '../components/files.js'
import { statusBadge } from '../components/feedback.js'
import { loadHealthPlans, loadProviders } from '../lib/data.js'
import { escapeHtml, icon } from '../lib/dom.js'
import { AUTH_STATUSES, CLAIM_STATUSES, formatDate, titleCase } from '../lib/format.js'
import { CATEGORIES } from '../components/attachments.js'

const all = (options) => [{ value: '', label: 'All' }, ...options]
const text = (value) => escapeHtml(value ?? '')
const link = (path, label, testId = 'record-link') => `<a href="#${path}" data-testid="${testId}">${text(label)}</a>`
const viewAction = (path) => `<a class="text-button" href="#${path}" data-testid="view-record">${icon('visibility')}View</a>`

export const SPECIALTIES = ['Cardiology', 'Dermatology', 'Endocrinology', 'Family Medicine', 'Internal Medicine', 'Neurology',
  'Orthopedic Surgery', 'Physical Therapy', 'Pulmonology', 'Radiology']
export const HOSPITALS = ['Demo General Hospital', 'Example Community Hospital', 'Mockingbird Regional (Demo)', 'Sample Valley Medical Center']

export const eligibilityBadge = (row) => statusBadge(row.eligibility_status, titleCase(row.eligibility_status))

export const authorizationColumns = [
  { label: 'Auth. No.', sort: 'auth_number', render: (r) => link(`/authorizations/${r.auth_number}`, r.auth_number) },
  { label: 'Status', sort: 'status', render: (r) => statusBadge(r.status, r.status_label) },
  { label: 'Member ID', sort: 'member_number', render: (r) => text(r.member_number) },
  { label: 'Member Name', sort: 'member_last_name', render: (r) => text(r.member_name) },
  { label: 'Sex', sort: 'member_sex', render: (r) => text(r.member_sex) },
  { label: 'DOB', sort: 'member_birth_date', render: (r) => formatDate(r.member_birth_date) },
  { label: 'Health Plan', sort: 'health_plan', render: (r) => text(r.health_plan_name) },
  { label: 'Provider', sort: 'requested_provider_last_name', render: (r) => text(r.requested_provider_name) },
  { label: 'Auth. Date', sort: 'authorization_date', render: (r) => formatDate(r.authorization_date) },
  { label: 'Req. Date', sort: 'request_date', render: (r) => formatDate(r.request_date) },
  { label: 'Actions', render: (r) => viewAction(`/authorizations/${r.auth_number}`) },
]

export const memberColumns = [
  { label: 'Eligibility', sort: 'eligibility_status', render: eligibilityBadge },
  { label: 'Name', sort: 'last_name', render: (r) => text(r.member_name) },
  { label: 'Member ID', sort: 'member_number', render: (r) => link(`/members/${r.member_number}`, r.member_number) },
  { label: 'SSN', render: () => '<span class="muted">DEMO-ONLY</span>' },
  { label: 'Sex', sort: 'sex', render: (r) => text(r.sex) },
  { label: 'Birth Date', sort: 'birth_date', render: (r) => formatDate(r.birth_date) },
  { label: 'Health Plan', sort: 'health_plan', render: (r) => text(r.health_plan_name) },
  { label: 'PCP', render: (r) => text(r.pcp_name) },
  { label: 'Options', render: (r) => viewAction(`/members/${r.member_number}`) },
]

export const documentColumns = [
  { label: 'Select', render: (r) => `<input type="checkbox" data-select-doc="${r.id}" aria-label="Select ${text(r.file_name)}">` },
  { label: 'Type', sort: 'doc_type', render: (r) => text(r.doc_type) },
  { label: 'Status', sort: 'status', render: (r) => statusBadge(r.status, titleCase(r.status)) },
  { label: 'Category', sort: 'category', render: (r) => text(r.category) },
  { label: 'Inbox', sort: 'inbox_name', render: (r) => text(r.inbox_name) },
  { label: 'Description', sort: 'description', render: (r) => `${text(r.description)}<br><small class="muted">${text(r.file_name)}</small>` },
  { label: 'Sent Date', sort: 'sent_date', render: (r) => formatDate(r.sent_date) },
  { label: 'Download', render: (r) => downloadButton(r) },
  { label: 'View', render: (r) => viewButton(r) },
]

export const SEARCH_CONFIGS = {
  '/authorizations/search': {
    title: 'Authorizations Search',
    source: 'mp_authorization_list',
    defaultSort: 'request_date.desc',
    fields: [
      { name: 'auth_number', label: 'Authorization No.', column: 'auth_number', op: 'ilike' },
      { name: 'reference_number', label: 'Reference No.', column: 'reference_number', op: 'ilike' },
      { name: 'status', label: 'Status', type: 'select', column: 'status', op: 'eq', options: all(AUTH_STATUSES) },
      { name: 'member_last_name', label: 'Member Last Name', column: 'member_last_name', op: 'ilike' },
      { name: 'member_first_name', label: 'Member First Name', column: 'member_first_name', op: 'ilike' },
      { name: 'member_number', label: 'Member Id', column: 'member_number', op: 'ilike' },
    ],
    advanced: [
      { name: 'request_date', label: 'Request Date', type: 'dateRange', column: 'request_date', full: true },
      { name: 'authorization_date', label: 'Authorization Date', type: 'dateRange', column: 'authorization_date', full: true },
      { name: 'expiration_date', label: 'Expiration Date', type: 'dateRange', column: 'expiration_date', full: true },
      { name: 'referring_provider_id', label: 'Referring Provider', type: 'select', column: 'referring_provider_id', op: 'eq', optionsLoader: async () => all(await loadProviders()) },
      { name: 'provider_last_name', label: 'Requested Provider Last Name', column: 'requested_provider_last_name', op: 'ilike' },
      { name: 'provider_first_name', label: 'Requested Provider First Name', column: 'requested_provider_first_name', op: 'ilike' },
    ],
    columns: authorizationColumns,
  },
  '/claims/search': {
    title: 'Claims Search',
    source: 'mp_claim_list',
    defaultSort: 'service_from.desc',
    fields: [
      { name: 'claim_number', label: 'Claim #', column: 'claim_number', op: 'ilike' },
      { name: 'check_number', label: 'Check Number', column: 'check_number', op: 'ilike' },
      { name: 'status', label: 'Status', type: 'select', column: 'status', op: 'eq', options: all(CLAIM_STATUSES) },
      { name: 'member_last_name', label: 'Member Last Name', column: 'member_last_name', op: 'ilike' },
      { name: 'member_first_name', label: 'Member First Name', column: 'member_first_name', op: 'ilike' },
      { name: 'member_number', label: 'Member Id', column: 'member_number', op: 'ilike' },
    ],
    advanced: [
      { name: 'member_birth_date', label: 'Member Birth Date', type: 'date', column: 'member_birth_date', op: 'eq' },
      { name: 'provider_id', label: 'Provider', type: 'select', column: 'provider_id', op: 'eq', optionsLoader: async () => all(await loadProviders()) },
      { name: 'service_from', label: 'Service From Date', type: 'date', column: 'service_from', op: 'gte' },
      { name: 'service_to', label: 'Service To Date', type: 'date', column: 'service_to', op: 'lte' },
      { name: 'health_plan', label: 'Health Plan', type: 'select', column: 'health_plan', op: 'eq', optionsLoader: async () => all(await loadHealthPlans()) },
    ],
    columns: [
      { label: 'Claim. No.', sort: 'claim_number', render: (r) => link(`/claims/${r.claim_number}`, r.claim_number) },
      { label: 'Member ID', sort: 'member_number', render: (r) => text(r.member_number) },
      { label: 'Member Name', sort: 'member_last_name', render: (r) => text(r.member_name) },
      { label: 'Provider', sort: 'provider_name', render: (r) => text(r.provider_name) },
      { label: 'Service Date', sort: 'service_from', render: (r) => formatDate(r.service_from) },
      { label: 'Status', sort: 'status', render: (r) => statusBadge(r.status, titleCase(r.status)) },
    ],
  },
  '/members/search': {
    title: 'Members Search',
    source: 'mp_member_list',
    defaultSort: 'last_name.asc',
    fields: [
      { name: 'last_name', label: 'Last Name', column: 'last_name', op: 'ilike' },
      { name: 'first_name', label: 'First Name', column: 'first_name', op: 'ilike' },
      { name: 'birth_date', label: 'Birth Date', type: 'date', column: 'birth_date', op: 'eq' },
      { name: 'member_number', label: 'Member ID', column: 'member_number', op: 'ilike' },
      { name: 'health_plan', label: 'Health Plan', type: 'select', column: 'health_plan', op: 'eq', optionsLoader: async () => all(await loadHealthPlans()) },
      { name: 'sex', label: 'Sex', type: 'select', column: 'sex', op: 'eq', options: all(['F', 'M', 'X']) },
    ],
    columns: memberColumns,
  },
  '/providers/search': {
    title: 'Providers Search',
    source: 'mp_provider_list',
    defaultSort: 'last_name.asc',
    fields: [
      { name: 'npi', label: 'NPI', column: 'npi', op: 'ilike' },
      { name: 'last_name', label: 'Last Name', column: 'last_name', op: 'ilike' },
      { name: 'first_name', label: 'First Name', column: 'first_name', op: 'ilike' },
      { name: 'specialty', label: 'Specialty', type: 'select', column: 'specialty', op: 'eq', options: all(SPECIALTIES) },
      { name: 'health_plan', label: 'Health Plan', type: 'select', column: 'health_plans', op: 'contains', optionsLoader: async () => all(await loadHealthPlans()) },
      { name: 'hospital', label: 'Hospital', type: 'select', column: 'hospitals', op: 'contains', options: all(HOSPITALS) },
      { name: 'city', label: 'City', column: 'city', op: 'ilike' },
      { name: 'zip', label: 'Zip', column: 'zip', op: 'ilike' },
    ],
    columns: [
      { label: 'Name', sort: 'last_name', render: (r) => link(`/providers/${r.npi}`, `Dr. ${r.first_name} ${r.last_name}`) },
      { label: 'Specialty', sort: 'specialty', render: (r) => text(r.specialty) },
      { label: 'Group', sort: 'group_name', render: (r) => text(r.group_name) },
      { label: 'Phone', render: (r) => text(r.phone) },
      { label: 'Email', render: (r) => text(r.email) },
      { label: 'Address', sort: 'city', render: (r) => text(`${r.address}, ${r.city} ${r.zip}`) },
      { label: 'Hospitals', render: (r) => text(r.hospitals_text) },
    ],
  },
  '/references': {
    title: 'Reference Search',
    kind: 'references',
    source: 'mp_reference_codes',
    orgScoped: false,
    defaultSort: 'code.asc',
    idleText: 'No references to display.',
    emptyText: 'No references to display.',
    fields: [
      { name: 'q', label: 'Code or Description', column: 'search_text', op: 'ilike-lower' },
    ],
    hiddenFilters: [{ name: 'type', column: 'code_type', op: 'eq' }],
    columns: [
      { label: 'Code', sort: 'code', render: (r) => text(r.code) },
      { label: 'Description', sort: 'description', render: (r) => text(r.description) },
    ],
  },
  '/documents/search': {
    title: 'Document Search',
    source: 'mp_document_list',
    defaultSort: 'sent_date.desc',
    pageSize: 25,
    fields: [
      { name: 'inbox', label: 'Inbox Name or Tax ID', column: 'inbox_search', op: 'ilike-lower' },
      { name: 'category', label: 'Category', type: 'select', column: 'category', op: 'eq', options: all(CATEGORIES) },
      { name: 'name', label: 'Document Name', column: 'file_name', op: 'ilike' },
      { name: 'sent_date', label: 'Sent Date', type: 'dateRange', column: 'sent_date' },
    ],
    columns: documentColumns,
    bulkRead: true,
  },
}

export const REFERENCE_TYPES = [
  { value: 'service', label: 'Service' },
  { value: 'diagnosis', label: 'Diagnosis' },
  { value: 'place_of_service', label: 'Place of Service' },
  { value: 'modifier', label: 'Modifier' },
]
