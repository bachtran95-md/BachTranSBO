# AI Learning dashboard

The AI Learning screen is intentionally separate from the ER operational workflow.

## Metrics

It shows:

- finalized corpus count,
- active SBO Documentation Skill version,
- active writing-style profile.

## Writing style / Style Coach

After at least 5 **approved distinct** Generated → Finalized cases:

1. **Generate Candidate** calls `analyze-style`.
2. Style Coach analyzes reusable writing/editing patterns only; it must not learn patient-specific clinical facts.
3. The backend creates a new **inactive** style profile and a `style_coach_runs` audit record containing corpus maturity, official-rule count, analysis text, candidate link and review status.
4. AI Learning shows the candidate plus the Style Coach analysis for physician review.
5. **Activate** requires an explicit confirmation. It marks the linked pending Style Coach run accepted and makes that profile active for future summary generation.
6. **Reject** marks the linked pending Style Coach run rejected and leaves the profile inactive.
7. No candidate is activated automatically. Existing clinical records and finalized summaries are never rewritten by style activation.
8. Only the active style profile is used by `generate-summary`.

## Skill suggestions

After at least 10 Generated → Finalized pairs:

1. **Analyze Edits** calls `analyze-skill`.
2. The backend creates a pending suggestion.
3. The user can Accept for follow-up or Reject.
4. Accepting only changes suggestion status.
5. It never updates `skill_versions` and never changes the active Skill.

## Data boundaries

The dashboard reads only the authenticated user's corpus metadata/candidates through RLS.

Permanent clinical writes continue to go exclusively through the privacy-gated backend.
