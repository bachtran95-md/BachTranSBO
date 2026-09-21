-- Persistent, monotonic display-case numbering per shift.
-- Deleted cases do not release their previously allocated number.

alter table public.shifts
  add column if not exists next_case_number integer not null default 1;

update public.shifts s
set next_case_number = greatest(
  s.next_case_number,
  coalesce((
    select max(c.local_id::integer) + 1
    from public.cases c
    where c.shift_id = s.id
      and c.local_id ~ '^[0-9]+$'
  ), 1)
);

alter table public.shifts
  drop constraint if exists shifts_next_case_number_positive;

alter table public.shifts
  add constraint shifts_next_case_number_positive
  check (next_case_number >= 1);

create or replace function public.allocate_shift_case_number(
  p_shift_id uuid,
  p_owner_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_number integer;
begin
  update public.shifts
  set next_case_number = next_case_number + 1
  where id = p_shift_id
    and owner_id = p_owner_id
    and status = 'active'
  returning next_case_number - 1 into v_number;

  if v_number is null then
    raise exception 'Active shift not found.';
  end if;

  return v_number;
end;
$$;

revoke all on function public.allocate_shift_case_number(uuid, uuid) from public;
revoke all on function public.allocate_shift_case_number(uuid, uuid) from anon;
revoke all on function public.allocate_shift_case_number(uuid, uuid) from authenticated;
grant execute on function public.allocate_shift_case_number(uuid, uuid) to service_role;
