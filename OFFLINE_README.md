# BachTranSBO offline bundle

This branch exists only to build an offline development bundle.

Included:
- current repository snapshot from main
- frontend, tests, docs, Supabase migrations and Edge Function source
- live Supabase project/schema/migration/function metadata snapshots under offline-snapshot/
- no production patient rows
- no OpenAI API secret, Supabase service-role key, auth token, or other secret

Recommended Codex starting points:
- docs/ai-handoff/PROJECT_STATE.md
- docs/ai-handoff/TODO.md
- docs/PROJECT_SPEC.md
- Master-handover.txt (added to the final downloaded ZIP outside GitHub)
- app.js, beta-status-generator.js, anamnesis-beta.js
- supabase/functions/
- supabase/migrations/

Release rule:
Stable stays conservative; risky changes go Beta -> real-world test -> Stable.
