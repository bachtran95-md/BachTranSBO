# BachTranSBO - ER Command Center

Personal emergency-department command center for one active shift at a time, with permanent de-identified case storage and a future doctor-approved AI learning corpus.

> **Start here:** [System Introduction](docs/SYSTEM_INTRO.md) — purpose, architecture, Case Assistant, privacy boundary, AI learning, and core system invariants.

## Current architecture

- Frontend: standalone HTML/CSS/JavaScript served by GitHub Pages.
- Stable entrypoint: `index.html` + production `cockpit.js`.
- Experimental entrypoint: `beta.html`, which reuses the production cockpit and adds isolated `beta-features.js/css`.
- Recovery entrypoint: `recovery.html`, the single pre-cockpit fallback UI.
- `cockpit-beta.js` is compatibility-only for stale browser caches; it must not contain production UI logic.
- Backend foundation: Supabase Auth + PostgreSQL + Row Level Security.
- Persistence: shifts, cases, test entries, summaries, and finalized-summary revisions.
- Authentication: single-owner Supabase email/password login with in-app password change.
- Privacy gate: permanent clinical writes go through the `clinical-store` Edge Function.
- De-identification: deterministic Hungarian-aware rules plus a fail-closed AI person-name/missed-identifier pass.
- AI summary: **Generate Summary** now calls the server-side `generate-summary` Edge Function, which reads the de-identified case, active SBO Documentation Skill version, optional style profile, and calls GPT.

See `docs/BACKEND_SETUP.md` for setup.

## Current workflow

- One active shift at a time, enforced in the database.
- Case IDs restart from `01` for every shift.
- Complaint, medical history, physical examination, therapy, and clinical course are required workflow fields: text turns them green; an explicit **None** state turns them grey; unresolved fields stay orange and block summary generation/finalization.
- Test/result workflow:
  - Lab 1-3.
  - EKG.
  - AVG / VVG.
  - Structured imaging: body part + modality (RTG / US / Native CT / Contrast CT / MR / Other).
  - Consultations.
  - Preview-v5 status dots, Enter-to-save results, and removable extra test cards.
  - Waiting for result / Result available / Not ordered states.
- Doctor-entered diagnoses (never inferred from test results by the UI).
- Final disposition.
- Editable case summary.
- Completed cases are read-only and move to the end of the active-shift list; **Reopen Case** returns them to active editing while keeping previous finalized revisions immutable.
- Finalize Summary:
  - stores the finalized text,
  - marks the case completed,
  - copies it to the clipboard when permitted,
  - stores an immutable finalized revision for the future AI corpus.

## Permanent case corpus

Cases are not automatically deleted after 15 days.

The intended long-term AI example is:

```text
de-identified clinical case
        +
AI generated draft
        +
doctor finalized summary
```

This allows retrieval/style learning to compare what the model generated with what the doctor actually approved. Finalized revisions store a de-identified case snapshot plus an embedding; Generate Summary retrieves similar approved cases as few-shot examples.

## Privacy model

BachTranSBO does not intentionally model patient name, TAJ, full date of birth, address, phone, or email.

Free-text copied from another system may still accidentally contain identifiers. Permanent clinical writes now pass through an automatic de-identification layer before they reach the corpus.

The target behavior is:

```text
raw free text
    ↓
automatic PII detection / de-identification
    ↓
permanent case database
    ↓
GPT / AI corpus
```

Raw identifiers must not be stored as a separate lookup table or training dataset.

## Repository layout

```text
index.html
beta.html
recovery.html
styles.css
app.js
case-ui.js
cockpit.js
backend.js
config.js

supabase/
  migrations/
    001_backend_v1.sql

docs/
  PROJECT_SPEC.md
  BACKEND_SETUP.md
```

## Backend setup

1. Create a Supabase project.
2. Apply migrations `001_backend_v1.sql` through `012_required_field_states.sql` in order.
3. Put the project URL and **publishable key** in `config.js`.
4. Configure Auth/GitHub Pages redirect, create the owner account, then disable public signup.
5. Set the model/API secrets plus `APP_ORIGIN` and `APP_OWNER_USER_ID` in Supabase. Recommended model routing: `ASSISTANT_EXTRACTION_MODEL=gpt-5.6-luna`, `ASSISTANT_MODEL=gpt-5.6-terra`, `ASSISTANT_STRUCTURER_MODEL=gpt-5.6-luna`, `SUMMARY_MODEL=gpt-5.6-terra`, `SKILL_ANALYSIS_MODEL=gpt-5.6-luna`, and `STYLE_COACH_MODEL=gpt-5.6-luna`.
6. Deploy `clinical-store`, `generate-summary`, `analyze-style`, `analyze-skill`, and `learning-admin`.
7. Insert the exact approved SBO Documentation Skill text as active Skill version 1.

Never place a Supabase secret/service-role key in browser code.

## AI Learning dashboard

The top workspace navigation includes **AI Learning**. It shows finalized corpus size, active Skill version, active/candidate style profiles, and Skill suggestions. Style candidates can be explicitly activated; Skill suggestions can be accepted/rejected for follow-up, but never modify the master Skill automatically.

## Next milestones

1. End-to-end deployment/testing against the real Supabase project.
2. Broader production hardening and operational monitoring.
