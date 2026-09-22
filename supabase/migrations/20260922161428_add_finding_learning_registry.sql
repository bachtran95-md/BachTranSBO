create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.finding_learning_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_phrase text not null check (char_length(source_phrase) between 1 and 500),
  normalized_phrase text not null check (char_length(normalized_phrase) between 1 and 500),
  mapping_kind text not null check (mapping_kind in ('existing', 'new')),
  finding_key text not null check (finding_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  canonical_label text not null default '',
  target text not null default '',
  section text not null default '',
  output_text text not null default '',
  conflict_text text not null default '',
  attributes jsonb not null default '{}'::jsonb,
  status text not null default 'approved' check (status in ('approved', 'reverted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finding_learning_owner_status_idx
  on public.finding_learning_records (owner_id, status, created_at desc);
create index if not exists finding_learning_normalized_idx
  on public.finding_learning_records (owner_id, normalized_phrase);

alter table public.finding_learning_records enable row level security;
revoke all on public.finding_learning_records from anon, authenticated;
grant select, insert, update, delete on public.finding_learning_records to service_role;

create table if not exists public.finding_registry_candidates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  normalized_phrase text not null,
  sample_phrase text not null,
  mapping_kind text not null check (mapping_kind in ('existing', 'new')),
  finding_key text not null,
  canonical_label text not null default '',
  target text not null default '',
  section text not null default '',
  output_text text not null default '',
  conflict_text text not null default '',
  attributes jsonb not null default '{}'::jsonb,
  confirmations integer not null default 1 check (confirmations > 0),
  first_confirmed_at timestamptz not null,
  last_confirmed_at timestamptz not null,
  built_at timestamptz not null default now(),
  state text not null default 'pending' check (state in ('pending', 'promoted', 'rejected')),
  updated_at timestamptz not null default now(),
  unique (owner_id, normalized_phrase, finding_key, mapping_kind)
);

create index if not exists finding_candidates_owner_state_idx
  on public.finding_registry_candidates (owner_id, state, confirmations desc, last_confirmed_at desc);

alter table public.finding_registry_candidates enable row level security;
revoke all on public.finding_registry_candidates from anon, authenticated;
grant select, insert, update, delete on public.finding_registry_candidates to service_role;

create or replace function public.build_finding_registry_candidates()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  pending_count integer;
begin
  insert into public.finding_registry_candidates (
    owner_id, normalized_phrase, sample_phrase, mapping_kind, finding_key,
    canonical_label, target, section, output_text, conflict_text, attributes,
    confirmations, first_confirmed_at, last_confirmed_at, built_at, state, updated_at
  )
  select
    owner_id, normalized_phrase, min(source_phrase), mapping_kind, finding_key,
    max(canonical_label), max(target), max(section), max(output_text),
    max(conflict_text),
    coalesce((array_agg(attributes order by created_at desc))[1], '{}'::jsonb),
    count(*)::integer, min(created_at), max(created_at), now(), 'pending', now()
  from public.finding_learning_records
  where status = 'approved'
  group by owner_id, normalized_phrase, mapping_kind, finding_key
  on conflict (owner_id, normalized_phrase, finding_key, mapping_kind)
  do update set
    sample_phrase = excluded.sample_phrase,
    canonical_label = excluded.canonical_label,
    target = excluded.target,
    section = excluded.section,
    output_text = excluded.output_text,
    conflict_text = excluded.conflict_text,
    attributes = excluded.attributes,
    confirmations = excluded.confirmations,
    first_confirmed_at = excluded.first_confirmed_at,
    last_confirmed_at = excluded.last_confirmed_at,
    built_at = excluded.built_at,
    state = case when public.finding_registry_candidates.state = 'promoted'
      then 'promoted' else 'pending' end,
    updated_at = now();

  select count(*)::integer into pending_count
  from public.finding_registry_candidates
  where state = 'pending';

  return pending_count;
end;
$$;

revoke all on function public.build_finding_registry_candidates() from public, anon, authenticated;
grant execute on function public.build_finding_registry_candidates() to service_role, postgres;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'finding-registry-daily'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'finding-registry-daily',
    '30 1 * * *',
    'select public.build_finding_registry_candidates();'
  );
end
$$;
