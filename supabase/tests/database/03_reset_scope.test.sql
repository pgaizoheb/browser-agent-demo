-- Scope of mp_private.reset_demo_dataset for the MedPoint LOCAL MOCK / DEMO portal
-- (synthetic data only). The reset runs inside this transaction and is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
select pg_temp.login('demo.admin');
select throws_ok($$select mp_private.reset_demo_dataset('MedPointDemo!2026')$$, '42501', null,
  'a verified admin cannot execute mp_private.reset_demo_dataset');

-- A demo-created request that the reset must remove.
reset role;
select pg_temp.login('demo.user');
do $$ begin
  perform set_config('tap.created', (select id::text from public.mp_save_authorization(
    '0a000000-0000-4000-a000-000000000001',
    jsonb_build_object(
      'member_id', md5('medpoint-demo:member:1')::uuid,
      'requested_provider_id', md5('medpoint-demo:provider:1')::uuid,
      'service_code', 'DEMO-S1003', 'diagnosis_code', 'DEMO-D2001', 'place_of_service', 'DEMO-P11',
      'units', 3, 'clinical_summary', 'pgTAP synthetic request that the reset must remove.'),
    null, true)), true);
end $$;
reset role;

select throws_ok(
  $$insert into public.mp_organizations (id, code, name, is_demo)
    values ('0c000000-0000-4000-a000-0000000000f1', 'DEMO-PGTAP-REAL', 'Not a demo organization', false)$$,
  '23514', 'new row for relation "mp_organizations" violates check constraint "mp_organizations_is_demo_check"',
  'organizations cannot be marked non-demo');

-- ---------------------------------------------------------------------------
-- State the reset must not touch, and seeded state it must restore
-- ---------------------------------------------------------------------------
insert into public.cases (id, patient_name, patient_id, request_id, medication_or_procedure, payer, submitted_date,
                          status, priority, notes, clinical_facts, policy_facts, provider_name, provider_reference,
                          diagnosis_context)
select '0c000000-0000-4000-a000-0000000000c1', patient_name, patient_id, 'PGTAP-SENTINEL-001', medication_or_procedure,
       payer, submitted_date, status, priority, notes, clinical_facts, policy_facts, provider_name, provider_reference,
       diagnosis_context
from public.cases
order by request_id
limit 1;
select set_config('tap.case_count', (select count(*)::text from public.cases), true);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '0c000000-0000-4000-a000-0000000000a1', 'authenticated', 'authenticated',
        'pgtap.nondemo@example.invalid', 'pgtap-not-a-real-hash', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
insert into public.mp_demo_outbox (user_id, to_address, subject, body)
values ('0c000000-0000-4000-a000-0000000000a1', 'pgtap.nondemo@example.invalid', 'pgTAP sentinel', 'Must survive the reset.');

update public.mp_authorizations set status = 'approved', clinical_summary = 'Tampered by pgTAP'
where auth_number = 'DEMO-AUTH-000001';

-- ---------------------------------------------------------------------------
-- Reset
-- ---------------------------------------------------------------------------
-- Other test runs may write to the shared local database concurrently. Hold off their
-- writes to the tables being re-seeded so the counts below are exact. Lock order follows
-- the write order of the portal RPCs (attachments/notes, requests, members, events).
lock table public.mp_documents, public.mp_consult_notes, public.mp_authorizations, public.mp_members,
           public.mp_activity_events in exclusive mode;

select is(mp_private.reset_demo_dataset('MedPointDemo!2026'),
  '{"organizations": 4, "providers": 74, "members": 2160, "authorizations": 6300,
    "claims": 6340, "documents": 60, "notes": 80, "forms": 18}'::jsonb,
  'reset re-seeds exactly the synthetic dataset');

select is((select count(*)::int from public.mp_authorizations where id = current_setting('tap.created')::uuid), 0,
  'demo-created requests are removed');
select results_eq(
  $$select status, clinical_summary like 'Synthetic clinical summary for demo request 1.%'
    from public.mp_authorizations where auth_number = 'DEMO-AUTH-000001'$$,
  $$values ('requested', true)$$,
  'mutated seeded requests are restored');
select results_eq(
  $$select last_value, is_called from mp_private.auth_number_seq$$,
  $$values (900001::bigint, false)$$,
  'new request numbering restarts at DEMO-AUTH-900001');
select ok(exists (select 1 from public.cases where id = '0c000000-0000-4000-a000-0000000000c1'),
  'the legacy sentinel case survives');
select is((select count(*)::int from public.cases), current_setting('tap.case_count')::int,
  'no legacy cases are removed');
select results_eq(
  $$select email, encrypted_password, updated_at from auth.users where id = '0c000000-0000-4000-a000-0000000000a1'$$,
  $$values ('pgtap.nondemo@example.invalid'::varchar, 'pgtap-not-a-real-hash'::varchar, '2026-01-01T00:00:00Z'::timestamptz)$$,
  'non-demo auth users are untouched');
select is((select count(*)::int from public.mp_demo_outbox where user_id = '0c000000-0000-4000-a000-0000000000a1'), 1,
  'test mailbox rows of non-demo users are untouched');

select * from finish();
rollback;
