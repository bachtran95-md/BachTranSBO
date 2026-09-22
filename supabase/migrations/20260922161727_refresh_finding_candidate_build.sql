create or replace function public.build_finding_registry_candidates()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  pending_count integer;
begin
  delete from public.finding_registry_candidates
  where state <> 'promoted';

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
    state = public.finding_registry_candidates.state,
    updated_at = now();

  select count(*)::integer into pending_count
  from public.finding_registry_candidates
  where state = 'pending';

  return pending_count;
end;
$$;

revoke all on function public.build_finding_registry_candidates() from public, anon, authenticated;
grant execute on function public.build_finding_registry_candidates() to service_role, postgres;
