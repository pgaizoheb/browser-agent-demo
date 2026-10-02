-- Deterministic synthetic dataset for the MedPoint LOCAL MOCK / DEMO portal.
--
-- mp_private.reset_demo_dataset(password) deletes ONLY rows owned by demo
-- organizations (mp_organizations.is_demo is constrained to true) and demo
-- profiles, then re-seeds. It never touches legacy cases/case_events, non-demo
-- auth users, or other storage buckets. Storage objects are synchronized by
-- scripts/demo-dataset.mjs because file bytes cannot be written from SQL.
--
-- All identifiers use DEMO prefixes; names are fictional; emails use the
-- reserved example.invalid domain; phone numbers use the fictional 555-01xx range.

create or replace function mp_private.seed_uuid(p_kind text, p_number integer)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select md5('medpoint-demo:' || p_kind || ':' || p_number)::uuid
$$;

create or replace function mp_private.seed_org(
  p_org_id uuid,
  p_provider_count integer,
  p_member_count integer,
  p_auth_count integer,
  p_claim_count integer,
  p_offset integer,
  p_creator uuid,
  p_reviewer uuid,
  p_inbox text,
  p_tax_id text,
  p_details boolean
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  first_names text[] := array['Alex', 'Taylor', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Avery', 'Quinn', 'Rowan', 'Sage',
                              'Parker', 'Emerson', 'Finley', 'Dakota', 'Reese', 'Skyler', 'Drew', 'Cameron', 'Hayden', 'Jamie'];
  last_names text[] := array['Example', 'Sample', 'Demoford', 'Mockley', 'Testwood', 'Placeholder', 'Fictiva', 'Synthwell',
                             'Specimen', 'Prototyne', 'Trialson', 'Mockett', 'Samplewood', 'Exemplar', 'Pretendo', 'Imaginary'];
  specialties text[] := array['Internal Medicine', 'Family Medicine', 'Cardiology', 'Neurology', 'Orthopedic Surgery',
                              'Dermatology', 'Endocrinology', 'Physical Therapy', 'Radiology', 'Pulmonology'];
  hospitals text[] := array['Demo General Hospital', 'Sample Valley Medical Center', 'Example Community Hospital', 'Mockingbird Regional (Demo)'];
  cities text[] := array['Demo City', 'Sampleton', 'Exampleville', 'Mockford', 'Testburg'];
  plans text[] := array['DEMO-HP-GOLD', 'DEMO-HP-SILVER', 'DEMO-HP-MA', 'DEMO-HP-MEDI'];
  places text[] := array['DEMO-P11', 'DEMO-P22', 'DEMO-P19', 'DEMO-P21', 'DEMO-P12', 'DEMO-P02', 'DEMO-P23', 'DEMO-P31'];
  auth_statuses text[] := array['approved', 'requested', 'deferred', 'cancelled', 'approved', 'modified', 'denied', 'requested', 'draft', 'approved'];
  claim_statuses text[] := array['paid', 'paid', 'pending', 'received', 'denied', 'adjusted', 'paid'];
  categories text[] := array['Authorization', 'Clinical', 'Correspondence', 'Eligibility', 'Claims', 'Remittance'];
  note_types text[] := array['consult', 'clinical', 'administrative'];
begin
  if p_provider_count = 0 then
    return;
  end if;

  insert into public.mp_providers(id, org_id, npi, first_name, last_name, specialty, group_name, phone, email,
                                  address, city, zip, hospitals, health_plans)
  select
    mp_private.seed_uuid('provider', n),
    p_org_id,
    'DEMO-NPI-' || lpad(n::text, 6, '0'),
    first_names[(n % 20) + 1],
    last_names[((n * 7) % 16) + 1],
    specialties[(n % 10) + 1],
    last_names[((n * 7) % 16) + 1] || ' Demo Medical Group',
    '555-01' || lpad((n % 100)::text, 2, '0'),
    lower(first_names[(n % 20) + 1] || '.' || last_names[((n * 7) % 16) + 1] || n) || '@example.invalid',
    (100 + n) || ' Example Way',
    cities[(n % 5) + 1],
    '000' || lpad((n % 100)::text, 2, '0'),
    case when n % 3 = 0 then array[hospitals[(n % 4) + 1], hospitals[((n + 1) % 4) + 1]] else array[hospitals[(n % 4) + 1]] end,
    case when n % 5 = 0 then array[plans[1], plans[3]] else plans end
  from generate_series(p_offset + 1, p_offset + p_provider_count) as n;

  insert into public.mp_members(id, org_id, member_number, first_name, last_name, sex, birth_date, health_plan,
                                pcp_provider_id, eligibility_status, eligibility_start, eligibility_end, enrolled_on,
                                last_pcp_visit, hospitalized_since, hospital_name, phone, email, address, city, zip)
  select
    mp_private.seed_uuid('member', n),
    p_org_id,
    'DEMO-MEM-' || lpad(n::text, 6, '0'),
    first_names[((n * 3) % 20) + 1],
    last_names[((n * 5) % 16) + 1],
    case when n % 7 = 0 then 'X' when n % 2 = 0 then 'F' else 'M' end,
    case
      when n % 15 = 0 then (current_date - interval '64 years')::date - (n % 300)
      else (current_date - make_interval(years => 18 + ((n * 37) % 70)))::date - (n % 300)
    end,
    plans[(n % 4) + 1],
    mp_private.seed_uuid('provider', p_offset + ((n * 3) % p_provider_count) + 1),
    case when n % 13 = 0 then 'ineligible' when n % 17 = 0 then 'pending' else 'eligible' end,
    current_date - ((n % 900) + 30),
    case when n % 13 = 0 then current_date - ((n % 60) + 1) when n % 4 = 0 then null else current_date + 365 end,
    current_date - ((n % 900) + 30),
    case when n % 6 = 0 then null when n % 6 = 1 then current_date - (400 + (n % 200)) else current_date - (n % 300) end,
    case when n % 19 = 0 then current_date - (n % 10) end,
    case when n % 19 = 0 then hospitals[(n % 4) + 1] end,
    '555-01' || lpad(((n * 7) % 100)::text, 2, '0'),
    'member' || n || '@example.invalid',
    (200 + n) || ' Sample Street',
    cities[((n * 3) % 5) + 1],
    '000' || lpad(((n * 3) % 100)::text, 2, '0')
  from generate_series(p_offset + 1, p_offset + p_member_count) as n;

  insert into public.mp_authorizations(id, org_id, auth_number, reference_number, status, priority, member_id,
                                       referring_provider_id, requested_provider_id, health_plan, service_code,
                                       diagnosis_code, place_of_service, units, approved_units, request_date,
                                       authorization_date, expiration_date, clinical_summary, decision_reason,
                                       created_by, submitted_by, is_seeded, created_at, updated_at)
  select
    mp_private.seed_uuid('authorization', g.n),
    p_org_id,
    'DEMO-AUTH-' || lpad(g.n::text, 6, '0'),
    'DEMO-REF-' || lpad(g.n::text, 6, '0'),
    g.status,
    case when g.n % 9 = 0 then 'urgent' else 'routine' end,
    m.id,
    case when g.n % 4 = 0 then null else mp_private.seed_uuid('provider', p_offset + ((g.n * 5) % p_provider_count) + 1) end,
    mp_private.seed_uuid('provider', p_offset + ((g.n * 3) % p_provider_count) + 1),
    m.health_plan,
    'DEMO-S' || (1001 + g.n % 20),
    'DEMO-D' || (2001 + g.n % 20),
    places[(g.n % 8) + 1],
    g.units,
    case g.status when 'approved' then g.units when 'modified' then greatest(g.units - 1, 1) when 'denied' then 0 when 'cancelled' then 0 end,
    g.request_date,
    case when g.status in ('approved', 'modified', 'denied') then g.request_date + (g.n % 5) end,
    case when g.status in ('approved', 'modified') then g.request_date + (g.n % 5) + 90 end,
    'Synthetic clinical summary for demo request ' || g.n || '. Member reports symptoms consistent with the selected demo '
      || 'diagnosis; conservative care is documented in this fictional record. No real patient data.',
    case g.status
      when 'denied' then 'Demo criteria not met in the synthetic record.'
      when 'deferred' then 'Additional synthetic documentation requested.'
      when 'modified' then 'Approved for fewer units than requested (synthetic).'
      when 'cancelled' then 'Cancelled by the requesting office (synthetic).'
      else ''
    end,
    case when g.status = 'draft' or g.n % 3 = 0 then p_creator end,
    case when g.status <> 'draft' and g.n % 3 = 0 then p_creator end,
    true,
    g.request_date::timestamptz + interval '9 hours',
    now() - make_interval(hours => (g.n * 7) % (24 * 60))
  from (
    select
      n,
      auth_statuses[(n % 10) + 1] as status,
      (n % 12) + 1 as units,
      current_date - (n % 120) as request_date,
      mp_private.seed_uuid('member', p_offset + ((n * 7) % p_member_count) + 1) as member_id
    from generate_series(p_offset + 1, p_offset + p_auth_count) as n
  ) g
  join public.mp_members m on m.id = g.member_id;

  insert into public.mp_claims(id, org_id, claim_number, check_number, status, member_id, provider_id, authorization_id,
                               health_plan, service_from, service_to, service_code, diagnosis_code, billed_amount,
                               allowed_amount, paid_amount, received_date, paid_date, denial_reason)
  select
    mp_private.seed_uuid('claim', g.n),
    p_org_id,
    'DEMO-CLM-' || lpad(g.n::text, 6, '0'),
    case when g.status in ('paid', 'adjusted') then 'DEMO-CHK-' || lpad(g.n::text, 6, '0') end,
    g.status,
    coalesce(a.member_id, m.id),
    coalesce(a.requested_provider_id, mp_private.seed_uuid('provider', p_offset + ((g.n * 13) % p_provider_count) + 1)),
    a.id,
    coalesce(a.health_plan, m.health_plan),
    g.service_from,
    g.service_from + (g.n % 3),
    coalesce(a.service_code, 'DEMO-S' || (1001 + (g.n * 3) % 20)),
    coalesce(a.diagnosis_code, 'DEMO-D' || (2001 + (g.n * 3) % 20)),
    g.billed,
    case when g.status in ('paid', 'adjusted') then round(g.billed * 0.8, 2) end,
    case when g.status = 'paid' then round(g.billed * 0.72, 2) when g.status = 'adjusted' then round(g.billed * 0.6, 2)
         when g.status = 'denied' then 0 end,
    g.service_from + (g.n % 3) + 2,
    case when g.status in ('paid', 'adjusted') then g.service_from + (g.n % 3) + 16 end,
    case when g.status = 'denied' then 'Synthetic denial: service was not authorized (demo).' end
  from (
    select
      n,
      n - p_offset as local_n,
      claim_statuses[(n % 7) + 1] as status,
      current_date - ((n % 180) + 3) as service_from,
      (75 + ((n * 37) % 4000))::numeric + 0.50 as billed,
      mp_private.seed_uuid('member', p_offset + ((n * 11) % p_member_count) + 1) as member_id
    from generate_series(p_offset + 1, p_offset + p_claim_count) as n
  ) g
  join public.mp_members m on m.id = g.member_id
  left join public.mp_authorizations a
    on g.local_n % 4 = 0 and g.local_n <= p_auth_count
   and a.id = mp_private.seed_uuid('authorization', g.n)
   and a.status in ('approved', 'modified');

  if not p_details then
    return;
  end if;

  insert into public.mp_documents(id, org_id, document_number, authorization_id, doc_type, status, category, inbox_name,
                                  tax_id, file_name, description, sent_date, storage_path, mime_type, size_bytes,
                                  uploaded_by, uploaded_by_name, is_seeded, created_at)
  select
    mp_private.seed_uuid('document', g.n),
    p_org_id,
    'DEMO-DOC-' || lpad(g.n::text, 6, '0'),
    case when g.local_n % 2 = 0 and g.local_n * 3 <= p_auth_count then mp_private.seed_uuid('authorization', p_offset + g.local_n * 3) end,
    g.doc_type,
    (array['new', 'read', 'archived'])[(g.n % 3) + 1],
    g.category,
    p_inbox,
    p_tax_id,
    g.file_name,
    'Synthetic ' || lower(g.category) || ' document ' || g.n || ' (demo only)',
    current_date - (g.local_n * 2),
    p_org_id::text || '/seed/DEMO-DOC-' || lpad(g.n::text, 6, '0') || '/' || g.file_name,
    case g.doc_type when 'PDF' then 'application/pdf' else 'text/plain' end,
    1024,
    null,
    'Demo Seed Process',
    true,
    now() - make_interval(days => g.local_n * 2)
  from (
    select
      n,
      n - p_offset as local_n,
      categories[(n % 6) + 1] as category,
      case when n % 3 = 0 then 'TXT' else 'PDF' end as doc_type,
      'demo-' || lower(categories[(n % 6) + 1]) || '-' || n || case when n % 3 = 0 then '.txt' else '.pdf' end as file_name
    from generate_series(p_offset + 1, p_offset + least(30, p_auth_count)) as n
  ) g;

  insert into public.mp_consult_notes(id, org_id, authorization_id, member_id, note_type, subject, body,
                                      author_user_id, author_name, is_seeded, created_at, updated_at)
  select
    mp_private.seed_uuid('note', p_offset + g.k),
    p_org_id,
    a.id,
    a.member_id,
    note_types[(g.k % 3) + 1],
    'Demo consult note ' || (p_offset + g.k),
    'Synthetic consult note for ' || a.auth_number || '. The fictional specialist reviewed the demo record and '
      || 'recommends follow-up in four weeks. No real patient data.',
    case when g.k % 2 = 0 then coalesce(p_reviewer, p_creator) else p_creator end,
    case when g.k % 2 = 0 and p_reviewer is not null then 'Demo Reviewer' else
      (select display_name from public.mp_profiles where user_id = p_creator) end,
    true,
    now() - make_interval(days => g.k),
    now() - make_interval(days => g.k)
  from generate_series(1, least(60, p_auth_count / 2)) as g(k)
  join public.mp_authorizations a on a.id = mp_private.seed_uuid('authorization', p_offset + g.k * 2);

  insert into public.mp_activity_events(org_id, entity_type, entity_id, entity_label, related_authorization_id,
                                        action, from_status, to_status, note, actor_user_id, actor_name, created_at)
  select a.org_id, 'authorization', a.id, a.auth_number, a.id, 'submitted', 'draft', 'requested', '',
         null::uuid, 'Demo Seed Process', a.request_date::timestamptz + interval '9 hours'
  from public.mp_authorizations a
  where a.org_id = p_org_id and a.status <> 'draft'
  union all
  select a.org_id, 'authorization', a.id, a.auth_number, a.id, a.status, 'requested', a.status, a.decision_reason,
         null, 'Demo Seed Process', coalesce(a.authorization_date, a.request_date + 1)::timestamptz + interval '15 hours'
  from public.mp_authorizations a
  where a.org_id = p_org_id and a.status in ('approved', 'modified', 'denied', 'deferred', 'cancelled');
end;
$$;

create or replace function mp_private.seed_demo_dataset(p_password text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_org_main uuid := '0a000000-0000-4000-a000-000000000001';
  v_org_other uuid := '0a000000-0000-4000-a000-000000000002';
  v_org_large uuid := '0a000000-0000-4000-a000-000000000003';
  v_org_empty uuid := '0a000000-0000-4000-a000-000000000004';
  v_admin uuid := '0b000000-0000-4000-a000-000000000001';
  v_reviewer uuid := '0b000000-0000-4000-a000-000000000002';
  v_user uuid := '0b000000-0000-4000-a000-000000000003';
  v_viewer uuid := '0b000000-0000-4000-a000-000000000004';
  v_other uuid := '0b000000-0000-4000-a000-000000000005';
  v_account record;
begin
  if p_password is null or char_length(p_password) < 8 then
    raise exception 'Demo password must be at least 8 characters.';
  end if;

  insert into public.mp_organizations(id, code, name, sort_order) values
    (v_org_main, 'DEMO-IPA-001', 'DEMO IPA — SYNTHETIC ORGANIZATION', 1),
    (v_org_other, 'DEMO-IPA-002', 'Demo Community Network', 2),
    (v_org_large, 'DEMO-IPA-LARGE', 'Demo Large Volume IPA (load test)', 3),
    (v_org_empty, 'DEMO-IPA-EMPTY', 'Demo Empty IPA (no records)', 4)
  on conflict (id) do update set code = excluded.code, name = excluded.name, sort_order = excluded.sort_order;

  insert into public.mp_health_plans(code, name, sort_order) values
    ('DEMO-HP-GOLD', 'Demo Health Plan Gold', 1),
    ('DEMO-HP-SILVER', 'Demo Health Plan Silver', 2),
    ('DEMO-HP-MA', 'Demo Medicare Advantage', 3),
    ('DEMO-HP-MEDI', 'Demo Medi-Plan', 4)
  on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order;

  insert into public.mp_reference_codes(code_type, code, description)
  select 'service', 'DEMO-S' || (1000 + i), d || ' (synthetic)'
  from unnest(array[
    'Demo office consultation, new patient', 'Demo office visit, established patient', 'Demo MRI, lumbar spine, without contrast',
    'Demo MRI, knee, without contrast', 'Demo CT, chest, with contrast', 'Demo physical therapy evaluation',
    'Demo physical therapy session, 15 minutes', 'Demo attended sleep study', 'Demo knee arthroscopy',
    'Demo cardiac stress test', 'Demo echocardiogram', 'Demo allergy testing panel', 'Demo screening colonoscopy',
    'Demo wheelchair rental', 'Demo home health nursing visit', 'Demo infusion therapy session',
    'Demo outpatient surgery facility', 'Demo skilled nursing day', 'Demo specialist telehealth visit', 'Demo orthotic fitting'
  ]) with ordinality as t(d, i)
  union all
  select 'diagnosis', 'DEMO-D' || (2000 + i), d || ' (synthetic)'
  from unnest(array[
    'Demo chronic low back pain', 'Demo knee osteoarthritis', 'Demo type 2 diabetes, controlled', 'Demo essential hypertension',
    'Demo obstructive sleep apnea', 'Demo atopic dermatitis', 'Demo rheumatoid arthritis', 'Demo migraine without aura',
    'Demo shoulder strain', 'Demo asthma, mild persistent', 'Demo congestive heart failure', 'Demo hypothyroidism',
    'Demo seasonal allergies', 'Demo iron deficiency anemia', 'Demo lumbar radiculopathy', 'Demo plantar fasciitis',
    'Demo generalized anxiety', 'Demo chronic kidney disease, stage 2', 'Demo COPD, stable', 'Demo post-operative follow-up'
  ]) with ordinality as t(d, i)
  union all
  select 'place_of_service', c, d || ' (demo)'
  from (values ('DEMO-P02', 'Telehealth'), ('DEMO-P11', 'Office'), ('DEMO-P12', 'Home'),
               ('DEMO-P19', 'Off-campus outpatient hospital'), ('DEMO-P21', 'Inpatient hospital'),
               ('DEMO-P22', 'On-campus outpatient hospital'), ('DEMO-P23', 'Emergency room'),
               ('DEMO-P31', 'Skilled nursing facility')) as t(c, d)
  union all
  select 'modifier', c, d || ' (demo)'
  from (values ('DEMO-M01', 'Bilateral procedure'), ('DEMO-M02', 'Repeat procedure'), ('DEMO-M03', 'Distinct procedural service'),
               ('DEMO-M04', 'Telehealth service'), ('DEMO-M05', 'Left side'), ('DEMO-M06', 'Right side')) as t(c, d)
  on conflict (code_type, code) do update set description = excluded.description;

  insert into public.mp_forms_manuals(folder, title, storage_path, mime_type, sort_order)
  select f.folder, x.title, 'shared/forms/' || f.slug || '/' || x.file, x.mime, f.ord * 10 + x.ord
  from unnest(array['Eligibility Inquiry Forms', 'Fact Sheets', 'Forms', 'Images', 'News', 'PDR Fillable Forms',
                    'Provider Manuals', 'Training', 'User Guides']) with ordinality as f0(folder, ord)
  cross join lateral (select f0.folder, f0.ord, lower(regexp_replace(f0.folder, '[^A-Za-z0-9]+', '-', 'g')) as slug) f
  cross join lateral (values
    ('Demo ' || f.folder || ' Guide.pdf', 'demo-guide.pdf', 'application/pdf', 1),
    ('Demo ' || f.folder || ' Checklist.txt', 'demo-checklist.txt', 'text/plain', 2)
  ) as x(title, file, mime, ord)
  on conflict (storage_path) do update set folder = excluded.folder, title = excluded.title,
    mime_type = excluded.mime_type, sort_order = excluded.sort_order;

  for v_account in
    select * from (values
      (v_admin, 'demo.admin', 'Demo Admin'),
      (v_reviewer, 'demo.reviewer', 'Demo Reviewer'),
      (v_user, 'demo.user', 'Demo User'),
      (v_viewer, 'demo.viewer', 'Demo Viewer'),
      (v_other, 'demo.other', 'Demo Other IPA User')
    ) as t(id, username, display_name)
  loop
    insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                           raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                           confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_account.id, 'authenticated', 'authenticated',
            v_account.username || '@example.invalid',
            extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('display_name', v_account.display_name, 'synthetic_demo_account', true),
            now(), now(), '', '', '', '')
    on conflict (id) do update set
      email = excluded.email,
      encrypted_password = excluded.encrypted_password,
      email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
      raw_user_meta_data = excluded.raw_user_meta_data,
      banned_until = null,
      updated_at = now();

    insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_account.id::text, v_account.id,
            jsonb_build_object('sub', v_account.id::text, 'email', v_account.username || '@example.invalid', 'email_verified', true),
            'email', now(), now(), now())
    on conflict (provider_id, provider) do nothing;

    insert into public.mp_profiles(user_id, username, display_name)
    values (v_account.id, v_account.username, v_account.display_name)
    on conflict (user_id) do update set username = excluded.username, display_name = excluded.display_name;
  end loop;

  delete from public.mp_memberships where org_id in (select id from public.mp_organizations where is_demo);
  insert into public.mp_memberships(org_id, user_id, role) values
    (v_org_main, v_admin, 'admin'), (v_org_other, v_admin, 'admin'), (v_org_large, v_admin, 'admin'), (v_org_empty, v_admin, 'admin'),
    (v_org_main, v_reviewer, 'reviewer'),
    (v_org_main, v_user, 'provider_staff'), (v_org_empty, v_user, 'provider_staff'),
    (v_org_main, v_viewer, 'read_only'),
    (v_org_other, v_other, 'provider_staff');

  perform mp_private.seed_org(v_org_main, 24, 120, 260, 300, 0, v_user, v_reviewer, 'Demo IPA Inbox', 'DEMO-TIN-000001', true);
  perform mp_private.seed_org(v_org_other, 10, 40, 40, 40, 1000, v_other, null, 'Demo Community Inbox', 'DEMO-TIN-000002', true);
  perform mp_private.seed_org(v_org_large, 40, 2000, 6000, 6000, 100000, v_admin, null, 'Demo Large Volume Inbox', 'DEMO-TIN-000003', false);
end;
$$;

create or replace function mp_private.reset_demo_dataset(p_password text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_demo_orgs uuid[];
  v_demo_users uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_demo_orgs from public.mp_organizations where is_demo;
  select coalesce(array_agg(user_id), '{}') into v_demo_users from public.mp_profiles where is_demo;
  perform set_config('mp.suppress_audit', 'on', true);

  delete from public.mp_activity_events
  where org_id = any (v_demo_orgs) or (org_id is null and actor_user_id = any (v_demo_users));
  delete from public.mp_consult_notes where org_id = any (v_demo_orgs);
  delete from public.mp_documents where org_id = any (v_demo_orgs);
  delete from public.mp_claims where org_id = any (v_demo_orgs);
  delete from public.mp_authorizations where org_id = any (v_demo_orgs);
  delete from public.mp_members where org_id = any (v_demo_orgs);
  delete from public.mp_providers where org_id = any (v_demo_orgs);
  delete from public.mp_login_challenges where user_id = any (v_demo_users);
  delete from public.mp_demo_outbox where user_id = any (v_demo_users);

  alter sequence mp_private.auth_number_seq restart with 900001;
  alter sequence mp_private.reference_number_seq restart with 900001;
  alter sequence mp_private.document_number_seq restart with 900001;

  perform mp_private.seed_demo_dataset(p_password);
  perform set_config('mp.suppress_audit', 'off', true);

  return jsonb_build_object(
    'organizations', (select count(*) from public.mp_organizations where is_demo),
    'providers', (select count(*) from public.mp_providers),
    'members', (select count(*) from public.mp_members),
    'authorizations', (select count(*) from public.mp_authorizations),
    'claims', (select count(*) from public.mp_claims),
    'documents', (select count(*) from public.mp_documents),
    'notes', (select count(*) from public.mp_consult_notes),
    'forms', (select count(*) from public.mp_forms_manuals)
  );
end;
$$;

revoke all on function
  mp_private.seed_uuid(text, integer),
  mp_private.seed_org(uuid, integer, integer, integer, integer, integer, uuid, uuid, text, text, boolean),
  mp_private.seed_demo_dataset(text),
  mp_private.reset_demo_dataset(text)
from public, anon, authenticated;
