-- Authorization workflow RPC rules and consult-note RLS for the MedPoint LOCAL MOCK / DEMO
-- portal (synthetic data only). Runs inside one transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- Persona helper (called as postgres): verified session for a seeded demo account.
create function pg_temp.login(p_username text)
returns void
language plpgsql
as $$
declare
  v_user uuid := (select user_id from public.mp_profiles where username = p_username);
  v_session uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal)
  values (v_session, v_user, now(), now(), 'aal1');
  insert into public.mp_login_challenges (session_id, user_id, code_hash, expires_at, verified_at)
  values (v_session, v_user, extensions.crypt('999999', extensions.gen_salt('bf', 4)), now() + interval '10 minutes', now());
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated', 'session_id', v_session)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Ids created during the test survive role switches as transaction-local settings.
create function pg_temp.remember(p_key text, p_id uuid) returns void
language sql as $$ select set_config('tap.' || p_key, p_id::text, true) $$;
create function pg_temp.recall(p_key text) returns uuid
language sql stable as $$ select current_setting('tap.' || p_key)::uuid $$;

-- Valid request payload for the main IPA (seeded member n is eligible for n = 1, 2).
create function pg_temp.request(p_units integer default 4, p_member integer default 1) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'member_id', md5('medpoint-demo:member:' || p_member)::uuid,
    'requested_provider_id', md5('medpoint-demo:provider:1')::uuid,
    'referring_provider_id', md5('medpoint-demo:provider:2')::uuid,
    'service_code', 'DEMO-S1003',
    'diagnosis_code', 'DEMO-D2001',
    'place_of_service', 'DEMO-P11',
    'units', p_units,
    'priority', 'routine',
    'clinical_summary', 'pgTAP synthetic clinical summary with enough detail to submit.')
$$;

-- ---------------------------------------------------------------------------
-- Request A: draft -> requested -> approved, with rule violations along the way
-- ---------------------------------------------------------------------------
select pg_temp.login('demo.user');
do $$ begin
  perform pg_temp.remember('a', (select id from public.mp_save_authorization(
    '0a000000-0000-4000-a000-000000000001', pg_temp.request(4))));
end $$;

select results_eq(
  $$select status, created_by, submitted_by, auth_number >= 'DEMO-AUTH-900001'
    from public.mp_authorizations where id = pg_temp.recall('a')$$,
  $$values ('draft', '0b000000-0000-4000-a000-000000000003'::uuid, null::uuid, true)$$,
  'provider_staff saves a draft numbered from DEMO-AUTH-900001');
select is((select status from public.mp_transition_authorization(pg_temp.recall('a'), 'requested')), 'requested',
  'provider_staff submits the draft');
select throws_ok($$select public.mp_transition_authorization(pg_temp.recall('a'), 'approved')$$,
  '42501', 'Only reviewers or administrators can record authorization decisions.',
  'provider_staff cannot approve');

reset role;
select pg_temp.login('demo.reviewer');

select throws_ok($$select public.mp_save_authorization('0a000000-0000-4000-a000-000000000001', pg_temp.request(4))$$,
  '42501', 'You do not have permission to create or edit authorization requests.',
  'reviewer cannot create a request');
select throws_ok($$select public.mp_transition_authorization(pg_temp.recall('a'), 'denied', '   ')$$,
  '22023', 'A reason is required to mark this request denied.',
  'deny requires a non-blank reason');
select throws_ok($$select public.mp_transition_authorization(pg_temp.recall('a'), 'modified', 'Fewer units', 4)$$,
  '22023', 'Modified approvals need approved units between 1 and 3.',
  'modified approval needs fewer units than requested');
select throws_ok(
  $$select public.mp_transition_authorization(pg_temp.recall('a'), 'approved', '', null, now() - interval '1 second')$$,
  '40001', 'This authorization changed since you opened it. Reload and try again.',
  'a stale expected updated_at is rejected as a conflict');
select results_eq(
  $$select status, approved_units, authorization_date, expiration_date
    from public.mp_transition_authorization(pg_temp.recall('a'), 'approved', '', null,
      (select updated_at from public.mp_authorizations where id = pg_temp.recall('a')))$$,
  $$values ('approved', 4, current_date, current_date + 90)$$,
  'reviewer approval grants all units and sets authorization and expiration dates');
select results_eq(
  $$select action, from_status, to_status, actor_name from public.mp_activity_events
    where related_authorization_id = pg_temp.recall('a') order by id$$,
  $$values ('draft_created', null::text, 'draft', 'Demo User'),
           ('submitted', 'draft', 'requested', 'Demo User'),
           ('approved', 'requested', 'approved', 'Demo Reviewer')$$,
  'each successful transition is recorded with its from/to status and actor');

-- ---------------------------------------------------------------------------
-- Request B: denied is terminal. Request C: modified boundary and cancel rules.
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.login('demo.user');
do $$ begin
  perform pg_temp.remember('b', (select id from public.mp_save_authorization(
    '0a000000-0000-4000-a000-000000000001', pg_temp.request(4), null, true)));
  perform pg_temp.remember('c', (select id from public.mp_save_authorization(
    '0a000000-0000-4000-a000-000000000001', pg_temp.request(4), null, true)));
end $$;

reset role;
select pg_temp.login('demo.reviewer');

select results_eq(
  $$select status, approved_units, decision_reason
    from public.mp_transition_authorization(pg_temp.recall('b'), 'denied', '  pgTAP denial reason  ')$$,
  $$values ('denied', 0, 'pgTAP denial reason')$$,
  'reviewer denies with a trimmed reason and zero approved units');
select throws_ok($$select public.mp_transition_authorization(pg_temp.recall('b'), 'approved')$$,
  '22023', 'Cannot change status from denied to approved.',
  'a denied request cannot be approved');
select results_eq(
  $$select status, approved_units, authorization_date
    from public.mp_transition_authorization(pg_temp.recall('c'), 'modified', 'Fewer units approved', 3)$$,
  $$values ('modified', 3, current_date)$$,
  'reviewer can modify to one fewer unit than requested');

reset role;
select pg_temp.login('demo.user');
select throws_ok($$select public.mp_transition_authorization(pg_temp.recall('c'), 'cancelled', 'No longer needed')$$,
  '22023', 'Cannot change status from modified to cancelled.',
  'provider_staff cannot cancel a decided request');

reset role;
select pg_temp.login('demo.admin');
select results_eq(
  $$select status, approved_units, decision_reason
    from public.mp_transition_authorization(pg_temp.recall('c'), 'cancelled', 'Cancelled by admin')$$,
  $$values ('cancelled', 0, 'Cancelled by admin')$$,
  'admin can cancel a modified approval');

-- ---------------------------------------------------------------------------
-- Deleting requests
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.login('demo.user');
do $$ begin
  perform pg_temp.remember('d', (select id from public.mp_save_authorization(
    '0a000000-0000-4000-a000-000000000001', pg_temp.request(2))));
end $$;
insert into public.mp_documents (org_id, authorization_id, doc_type, category, file_name, storage_path, mime_type, size_bytes)
values ('0a000000-0000-4000-a000-000000000001', pg_temp.recall('a'), 'TXT', 'Clinical', 'pgtap-attachment.txt',
        '0a000000-0000-4000-a000-000000000001/pgtap/' || pg_temp.recall('a') || '/pgtap-attachment.txt', 'text/plain', 12);

reset role;
select pg_temp.login('demo.viewer');
select throws_ok($$select public.mp_delete_authorization(pg_temp.recall('d'))$$,
  '42501', 'You do not have permission to delete authorization requests.',
  'read_only cannot delete a request');

reset role;
select pg_temp.login('demo.user');
select throws_ok($$select public.mp_delete_authorization(pg_temp.recall('a'))$$,
  '22023', 'Only draft requests can be deleted.',
  'provider_staff cannot delete a non-draft request');
select is(public.mp_delete_authorization(pg_temp.recall('d')), '{}'::text[],
  'provider_staff deletes a draft without attachments');
select is((select count(*)::int from public.mp_authorizations where id = pg_temp.recall('d')), 0,
  'the deleted draft is gone');

reset role;
select pg_temp.login('demo.admin');
select is(public.mp_delete_authorization(pg_temp.recall('a')),
  array['0a000000-0000-4000-a000-000000000001/pgtap/' || pg_temp.recall('a') || '/pgtap-attachment.txt'],
  'admin deletes an approved request and receives its attachment storage paths');
select is((select count(*)::int from public.mp_documents where authorization_id = pg_temp.recall('a')), 0,
  'attachment rows are removed with the request');
select results_eq(
  $$select action, from_status, to_status from public.mp_activity_events
    where entity_id = pg_temp.recall('a') and related_authorization_id is null$$,
  $$values ('deleted', 'approved', null::text)$$,
  'the deletion is recorded in the activity log');

-- ---------------------------------------------------------------------------
-- Consult notes
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.login('demo.user');
do $$
declare v_id uuid;
begin
  insert into public.mp_consult_notes (org_id, authorization_id, member_id, subject, body)
  values ('0a000000-0000-4000-a000-000000000001', pg_temp.recall('b'), md5('medpoint-demo:member:1')::uuid,
          'pgTAP note', 'Synthetic note body.')
  returning id into v_id;
  perform pg_temp.remember('note', v_id);
end $$;

with u as (update public.mp_consult_notes set body = 'Edited by author' where id = pg_temp.recall('note') returning 1)
select is(count(*)::int, 1, 'the author can update their own note') from u;
select throws_ok(
  $$insert into public.mp_consult_notes (org_id, authorization_id, member_id, subject, body)
    values ('0a000000-0000-4000-a000-000000000001', pg_temp.recall('b'), md5('medpoint-demo:member:2')::uuid,
            'Mismatched note', 'Synthetic body.')$$,
  '22023', 'The note member must match the authorization member.',
  'a note member must match its authorization member');

reset role;
select pg_temp.login('demo.reviewer');
with u as (update public.mp_consult_notes set body = 'Edited by reviewer' where id = pg_temp.recall('note') returning 1)
select is(count(*)::int, 0, 'another non-admin writer cannot update the note') from u;

reset role;
select pg_temp.login('demo.admin');
with u as (update public.mp_consult_notes set body = 'Edited by admin' where id = pg_temp.recall('note') returning 1)
select is(count(*)::int, 1, 'an admin can update any note in their IPA') from u;

select * from finish();
rollback;
