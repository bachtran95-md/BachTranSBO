-- Finalized Státusz Generator dataset.
-- Working generator state remains browser-local; only the end-of-shift final record is persisted.

create table if not exists public.status_generator_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  generator_version text not null,
  parameters jsonb not null default '{}'::jsonb,
  section_inputs jsonb not null default '{}'::jsonb,
  canonical_findings jsonb not null default '[]'::jsonb,
  explicit_normal_findings jsonb not null default '[]'::jsonb,
  confirmed_custom_findings jsonb not null default '[]'::jsonb,
  renderer_output text not null default '',
  final_status text not null default '',
  copied_at timestamptz,
  finalized_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, case_id)
);

create index if not exists status_generator_owner_shift_idx
  on public.status_generator_revisions(owner_id, shift_id, finalized_at desc);

alter table public.status_generator_revisions enable row level security;

revoke all on public.status_generator_revisions from public, anon, authenticated;
grant select, insert, update, delete on public.status_generator_revisions to service_role;

create or replace function public.save_status_generator_revision(
  p_case_id uuid,
  p_shift_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_owner_id uuid := auth.uid();
  v_id uuid;
begin
  if v_owner_id is null then
    raise exception 'Authentication required.';
  end if;

  if not exists (
    select 1
    from public.cases c
    join public.shifts s on s.id = c.shift_id
    where c.id = p_case_id
      and c.shift_id = p_shift_id
      and c.owner_id = v_owner_id
      and s.owner_id = v_owner_id
  ) then
    raise exception 'Case/shift ownership mismatch.';
  end if;

  insert into public.status_generator_revisions (
    owner_id,
    shift_id,
    case_id,
    generator_version,
    parameters,
    section_inputs,
    canonical_findings,
    explicit_normal_findings,
    confirmed_custom_findings,
    renderer_output,
    final_status,
    copied_at,
    finalized_at,
    updated_at
  )
  values (
    v_owner_id,
    p_shift_id,
    p_case_id,
    coalesce(nullif(p_payload->>'generator_version', ''), 'unknown'),
    coalesce(p_payload->'parameters', '{}'::jsonb),
    coalesce(p_payload->'section_inputs', '{}'::jsonb),
    coalesce(p_payload->'canonical_findings', '[]'::jsonb),
    coalesce(p_payload->'explicit_normal_findings', '[]'::jsonb),
    coalesce(p_payload->'confirmed_custom_findings', '[]'::jsonb),
    coalesce(p_payload->>'renderer_output', ''),
    coalesce(p_payload->>'final_status', ''),
    nullif(p_payload->>'copied_at', '')::timestamptz,
    coalesce(nullif(p_payload->>'finalized_at', '')::timestamptz, now()),
    now()
  )
  on conflict (owner_id, case_id)
  do update set
    shift_id = excluded.shift_id,
    generator_version = excluded.generator_version,
    parameters = excluded.parameters,
    section_inputs = excluded.section_inputs,
    canonical_findings = excluded.canonical_findings,
    explicit_normal_findings = excluded.explicit_normal_findings,
    confirmed_custom_findings = excluded.confirmed_custom_findings,
    renderer_output = excluded.renderer_output,
    final_status = excluded.final_status,
    copied_at = excluded.copied_at,
    finalized_at = excluded.finalized_at,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.save_status_generator_revision(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.save_status_generator_revision(uuid, uuid, jsonb)
  to authenticated, service_role;
