alter table public.cases
  add column triage_status text not null default '';

alter table public.cases
  add constraint cases_triage_status_check
  check (triage_status in ('', 'red', 'yellow', 'green'));

comment on column public.cases.triage_status is
  'Manual UI-only case triage color. Excluded from clinical summary and AI prompt payloads.';
