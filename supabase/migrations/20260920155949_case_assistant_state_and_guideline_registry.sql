-- Reconciled from production Supabase migration history.
create table if not exists public.case_assistant_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  case_fingerprint text not null,
  model text,
  generated_at timestamptz not null default now(),
  source_count integer not null default 0 check (source_count >= 0),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists case_assistant_runs_case_generated_idx
  on public.case_assistant_runs(case_id, generated_at desc);
create index if not exists case_assistant_runs_owner_idx
  on public.case_assistant_runs(owner_id);

alter table public.case_assistant_runs enable row level security;
revoke all on public.case_assistant_runs from anon, authenticated;

create table if not exists public.case_assistant_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.case_assistant_runs(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  priority text not null check (priority in ('now','next','consider')),
  category text not null check (
    category in (
      'safety','assessment','investigation','therapy',
      'consultation','disposition','missing_information'
    )
  ),
  title text not null,
  reason text not null default '',
  missing_information jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  doctor_decision text not null default 'pending' check (
    doctor_decision in ('pending','yes','no','already_done','not_applicable')
  ),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique(run_id, item_key)
);

create index if not exists case_assistant_items_case_idx
  on public.case_assistant_items(case_id, created_at desc);
create index if not exists case_assistant_items_run_idx
  on public.case_assistant_items(run_id);
create index if not exists case_assistant_items_owner_idx
  on public.case_assistant_items(owner_id);

alter table public.case_assistant_items enable row level security;
revoke all on public.case_assistant_items from anon, authenticated;

create table if not exists public.clinical_guideline_sources (
  id uuid primary key default gen_random_uuid(),
  organization text not null,
  domain text not null unique,
  base_url text not null,
  jurisdiction text not null,
  priority integer not null default 100,
  is_active boolean not null default true,
  last_verified_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clinical_guideline_sources_active_idx
  on public.clinical_guideline_sources(is_active, priority, organization);

alter table public.clinical_guideline_sources enable row level security;
revoke all on public.clinical_guideline_sources from anon, authenticated;

insert into public.clinical_guideline_sources
  (organization, domain, base_url, jurisdiction, priority, is_active, last_verified_at)
values
  ('ESC','escardio.org','https://www.escardio.org','EU',10,true,now()),
  ('ERS','ersnet.org','https://www.ersnet.org','EU',10,true,now()),
  ('ESICM','esicm.org','https://www.esicm.org','EU',10,true,now()),
  ('ERC','erc.edu','https://www.erc.edu','EU',10,true,now()),
  ('EASL','easl.eu','https://easl.eu','EU',10,true,now()),
  ('ESGE','esge.com','https://www.esge.com','EU',10,true,now()),
  ('EMA','ema.europa.eu','https://www.ema.europa.eu','EU',10,true,now()),
  ('WHO','who.int','https://www.who.int','International',20,true,now()),
  ('KDIGO','kdigo.org','https://kdigo.org','International',20,true,now()),
  ('Surviving Sepsis Campaign / SCCM','sccm.org','https://www.sccm.org','International',20,true,now()),
  ('NICE','nice.org.uk','https://www.nice.org.uk','UK',20,true,now()),
  ('IDSA','idsociety.org','https://www.idsociety.org','US',30,true,now()),
  ('CDC','cdc.gov','https://www.cdc.gov','US',30,true,now()),
  ('ACEP','acep.org','https://www.acep.org','US',30,true,now()),
  ('AHA','heart.org','https://www.heart.org','US',30,true,now()),
  ('AHA Journals','ahajournals.org','https://www.ahajournals.org','US',30,true,now()),
  ('ACC','acc.org','https://www.acc.org','US',30,true,now()),
  ('ADA','diabetesjournals.org','https://diabetesjournals.org','US',30,true,now()),
  ('ACG','gi.org','https://gi.org','US',30,true,now()),
  ('FDA','fda.gov','https://www.fda.gov','US',30,true,now()),
  ('GINA','ginasthma.org','https://ginasthma.org','International',20,true,now()),
  ('GOLD','goldcopd.org','https://goldcopd.org','International',20,true,now())
on conflict (domain) do update set
  organization = excluded.organization,
  base_url = excluded.base_url,
  jurisdiction = excluded.jurisdiction,
  priority = excluded.priority,
  is_active = excluded.is_active,
  last_verified_at = excluded.last_verified_at,
  updated_at = now();
