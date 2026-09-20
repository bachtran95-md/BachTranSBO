-- Official documentation library advisor cleanup
-- Adds helper indexes and explicit deny policies so browser clients do not
-- directly read/write official documentation learning tables.
--
-- Edge Functions use service_role and remain the only intended access path.

create index if not exists documentation_rules_source_idx
  on public.documentation_rules (source_id);

create index if not exists style_coach_runs_candidate_profile_idx
  on public.style_coach_runs (candidate_profile_id)
  where candidate_profile_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'documentation_sources'
      and policyname = 'documentation_sources_deny_browser_access'
  ) then
    create policy documentation_sources_deny_browser_access
      on public.documentation_sources
      for all
      to anon, authenticated
      using (false)
      with check (false);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'documentation_rules'
      and policyname = 'documentation_rules_deny_browser_access'
  ) then
    create policy documentation_rules_deny_browser_access
      on public.documentation_rules
      for all
      to anon, authenticated
      using (false)
      with check (false);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'style_coach_runs'
      and policyname = 'style_coach_runs_deny_browser_access'
  ) then
    create policy style_coach_runs_deny_browser_access
      on public.style_coach_runs
      for all
      to anon, authenticated
      using (false)
      with check (false);
  end if;
end $$;
