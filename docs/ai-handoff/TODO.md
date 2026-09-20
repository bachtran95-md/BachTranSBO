# Active TODO

Keep this list short. Move completed work into `PROJECT_STATE.md` instead of allowing this file to become a long archive.

## Now

- [ ] Run end-to-end testing against the real Supabase project.
- [ ] Verify the deployed GitHub Pages frontend against the current backend.
- [ ] Test the full path: case entry → de-identification → Generate Summary → doctor edit → Finalize Summary → finalized revision storage.
- [ ] Validate retrieval/style-learning behavior using multiple de-identified finalized cases.
- [ ] Verify failure handling for AI/API/Supabase errors without losing clinician-entered data.

## Next

- [ ] Review production hardening: auth/session handling, RLS, Edge Function authorization, CORS/origin checks, rate/error handling.
- [ ] Add lightweight operational monitoring/logging where useful without storing patient identifiers.
- [ ] Keep documentation aligned with migrations and deployed Edge Functions.

## Rules for agents

- Do not mark an item complete unless it was actually verified.
- Add newly discovered bugs here only if they are still unresolved at handoff.
- Prefer one specific next action over a large speculative backlog.
- Never store secrets or identifiable patient information here.
