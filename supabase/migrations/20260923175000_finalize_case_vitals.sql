-- Ensure atomic finalization persists the latest canonical vitals as well.
-- Preserve existing vitals when an older client omits the field.

create or replace function public.finalize_case_atomic_status(
  p_owner_id uuid,
  p_case jsonb,
  p_tests jsonb,
  p_summary jsonb,
  p_revision jsonb
)
returns uuid
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_revision_id uuid;
  v_case_id uuid := (p_case->>'id')::uuid;
begin
  v_revision_id := public.finalize_case_atomic(
    p_owner_id,
    p_case,
    p_tests,
    p_summary,
    p_revision
  );

  update public.cases
  set
    physical_status_data = coalesce(p_case->'physical_status_data', '{}'::jsonb),
    vitals = case
      when p_case ? 'vitals' then coalesce(p_case->'vitals', '{}'::jsonb)
      else vitals
    end
  where id = v_case_id
    and owner_id = p_owner_id;

  if not found then
    raise exception 'Structured clinical state persistence failed.';
  end if;

  return v_revision_id;
end;
$function$;
