-- Reconciled from production Supabase migration history.
create table if not exists public.documentation_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  publisher text not null,
  title text not null,
  version text,
  jurisdiction text not null default 'international',
  source_kind text not null
    check (source_kind in ('documentation_standard','operational_guidance','regulation')),
  source_url text not null unique,
  is_active boolean not null default true,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.documentation_rules (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.documentation_sources(id) on delete cascade,
  code text not null unique,
  category text not null,
  rule_text text not null,
  prompt_text text not null,
  priority smallint not null default 50 check (priority between 1 and 100),
  applies_to text[] not null default array['emergency_summary']::text[],
  is_active boolean not null default true,
  allow_clinical_inference boolean not null default false
    check (allow_clinical_inference = false),
  created_at timestamptz not null default now()
);

create index if not exists documentation_rules_active_idx
  on public.documentation_rules(is_active, priority desc);

create table if not exists public.style_coach_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_revision_count integer not null default 0,
  official_rule_count integer not null default 0,
  corpus_maturity text not null default 'early'
    check (corpus_maturity in ('early','developing','stable')),
  analysis_text text not null,
  candidate_profile_text text not null,
  candidate_profile_id uuid references public.style_profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected')),
  model text,
  generated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists style_coach_runs_owner_idx
  on public.style_coach_runs(owner_id, generated_at desc);

alter table public.documentation_sources enable row level security;
alter table public.documentation_rules enable row level security;
alter table public.style_coach_runs enable row level security;

revoke all on table public.documentation_sources from anon, authenticated;
revoke all on table public.documentation_rules from anon, authenticated;
revoke all on table public.style_coach_runs from anon, authenticated;

grant select, insert, update, delete on table public.documentation_sources to service_role;
grant select, insert, update, delete on table public.documentation_rules to service_role;
grant select, insert, update, delete on table public.style_coach_runs to service_role;

insert into public.documentation_sources
  (source_key, publisher, title, version, jurisdiction, source_kind, source_url, verified_at)
values
  ('PRSB_ECD_V2_2', 'PRSB / NHS England', 'Emergency Care Discharge Standard', 'v2.2', 'UK', 'documentation_standard', 'https://theprsb.org/standards/emergencycaredischarge/', now()),
  ('PRSB_EDISCHARGE_V2_1', 'PRSB / NHS England', 'eDischarge Summary Standard', 'v2.1', 'UK', 'documentation_standard', 'https://theprsb.org/standards/edischargesummary/', now()),
  ('NHS_EEMAC_2026', 'NHS England', 'Extended emergency medicine ambulatory care operating principles', '2026-02', 'UK', 'operational_guidance', 'https://www.england.nhs.uk/long-read/extended-emergency-medicine-ambulatory-care-eemac-operating-principles/', now()),
  ('EU_EHDS_2025_327', 'European Union', 'European Health Data Space Regulation (EU) 2025/327', '2025/327', 'EU', 'regulation', 'https://eur-lex.europa.eu/eli/reg/2025/327/oj/eng', now())
on conflict (source_key) do update set
  publisher = excluded.publisher,
  title = excluded.title,
  version = excluded.version,
  jurisdiction = excluded.jurisdiction,
  source_kind = excluded.source_kind,
  source_url = excluded.source_url,
  is_active = true,
  verified_at = excluded.verified_at;

insert into public.documentation_rules
  (source_id, code, category, rule_text, prompt_text, priority)
select s.id, v.code, v.category, v.rule_text, v.prompt_text, v.priority
from (
  values
    ('PRSB_ECD_V2_2','ECD_PRESENTING','structure',
      'Emergency care documentation should clearly capture the presenting complaint or issue.',
      'Make the presenting complaint/issues easy to identify when they are present in the current case data.', 90),
    ('PRSB_ECD_V2_2','ECD_NARRATIVE','structure',
      'Emergency care documentation includes a brief clinical narrative of the encounter.',
      'Keep the clinical narrative concise, episode-focused, logically ordered, and chronological where chronology is known.', 95),
    ('PRSB_ECD_V2_2','ECD_DIAGNOSES','continuity',
      'Diagnoses are a core component of emergency care discharge information.',
      'Present only doctor-entered diagnoses clearly and distinctly; never infer an additional diagnosis from tests or symptoms.', 100),
    ('PRSB_ECD_V2_2','ECD_DISPOSITION','continuity',
      'Emergency discharge details should make the outcome of the encounter clear.',
      'Make the documented outcome—discharge, admission, transfer, or other disposition—easy to identify.', 95),
    ('PRSB_ECD_V2_2','ECD_PLAN','follow_up',
      'Plan and requested actions are a core part of emergency care discharge communication.',
      'Place documented follow-up, planned actions, and recommendations in a clear closing portion of the summary; do not invent missing actions.', 95),
    ('PRSB_ECD_V2_2','ECD_ADVICE','follow_up',
      'Information and advice given are part of emergency care discharge communication.',
      'If advice/information given is explicitly present in the source data, retain it clearly in the summary.', 75),
    ('PRSB_EDISCHARGE_V2_1','EDISCH_INVESTIGATIONS','completeness',
      'Discharge information can draw on recorded investigation results and the episode summary.',
      'Surface clinically relevant investigations/results that are actually available in the case, while avoiding redundant repetition.', 85),
    ('PRSB_EDISCHARGE_V2_1','EDISCH_TREATMENT','completeness',
      'Discharge communication should transfer relevant treatment and procedure information.',
      'State treatments, procedures, and medication changes only when explicitly documented in the current case.', 90),
    ('PRSB_EDISCHARGE_V2_1','EDISCH_CONTINUITY','style',
      'The discharge summary supports safe continuity of care through consistent, timely information transfer.',
      'Prioritize information that helps the next clinician understand what happened, what was found, what was done, and what happens next; remove nonessential repetition.', 90),
    ('NHS_EEMAC_2026','NHS_INVEST_THERAPY_FOLLOWUP','completeness',
      'Same-day emergency discharge summaries should detail investigations undertaken, new therapies initiated and the follow-up plan.',
      'When present in source data, make investigations undertaken, new therapies, and the follow-up plan readily identifiable.', 95),
    ('EU_EHDS_2025_327','EU_EPISODE_CORE','interoperability',
      'EU discharge reports contain essential information about the healthcare encounter, including admission/attendance, treatment and discharge.',
      'Organize supplied facts so the encounter/attendance, treatment, and final disposition can be understood without searching through the text.', 85),
    ('EU_EHDS_2025_327','EU_NO_INVENTION','safety',
      'Interoperable summaries transmit recorded health data; they do not create new clinical facts.',
      'Official standards guide organization and completeness only. Never use them to infer or add a diagnosis, result, treatment, medication, consultation, advice, follow-up, or disposition absent from the current case.', 100)
) as v(source_key, code, category, rule_text, prompt_text, priority)
join public.documentation_sources s on s.source_key = v.source_key
on conflict (code) do update set
  source_id = excluded.source_id,
  category = excluded.category,
  rule_text = excluded.rule_text,
  prompt_text = excluded.prompt_text,
  priority = excluded.priority,
  is_active = true,
  allow_clinical_inference = false;
