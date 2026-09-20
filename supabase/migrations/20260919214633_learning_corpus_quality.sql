-- Learning corpus quality controls
-- Adds explicit approve/exclude status for finalized summary revisions
-- and updates similarity matching to use only approved, latest-per-case revisions.

alter table public.summary_revisions
  add column if not exists learning_status text not null default 'approved',
  add column if not exists learning_note text,
  add column if not exists learning_reviewed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'summary_revisions_learning_status_check'
      and conrelid = 'public.summary_revisions'::regclass
  ) then
    alter table public.summary_revisions
      add constraint summary_revisions_learning_status_check
      check (learning_status in ('approved', 'excluded'));
  end if;
end $$;

create index if not exists summary_revisions_learning_idx
  on public.summary_revisions (owner_id, learning_status, finalized_at desc);

drop function if exists public.match_finalized_cases(
  uuid,
  vector,
  integer,
  uuid
);

drop function if exists public.match_finalized_cases(
  uuid,
  vector(1536),
  integer,
  uuid
);

create or replace function public.match_finalized_cases(
  p_owner_id uuid,
  p_query_embedding vector(1536),
  p_match_count integer default 5,
  p_exclude_case_id uuid default null
)
returns table (
  revision_id uuid,
  case_id uuid,
  finalized_text text,
  generated_text text,
  similarity double precision,
  finalized_at timestamptz,
  model text,
  skill_version_id uuid
)
language sql
security invoker
set search_path = public
as $$
  with latest_per_case as (
    select distinct on (sr.case_id)
      sr.id,
      sr.case_id,
      sr.finalized_text,
      sr.generated_text,
      sr.embedding,
      sr.finalized_at,
      sr.model,
      sr.skill_version_id
    from public.summary_revisions sr
    where sr.owner_id = p_owner_id
      and sr.learning_status = 'approved'
      and sr.embedding is not null
      and (p_exclude_case_id is null or sr.case_id <> p_exclude_case_id)
    order by sr.case_id, sr.finalized_at desc
  )
  select
    lpc.id as revision_id,
    lpc.case_id,
    lpc.finalized_text,
    lpc.generated_text,
    1 - (lpc.embedding <=> p_query_embedding) as similarity,
    lpc.finalized_at,
    lpc.model,
    lpc.skill_version_id
  from latest_per_case lpc
  order by lpc.embedding <=> p_query_embedding
  limit least(greatest(coalesce(p_match_count, 5), 1), 8);
$$;

revoke all on function public.match_finalized_cases(
  uuid,
  vector(1536),
  integer,
  uuid
) from public, anon, authenticated;

grant execute on function public.match_finalized_cases(
  uuid,
  vector(1536),
  integer,
  uuid
) to service_role;

drop function if exists public.match_approved_finalized_cases(
  uuid,
  vector,
  text,
  uuid,
  integer
);

drop function if exists public.match_approved_finalized_cases(
  uuid,
  vector(1536),
  text,
  uuid,
  integer
);

create or replace function public.match_approved_finalized_cases(
  p_owner_id uuid,
  p_query_embedding vector(1536),
  p_embedding_model text default 'text-embedding-3-small',
  p_exclude_case_id uuid default null,
  p_match_count integer default 5
)
returns table (
  revision_id uuid,
  case_id uuid,
  finalized_text text,
  generated_text text,
  similarity double precision,
  finalized_at timestamptz,
  model text,
  skill_version_id uuid,
  embedding_model text
)
language sql
security invoker
set search_path = public
as $$
  with latest_per_case as (
    select distinct on (sr.case_id)
      sr.id,
      sr.case_id,
      sr.finalized_text,
      sr.generated_text,
      sr.embedding,
      sr.embedding_model,
      sr.finalized_at,
      sr.model,
      sr.skill_version_id
    from public.summary_revisions sr
    where sr.owner_id = p_owner_id
      and sr.learning_status = 'approved'
      and sr.embedding is not null
      and sr.embedding_model = p_embedding_model
      and (p_exclude_case_id is null or sr.case_id <> p_exclude_case_id)
    order by sr.case_id, sr.finalized_at desc
  )
  select
    lpc.id as revision_id,
    lpc.case_id,
    lpc.finalized_text,
    lpc.generated_text,
    1 - (lpc.embedding <=> p_query_embedding) as similarity,
    lpc.finalized_at,
    lpc.model,
    lpc.skill_version_id,
    lpc.embedding_model
  from latest_per_case lpc
  order by lpc.embedding <=> p_query_embedding
  limit least(greatest(coalesce(p_match_count, 5), 1), 8);
$$;

revoke all on function public.match_approved_finalized_cases(
  uuid,
  vector(1536),
  text,
  uuid,
  integer
) from public, anon, authenticated;

grant execute on function public.match_approved_finalized_cases(
  uuid,
  vector(1536),
  text,
  uuid,
  integer
) to service_role;
