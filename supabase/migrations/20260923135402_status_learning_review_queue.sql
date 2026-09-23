alter table public.finding_learning_records
  drop constraint if exists finding_learning_records_status_check;

update public.finding_learning_records
set status = 'excluded',
    updated_at = now()
where status = 'reverted';

alter table public.finding_learning_records
  alter column status set default 'pending';

alter table public.finding_learning_records
  add constraint finding_learning_records_status_check
  check (status in ('pending', 'approved', 'excluded'));

alter table public.finding_learning_records
  add column if not exists review_note text not null default '',
  add column if not exists reviewed_at timestamptz;
