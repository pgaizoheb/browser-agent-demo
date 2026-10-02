-- Access control for the MedPoint LOCAL MOCK / DEMO portal (synthetic data only).
-- Runs inside one transaction that is rolled back: nothing persists.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

-- Persona helper (called as postgres): creates an auth session for a seeded demo
-- account, optionally marks it verified, then acts as that user for the rest of
-- the transaction. `reset role` returns to postgres; the JWT claims stay set, so
-- `set local role authenticated` resumes the same session.
create function pg_temp.login(p_username text, p_verified boolean default true)
returns void
language plpgsql
as $$
declare
  v_user uuid := (select user_id from public.mp_profiles where username = p_username);
  v_session uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal)
  values (v_session, v_user, now(), now(), 'aal1');
  if p_verified then
    insert into public.mp_login_challenges (session_id, user_id, code_hash, expires_at, verified_at)
    values (v_session, v_user, extensions.crypt('999999', extensions.gen_salt('bf', 4)), now() + interval '10 minutes', now());
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated', 'session_id', v_session)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Sets the current session's verification code to 123456 (the real code is random).
create function pg_temp.set_known_code(p_expires_at timestamptz default now() + interval '10 minutes')
returns void
language sql
as $$
  update public.mp_login_challenges
  set code_hash = extensions.crypt('123456', extensions.gen_salt('bf', 4)), expires_at = p_expires_at
  where session_id = (auth.jwt() ->> 'session_id')::uuid
$$;

-- Storage visibility is asserted against sentinel object rows created inside this
-- transaction, so the test does not depend on the synthetic file sync having run.
insert into storage.objects (bucket_id, name) values
  ('mp-demo-documents', '0a000000-0000-4000-a000-000000000001/pgtap-sentinel/main.txt'),
  ('mp-demo-documents', '0a000000-0000-4000-a000-000000000002/pgtap-sentinel/other.txt'),
  ('mp-demo-documents', '0a000000-0000-4000-a000-000000000003/pgtap-sentinel/large.txt'),
  ('mp-demo-documents', 'shared/forms/pgtap-sentinel/form.txt');

-- ---------------------------------------------------------------------------
-- anon has no access
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok('select count(*) from public.mp_authorizations', '42501', null,
  'anon cannot select mp_authorizations');
select throws_ok('select count(*) from public.mp_members', '42501', null,
  'anon cannot select mp_members');
select throws_ok($$select public.mp_save_authorization('0a000000-0000-4000-a000-000000000001', '{}'::jsonb)$$, '42501', null,
  'anon cannot execute mp_save_authorization');

-- ---------------------------------------------------------------------------
-- Signed in but not verified: no data, no writes
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.login('demo.user', false);

select is((select count(*)::int from public.mp_authorizations), 0, 'unverified session sees no authorizations');
select is((select count(*)::int from public.mp_members), 0, 'unverified session sees no members');
select is((select count(*)::int from public.mp_reference_codes), 0, 'unverified session sees no reference codes');
select is((select count(*)::int from storage.objects where bucket_id = 'mp-demo-documents'), 0,
  'unverified session sees no stored documents or forms');
select throws_ok($$select public.mp_save_authorization('0a000000-0000-4000-a000-000000000001', '{}'::jsonb)$$,
  '42501', 'Email verification is required for this session.',
  'unverified session cannot save an authorization');

-- ---------------------------------------------------------------------------
-- Verified sessions see exactly their organizations
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.login('demo.user');

select ok((select count(*) from public.mp_authorizations where org_id = '0a000000-0000-4000-a000-000000000001') >= 260,
  'demo.user sees the main IPA authorizations');
select set_eq('select distinct org_id from public.mp_authorizations',
  array['0a000000-0000-4000-a000-000000000001'::uuid],
  'demo.user sees authorizations from the main IPA only');
select is((select count(*)::int from public.mp_members), 120, 'demo.user sees exactly the 120 main IPA members');
select set_eq('select id from public.mp_organizations',
  array['0a000000-0000-4000-a000-000000000001', '0a000000-0000-4000-a000-000000000004']::uuid[],
  'demo.user sees only the organizations they belong to');
select set_eq($$select distinct split_part(name, '/', 1) from storage.objects where bucket_id = 'mp-demo-documents'$$,
  array['0a000000-0000-4000-a000-000000000001', 'shared'],
  'demo.user storage access is limited to the main IPA folder and shared forms');
select ok(exists (select 1 from storage.objects
           where bucket_id = 'mp-demo-documents' and name = '0a000000-0000-4000-a000-000000000001/pgtap-sentinel/main.txt'),
  'demo.user can read main IPA document objects');
select ok(exists (select 1 from storage.objects
           where bucket_id = 'mp-demo-documents' and name = 'shared/forms/pgtap-sentinel/form.txt'),
  'demo.user can read shared form objects');

reset role;
select pg_temp.login('demo.other');

select set_eq('select distinct org_id from public.mp_authorizations',
  array['0a000000-0000-4000-a000-000000000002'::uuid],
  'demo.other sees authorizations from Demo Community Network only');
select is((select count(*)::int from public.mp_members), 40, 'demo.other sees exactly the 40 Demo Community Network members');
select set_eq($$select distinct split_part(name, '/', 1) from storage.objects where bucket_id = 'mp-demo-documents'$$,
  array['0a000000-0000-4000-a000-000000000002', 'shared'],
  'demo.other cannot read main IPA storage objects');

reset role;
select pg_temp.login('demo.admin');

select set_eq('select id from public.mp_organizations',
  array['0a000000-0000-4000-a000-000000000001', '0a000000-0000-4000-a000-000000000002',
        '0a000000-0000-4000-a000-000000000003', '0a000000-0000-4000-a000-000000000004']::uuid[],
  'demo.admin sees all four demo organizations');
select set_eq('select distinct org_id from public.mp_authorizations',
  array['0a000000-0000-4000-a000-000000000001', '0a000000-0000-4000-a000-000000000002',
        '0a000000-0000-4000-a000-000000000003']::uuid[],
  'demo.admin sees authorizations from every populated organization');
select is((select count(*)::int from public.mp_members), 2160, 'demo.admin sees every demo member');

-- ---------------------------------------------------------------------------
-- Test-mode verification RPCs
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.login('demo.reviewer', false);

select is(public.mp_begin_verification() - 'masked_email' - 'expires_at',
  '{"verified": false, "attempts_remaining": 5, "sent": true}'::jsonb,
  'mp_begin_verification issues a code');
select is((select count(*)::int from public.mp_demo_outbox
           where session_id = (auth.jwt() ->> 'session_id')::uuid
             and body ~ 'Your verification code is [0-9]{6}\.'),
  1, 'the code is delivered to the test mailbox the user can read');
reset role;
select results_eq(
  $$select attempts, verified_at is null from public.mp_login_challenges
    where session_id = (auth.jwt() ->> 'session_id')::uuid$$,
  $$values (0, true)$$,
  'mp_begin_verification stores an unverified challenge for the session');
select pg_temp.set_known_code();
set local role authenticated;

select is(public.mp_verify_login_code('000000'),
  '{"verified": false, "reason": "incorrect", "message": "Incorrect verification code.", "attempts_remaining": 4}'::jsonb,
  'a wrong code is rejected and consumes an attempt');
select is(public.mp_verify_login_code('12ab') - 'message',
  '{"verified": false, "reason": "format", "attempts_remaining": 4}'::jsonb,
  'a malformed code is rejected without consuming an attempt');
select is(public.mp_verify_login_code('123456'), '{"verified": true}'::jsonb, 'the correct code verifies the session');
select is((select count(*)::int from public.mp_reference_codes), 54, 'a verified session can read reference codes');

-- Five wrong codes lock the challenge; even the correct code then fails.
reset role;
select pg_temp.login('demo.reviewer', false);
do $$ begin perform public.mp_begin_verification(); end $$;
reset role;
select pg_temp.set_known_code();
set local role authenticated;
do $$ begin
  for i in 1..4 loop perform public.mp_verify_login_code('000000'); end loop;
end $$;

select is(public.mp_verify_login_code('000000') - 'message',
  '{"verified": false, "reason": "locked", "attempts_remaining": 0}'::jsonb,
  'the fifth wrong code locks the challenge');
select is(public.mp_verify_login_code('123456') - 'message',
  '{"verified": false, "reason": "locked"}'::jsonb,
  'a locked challenge rejects even the correct code');
select is(public.mp_begin_verification(true) - 'masked_email' - 'expires_at',
  '{"verified": false, "attempts_remaining": 5, "sent": true}'::jsonb,
  'requesting a new code resets the attempt counter');

-- An expired challenge is rejected.
reset role;
select pg_temp.login('demo.reviewer', false);
do $$ begin perform public.mp_begin_verification(); end $$;
reset role;
select pg_temp.set_known_code(now() - interval '1 second');
set local role authenticated;

select is(public.mp_verify_login_code('123456') - 'message',
  '{"verified": false, "reason": "expired"}'::jsonb,
  'an expired challenge rejects the correct code');

-- ---------------------------------------------------------------------------
-- Direct table writes are blocked even for a verified administrator
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.login('demo.admin');

select throws_ok($$insert into public.mp_authorizations
  (org_id, member_id, requested_provider_id, health_plan, service_code, diagnosis_code, place_of_service)
  values ('0a000000-0000-4000-a000-000000000001', md5('medpoint-demo:member:1')::uuid,
          md5('medpoint-demo:provider:1')::uuid, 'DEMO-HP-GOLD', 'DEMO-S1001', 'DEMO-D2001', 'DEMO-P11')$$,
  '42501', null, 'authenticated cannot insert into mp_authorizations');
select throws_ok($$update public.mp_authorizations set status = 'approved' where auth_number = 'DEMO-AUTH-000001'$$,
  '42501', null, 'authenticated cannot update mp_authorizations');
select throws_ok($$delete from public.mp_authorizations where auth_number = 'DEMO-AUTH-000008'$$,
  '42501', null, 'authenticated cannot delete from mp_authorizations');
select throws_ok($$insert into public.mp_claims
  (org_id, claim_number, status, member_id, provider_id, health_plan, service_from, service_to,
   service_code, diagnosis_code, billed_amount, received_date)
  values ('0a000000-0000-4000-a000-000000000001', 'DEMO-CLM-999999', 'paid', md5('medpoint-demo:member:1')::uuid,
          md5('medpoint-demo:provider:1')::uuid, 'DEMO-HP-GOLD', current_date, current_date,
          'DEMO-S1001', 'DEMO-D2001', 10, current_date)$$,
  '42501', null, 'authenticated cannot insert into mp_claims');
select throws_ok($$update public.mp_claims set paid_amount = 0 where claim_number = 'DEMO-CLM-000001'$$,
  '42501', null, 'authenticated cannot update mp_claims');
select throws_ok($$delete from public.mp_claims where claim_number = 'DEMO-CLM-000001'$$,
  '42501', null, 'authenticated cannot delete from mp_claims');
select lives_ok($$update public.mp_documents set description = description where false$$,
  'authenticated may update document metadata columns');
select throws_ok($$update public.mp_documents set storage_path = storage_path where false$$,
  '42501', null, 'authenticated cannot update mp_documents.storage_path');
select throws_ok($$insert into public.mp_activity_events (org_id, entity_type, action)
  values ('0a000000-0000-4000-a000-000000000001', 'authorization', 'forged')$$,
  '42501', null, 'authenticated cannot insert into mp_activity_events');
select throws_ok('select count(*) from public.mp_login_challenges', '42501', null,
  'authenticated cannot select mp_login_challenges');

select * from finish();
rollback;
