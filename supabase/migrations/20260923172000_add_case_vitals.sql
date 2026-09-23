-- Persist canonical ER vital parameters separately from physical status.
-- These values are available to workflow/Case Assistant but intentionally excluded
-- from Summary generation and finalized Summary-learning snapshots.

alter table public.cases
  add column if not exists vitals jsonb not null default '{}'::jsonb;

alter table public.cases
  drop constraint if exists cases_vitals_object_check;

alter table public.cases
  add constraint cases_vitals_object_check
  check (jsonb_typeof(vitals) = 'object');

comment on column public.cases.vitals is
  'Canonical ER vital parameters. Persisted for workflow and Case Assistant; intentionally excluded from Summary generation and Summary-learning snapshots.';
