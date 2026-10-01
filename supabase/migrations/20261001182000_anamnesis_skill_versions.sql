-- Dedicated versioned skill store for the Anamnézis module.
-- This is intentionally separate from public.skill_versions so activating
-- Med - Anamnesis AI cannot deactivate or change the existing SBO Documentation AI skill.

create table if not exists public.anamnesis_skill_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  version integer not null,
  name text not null default 'Med - Anamnesis AI',
  instructions text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, version)
);

create unique index if not exists one_active_anamnesis_skill_per_owner
  on public.anamnesis_skill_versions(owner_id)
  where is_active = true;

alter table public.anamnesis_skill_versions enable row level security;

revoke all on table public.anamnesis_skill_versions from anon, authenticated;
grant select on table public.anamnesis_skill_versions to service_role;

-- The exact v1 instructions are backed up in:
-- docs/MED_ANAMNESIS_AI_V1.md
--
-- Seed/activate the row server-side or through the Supabase SQL editor.
-- Do not expose the master skill instructions to the operational browser.
