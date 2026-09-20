-- Official Documentation Library + Style Coach
-- Adds a safe official-documentation rule library and audit trail for
-- doctor-approved style profile candidates.
--
-- Safety boundary:
-- Official documentation rules are for structure, completeness, continuity,
-- clarity, and style only. They must never permit clinical inference.

create table if not exists public.documentation_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  publisher text not null,
  title text not null,
  version text,
  jurisdiction text not null default 'international',
  source_kind text not null check (
    source_kind in (
      'documentation_standard',
      'operational_guidance',
      'regulation'
    )
  ),
  source_url text not null unique,
  is_active boolean not null default true,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.documentation_rules (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.documentation_sources(id) on delete cascade,
  code text not null unique,
  category text not null,
  rule_text text not null,
  prompt_text text not null,
  priority integer not null default 50 check (priority between 1 and 100),
  applies_to text[] not null default array['emergency_summary']::text[],
  is_active boolean not null default true,
  allow_clinical_inference boolean not null default false,
  created_at timestamptz not null default now(),
  constraint documentation_rules_no_clinical_inference
    check (allow_clinical_inference = false)
);

create index if not exists documentation_rules_active_idx
  on public.documentation_rules (is_active, priority desc);

create table if not exists public.style_coach_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_revision_count integer not null default 0,
  official_rule_count integer not null default 0,
  corpus_maturity text not null check (
    corpus_maturity in ('early', 'developing', 'stable')
  ),
  analysis_text text not null,
  candidate_profile_text text not null,
  candidate_profile_id uuid references public.style_profiles(id) on delete set null,
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'rejected')
  ),
  model text,
  generated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists style_coach_runs_owner_idx
  on public.style_coach_runs (owner_id, generated_at desc);

alter table public.documentation_sources enable row level security;
alter table public.documentation_rules enable row level security;
alter table public.style_coach_runs enable row level security;

revoke all on public.documentation_sources from public, anon, authenticated;
revoke all on public.documentation_rules from public, anon, authenticated;
revoke all on public.style_coach_runs from public, anon, authenticated;

grant select, insert, update, delete on public.documentation_sources to service_role;
grant select, insert, update, delete on public.documentation_rules to service_role;
grant select, insert, update, delete on public.style_coach_runs to service_role;

insert into public.documentation_sources (
  source_key,
  publisher,
  title,
  version,
  jurisdiction,
  source_kind,
  source_url,
  is_active,
  verified_at
)
values
  (
    'PRSB_ECD_V2_2',
    'PRSB / NHS England',
    'Emergency Care Discharge Standard',
    'v2.2',
    'United Kingdom',
    'documentation_standard',
    'https://theprsb.org/standards/emergencycaredischarge/',
    true,
    now()
  ),
  (
    'PRSB_EDISCHARGE_V2_1',
    'PRSB / NHS England',
    'eDischarge Summary Standard',
    'v2.1',
    'United Kingdom',
    'documentation_standard',
    'https://theprsb.org/standards/edischargesummary/',
    true,
    now()
  ),
  (
    'NHS_EEMAC_2026',
    'NHS England',
    'Extended emergency medicine ambulatory care operating principles',
    '2026-02',
    'United Kingdom',
    'operational_guidance',
    'https://www.england.nhs.uk/long-read/extended-emergency-medicine-ambulatory-care-eemac-operating-principles/',
    true,
    now()
  ),
  (
    'EU_EHDS_2025_327',
    'European Union',
    'European Health Data Space Regulation',
    'Regulation (EU) 2025/327',
    'European Union',
    'regulation',
    'https://eur-lex.europa.eu/eli/reg/2025/327/oj/eng',
    true,
    now()
  )
on conflict (source_key) do update
set
  publisher = excluded.publisher,
  title = excluded.title,
  version = excluded.version,
  jurisdiction = excluded.jurisdiction,
  source_kind = excluded.source_kind,
  source_url = excluded.source_url,
  is_active = excluded.is_active,
  verified_at = excluded.verified_at;

insert into public.documentation_rules (
  source_id,
  code,
  category,
  rule_text,
  prompt_text,
  priority,
  applies_to,
  is_active,
  allow_clinical_inference
)
select
  ds.id,
  rules.code,
  rules.category,
  rules.rule_text,
  rules.prompt_text,
  rules.priority,
  array['emergency_summary']::text[],
  true,
  false
from public.documentation_sources ds
join (
  values
    (
      'PRSB_ECD_V2_2',
      'ECD_PRESENTING',
      'structure',
      'The presenting complaint and key clinical issues should be easy to identify when supplied.',
      'Make the presenting complaint and key clinical issues easy to identify if they are present in the current case data. Do not invent missing information.',
      95
    ),
    (
      'PRSB_ECD_V2_2',
      'ECD_NARRATIVE',
      'style',
      'The emergency care episode should be summarized in a concise, chronological, episode-focused narrative.',
      'Write a concise chronological narrative focused on this emergency episode. Avoid unnecessary repetition.',
      90
    ),
    (
      'PRSB_ECD_V2_2',
      'ECD_DIAGNOSES',
      'diagnoses',
      'Diagnoses should reflect documented clinician-entered diagnoses only.',
      'Use only doctor-entered diagnoses. Never infer or add a diagnosis from symptoms, labs, ECG, or treatment.',
      100
    ),
    (
      'PRSB_ECD_V2_2',
      'ECD_DISPOSITION',
      'disposition',
      'The outcome and disposition of the encounter should be easy to identify when documented.',
      'Make the documented disposition, destination, or outcome easy to identify if present. Do not invent disposition.',
      88
    ),
    (
      'PRSB_ECD_V2_2',
      'ECD_PLAN',
      'continuity',
      'Follow-up, actions, and recommendations should be clear when documented.',
      'Place documented follow-up, actions, recommendations, and pending next steps in a clear closing part. Do not add new recommendations.',
      88
    ),
    (
      'PRSB_ECD_V2_2',
      'ECD_ADVICE',
      'patient_information',
      'Explicit advice and information given to the patient should be retained when supplied.',
      'Retain explicit patient advice or information if present. Do not create generic advice that was not documented.',
      82
    ),
    (
      'PRSB_EDISCHARGE_V2_1',
      'EDISCH_INVESTIGATIONS',
      'investigations',
      'Relevant investigations and results should be surfaced in the summary when available.',
      'Surface available relevant investigations and results in a compact way. Avoid redundant repetition and do not invent results.',
      90
    ),
    (
      'PRSB_EDISCHARGE_V2_1',
      'EDISCH_TREATMENT',
      'treatment',
      'Treatments, procedures, and medication changes should be stated only when documented.',
      'State treatments, procedures, and medication changes only if they are documented in the current case data.',
      92
    ),
    (
      'PRSB_EDISCHARGE_V2_1',
      'EDISCH_CONTINUITY',
      'continuity',
      'A discharge summary should prioritize what happened, what was found, what was done, and what happens next.',
      'Prioritize what happened, what was found, what was done, and what happens next. Remove nonessential repetition.',
      86
    ),
    (
      'NHS_EEMAC_2026',
      'NHS_INVEST_THERAPY_FOLLOWUP',
      'continuity',
      'When present, investigations undertaken, new therapies, and follow-up plans should be identifiable.',
      'When supplied, make investigations undertaken, new therapies, and follow-up plans identifiable. Do not add missing elements.',
      84
    ),
    (
      'EU_EHDS_2025_327',
      'EU_EPISODE_CORE',
      'structure',
      'Health documentation should organize supplied facts so an encounter, treatment, and disposition can be understood.',
      'Organize supplied facts so the encounter, treatment, and disposition can be understood. Do not infer facts.',
      80
    ),
    (
      'EU_EHDS_2025_327',
      'EU_NO_INVENTION',
      'safety',
      'Official standards guide organization and completeness only; they do not authorize adding clinical facts.',
      'Official standards guide structure and completeness only. Never infer or add any clinical fact, diagnosis, result, treatment, medication, consultation, advice, follow-up, or disposition absent from the current case.',
      100
    )
) as rules(
  source_key,
  code,
  category,
  rule_text,
  prompt_text,
  priority
)
on ds.source_key = rules.source_key
on conflict (code) do update
set
  source_id = excluded.source_id,
  category = excluded.category,
  rule_text = excluded.rule_text,
  prompt_text = excluded.prompt_text,
  priority = excluded.priority,
  applies_to = excluded.applies_to,
  is_active = excluded.is_active,
  allow_clinical_inference = false;
