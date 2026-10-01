# SBO Documentation Skill backend setup

The operational browser does not contain, fetch, or edit the master documentation Skill. Browser sessions have no SELECT grant on `skill_versions`; server-side functions return only safe metadata such as Skill name/version.

The active Skill is stored in `skill_versions` and loaded only by the server-side `generate-summary` Edge Function.

## Create the first Skill version

After creating your Supabase user, obtain that user's UUID from the Auth dashboard and insert the exact approved SBO Documentation Skill text through the Supabase SQL editor:

```sql
insert into public.skill_versions (
  owner_id,
  version,
  name,
  instructions,
  is_active
)
values (
  'YOUR_AUTH_USER_UUID',
  1,
  'SBO Documentation AI',
  $$PASTE THE EXACT APPROVED SKILL TEXT HERE$$,
  true
);
```

Do not put the Skill instructions into `index.html`, `app.js`, or another browser-delivered file.

## Style profile

A style profile is optional. Initially, the system can generate summaries with the Skill alone.

Later, an approved profile can be inserted into `style_profiles`:

```sql
insert into public.style_profiles (
  owner_id,
  version,
  profile_text,
  is_active
)
values (
  'YOUR_AUTH_USER_UUID',
  1,
  $$APPROVED ABSTRACT WRITING STYLE PROFILE$$,
  true
);
```

The style profile must describe writing preferences only. It must not contain patient-specific facts.

## Versioning rule

Never overwrite the meaning of an old Skill version.

When the Skill changes:

1. set the current row `is_active = false`,
2. insert a new row with `version = previous + 1`,
3. set the new row `is_active = true`.

Generated summaries record the Skill version used.


## Anamnézis companion skill

`docs/MED_ANAMNESIS_AI_V1.md` is a task-specific companion instruction set for the existing `SBO Documentation AI` GPT skill.

It is **not** stored or activated as a second backend skill and does not use a separate `skill_versions` table. When the Anamnézis module is wired to the API, its instructions should be composed with the main SBO Documentation AI instructions for Anamnézis-specific requests.

This keeps one overall GPT documentation skill while allowing Anamnézis behavior to evolve independently in a versioned repository document.
