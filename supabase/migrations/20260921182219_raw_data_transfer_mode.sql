create table if not exists public.case_raw_data (
  case_id uuid primary key references public.cases(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '',
  source text not null default 'heidi' check (source in ('heidi', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_raw_data_content_length check (char_length(content) <= 100000)
);

create index if not exists case_raw_data_owner_id_idx
  on public.case_raw_data(owner_id);

alter table public.case_raw_data enable row level security;

revoke all on table public.case_raw_data from anon, authenticated;
grant select, insert, update, delete on table public.case_raw_data to authenticated;

drop policy if exists "case_raw_data_select_own" on public.case_raw_data;
create policy "case_raw_data_select_own"
on public.case_raw_data
for select
to authenticated
using (
  (select auth.uid()) = owner_id
  and exists (
    select 1
    from public.cases c
    where c.id = case_raw_data.case_id
      and c.owner_id = (select auth.uid())
  )
);

drop policy if exists "case_raw_data_insert_own" on public.case_raw_data;
create policy "case_raw_data_insert_own"
on public.case_raw_data
for insert
to authenticated
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1
    from public.cases c
    where c.id = case_raw_data.case_id
      and c.owner_id = (select auth.uid())
  )
);

drop policy if exists "case_raw_data_update_own" on public.case_raw_data;
create policy "case_raw_data_update_own"
on public.case_raw_data
for update
to authenticated
using (
  (select auth.uid()) = owner_id
  and exists (
    select 1
    from public.cases c
    where c.id = case_raw_data.case_id
      and c.owner_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1
    from public.cases c
    where c.id = case_raw_data.case_id
      and c.owner_id = (select auth.uid())
  )
);

drop policy if exists "case_raw_data_delete_own" on public.case_raw_data;
create policy "case_raw_data_delete_own"
on public.case_raw_data
for delete
to authenticated
using (
  (select auth.uid()) = owner_id
  and exists (
    select 1
    from public.cases c
    where c.id = case_raw_data.case_id
      and c.owner_id = (select auth.uid())
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'case_raw_data'
  ) then
    alter publication supabase_realtime add table public.case_raw_data;
  end if;
end
$$;
