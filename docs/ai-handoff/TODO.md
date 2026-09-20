# Active TODO

Keep this list short and ordered. Move completed work into `PROJECT_STATE.md` instead of turning this file into a historical log.

## NOW — AI Assistance for Summary

- [ ] Rewrite cockpit MutationObserver/event model to avoid self-triggering DOM mutation loops; cockpit UI is currently disabled on production.
- [ ] Add browser-level smoke test covering login → load existing cases → add case → delete synthetic case → reload before re-enabling cockpit UI.

- [ ] Inspect/export the currently deployed `case-assistant` source and reconcile it into GitHub before changing it.
- [ ] Compare deployed `generate-summary` with repo source so production-only logic is not lost.
- [x] Define the Summary Assistant UI inside/next to the Case Summary section (implemented on `ui-compact-cockpit`, pending visual review/merge).
- [x] Add optional paste-text input for physician notes / Heidi text (preview UI implemented on `ui-compact-cockpit`).
- [x] Call `case-assistant` to extract only explicitly documented facts (wired on `ui-compact-cockpit`).
- [x] Show an extraction preview with evidence/traceability before applying anything (wired on `ui-compact-cockpit`).
- [ ] Persist/apply explicitly accepted extracted items to the correct clinical fields; current branch only records local Accept/Ignore UI decisions and never auto-overwrites.
- [ ] Show missing/conflicting/unresolved information that may affect documentation.
- [ ] Show investigation suggestions separately from documented/ordered tests.
- [ ] Show therapy suggestions separately from therapy already administered.
- [ ] Make it visually explicit that suggestions are advisory and require physician judgment.
- [ ] Preserve the existing Generate Summary → edit → Finalize Summary path as authoritative.
- [ ] Test that AI failure never destroys or overwrites clinician-entered data.

## NEXT — source-of-truth / privacy cleanup

- [ ] Reconcile production Supabase migrations with GitHub `main`.
- [ ] Commit production-only Edge Function source, especially `case-assistant` and `backend-diagnostics`.
- [ ] Reconcile `summary-standardization-sync` with `main`.
- [ ] Move direct clinical free-text updates in `config.js` behind `clinical-store`.
- [x] Move Delete Case to a server-authorized `clinical-store/delete_case` action; synthetic add/delete + cascade verification passed.
- [ ] Refactor `config.js` back to configuration-only and move runtime UI logic into maintained frontend modules.
- [ ] Confirm whether `case_patch.js` is dead code, then remove or integrate it.
- [ ] Update stale GitHub Pages URLs and outdated privacy/learning documentation.
- [ ] Close/delete the Codex write-test PR/branch when no longer needed.

## LATER — learning / production hardening

- [ ] Expose corpus approve/exclude review cleanly in AI Learning.
- [ ] Run and review the new Style Coach workflow; currently there are no Style Coach runs.
- [ ] Review/activate a style profile only after explicit human approval.
- [ ] Enable Supabase leaked-password protection.
- [ ] Run full end-to-end regression: case entry → privacy gate → assistant → Generate Summary → edit → Finalize → immutable revision → retrieval/learning.
- [ ] Review auth/session, RLS, Edge Function authorization, CORS/origin, error handling and operational logging.

## Rules for agents

- Do not mark an item complete unless it was actually verified.
- Never silently convert an AI suggestion into a clinical fact, diagnosis, ordered test, administered therapy, disposition, or finalized text.
- Preserve evidence/traceability for extracted facts where feasible.
- Never store secrets or identifiable patient information in handoff docs.
- Keep `main` deployable and update `PROJECT_STATE.md` after meaningful milestones.
