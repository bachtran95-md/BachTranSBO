-- Harden Státusz finalized dataset access: only backend service writes.
drop function if exists public.save_status_generator_revision(uuid, uuid, jsonb);

create index if not exists status_generator_case_idx
  on public.status_generator_revisions(case_id);

create index if not exists status_generator_shift_idx
  on public.status_generator_revisions(shift_id);
