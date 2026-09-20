# BachTranSBO — Project State

Last updated: 2026-09-20

## Goal

Personal ER/SBO command center for one active shift at a time, with privacy-conscious permanent de-identified case storage, server-side AI documentation assistance, and a doctor-approved AI learning corpus.

## Primary focus now

**AI Assistance while writing/finalizing the Summary.**

The next product milestone is to make AI useful inside the doctor’s documentation workflow without silently changing clinical facts. The assistant should help review the current case, surface missing/unclear information, extract or organize supplied text, and offer clearly separated suggestions that the doctor can accept, reject, or ignore.

Guardrails for this feature:

- never overwrite doctor-entered clinical facts automatically;
- never convert a suggestion into an ordered test, administered therapy, diagnosis, or disposition;
- clearly distinguish documented facts from AI suggestions;
- preserve evidence/traceability back to the supplied case data where possible;
- the doctor remains the final decision-maker and Finalize Summary remains an explicit action.

## Current architecture

- Frontend: standalone HTML/CSS/JavaScript on GitHub Pages.
- Backend: Supabase Auth + PostgreSQL + Row Level Security.
- Persistence: shifts, cases, test entries, summaries, and immutable finalized-summary revisions.
- Clinical privacy gate: `clinical-store` Edge Function.
- De-identification: deterministic Hungarian-aware rules plus AI missed-identifier/person-name handling.
- AI summary: server-side `generate-summary` Edge Function using the de-identified case, active SBO Documentation Skill, optional active style profile, similar doctor-approved cases, and active official documentation rules.
- AI assistance backend: production also has a `case-assistant` Edge Function for fact extraction and physician-facing assistance.
- AI learning unit: de-identified case + AI draft + doctor-finalized summary.
- Active Git branch: `main`.

## Latest audit snapshot

A repository + production Supabase audit on 2026-09-20 found that the **production backend is ahead of GitHub `main`**. Treat Supabase runtime as containing newer work that must be reconciled back into source control.

### Frontend status

Core ER workflow is largely implemented:

- [x] One-active-shift workflow.
- [x] Per-shift case IDs.
- [x] Add/select/edit case.
- [x] Sex, year of birth/age, main complaint and arrival metadata.
- [x] Complaint, history, physical examination, therapy and clinical course.
- [x] Required-field states and summary blocking while unresolved.
- [x] Lab 1–3, EKG, AVG/VVG, radiology and consultations.
- [x] Doctor-entered diagnoses.
- [x] Disposition workflow.
- [x] Generate Summary.
- [x] Editable summary.
- [x] Finalize / reopen case.
- [x] AI Learning screen.
- [x] Hungarian / English UI.

Frontend debt / missing work:

- `config.js` is no longer config-only; it contains substantial runtime UI and persistence patches.
- `case_patch.js` exists in the repo but is not loaded by `index.html`; likely dead/legacy code pending confirmation.
- Some case metadata is written directly from the browser to `cases`, bypassing the intended `clinical-store` privacy path.
- Delete Case currently attempts a browser-side delete while production grants do not allow authenticated DELETE on `cases`; move deletion behind a server action.
- The production `case-assistant` backend is not yet integrated into the Summary UI.
- New learning/corpus review capabilities in production are not fully represented in the frontend.

### Backend status

Production Supabase project: `bachtranSBO` / `nfpmngtxebnxueqivxox`, status **ACTIVE_HEALTHY** at audit time.

Production Edge Functions observed:

- `clinical-store` — active.
- `generate-summary` — active.
- `analyze-style` — active.
- `analyze-skill` — active.
- `learning-admin` — active.
- `backend-diagnostics` — active in production but source is not currently represented on `main`.
- `case-assistant` — active in production but source is not currently represented on `main`.

Production database contains newer migrations/features beyond the files currently on `main`, including:

- browser-write hardening / arrival metadata adjustments;
- learning-corpus quality review;
- official documentation source/rule library;
- Style Coach support and advisor cleanup.

Branch `summary-standardization-sync` contains part of this newer migration history but has diverged from `main`; reconcile instead of leaving it as a long-lived parallel source of truth.

### AI learning snapshot

At audit time:

- finalized revisions: **15**;
- approved revisions: **15**;
- excluded revisions: **0**;
- distinct finalized cases: **5**;
- revisions with embeddings: **15 / 15**;
- active Skill: **version 1**;
- style profiles: **1**;
- active style profiles: **0**;
- Skill suggestions: **1**, none pending;
- active official documentation sources: **4**;
- active official documentation rules: **12**;
- Style Coach runs: **0**.

This means the learning infrastructure is functional, but the newer Style Coach path has not yet been exercised and there is currently no active style profile.

## Privacy / security findings

Intended invariant:

```text
Browser
  -> clinical-store
  -> de-identification
  -> PostgreSQL
```

Current exception found during audit:

- `config.js` directly updates selected columns in `cases`.
- Production currently grants authenticated users `SELECT, UPDATE` on `cases`.
- Free-text values such as main complaint, arrival details, or discharge-condition details can therefore bypass `clinical-store`.

Target: move all clinical free-text writes back behind `clinical-store` and keep browser database access as read-only wherever practical.

Supabase Security Advisor at audit time had one notable warning:

- leaked-password protection is disabled.

Performance advisor only reported informational unused indexes; this is not currently a priority.

## Repository / deployment status

- GitHub Pages workflow is passing.
- Backend checks workflow is passing.
- `main` was deployable at audit time.
- There is a draft PR/branch created only to test Codex write access; clean it up when convenient.
- The branch `summary-standardization-sync` must be reconciled with `main`.
- Documentation contains stale references to the former `report0101.github.io` deployment and some older privacy/learning assumptions.

## Important constraints

- Do not intentionally store patient name, TAJ, full date of birth, address, phone, or email.
- Never place Supabase service-role/secret keys, OpenAI keys, passwords, or other secrets in browser code or repository docs.
- Doctor-approved finalized summaries are the authoritative learning target.
- Skill/style suggestions must not silently overwrite the approved master Skill.
- AI assistance may suggest, but must not silently mutate clinical decisions or documentation.
- Keep `main` deployable.

## Key files

- `README.md` — product/architecture overview.
- `app.js` — main frontend behavior.
- `backend.js` — frontend/backend integration.
- `config.js` — currently contains configuration plus runtime patch logic; should be refactored.
- `supabase/functions/generate-summary/` — summary generation source currently in repo; compare with deployed version before modifying.
- `docs/PROJECT_SPEC.md` — product specification.
- `docs/BACKEND_SETUP.md` — backend setup; currently partly stale.
- `docs/PRIVACY.md` — privacy model; reconcile with current clinician-name behavior.
- `docs/AI_LEARNING.md` — learning workflow; production has newer capabilities.
- `docs/ai-handoff/TODO.md` — active prioritized queue.

## Current milestones

1. **AI Assistance for Summary** — integrate the deployed assistant capabilities cleanly into the summary-writing workflow.
2. Reconcile production Supabase source/migrations/functions back into GitHub `main`.
3. Remove direct clinical browser writes and restore the privacy-gated write invariant.
4. Refactor frontend patch logic out of `config.js`.
5. Run end-to-end regression testing against production.

## Verification status

The 2026-09-20 audit inspected:

- GitHub `main` tree and recent history;
- active branches and open PRs;
- GitHub Actions status;
- current handoff/docs;
- production Supabase tables, migrations, Edge Functions and advisors;
- current AI-learning corpus counts;
- selected deployed function behavior, including `case-assistant`, `generate-summary`, `analyze-style`, and `learning-admin`.

No destructive changes, schema changes, or production function deployments were performed during the audit.

## Frontend cockpit work in progress

Branch `ui-compact-cockpit` / draft PR #2 now contains the first merge of the existing UI with the compact 1080p cockpit prototype:

- three-column ER layout (patient board / case workspace / AI rail);
- compact Clinical / Tests / Disposition / Summary tabs without replacing existing clinical IDs or backend workflow;
- responsive AI drawer on narrower displays;
- Case Assistant rail wired to the deployed `case-assistant` Edge Function for current-case analysis;
- pasted-note extraction preview with source evidence and explicit review controls;
- Summary rail reuses the existing Generate Summary / Finalize Summary controls;
- GitHub Backend checks pass, including browser JavaScript syntax and privacy regression tests.

The extraction preview does **not** yet write accepted items back into clinical fields. Case Assistant YES/NO/DONE/N/A choices are currently local UI decisions only; persistence and structured suggestion semantics should be designed before saving them.

Delete Case has now been moved behind the authenticated `clinical-store` Edge Function via a `delete_case` action. Browser code no longer issues direct case DELETE queries. Production foreign keys for `test_entries`, `summaries`, and `summary_revisions` use ON DELETE CASCADE. A synthetic production-database add/delete test verified case creation, deletion, all three cascades, and zero retained synthetic rows. GitHub Backend checks pass with a new invariant that rejects direct browser case deletion.

## Production incident — cockpit UI rollback (2026-09-20)

After PR #2 was merged, the new `cockpit.js` layer caused the production page to become unresponsive before the normal login flow could be used. The likely root cause is a self-triggering `MutationObserver`: it watches `childList`/class/disabled mutations while its callback rewrites text/classes/disabled states, creating a mutation feedback loop.

Immediate recovery completed:

- production data was checked directly in Supabase and remained intact: 1 active shift, 8 active-shift cases, 7 summaries, 15 revisions;
- `cockpit.js` was disabled in `index.html` by hotfix commit `fb90248a90d99eebd5691aa9254520a69478bfd3`;
- the pre-cockpit clinical UI/login flow is active again;
- secure server-side Delete Case remains in place via `clinical-store/delete_case`;
- GitHub Backend checks and GitHub Pages deployment both passed after the hotfix.

Do not re-enable `cockpit.js` on production until its observer/event model is rewritten and browser-level login/state-load/add/delete regression tests pass.

## Resume here

**Start with AI Assistance in the Summary workflow.**

Before editing, compare the deployed `case-assistant` and deployed `generate-summary` with repository source so no production-only logic is lost.

Then design/implement a doctor-controlled Summary Assistant UI with this initial flow:

1. use current case data and optional pasted clinical text;
2. show extracted/documented facts separately from suggestions;
3. flag missing, conflicting, or unresolved information relevant to documentation;
4. provide optional investigation/therapy/documentation suggestions in a separate panel;
5. require explicit doctor action to apply any extracted text or suggestion;
6. never overwrite the current summary or clinical fields silently;
7. keep Generate Summary / doctor edit / Finalize Summary as the authoritative documentation path.

After each meaningful milestone, update this file and `TODO.md`.
