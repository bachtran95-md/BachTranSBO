# BachTranSBO backend setup (Supabase)

This branch replaces clinical-data `localStorage` persistence with a Supabase backend while keeping the current HTML/CSS/JavaScript UI.

Clinical content is permanently stored only after automatic de-identification.

## 1. Create a Supabase project

Create a Supabase project. An EU region is appropriate if that matches your deployment/privacy requirements.

## 2. Apply database migrations

Apply all migrations in order:

1. `supabase/migrations/001_backend_v1.sql`
2. `supabase/migrations/002_privacy_hardening.sql`
3. `supabase/migrations/003_ai_summary.sql`
4. `supabase/migrations/004_similar_case_retrieval.sql`
5. `supabase/migrations/005_style_learning.sql`
6. `supabase/migrations/006_skill_suggestions.sql`
7. `supabase/migrations/007_backend_skill_privacy.sql`
8. `supabase/migrations/008_backend_service_grants.sql`
9. `supabase/migrations/009_advisor_cleanup.sql`
10. `supabase/migrations/010_preview_v5_clinical_fields.sql`
11. `supabase/migrations/011_atomic_finalize.sql`
12. `supabase/migrations/012_required_field_states.sql`

The first migration creates:

- `shifts`
- `cases`
- `test_entries`
- `summaries`
- `summary_revisions`

The second migration makes the permanent clinical tables browser read-only. Clinical writes are then accepted only through the `clinical-store` Edge Function.

The third migration adds backend-only versioned SBO Documentation Skill and writing-style profile tables.

The fourth migration enables pgvector retrieval and stores a de-identified case snapshot + embedding for every finalized revision.

The fifth migration adds metadata for human-approved writing-style learning candidates.

The sixth migration adds server-managed, human-review-only Skill improvement suggestions.

The seventh migration removes browser access to master Skill instructions; only server-side functions can read them.

The eighth migration makes the backend secret-key/service-role table grants explicit.

The ninth migration addresses advisor findings and tightens database definitions.

The tenth migration adds doctor-entered diagnoses plus structured radiology fields used by the preview-v5-compatible UI.

The eleventh migration adds a server-only atomic finalization RPC so the completed case, synchronized tests, finalized summary, and immutable corpus revision commit or roll back together. Embedding generation remains best-effort after the database transaction.

The twelfth migration persists required narrative-field workflow states (provided vs none/not applicable), keeps atomic finalization in sync with those fields, and adds an atomic completed-case reopen RPC.

Cases and finalized summaries are permanent. There is no 15-day deletion rule.

## 3. Configure browser credentials

Edit `config.js`:

```js
window.BACH_SBO_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabasePublishableKey: "YOUR_PUBLISHABLE_KEY",
  authRedirectTo: window.location.origin + window.location.pathname
};
```

Use the browser-safe publishable key. Never put a secret/service-role key in browser code.

## 4. Configure Auth

The frontend uses the configured single-owner Supabase email/password account. Public signup should remain disabled.

In Auth settings:

1. enable Email,
2. add `https://bachtran95-md.github.io/BachTranSBO/` as an allowed redirect URL,
3. use the personal email account intended for BachTranSBO,
4. after the owner account exists, disable public new-user signups for this personal app,
5. copy the owner's Auth user UUID for the `APP_OWNER_USER_ID` secret.

## 5. Configure de-identification secrets

The `clinical-store` function performs deterministic identifier removal and then an AI pass for unlabelled names / missed identifiers.

Set:

```bash
supabase secrets set OPENAI_API_KEY=YOUR_OPENAI_API_KEY
supabase secrets set DEID_MODEL=gpt-5.6-luna
supabase secrets set SUMMARY_MODEL=gpt-5.6-terra
supabase secrets set EMBEDDING_MODEL=text-embedding-3-small
supabase secrets set STYLE_MODEL=gpt-5.6-luna
supabase secrets set SKILL_ANALYSIS_MODEL=gpt-5.6-luna
supabase secrets set APP_ORIGIN=https://bachtran95-md.github.io
supabase secrets set APP_OWNER_USER_ID=YOUR_SUPABASE_AUTH_USER_UUID
```

The function fails closed when the AI privacy pass cannot complete successfully. All operational Edge Functions also reject authenticated users whose UUID does not equal `APP_OWNER_USER_ID`.

## 6. Deploy the Edge Function

With the Supabase CLI:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_ID
supabase functions deploy clinical-store
supabase functions deploy generate-summary
supabase functions deploy analyze-style
supabase functions deploy analyze-skill
supabase functions deploy learning-admin
```

The function source is:

`supabase/functions/clinical-store/index.ts`

Shared privacy logic is:

`supabase/functions/_shared/deidentify.ts`

## 7. Configure the active SBO Documentation Skill

Follow `docs/SKILL_SETUP.md` and insert the exact approved Skill text as an active version in `skill_versions`.

`generate-summary` refuses to generate a clinical draft when no active Skill exists.

## 8. Privacy tests

Rule-level tests are in:

`supabase/functions/_shared/deidentify.test.ts`

They cover:

- TAJ,
- labelled full DOB,
- phone,
- email,
- labelled names,
- preservation of normal clinical dates,
- preservation of clinical numeric values.

## 9. Data model

```text
User
 └─ Shift
     └─ Case
         ├─ Test entries
         └─ Summary
             └─ Summary revisions
```

Every finalized revision is retained as a doctor-approved AI example.

The intended corpus unit is:

```text
de-identified clinical case
        +
original generated draft
        +
doctor-finalized summary
```

## 10. Current milestone

Implemented on `backend-v1`:

- Supabase Auth foundation,
- permanent PostgreSQL case storage,
- RLS,
- one active shift per owner,
- browser read-only clinical tables,
- privacy-gated Edge Function writes,
- deterministic PII rules,
- fail-closed AI person-name scrub,
- permanent finalized-summary revisions,
- versioned backend-only SBO Documentation Skill,
- optional versioned writing-style profile,
- live server-side GPT summary generation from de-identified DB state,
- finalized-case snapshots + embeddings,
- similar-case retrieval for few-shot generation,
- inactive writing-style candidate generation from Generated → Finalized pairs,
- explicit style-profile activation only after approval,
- advisory Skill-improvement suggestions from repeated edits,
- explicit accept/reject review without automatic Skill mutation,
- backend-only Skill instructions with safe dashboard metadata endpoint,
- configured-origin CORS support.

Still pending:

1. AI-learning/admin dashboard,
2. end-to-end deployment testing with the real Supabase project.

See `docs/PRIVACY.md` for the privacy architecture.


## GitHub Pages artifact

The Pages workflow stages only the frontend runtime files:

- `index.html`
- `styles.css`
- `app.js`
- `backend.js`
- `config.js`
- `.nojekyll`

Supabase migrations, Edge Function source, and project docs are not placed in the public Pages artifact.


## Production URLs

For this repository:

- App URL / Auth redirect: `https://bachtran95-md.github.io/BachTranSBO/`
- CORS `APP_ORIGIN`: `https://bachtran95-md.github.io`

CORS origin must not include `/BachTranSBO/`; browser Origin headers contain only scheme + host (+ port).


## Admin authentication

The production frontend uses single-owner email + password authentication.

- The admin email is public configuration in `config.js`.
- The password is never stored in the repository.
- There is no signup UI.
- Sign-in uses `supabase.auth.signInWithPassword()`.
- The Admin view can change the password after verifying the current password.
- Frontend minimum password length is 6 characters and imposes no additional complexity rule.
- Edge Functions still enforce `APP_OWNER_USER_ID`, and database RLS remains enabled.
