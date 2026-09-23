-- Persist only explicit normal Státusz concepts needed by Summary.
-- Parameters and draft generator inputs remain browser-local until shift finalization.

alter table public.cases
  add column if not exists status_explicit_normals jsonb not null default '[]'::jsonb;

comment on column public.cases.status_explicit_normals is
  'Canonical normal findings explicitly entered by the physician in Státusz; no raw free text.';
