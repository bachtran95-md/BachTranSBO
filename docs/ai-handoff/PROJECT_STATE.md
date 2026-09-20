# BachTranSBO — Project State

Last updated: 2026-09-20

## Goal

Personal ER/SBO command center for one active shift at a time, with privacy-conscious permanent de-identified case storage and a doctor-approved AI learning corpus.

## Current architecture

- Frontend: standalone HTML/CSS/JavaScript on GitHub Pages.
- Backend: Supabase Auth + PostgreSQL + Row Level Security.
- Persistence: shifts, cases, test entries, summaries, and immutable finalized-summary revisions.
- Clinical write privacy gate: `clinical-store` Edge Function.
- De-identification: deterministic Hungarian-aware rules plus AI missed-identifier/person-name pass.
- AI summary: server-side `generate-summary` Edge Function using the de-identified case, active SBO Documentation Skill version, optional style profile, and GPT.
- AI learning unit: de-identified case + AI draft + doctor-finalized summary.
- Active branch: `main`.

## Current repo state

AI handoff system was introduced on `main` starting at:

`e8a93efc6ca83907489f8b83ab71b90146465667` — **docs: add AI handoff guide**

Application state immediately before the handoff docs:

`54ea33a0fe6b908182b5456fe56d169fb8716437` — **Fix duplicate case ID generation**

Recent application work also includes:
- add-case demographic synchronization;
- sex-label/discharge-condition UI fixes;
- preservation of clinician names where appropriate;
- non-blocking AI de-identification scrub behavior.

## Implemented

- [x] One-active-shift workflow.
- [x] Per-shift case IDs.
- [x] Required clinical field states and summary blocking while unresolved.
- [x] Lab/EKG/blood-gas/imaging/consultation result workflow.
- [x] Doctor-entered diagnoses and disposition.
- [x] Editable generated summary.
- [x] Finalize/reopen case workflow with immutable finalized revisions.
- [x] Supabase persistence and owner authentication foundation.
- [x] Automatic de-identification layer for permanent clinical writes.
- [x] Server-side GPT summary generation using active SBO Documentation Skill.
- [x] Finalized-summary corpus for retrieval/style learning.
- [x] AI Learning dashboard and candidate/suggestion review flow.
- [x] AI handoff directory for cross-session continuity.

## Important constraints

- Do not intentionally store patient name, TAJ, full date of birth, address, phone, or email.
- Do not place Supabase service-role keys or other secrets in browser code.
- Doctor-approved finalized summaries are the authoritative learning target.
- Skill/style suggestions must not silently overwrite the approved master Skill.
- Keep `main` deployable.

## Key files

- `README.md` — product/architecture overview.
- `app.js` — main frontend behavior.
- `backend.js` — frontend/backend integration.
- `config.js` — public runtime configuration only; no secrets.
- `docs/PROJECT_SPEC.md` — detailed product specification.
- `docs/BACKEND_SETUP.md` — Supabase/backend setup.
- `docs/PRIVACY.md` — privacy model.
- `docs/AI_LEARNING.md` — learning workflow.
- `docs/ai-handoff/TODO.md` — compact active work queue.

## Current milestones

1. End-to-end deployment/testing against the real Supabase project.
2. Broader production hardening and operational monitoring.
3. Continue validating the finalized-summary feedback/learning workflow with real de-identified examples.

## Verification status

At handoff creation, the repository structure, README, recent commits, and current GitHub installation were inspected. No new application build, browser flow, database migration, or live deployment test was performed as part of creating these documentation files.

## Resume here

Read `TODO.md`, check whether `main` has moved since this file was last updated, reconcile any completed items, and continue the highest-priority unfinished milestone without redoing completed work.
