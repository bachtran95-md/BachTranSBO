# Current Session Handoff — Beta Heidi Incremental Updates

Last updated: 2026-09-21

## Goal

Make the Beta `Jegyzet / Heidi szöveg` area handle short, repeated clinical updates safely. New notes may contain later patient history, new investigation results, consultation results, or clinical-course changes. AI output must remain a physician-reviewed proposal and must never silently become a clinical fact.

Stable `/` must remain unchanged. Work is isolated to `/beta.html`, Beta cockpit behavior, the shared extraction core used by Beta/Edge Function, tests, and deployment plumbing required by Beta.

## Completed milestones

### 1. GitHub Pages dependency integrity

- Added `case-ui.js` and `assistant-core.js` to the Pages artifact. Beta already referenced both files, but the deploy workflow omitted them.
- Added a deploy-time check that every local `<script src>` referenced by `index.html`, `recovery.html`, or `beta.html` exists in `_site`.
- This prevents a green Pages deployment that leaves the Beta extraction review unusable.

### 2. Pure incremental reconciliation core

- Added `BachAssistantCore.reconcileItems(patient, items)`.
- Narrative facts are classified as `add`, `update` (append), or `duplicate`. A section previously marked None becomes an explicit `update`; accepting it reopens the section and adds the newly received information.
- Test results update a uniquely matched waiting EKG/AVG-VVG, lab, radiology, or consultation entry instead of blindly creating another card.
- Generic Lab results update the sole waiting lab; multiple waiting labs are treated as ambiguous and blocked for manual review.
- Named radiology/consultation updates require a unique label match.
- Existing identical results are classified as duplicates. A different result on an already completed matching test is classified as a conflict/possible repeat and is not overwritten.
- The apply core now updates the matched card by stable entry ID and rejects stale, duplicate, or conflicting proposals.
- Unit coverage includes later history, duplicate history, a section marked None, waiting Lab completion, duplicate Lab result, ambiguous Labs, and Cardiology-vs-Neurology consultation matching.

### 3. Investigation Add-test usability and persistence

- Root cause confirmed: the previous unified Add button invoked the legacy add functions, which only called `persist()`; that function marks the in-memory state dirty and does not call the backend. A newly added blank card could therefore disappear after navigation/reload and look like a backend failure.
- Replaced the iPad-unfriendly native type dropdown with four direct type buttons: Lab, Imaging, Consultation, Other.
- Imaging, Consultation, and Other require a descriptive name before Add, so the resulting card clearly identifies what it is.
- Added a doctor-draft-safe `BachSBOClinicalUi.addInvestigation()` bridge. It adds the entry and immediately persists through the existing `clinical-store/save_patient` privacy path.
- If backend persistence fails, the exact pre-add physician draft is restored and the unsaved test card is removed.
- Lab capacity produces a visible message instead of a silent no-op.
- Consultation and Other cards show both their category and specific name. `Other` is stored in the existing backend-supported consultation category with an explicit `Egyéb —` subtype; no database schema change was made.
- Browser smoke now covers immediate Consultation persistence and a synthetic failed Imaging save with rollback.
- The branch was reconciled with `origin/main` through `c8c6d5e`. The newer Hungarian-first UI, autosave protections, diagnoses-none state, finalized-summary footer, closed-case styling, and header AI data-entry dialog were retained.
- Cross-language consultation matching now treats common Hungarian/English specialty names (for example `Kardiológia` / `Cardiology`) as the same waiting consultation.

## Decisions

- Treat every Heidi paste as an incremental update, not as a full replacement of the case.
- Preserve the existing two-step physician control: `ACCEPT / IGNORE`, then explicit `APPLY ACCEPTED`.
- Narrative information defaults to append.
- Investigation results should update a uniquely matched waiting test; ambiguous matches must be presented for review and must not overwrite automatically.
- Duplicate and conflicting facts must be visible rather than silently written.
- Raw pasted text should not be added to permanent storage.

## Work in progress

- Upload the post-merge integration commit, open the PR, run GitHub checks, merge to `main`, and verify the live Beta deployment.
- Production `case-assistant` was intentionally not redeployed yet. Its extraction contract is unchanged; the reconciliation logic is applied in the Beta browser after extraction.

## Verification so far

- Source audit confirmed production `case-assistant` v4 matches repository source.
- Supabase project is active and current auth/owner/case ownership checks remain in place.
- Pages local-script artifact verification passes locally.
- `assistant-core.js` syntax check and `tests/assistant-core.mjs` pass locally after reconciliation changes.
- Full Chromium browser smoke passes locally, including waiting Lab completion without a duplicate card, repeated-result suppression, named Cardiology consultation matching, later history append, and failed-save rollback.
- Full Chromium browser smoke also passes after integration with `main` for the segmented Add-test control, immediate backend persistence, category/name rendering, failed-add rollback, Hungarian-first UI, and Hungarian/English consultation matching.

## Beta UI behavior implemented

- Renamed the panel to `New note / Heidi update` / `Új jegyzet / Heidi frissítés` and clarified that it accepts newly received information.
- Added a 30,000-character counter.
- Proposal cards show `ADD NEW`, `UPDATE EXISTING`, `ALREADY DOCUMENTED`, or `NEEDS REVIEW`.
- Cards show the current value/status, proposed value/status, reason, and exact source evidence.
- Duplicate and conflict proposals cannot be accepted automatically.
- A case change invalidates an in-flight extraction response so an old response cannot reappear after switching away and back.
- Browser validation uses the sanitized source returned by the server when available, avoiding false evidence failures after de-identification.

## Repository position

- Branch: `codex/beta-heidi-incremental-20260921`
- Integrated with: `origin/main` at `c8c6d5e`
- Worktree: `BachTranSBO-beta-heidi`
- Remote feature commits before integration: `f93371b`, `cbd651f`, `72c3fbf`, `088856a`, `64d6024`, `3b1e346`.

## Resume here

1. Upload the post-merge integration commit to the existing remote branch.
2. Open/merge a PR, wait for both GitHub checks, then verify `/beta.html` live. Do not promote Beta to stable `/`.

## Safety reminders

- Do not store names, identifiers, or raw Heidi text in this handoff.
- Do not let Case Assistant suggestions enter documented facts.
- Do not deploy the Edge Function until repository tests pass and deployed-source parity is intentionally updated.
