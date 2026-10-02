import { approximationNotice, errorState, statusBadge } from '../components/feedback.js'
import { noteList } from '../components/notes.js'
import { escapeHtml, icon } from '../lib/dom.js'
import { formatDate, formatMoney, titleCase } from '../lib/format.js'
import { can, session } from '../lib/session.js'
import { supabase, unwrap } from '../lib/supabase.js'
import { detailGrid } from './authorizationDetail.js'

const text = (value) => escapeHtml(value ?? '')
const notice = (what) => approximationNotice(`Mock approximation: production ${what} details were never opened. This view is locally designed and shows synthetic Supabase records only.`)

function miniTable(testId, headers, rows) {
  if (!rows.length) return '<p class="muted">None.</p>'
  return `<div class="table-wrap"><table data-testid="${testId}"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
}

export async function renderMemberDetail(ctx) {
  const { main, params } = ctx
  const member = await unwrap(supabase.from('mp_member_list').select('*').eq('org_id', session.orgId).eq('member_number', params.number).maybeSingle())
  if (!ctx.isCurrent()) return
  if (!member) { main.innerHTML = errorState(`Member ${params.number} was not found in the current IPA.`); return }
  const [auths, claims, notes] = await Promise.all([
    unwrap(supabase.from('mp_authorization_list').select('auth_number, status, status_label, request_date, service_code').eq('member_id', member.id).order('request_date', { ascending: false }).limit(10)),
    unwrap(supabase.from('mp_claim_list').select('claim_number, status, service_from, billed_amount, paid_amount').eq('member_id', member.id).order('service_from', { ascending: false }).limit(10)),
    unwrap(supabase.from('mp_note_list').select('*').eq('member_id', member.id).order('created_at', { ascending: false }).limit(10)),
  ])
  if (!ctx.isCurrent()) return
  main.innerHTML = `${notice('member')}
    <section class="card detail-card" data-testid="member-detail" data-record-id="${member.id}">
      <div class="card-title-row"><h1>${text(member.member_name)} <span class="muted">${text(member.member_number)}</span></h1>
        ${statusBadge(member.eligibility_status, `Eligibility: ${titleCase(member.eligibility_status)}`)}</div>
      ${detailGrid([
        ['Member ID', text(member.member_number), 'member_number'], ['SSN', '<span class="muted">DEMO-ONLY (not stored)</span>'],
        ['Birth Date', formatDate(member.birth_date), 'birth_date'], ['Age', text(member.age_years)], ['Sex', text(member.sex), 'sex'],
        ['Health Plan', text(member.health_plan_name), 'health_plan'], ['PCP', text(member.pcp_name), 'pcp'],
        ['Eligibility', text(titleCase(member.eligibility_status)), 'eligibility_status'],
        ['Eligible From', formatDate(member.eligibility_start), 'eligibility_start'], ['Eligible Through', formatDate(member.eligibility_end) || 'Open-ended', 'eligibility_end'],
        ['Enrolled', formatDate(member.enrolled_on)], ['Last PCP Visit', formatDate(member.last_pcp_visit) || 'None on record', 'last_pcp_visit'],
        ['Hospitalized', member.hospitalized ? `${text(member.hospital_name)} since ${formatDate(member.hospitalized_since)}` : 'No', 'hospitalized'],
        ['Phone', text(member.phone)], ['Email', text(member.email)], ['Address', text(`${member.address}, ${member.city} ${member.zip}`)],
      ])}
      ${can('createRequest') ? `<div class="detail-actions"><a class="text-button" href="#/authorization-request?member=${text(member.member_number)}" data-testid="new-request-for-member">${icon('add')}New Request for Member</a></div>` : ''}
    </section>
    <section class="card"><div class="card-title-row"><h2>Authorizations</h2><a class="text-button" href="#/authorizations/search?searched=1&member_number=${text(member.member_number)}">View all</a></div>
      ${miniTable('member-authorizations', ['Auth. No.', 'Status', 'Req. Date', 'Service'], auths.map((a) =>
        `<tr data-status="${a.status}"><td><a href="#/authorizations/${text(a.auth_number)}">${text(a.auth_number)}</a></td><td>${statusBadge(a.status, a.status_label)}</td><td>${formatDate(a.request_date)}</td><td>${text(a.service_code)}</td></tr>`))}</section>
    <section class="card"><div class="card-title-row"><h2>Claims</h2><a class="text-button" href="#/claims/search?searched=1&member_number=${text(member.member_number)}">View all</a></div>
      ${miniTable('member-claims', ['Claim No.', 'Status', 'Service Date', 'Billed', 'Paid'], claims.map((c) =>
        `<tr><td><a href="#/claims/${text(c.claim_number)}">${text(c.claim_number)}</a></td><td>${statusBadge(c.status, titleCase(c.status))}</td><td>${formatDate(c.service_from)}</td><td>${formatMoney(c.billed_amount)}</td><td>${formatMoney(c.paid_amount)}</td></tr>`))}</section>
    <section class="card"><h2>Consult Notes</h2>${noteList(notes.map((n) => ({ ...n, author_user_id: null })))}</section>`
}

export async function renderClaimDetail(ctx) {
  const { main, params } = ctx
  const claim = await unwrap(supabase.from('mp_claim_list').select('*').eq('org_id', session.orgId).eq('claim_number', params.number).maybeSingle())
  if (!ctx.isCurrent()) return
  if (!claim) { main.innerHTML = errorState(`Claim ${params.number} was not found in the current IPA.`); return }
  main.innerHTML = `${notice('claim')}
    <section class="card detail-card" data-testid="claim-detail" data-record-id="${claim.id}" data-status="${claim.status}">
      <div class="card-title-row"><h1>Claim ${text(claim.claim_number)}</h1>${statusBadge(claim.status, titleCase(claim.status))}</div>
      ${detailGrid([
        ['Claim No.', text(claim.claim_number), 'claim_number'], ['Check Number', text(claim.check_number), 'check_number'],
        ['Status', text(titleCase(claim.status)), 'status'], ['Member', `<a href="#/members/${text(claim.member_number)}">${text(claim.member_name)} (${text(claim.member_number)})</a>`, 'member'],
        ['Member Birth Date', formatDate(claim.member_birth_date)], ['Provider', text(claim.provider_name), 'provider'],
        ['Health Plan', text(claim.health_plan_name), 'health_plan'], ['Service From', formatDate(claim.service_from), 'service_from'],
        ['Service To', formatDate(claim.service_to), 'service_to'], ['Service Code', text(claim.service_code)], ['Diagnosis Code', text(claim.diagnosis_code)],
        ['Authorization', claim.auth_number ? `<a href="#/authorizations/${text(claim.auth_number)}">${text(claim.auth_number)}</a>` : '', 'authorization'],
        ['Billed', formatMoney(claim.billed_amount), 'billed_amount'], ['Allowed', formatMoney(claim.allowed_amount), 'allowed_amount'],
        ['Paid', formatMoney(claim.paid_amount), 'paid_amount'], ['Received', formatDate(claim.received_date)], ['Paid Date', formatDate(claim.paid_date)],
        ['Denial Reason', text(claim.denial_reason), 'denial_reason'],
      ])}</section>`
}

export async function renderProviderDetail(ctx) {
  const { main, params } = ctx
  const provider = await unwrap(supabase.from('mp_provider_list').select('*').eq('org_id', session.orgId).eq('npi', params.npi).maybeSingle())
  if (!ctx.isCurrent()) return
  if (!provider) { main.innerHTML = errorState(`Provider ${params.npi} was not found in the current IPA.`); return }
  const [{ count: pcpCount }, { count: authCount }] = await Promise.all([
    supabase.from('mp_members').select('id', { count: 'exact', head: true }).eq('pcp_provider_id', provider.id),
    supabase.from('mp_authorizations').select('id', { count: 'exact', head: true }).eq('requested_provider_id', provider.id),
  ])
  if (!ctx.isCurrent()) return
  main.innerHTML = `${notice('provider')}
    <section class="card detail-card" data-testid="provider-detail" data-record-id="${provider.id}">
      <div class="card-title-row"><h1>Dr. ${text(provider.first_name)} ${text(provider.last_name)}</h1><span class="badge">${text(provider.specialty)}</span></div>
      ${detailGrid([
        ['NPI (synthetic)', text(provider.npi), 'npi'], ['Specialty', text(provider.specialty), 'specialty'], ['Group', text(provider.group_name)],
        ['Phone', text(provider.phone)], ['Email', text(provider.email)], ['Address', text(`${provider.address}, ${provider.city} ${provider.zip}`)],
        ['Hospitals', text(provider.hospitals_text)], ['Health Plans', text(provider.health_plans.join(', '))],
        ['PCP Members', text(pcpCount ?? 0), 'pcp_members'], ['Authorizations Requested', text(authCount ?? 0), 'authorization_count'],
      ])}</section>`
}
