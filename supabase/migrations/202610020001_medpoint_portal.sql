-- MedPoint-style LOCAL MOCK / DEMO portal. Synthetic data only.
--
-- Every table is prefixed mp_ and isolated from the legacy cases/case_events demo.
-- Organizations carry a CHECK (is_demo) constraint so the reset routine can never
-- target anything but this application's synthetic dataset.
--
-- Access model:
--   * Supabase Auth email/password establishes an aal1 session.
--   * A test-mode verification code (delivered only to mp_demo_outbox, never email)
--     marks that session verified in mp_login_challenges.
--   * Every data policy requires a verified session plus organization membership.
--   * Writes that change workflow state go through SECURITY DEFINER RPCs that
--     enforce role and transition rules; anon has no privileges.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists mp_private;
revoke all on schema mp_private from public;
grant usage on schema mp_private to authenticated, service_role;

create sequence if not exists mp_private.auth_number_seq start 900001;
create sequence if not exists mp_private.reference_number_seq start 900001;
create sequence if not exists mp_private.document_number_seq start 900001;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.mp_organizations (
  id uuid primary key,
  code text not null unique check (code like 'DEMO-%'),
  name text not null,
  is_demo boolean not null default true check (is_demo),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.mp_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^demo\.[a-z0-9.]+$'),
  display_name text not null,
  is_demo boolean not null default true check (is_demo),
  created_at timestamptz not null default now()
);

create table public.mp_memberships (
  org_id uuid not null references public.mp_organizations(id) on delete cascade,
  user_id uuid not null references public.mp_profiles(user_id) on delete cascade,
  role text not null check (role in ('admin', 'reviewer', 'provider_staff', 'read_only')),
  primary key (org_id, user_id)
);
create index mp_memberships_user_idx on public.mp_memberships(user_id);

create table public.mp_health_plans (
  code text primary key check (code like 'DEMO-%'),
  name text not null,
  sort_order integer not null default 0
);

create table public.mp_reference_codes (
  id uuid primary key default gen_random_uuid(),
  code_type text not null check (code_type in ('service', 'diagnosis', 'place_of_service', 'modifier')),
  code text not null check (code like 'DEMO-%'),
  description text not null,
  search_text text generated always as (lower(code || ' ' || description)) stored,
  unique (code_type, code)
);

create table public.mp_forms_manuals (
  id uuid primary key default gen_random_uuid(),
  folder text not null,
  title text not null,
  storage_path text not null unique check (storage_path like 'shared/forms/%'),
  mime_type text not null,
  sort_order integer not null default 0
);

create table public.mp_providers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.mp_organizations(id) on delete cascade,
  npi text not null unique check (npi like 'DEMO-NPI-%'),
  first_name text not null,
  last_name text not null,
  specialty text not null,
  group_name text not null,
  phone text not null,
  email text not null check (email like '%@example.invalid'),
  address text not null,
  city text not null,
  zip text not null,
  hospitals text[] not null default '{}',
  health_plans text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create index mp_providers_org_name_idx on public.mp_providers(org_id, last_name, first_name);

create table public.mp_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.mp_organizations(id) on delete cascade,
  member_number text not null unique check (member_number like 'DEMO-MEM-%'),
  first_name text not null,
  last_name text not null,
  sex text not null check (sex in ('F', 'M', 'X')),
  birth_date date not null,
  health_plan text not null references public.mp_health_plans(code),
  pcp_provider_id uuid,
  eligibility_status text not null check (eligibility_status in ('eligible', 'ineligible', 'pending')),
  eligibility_start date not null,
  eligibility_end date,
  enrolled_on date not null,
  last_pcp_visit date,
  hospitalized_since date,
  hospital_name text,
  phone text not null,
  email text not null check (email like '%@example.invalid'),
  address text not null,
  city text not null,
  zip text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, pcp_provider_id) references public.mp_providers(org_id, id)
);
create index mp_members_org_name_idx on public.mp_members(org_id, last_name, first_name);

create table public.mp_authorizations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.mp_organizations(id) on delete cascade,
  auth_number text not null unique
    default ('DEMO-AUTH-' || lpad(nextval('mp_private.auth_number_seq')::text, 6, '0'))
    check (auth_number like 'DEMO-AUTH-%'),
  reference_number text not null unique
    default ('DEMO-REF-' || lpad(nextval('mp_private.reference_number_seq')::text, 6, '0'))
    check (reference_number like 'DEMO-REF-%'),
  status text not null default 'draft'
    check (status in ('draft', 'requested', 'approved', 'modified', 'denied', 'deferred', 'cancelled')),
  priority text not null default 'routine' check (priority in ('routine', 'urgent')),
  member_id uuid not null,
  referring_provider_id uuid,
  requested_provider_id uuid not null,
  health_plan text not null references public.mp_health_plans(code),
  service_code text not null,
  diagnosis_code text not null,
  place_of_service text not null,
  units integer not null default 1 check (units between 1 and 999),
  approved_units integer check (approved_units between 0 and 999),
  request_date date not null default current_date,
  authorization_date date,
  expiration_date date,
  clinical_summary text not null default '' check (char_length(clinical_summary) <= 4000),
  decision_reason text not null default '' check (char_length(decision_reason) <= 2000),
  created_by uuid references public.mp_profiles(user_id) on delete set null,
  submitted_by uuid references public.mp_profiles(user_id) on delete set null,
  is_seeded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, member_id) references public.mp_members(org_id, id) on delete cascade,
  foreign key (org_id, referring_provider_id) references public.mp_providers(org_id, id),
  foreign key (org_id, requested_provider_id) references public.mp_providers(org_id, id)
);
create index mp_authorizations_org_status_idx on public.mp_authorizations(org_id, status, request_date desc);
create index mp_authorizations_org_updated_idx on public.mp_authorizations(org_id, updated_at desc);
create index mp_authorizations_member_idx on public.mp_authorizations(member_id);
create index mp_authorizations_creator_idx on public.mp_authorizations(created_by);

create table public.mp_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.mp_organizations(id) on delete cascade,
  claim_number text not null unique check (claim_number like 'DEMO-CLM-%'),
  check_number text check (check_number like 'DEMO-CHK-%'),
  status text not null check (status in ('received', 'pending', 'paid', 'denied', 'adjusted')),
  member_id uuid not null,
  provider_id uuid not null,
  authorization_id uuid references public.mp_authorizations(id) on delete set null,
  health_plan text not null references public.mp_health_plans(code),
  service_from date not null,
  service_to date not null,
  service_code text not null,
  diagnosis_code text not null,
  billed_amount numeric(10, 2) not null,
  allowed_amount numeric(10, 2),
  paid_amount numeric(10, 2),
  received_date date not null,
  paid_date date,
  denial_reason text,
  created_at timestamptz not null default now(),
  check (service_to >= service_from),
  foreign key (org_id, member_id) references public.mp_members(org_id, id) on delete cascade,
  foreign key (org_id, provider_id) references public.mp_providers(org_id, id) on delete cascade
);
create index mp_claims_org_service_idx on public.mp_claims(org_id, service_from desc);
create index mp_claims_member_idx on public.mp_claims(member_id);
create index mp_claims_auth_idx on public.mp_claims(authorization_id);

create table public.mp_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.mp_organizations(id) on delete cascade,
  -- Assigned by mp_private.prepare_document() so callers never need sequence privileges.
  document_number text not null unique check (document_number like 'DEMO-DOC-%'),
  authorization_id uuid,
  doc_type text not null check (doc_type in ('PDF', 'TXT', 'PNG', 'JPG')),
  status text not null default 'new' check (status in ('new', 'read', 'archived')),
  category text not null check (category in ('Authorization', 'Claims', 'Eligibility', 'Correspondence', 'Clinical', 'Remittance')),
  inbox_name text not null default 'Demo IPA Inbox',
  tax_id text not null default 'DEMO-TIN-000001' check (tax_id like 'DEMO-TIN-%'),
  inbox_search text generated always as (lower(inbox_name || ' ' || tax_id)) stored,
  file_name text not null check (char_length(file_name) between 1 and 200),
  description text not null default '' check (char_length(description) <= 500),
  sent_date date not null default current_date,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf', 'text/plain', 'image/png', 'image/jpeg')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  uploaded_by uuid default auth.uid() references public.mp_profiles(user_id) on delete set null,
  uploaded_by_name text,
  is_seeded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_path like org_id::text || '/%'),
  foreign key (org_id, authorization_id) references public.mp_authorizations(org_id, id) on delete cascade
);
create index mp_documents_org_sent_idx on public.mp_documents(org_id, sent_date desc);
create index mp_documents_auth_idx on public.mp_documents(authorization_id);

create table public.mp_consult_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.mp_organizations(id) on delete cascade,
  authorization_id uuid,
  member_id uuid not null,
  note_type text not null default 'consult' check (note_type in ('consult', 'clinical', 'administrative')),
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  body text not null check (char_length(btrim(body)) between 1 and 8000),
  author_user_id uuid default auth.uid() references public.mp_profiles(user_id) on delete set null,
  author_name text,
  is_seeded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, authorization_id) references public.mp_authorizations(org_id, id) on delete cascade,
  foreign key (org_id, member_id) references public.mp_members(org_id, id) on delete cascade
);
create index mp_consult_notes_org_created_idx on public.mp_consult_notes(org_id, created_at desc);
create index mp_consult_notes_auth_idx on public.mp_consult_notes(authorization_id);

create table public.mp_activity_events (
  id bigint generated always as identity primary key,
  org_id uuid references public.mp_organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('authorization', 'claim', 'member', 'document', 'note', 'session')),
  entity_id uuid,
  entity_label text not null default '',
  related_authorization_id uuid references public.mp_authorizations(id) on delete cascade,
  action text not null,
  from_status text,
  to_status text,
  note text not null default '',
  actor_user_id uuid references public.mp_profiles(user_id) on delete set null,
  actor_name text not null default 'System',
  created_at timestamptz not null default now()
);
create index mp_activity_org_created_idx on public.mp_activity_events(org_id, created_at desc);
create index mp_activity_auth_idx on public.mp_activity_events(related_authorization_id, created_at desc);
create index mp_activity_actor_idx on public.mp_activity_events(actor_user_id, created_at desc);

-- One row per Supabase Auth session. Holds only a bcrypt hash of the test code.
create table public.mp_login_challenges (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  messages_sent integer not null default 1,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index mp_login_challenges_user_idx on public.mp_login_challenges(user_id);

-- Test-mode mailbox. Verification "emails" are written here instead of being sent.
create table public.mp_demo_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid,
  to_address text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index mp_demo_outbox_user_idx on public.mp_demo_outbox(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Access helpers (not exposed through the Data API)
-- ---------------------------------------------------------------------------

create or replace function mp_private.session_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mp_login_challenges c
    where c.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and c.user_id = auth.uid()
      and c.verified_at is not null
  )
$$;

create or replace function mp_private.org_ids_with_roles(p_roles text[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id
  from public.mp_memberships m
  where m.user_id = auth.uid()
    and m.role = any (p_roles)
    and mp_private.session_verified()
$$;

create or replace function mp_private.readable_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mp_private.org_ids_with_roles(array['admin', 'reviewer', 'provider_staff', 'read_only'])
$$;

create or replace function mp_private.writable_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mp_private.org_ids_with_roles(array['admin', 'reviewer', 'provider_staff'])
$$;

create or replace function mp_private.admin_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mp_private.org_ids_with_roles(array['admin'])
$$;

create or replace function mp_private.org_role(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.mp_memberships m
  where m.org_id = p_org_id
    and m.user_id = auth.uid()
    and mp_private.session_verified()
$$;

create or replace function mp_private.actor_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.display_name from public.mp_profiles p where p.user_id = auth.uid()), 'System')
$$;

create or replace function mp_private.require_role(p_org_id uuid, p_roles text[], p_message text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if not mp_private.session_verified() then
    raise exception 'Email verification is required for this session.' using errcode = '42501';
  end if;
  v_role := mp_private.org_role(p_org_id);
  if v_role is null or not (v_role = any (p_roles)) then
    raise exception '%', p_message using errcode = '42501';
  end if;
  return v_role;
end;
$$;

create or replace function mp_private.log_event(
  p_org_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_entity_label text,
  p_related_authorization_id uuid,
  p_action text,
  p_from_status text default null,
  p_to_status text default null,
  p_note text default ''
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.mp_activity_events(
    org_id, entity_type, entity_id, entity_label, related_authorization_id,
    action, from_status, to_status, note, actor_user_id, actor_name
  ) values (
    p_org_id, p_entity_type, p_entity_id, coalesce(p_entity_label, ''), p_related_authorization_id,
    p_action, p_from_status, p_to_status, coalesce(p_note, ''),
    (select p.user_id from public.mp_profiles p where p.user_id = auth.uid()),
    mp_private.actor_name()
  )
$$;

revoke all on all functions in schema mp_private from public, anon;
grant execute on function
  mp_private.session_verified(),
  mp_private.org_ids_with_roles(text[]),
  mp_private.readable_org_ids(),
  mp_private.writable_org_ids(),
  mp_private.admin_org_ids(),
  mp_private.org_role(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function mp_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger mp_members_touch before update on public.mp_members
  for each row execute function mp_private.touch_updated_at();
create trigger mp_authorizations_touch before update on public.mp_authorizations
  for each row execute function mp_private.touch_updated_at();
create trigger mp_documents_touch before update on public.mp_documents
  for each row execute function mp_private.touch_updated_at();
create trigger mp_consult_notes_touch before update on public.mp_consult_notes
  for each row execute function mp_private.touch_updated_at();

create or replace function mp_private.prepare_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
begin
  if tg_op = 'INSERT' then
    if not new.is_seeded then
      new.author_user_id := auth.uid();
      new.author_name := mp_private.actor_name();
    end if;
  else
    new.author_user_id := old.author_user_id;
    new.author_name := old.author_name;
    new.org_id := old.org_id;
    new.authorization_id := old.authorization_id;
    new.member_id := old.member_id;
  end if;
  new.subject := btrim(new.subject);
  new.body := btrim(new.body);
  if new.authorization_id is not null then
    select a.member_id into v_member from public.mp_authorizations a where a.id = new.authorization_id;
    if v_member is distinct from new.member_id then
      raise exception 'The note member must match the authorization member.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger mp_consult_notes_prepare before insert or update on public.mp_consult_notes
  for each row execute function mp_private.prepare_note();

create or replace function mp_private.prepare_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.document_number is null then
      new.document_number := 'DEMO-DOC-' || lpad(nextval('mp_private.document_number_seq')::text, 6, '0');
    end if;
    if not new.is_seeded then
      new.uploaded_by := auth.uid();
      new.uploaded_by_name := mp_private.actor_name();
      new.status := 'new';
      new.sent_date := current_date;
    end if;
  end if;
  new.description := btrim(new.description);
  return new;
end;
$$;

create trigger mp_documents_prepare before insert or update on public.mp_documents
  for each row execute function mp_private.prepare_document();

create or replace function mp_private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_label text;
  v_action text;
  v_entity text;
begin
  if coalesce(current_setting('mp.suppress_audit', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  if v_row.is_seeded and tg_op = 'INSERT' then
    return null;
  end if;
  if tg_table_name = 'mp_documents' then
    v_entity := 'document';
    v_label := v_row.file_name;
  else
    v_entity := 'note';
    v_label := v_row.subject;
  end if;
  v_action := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  -- Deleting a parent authorization cascades here; skip events that would reference it.
  if tg_op = 'DELETE' and v_row.authorization_id is not null
     and not exists (select 1 from public.mp_authorizations a where a.id = v_row.authorization_id) then
    return null;
  end if;
  perform mp_private.log_event(
    v_row.org_id, v_entity, v_row.id, v_label,
    case when tg_op = 'DELETE' then null else v_row.authorization_id end,
    v_entity || '_' || v_action
  );
  return null;
end;
$$;

create trigger mp_documents_audit after insert or update or delete on public.mp_documents
  for each row execute function mp_private.audit_row();
create trigger mp_consult_notes_audit after insert or update or delete on public.mp_consult_notes
  for each row execute function mp_private.audit_row();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.mp_organizations enable row level security;
alter table public.mp_profiles enable row level security;
alter table public.mp_memberships enable row level security;
alter table public.mp_health_plans enable row level security;
alter table public.mp_reference_codes enable row level security;
alter table public.mp_forms_manuals enable row level security;
alter table public.mp_providers enable row level security;
alter table public.mp_members enable row level security;
alter table public.mp_authorizations enable row level security;
alter table public.mp_claims enable row level security;
alter table public.mp_documents enable row level security;
alter table public.mp_consult_notes enable row level security;
alter table public.mp_activity_events enable row level security;
alter table public.mp_login_challenges enable row level security;
alter table public.mp_demo_outbox enable row level security;

create policy "members read their organizations" on public.mp_organizations
  for select to authenticated using (id in (select mp_private.readable_org_ids()));

create policy "users read own profile" on public.mp_profiles
  for select to authenticated using (user_id = (select auth.uid()));

create policy "users read own memberships" on public.mp_memberships
  for select to authenticated using (user_id = (select auth.uid()));

create policy "verified users read health plans" on public.mp_health_plans
  for select to authenticated using ((select mp_private.session_verified()));

create policy "verified users read reference codes" on public.mp_reference_codes
  for select to authenticated using ((select mp_private.session_verified()));

create policy "verified users read forms" on public.mp_forms_manuals
  for select to authenticated using ((select mp_private.session_verified()));

create policy "org members read providers" on public.mp_providers
  for select to authenticated using (org_id in (select mp_private.readable_org_ids()));

create policy "org members read members" on public.mp_members
  for select to authenticated using (org_id in (select mp_private.readable_org_ids()));

create policy "org members read authorizations" on public.mp_authorizations
  for select to authenticated using (org_id in (select mp_private.readable_org_ids()));

create policy "org members read claims" on public.mp_claims
  for select to authenticated using (org_id in (select mp_private.readable_org_ids()));

create policy "org members read documents" on public.mp_documents
  for select to authenticated using (org_id in (select mp_private.readable_org_ids()));
create policy "writers add documents" on public.mp_documents
  for insert to authenticated
  with check (
    org_id in (select mp_private.writable_org_ids())
    and storage_path like org_id::text || '/%'
    and not is_seeded
  );
create policy "writers update documents" on public.mp_documents
  for update to authenticated
  using (org_id in (select mp_private.writable_org_ids()))
  with check (org_id in (select mp_private.writable_org_ids()));
create policy "uploaders or admins delete documents" on public.mp_documents
  for delete to authenticated
  using (
    org_id in (select mp_private.writable_org_ids())
    and (uploaded_by = (select auth.uid()) or org_id in (select mp_private.admin_org_ids()))
  );

create policy "org members read notes" on public.mp_consult_notes
  for select to authenticated using (org_id in (select mp_private.readable_org_ids()));
create policy "writers add notes" on public.mp_consult_notes
  for insert to authenticated
  with check (org_id in (select mp_private.writable_org_ids()) and not is_seeded);
create policy "authors or admins update notes" on public.mp_consult_notes
  for update to authenticated
  using (
    org_id in (select mp_private.writable_org_ids())
    and (author_user_id = (select auth.uid()) or org_id in (select mp_private.admin_org_ids()))
  )
  with check (org_id in (select mp_private.writable_org_ids()));
create policy "authors or admins delete notes" on public.mp_consult_notes
  for delete to authenticated
  using (
    org_id in (select mp_private.writable_org_ids())
    and (author_user_id = (select auth.uid()) or org_id in (select mp_private.admin_org_ids()))
  );

create policy "org members read activity" on public.mp_activity_events
  for select to authenticated
  using (
    org_id in (select mp_private.readable_org_ids())
    or (org_id is null and actor_user_id = (select auth.uid()))
  );

create policy "users read own test mailbox" on public.mp_demo_outbox
  for select to authenticated using (user_id = (select auth.uid()));

-- mp_login_challenges intentionally has no policies: only SECURITY DEFINER RPCs touch it.

-- ---------------------------------------------------------------------------
-- Views (security_invoker so base-table RLS applies)
-- ---------------------------------------------------------------------------

create view public.mp_authorization_list with (security_invoker = true) as
select
  a.*,
  case a.status
    when 'approved' then '1 - Approved'
    when 'modified' then '2 - Modified'
    when 'denied' then '3 - Denied'
    when 'deferred' then '4 - Deferred'
    when 'cancelled' then '6 - Cancelled'
    when 'requested' then '7 - Requested'
    else '0 - Draft'
  end as status_label,
  m.member_number,
  m.first_name as member_first_name,
  m.last_name as member_last_name,
  m.last_name || ', ' || m.first_name as member_name,
  m.sex as member_sex,
  m.birth_date as member_birth_date,
  hp.name as health_plan_name,
  rp.first_name as requested_provider_first_name,
  rp.last_name as requested_provider_last_name,
  'Dr. ' || rp.first_name || ' ' || rp.last_name as requested_provider_name,
  case when fp.id is null then null else 'Dr. ' || fp.first_name || ' ' || fp.last_name end as referring_provider_name,
  pr.display_name as created_by_name
from public.mp_authorizations a
join public.mp_members m on m.id = a.member_id
join public.mp_health_plans hp on hp.code = a.health_plan
join public.mp_providers rp on rp.id = a.requested_provider_id
left join public.mp_providers fp on fp.id = a.referring_provider_id
left join public.mp_profiles pr on pr.user_id = a.created_by;

create view public.mp_claim_list with (security_invoker = true) as
select
  c.*,
  m.member_number,
  m.first_name as member_first_name,
  m.last_name as member_last_name,
  m.last_name || ', ' || m.first_name as member_name,
  m.birth_date as member_birth_date,
  hp.name as health_plan_name,
  'Dr. ' || p.first_name || ' ' || p.last_name as provider_name,
  a.auth_number
from public.mp_claims c
join public.mp_members m on m.id = c.member_id
join public.mp_health_plans hp on hp.code = c.health_plan
join public.mp_providers p on p.id = c.provider_id
left join public.mp_authorizations a on a.id = c.authorization_id;

create view public.mp_member_list with (security_invoker = true) as
select
  m.*,
  m.last_name || ', ' || m.first_name as member_name,
  hp.name as health_plan_name,
  case when p.id is null then null else 'Dr. ' || p.first_name || ' ' || p.last_name end as pcp_name,
  date_part('year', age(current_date, m.birth_date))::integer as age_years,
  (m.birth_date > (current_date - interval '65 years')::date
    and m.birth_date <= (current_date - interval '64 years')::date) as approaching_65,
  (m.hospitalized_since is not null) as hospitalized,
  (m.last_pcp_visit is null or m.last_pcp_visit < (current_date - interval '1 year')::date) as no_visit_past_year,
  (m.last_pcp_visit is null) as no_visit_since_enrollment
from public.mp_members m
join public.mp_health_plans hp on hp.code = m.health_plan
left join public.mp_providers p on p.id = m.pcp_provider_id;

create view public.mp_provider_list with (security_invoker = true) as
select
  p.*,
  p.last_name || ', ' || p.first_name as provider_name,
  array_to_string(p.hospitals, ', ') as hospitals_text
from public.mp_providers p;

create view public.mp_document_list with (security_invoker = true) as
select
  d.*,
  a.auth_number
from public.mp_documents d
left join public.mp_authorizations a on a.id = d.authorization_id;

create view public.mp_note_list with (security_invoker = true) as
select
  n.*,
  a.auth_number,
  m.member_number,
  m.last_name || ', ' || m.first_name as member_name
from public.mp_consult_notes n
join public.mp_members m on m.id = n.member_id
left join public.mp_authorizations a on a.id = n.authorization_id;

-- ---------------------------------------------------------------------------
-- Privileges (Supabase grants broad defaults on public; replace them explicitly)
-- ---------------------------------------------------------------------------

revoke all on
  public.mp_organizations, public.mp_profiles, public.mp_memberships, public.mp_health_plans,
  public.mp_reference_codes, public.mp_forms_manuals, public.mp_providers, public.mp_members,
  public.mp_authorizations, public.mp_claims, public.mp_documents, public.mp_consult_notes,
  public.mp_activity_events, public.mp_login_challenges, public.mp_demo_outbox,
  public.mp_authorization_list, public.mp_claim_list, public.mp_member_list,
  public.mp_provider_list, public.mp_document_list, public.mp_note_list
from anon, authenticated;

grant select on
  public.mp_organizations, public.mp_profiles, public.mp_memberships, public.mp_health_plans,
  public.mp_reference_codes, public.mp_forms_manuals, public.mp_providers, public.mp_members,
  public.mp_authorizations, public.mp_claims, public.mp_documents, public.mp_consult_notes,
  public.mp_activity_events, public.mp_demo_outbox,
  public.mp_authorization_list, public.mp_claim_list, public.mp_member_list,
  public.mp_provider_list, public.mp_document_list, public.mp_note_list
to authenticated;

grant insert (id, org_id, authorization_id, doc_type, category, file_name, description, storage_path, mime_type, size_bytes)
  on public.mp_documents to authenticated;
grant update (status, category, description) on public.mp_documents to authenticated;
grant delete on public.mp_documents to authenticated;

grant insert (org_id, authorization_id, member_id, note_type, subject, body) on public.mp_consult_notes to authenticated;
grant update (note_type, subject, body) on public.mp_consult_notes to authenticated;
grant delete on public.mp_consult_notes to authenticated;

-- ---------------------------------------------------------------------------
-- Test-mode sign-in verification RPCs
-- ---------------------------------------------------------------------------

create or replace function public.mp_session_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.mp_profiles;
begin
  if auth.uid() is null then
    return jsonb_build_object('authenticated', false, 'verified', false);
  end if;
  select * into v_profile from public.mp_profiles where user_id = auth.uid();
  return jsonb_build_object(
    'authenticated', true,
    'demo_account', v_profile.user_id is not null,
    'verified', mp_private.session_verified(),
    'username', v_profile.username,
    'display_name', v_profile.display_name,
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('org_id', o.id, 'code', o.code, 'name', o.name, 'role', m.role) order by o.sort_order)
      from public.mp_memberships m
      join public.mp_organizations o on o.id = m.org_id
      where m.user_id = auth.uid()
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.mp_begin_verification(p_resend boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_email text;
  v_challenge public.mp_login_challenges;
  v_code text;
  v_ttl interval := interval '10 minutes';
begin
  if auth.uid() is null or v_session is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.mp_profiles where user_id = auth.uid()) then
    raise exception 'Only seeded demo accounts can use this portal.' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = auth.uid();

  select * into v_challenge from public.mp_login_challenges where session_id = v_session for update;
  if found and v_challenge.verified_at is not null then
    return jsonb_build_object('verified', true);
  end if;
  if found and not p_resend and v_challenge.expires_at > now() and v_challenge.attempts < v_challenge.max_attempts then
    return jsonb_build_object(
      'verified', false,
      'masked_email', regexp_replace(v_email, '^(.).*(@.*)$', '\1•••\2'),
      'expires_at', v_challenge.expires_at,
      'attempts_remaining', v_challenge.max_attempts - v_challenge.attempts
    );
  end if;
  if found and v_challenge.messages_sent >= 10 then
    raise exception 'Too many verification messages for this session. Sign out and sign in again.' using errcode = '54000';
  end if;

  v_code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');

  insert into public.mp_login_challenges(session_id, user_id, code_hash, attempts, messages_sent, expires_at)
  values (v_session, auth.uid(), extensions.crypt(v_code, extensions.gen_salt('bf', 6)), 0, 1, now() + v_ttl)
  on conflict (session_id) do update
    set code_hash = excluded.code_hash,
        attempts = 0,
        messages_sent = public.mp_login_challenges.messages_sent + 1,
        expires_at = excluded.expires_at,
        created_at = now();

  insert into public.mp_demo_outbox(user_id, session_id, to_address, subject, body)
  values (
    auth.uid(), v_session, v_email,
    'MedPoint LOCAL MOCK verification code',
    'TEST MODE — this message was NOT emailed. It exists only in the demo portal test mailbox.' || chr(10) || chr(10)
      || 'Your verification code is ' || v_code || '.' || chr(10)
      || 'It expires in 10 minutes and allows 5 attempts.'
  );

  return jsonb_build_object(
    'verified', false,
    'masked_email', regexp_replace(v_email, '^(.).*(@.*)$', '\1•••\2'),
    'expires_at', now() + v_ttl,
    'attempts_remaining', 5,
    'sent', true
  );
end;
$$;

create or replace function public.mp_verify_login_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_challenge public.mp_login_challenges;
begin
  if auth.uid() is null or v_session is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  select * into v_challenge from public.mp_login_challenges
  where session_id = v_session and user_id = auth.uid()
  for update;
  if not found then
    return jsonb_build_object('verified', false, 'reason', 'missing', 'message', 'Request a verification code first.');
  end if;
  if v_challenge.verified_at is not null then
    return jsonb_build_object('verified', true);
  end if;
  if v_challenge.expires_at <= now() then
    return jsonb_build_object('verified', false, 'reason', 'expired', 'message', 'This verification code expired. Request a new code.');
  end if;
  if v_challenge.attempts >= v_challenge.max_attempts then
    return jsonb_build_object('verified', false, 'reason', 'locked', 'message', 'Too many incorrect codes. Request a new code.');
  end if;
  if coalesce(p_code, '') !~ '^[0-9]{6}$' then
    return jsonb_build_object('verified', false, 'reason', 'format', 'message', 'Enter the 6-digit verification code.',
      'attempts_remaining', v_challenge.max_attempts - v_challenge.attempts);
  end if;
  if extensions.crypt(p_code, v_challenge.code_hash) <> v_challenge.code_hash then
    update public.mp_login_challenges set attempts = attempts + 1 where session_id = v_session;
    return jsonb_build_object(
      'verified', false,
      'reason', case when v_challenge.attempts + 1 >= v_challenge.max_attempts then 'locked' else 'incorrect' end,
      'message', case when v_challenge.attempts + 1 >= v_challenge.max_attempts
        then 'Too many incorrect codes. Request a new code.'
        else 'Incorrect verification code.' end,
      'attempts_remaining', greatest(v_challenge.max_attempts - v_challenge.attempts - 1, 0)
    );
  end if;
  update public.mp_login_challenges set verified_at = now() where session_id = v_session;
  perform mp_private.log_event(null, 'session', null, 'Sign-in', null, 'login_verified');
  return jsonb_build_object('verified', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Authorization workflow RPCs
-- ---------------------------------------------------------------------------

create or replace function public.mp_save_authorization(
  p_org_id uuid,
  p_data jsonb,
  p_id uuid default null,
  p_submit boolean default false
)
returns public.mp_authorizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_existing public.mp_authorizations;
  v_row public.mp_authorizations;
  v_errors text[] := '{}';
  v_member public.mp_members;
  v_units integer;
  v_summary text := btrim(coalesce(p_data ->> 'clinical_summary', ''));
  v_requested uuid := nullif(p_data ->> 'requested_provider_id', '')::uuid;
  v_referring uuid := nullif(p_data ->> 'referring_provider_id', '')::uuid;
  v_service text := nullif(btrim(coalesce(p_data ->> 'service_code', '')), '');
  v_diagnosis text := nullif(btrim(coalesce(p_data ->> 'diagnosis_code', '')), '');
  v_pos text := nullif(btrim(coalesce(p_data ->> 'place_of_service', '')), '');
  v_priority text := coalesce(nullif(p_data ->> 'priority', ''), 'routine');
  v_request_date date := coalesce(nullif(p_data ->> 'request_date', '')::date, current_date);
  v_action text;
  v_to_status text;
begin
  v_role := mp_private.require_role(p_org_id, array['admin', 'provider_staff'],
    'You do not have permission to create or edit authorization requests.');

  if p_id is not null then
    select * into v_existing from public.mp_authorizations where id = p_id and org_id = p_org_id for update;
    if not found then
      raise exception 'Authorization request not found.' using errcode = 'P0002';
    end if;
    if v_existing.status not in ('draft', 'deferred') then
      raise exception 'Only draft or deferred requests can be edited (current status: %).', v_existing.status using errcode = '22023';
    end if;
    if v_existing.status = 'deferred' and not p_submit then
      raise exception 'Deferred requests must be resubmitted, not saved as drafts.' using errcode = '22023';
    end if;
  end if;

  select * into v_member from public.mp_members
  where id = nullif(p_data ->> 'member_id', '')::uuid and org_id = p_org_id;
  if v_member.id is null then v_errors := array_append(v_errors, 'Member is required.'::text); end if;

  if v_requested is null or not exists (select 1 from public.mp_providers where id = v_requested and org_id = p_org_id) then
    v_errors := array_append(v_errors, 'Requested provider is required.'::text);
  end if;
  if v_referring is not null and not exists (select 1 from public.mp_providers where id = v_referring and org_id = p_org_id) then
    v_errors := array_append(v_errors, 'Referring provider is not in this IPA.'::text);
  end if;
  if v_service is null or not exists (select 1 from public.mp_reference_codes where code_type = 'service' and code = v_service) then
    v_errors := array_append(v_errors, 'Service code is required.'::text);
  end if;
  if v_diagnosis is null or not exists (select 1 from public.mp_reference_codes where code_type = 'diagnosis' and code = v_diagnosis) then
    v_errors := array_append(v_errors, 'Diagnosis code is required.'::text);
  end if;
  if v_pos is null or not exists (select 1 from public.mp_reference_codes where code_type = 'place_of_service' and code = v_pos) then
    v_errors := array_append(v_errors, 'Place of service is required.'::text);
  end if;
  begin
    v_units := (p_data ->> 'units')::integer;
  exception when others then
    v_units := null;
  end;
  if v_units is null or v_units < 1 or v_units > 999 then
    v_errors := array_append(v_errors, 'Units must be between 1 and 999.'::text);
  end if;
  if v_priority not in ('routine', 'urgent') then
    v_errors := array_append(v_errors, 'Priority must be routine or urgent.'::text);
  end if;
  if char_length(v_summary) > 4000 then
    v_errors := array_append(v_errors, 'Clinical summary must be 4000 characters or fewer.'::text);
  end if;
  if p_submit then
    if char_length(v_summary) < 20 then
      v_errors := array_append(v_errors, 'Clinical summary must be at least 20 characters to submit.'::text);
    end if;
    if v_member.id is not null and v_member.eligibility_status <> 'eligible' then
      v_errors := array_append(v_errors, 'Member is not eligible on the request date.'::text);
    end if;
  end if;

  if cardinality(v_errors) > 0 then
    raise exception 'Validation failed: %', array_to_string(v_errors, ' ')
      using errcode = '22023', detail = to_jsonb(v_errors)::text;
  end if;

  v_to_status := case when p_submit then 'requested' else 'draft' end;

  if p_id is null then
    insert into public.mp_authorizations(
      org_id, status, priority, member_id, referring_provider_id, requested_provider_id, health_plan,
      service_code, diagnosis_code, place_of_service, units, request_date, clinical_summary,
      created_by, submitted_by
    ) values (
      p_org_id, v_to_status, v_priority, v_member.id, v_referring, v_requested, v_member.health_plan,
      v_service, v_diagnosis, v_pos, v_units, v_request_date, v_summary,
      auth.uid(), case when p_submit then auth.uid() end
    ) returning * into v_row;
    perform mp_private.log_event(p_org_id, 'authorization', v_row.id, v_row.auth_number, v_row.id,
      case when p_submit then 'submitted' else 'draft_created' end, null, v_to_status);
  else
    update public.mp_authorizations set
      status = v_to_status,
      priority = v_priority,
      member_id = v_member.id,
      referring_provider_id = v_referring,
      requested_provider_id = v_requested,
      health_plan = v_member.health_plan,
      service_code = v_service,
      diagnosis_code = v_diagnosis,
      place_of_service = v_pos,
      units = v_units,
      request_date = v_request_date,
      clinical_summary = v_summary,
      submitted_by = case when p_submit then auth.uid() else submitted_by end,
      decision_reason = case when v_existing.status = 'deferred' then decision_reason else '' end
    where id = p_id
    returning * into v_row;
    v_action := case
      when v_existing.status = 'deferred' then 'resubmitted'
      when p_submit then 'submitted'
      else 'draft_updated'
    end;
    perform mp_private.log_event(p_org_id, 'authorization', v_row.id, v_row.auth_number, v_row.id,
      v_action, v_existing.status, v_to_status);
  end if;

  return v_row;
end;
$$;

create or replace function public.mp_transition_authorization(
  p_id uuid,
  p_to_status text,
  p_reason text default '',
  p_approved_units integer default null,
  p_expected_updated_at timestamptz default null
)
returns public.mp_authorizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth public.mp_authorizations;
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_allowed boolean;
  v_decision boolean := p_to_status in ('approved', 'modified', 'denied', 'deferred');
  v_previous text;
begin
  select * into v_auth from public.mp_authorizations where id = p_id for update;
  if not found then
    raise exception 'Authorization not found.' using errcode = 'P0002';
  end if;
  v_previous := v_auth.status;

  v_role := mp_private.org_role(v_auth.org_id);
  if auth.uid() is null or not mp_private.session_verified() or v_role is null then
    raise exception 'Authorization not found.' using errcode = 'P0002';
  end if;

  if p_expected_updated_at is not null and date_trunc('milliseconds', v_auth.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'This authorization changed since you opened it. Reload and try again.' using errcode = '40001';
  end if;

  if v_decision and v_role not in ('admin', 'reviewer') then
    raise exception 'Only reviewers or administrators can record authorization decisions.' using errcode = '42501';
  end if;
  if p_to_status in ('requested', 'cancelled') and v_role not in ('admin', 'provider_staff') then
    raise exception 'You do not have permission to submit or cancel requests.' using errcode = '42501';
  end if;

  v_allowed := case
    when v_auth.status = 'draft' and p_to_status = 'requested' then true
    when v_auth.status = 'requested' and p_to_status in ('approved', 'modified', 'denied', 'deferred', 'cancelled') then true
    when v_auth.status = 'deferred' and p_to_status in ('approved', 'modified', 'denied', 'requested', 'cancelled') then true
    when v_auth.status in ('approved', 'modified') and p_to_status = 'cancelled' and v_role = 'admin' then true
    else false
  end;
  if not v_allowed then
    raise exception 'Cannot change status from % to %.', v_auth.status, p_to_status using errcode = '22023';
  end if;

  if p_to_status in ('denied', 'deferred', 'modified', 'cancelled') and v_reason = '' then
    raise exception 'A reason is required to mark this request %.', p_to_status using errcode = '22023';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception 'Reason must be 2000 characters or fewer.' using errcode = '22023';
  end if;
  if p_to_status = 'modified' and (p_approved_units is null or p_approved_units < 1 or p_approved_units >= v_auth.units) then
    raise exception 'Modified approvals need approved units between 1 and %.', v_auth.units - 1 using errcode = '22023';
  end if;
  if p_to_status = 'requested' and char_length(btrim(v_auth.clinical_summary)) < 20 then
    raise exception 'Clinical summary must be at least 20 characters to submit.' using errcode = '22023';
  end if;
  if p_to_status = 'requested' and exists (
    select 1 from public.mp_members m where m.id = v_auth.member_id and m.eligibility_status <> 'eligible'
  ) then
    raise exception 'Member is not eligible on the request date.' using errcode = '22023';
  end if;

  update public.mp_authorizations set
    status = p_to_status,
    decision_reason = case when v_decision or p_to_status = 'cancelled' then v_reason else decision_reason end,
    approved_units = case
      when p_to_status = 'approved' then units
      when p_to_status = 'modified' then p_approved_units
      when p_to_status in ('denied', 'cancelled') then 0
      else approved_units
    end,
    authorization_date = case when p_to_status in ('approved', 'modified') then current_date else authorization_date end,
    expiration_date = case
      when p_to_status in ('approved', 'modified') then coalesce(expiration_date, current_date + 90)
      else expiration_date
    end,
    submitted_by = case when p_to_status = 'requested' then auth.uid() else submitted_by end
  where id = p_id
  returning * into v_auth;

  perform mp_private.log_event(v_auth.org_id, 'authorization', v_auth.id, v_auth.auth_number, v_auth.id,
    case p_to_status
      when 'requested' then 'submitted'
      when 'approved' then 'approved'
      when 'modified' then 'modified'
      when 'denied' then 'denied'
      when 'deferred' then 'deferred'
      else 'cancelled'
    end,
    v_previous, p_to_status, v_reason);

  return v_auth;
end;
$$;

create or replace function public.mp_delete_authorization(p_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth public.mp_authorizations;
  v_role text;
  v_paths text[];
begin
  select * into v_auth from public.mp_authorizations where id = p_id for update;
  if not found then
    raise exception 'Authorization not found.' using errcode = 'P0002';
  end if;
  v_role := mp_private.require_role(v_auth.org_id, array['admin', 'provider_staff'],
    'You do not have permission to delete authorization requests.');
  if v_role <> 'admin' and v_auth.status <> 'draft' then
    raise exception 'Only draft requests can be deleted.' using errcode = '22023';
  end if;
  select coalesce(array_agg(storage_path), '{}') into v_paths from public.mp_documents where authorization_id = p_id;
  delete from public.mp_authorizations where id = p_id;
  perform mp_private.log_event(v_auth.org_id, 'authorization', v_auth.id, v_auth.auth_number, null, 'deleted', v_auth.status, null);
  return v_paths;
end;
$$;

-- Hospital Admin (approximation): administrators record admissions and discharges.
create or replace function public.mp_set_member_admission(p_member_id uuid, p_hospital text default null)
returns public.mp_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.mp_members;
  v_hospital text := nullif(btrim(coalesce(p_hospital, '')), '');
begin
  select * into v_member from public.mp_members where id = p_member_id for update;
  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
  perform mp_private.require_role(v_member.org_id, array['admin'], 'Hospital Admin is restricted to IPA administrators.');
  update public.mp_members set
    hospitalized_since = case when v_hospital is null then null else coalesce(hospitalized_since, current_date) end,
    hospital_name = v_hospital
  where id = p_member_id
  returning * into v_member;
  perform mp_private.log_event(v_member.org_id, 'member', v_member.id, v_member.member_number, null,
    case when v_hospital is null then 'discharged' else 'admitted' end, null, null, coalesce(v_hospital, ''));
  return v_member;
end;
$$;

revoke all on function
  public.mp_session_status(),
  public.mp_begin_verification(boolean),
  public.mp_verify_login_code(text),
  public.mp_save_authorization(uuid, jsonb, uuid, boolean),
  public.mp_transition_authorization(uuid, text, text, integer, timestamptz),
  public.mp_delete_authorization(uuid),
  public.mp_set_member_admission(uuid, text)
from public, anon;

grant execute on function
  public.mp_session_status(),
  public.mp_begin_verification(boolean),
  public.mp_verify_login_code(text),
  public.mp_save_authorization(uuid, jsonb, uuid, boolean),
  public.mp_transition_authorization(uuid, text, text, integer, timestamptz),
  public.mp_delete_authorization(uuid),
  public.mp_set_member_admission(uuid, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for synthetic attachments and forms
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mp-demo-documents', 'mp-demo-documents', false, 5242880,
        array['application/pdf', 'text/plain', 'image/png', 'image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "mp demo read documents" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'mp-demo-documents'
    and (
      ((storage.foldername(name))[1] = 'shared' and (select mp_private.session_verified()))
      or (storage.foldername(name))[1] in (select id::text from mp_private.readable_org_ids() as t(id))
    )
  );

create policy "mp demo upload documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'mp-demo-documents'
    and (storage.foldername(name))[1] in (select id::text from mp_private.writable_org_ids() as t(id))
  );

create policy "mp demo delete documents" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'mp-demo-documents'
    and (storage.foldername(name))[1] in (select id::text from mp_private.writable_org_ids() as t(id))
    and (
      owner_id = (select auth.uid())::text
      or (storage.foldername(name))[1] in (select id::text from mp_private.admin_org_ids() as t(id))
    )
  );
