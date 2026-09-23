-- Finalized Summary learning corpus review states.
-- New revisions wait in Pending until explicitly approved or excluded.

alter table public.summary_revisions
  drop constraint if exists summary_revisions_learning_status_check;

alter table public.summary_revisions
  alter column learning_status set default 'pending';

alter table public.summary_revisions
  add constraint summary_revisions_learning_status_check
  check (learning_status in ('pending', 'approved', 'excluded'));

-- Historical rows that were auto-approved but never explicitly reviewed
-- should enter the new Pending workflow.
update public.summary_revisions
set learning_status = 'pending'
where learning_status = 'approved'
  and learning_reviewed_at is null;
