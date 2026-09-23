create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_title_length check (char_length(title) <= 200),
  constraint notes_content_length check (char_length(content) <= 50000)
);

create index if not exists notes_owner_updated_at_idx
  on public.notes(owner_id, updated_at desc);

alter table public.notes enable row level security;

revoke all on table public.notes from anon, authenticated;
grant select on table public.notes to authenticated;

drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own"
on public.notes
for select
to authenticated
using ((select auth.uid()) = owner_id);
