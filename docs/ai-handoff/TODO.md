# Active TODO

Keep this list short and ordered. Move completed work into `PROJECT_STATE.md` instead of turning this file into a historical log.

## NOW — AI Assistance for Summary

- [x] Replace the cockpit MutationObserver with an observer-free event/timer model in isolated `/beta.html`; stable `/` remains default.
- [x] Add browser-level Chromium smoke test covering login → load existing cases → add case → delete synthetic case → reload, plus beta load.

- [x] Reconcile deployed `case-assistant` into GitHub; repository source matches production v4.
- [x] Compare deployed `generate-summary` with repo source and sync the production source back into GitHub.
- [x] Define the Summary Assistant UI inside/next to the Case Summary section; it is available in the isolated `/beta.html` cockpit.
- [x] Add optional paste-text input for physician notes / Heidi text in the beta cockpit.
- [x] Call `case-assistant` to extract only explicitly documented facts in the beta cockpit.
- [x] Show an extraction preview with evidence/traceability before applying anything in the beta cockpit.
- [x] Persist/apply explicitly accepted extracted items via a two-step Accept → Apply Accepted flow in Beta; Append is default, Replace is explicit, stale-case apply is blocked, and persistence uses the existing privacy-gated save path.
- [ ] Show missing/conflicting/unresolved information that may affect documentation.
- [x] Keep investigation suggestions in the separate Case Assistant rail/to-do list, never in documented/ordered test fields.
- [x] Keep therapy suggestions in the separate Case Assistant rail/to-do list, never in administered-therapy fields.
- [x] Make Assistant suggestions advisory, priority-ranked, source-traceable, and physician-decided with persisted YES/NO/DONE/N/A state.
- [x] Preserve Generate Summary → edit → Finalize Summary as the authoritative documentation path; Assistant state is separate.
- [x] Test that AI apply/save failure never destroys or overwrites clinician-entered data; Chromium smoke injects a synthetic save failure and verifies the physician draft is restored unchanged.

## NEXT — source-of-truth / privacy cleanup

`docs/AUDIT_2026-09-20.md` is the historical audit; the hardening section in `PROJECT_STATE.md` is the current source of truth and the arrival gap is fixed.

- [x] Reconcile the current late production Supabase migration history with GitHub `main`.
- [x] Commit/sync production Edge Function source needed for the current runtime, including `case-assistant`, `generate-summary`, and `backend-diagnostics`.
- [x] Reconcile the needed migration/runtime work without merging stale `summary-standardization-sync` wholesale.
- [x] Move direct case metadata/free-text updates behind `clinical-store/update_case_metadata` and revoke authenticated browser UPDATE on `cases`.
- [x] Move Delete Case to a server-authorized `clinical-store/delete_case` action; synthetic add/delete + cascade verification passed.
- [ ] Refactor `config.js` back to configuration-only and move runtime UI logic into maintained frontend modules.
- [x] Confirm `case_patch.js` is dead code and remove it.
- [x] Update stale GitHub Pages URLs.
- [ ] Continue pruning older documentation sections as features evolve; `PROJECT_STATE.md` hardening section is the current source of truth.
- [x] Close the Codex write-test PR.
- [ ] Delete stale remote branches (`codex-write-test`, merged `ui-compact-cockpit`) when branch-delete capability is available.

## LATER — learning / production hardening

- [ ] Expose corpus approve/exclude review cleanly in AI Learning.
- [ ] Run and review the new Style Coach workflow; currently there are no Style Coach runs.
- [ ] Review/activate a style profile only after explicit human approval.
- [ ] Enable Supabase leaked-password protection.
- [ ] Run a full authenticated live regression: case entry → privacy gate → assistant → Generate Summary → edit → Finalize → immutable revision → retrieval/learning. Mocked Chromium smoke + rollback-only production atomic-finalize verification already pass.
- [ ] Review auth/session, RLS, Edge Function authorization, CORS/origin, error handling and operational logging.

## Rules for agents

- Do not mark an item complete unless it was actually verified.
- Never silently convert an AI suggestion into a clinical fact, diagnosis, ordered test, administered therapy, disposition, or finalized text.
- Preserve evidence/traceability for extracted facts where feasible.
- Never store secrets or identifiable patient information in handoff docs.
- Keep `main` deployable and update `PROJECT_STATE.md` after meaningful milestones.
