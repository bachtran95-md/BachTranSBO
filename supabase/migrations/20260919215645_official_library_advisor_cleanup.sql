-- Reconciled from production Supabase migration history.
create index if not exists documentation_rules_source_idx
  on public.documentation_rules(source_id);

create index if not exists style_coach_runs_candidate_profile_idx
  on public.style_coach_runs(candidate_profile_id)
  where candidate_profile_id is not null;

drop policy if exists "documentation_sources_browser_deny" on public.documentation_sources;
create policy "documentation_sources_browser_deny"
on public.documentation_sources
for all
to authenticated
using (false)
with check (false);

drop policy if exists "documentation_rules_browser_deny" on public.documentation_rules;
create policy "documentation_rules_browser_deny"
on public.documentation_rules
for all
to authenticated
using (false)
with check (false);

drop policy if exists "style_coach_runs_browser_deny" on public.style_coach_runs;
create policy "style_coach_runs_browser_deny"
on public.style_coach_runs
for all
to authenticated
using (false)
with check (false);
