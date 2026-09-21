# BachTranSBO — System Introduction

## What this system is

**BachTranSBO** is a personal emergency-department documentation and case-management web application designed for fast use during an active clinical shift.

Its purpose is to help a physician keep one coherent view of each case: patient basics, presenting complaint, history, physical examination, investigations, consultations, therapy, clinical course, disposition, and the final documentation summary.

It is intentionally a **physician-in-the-loop system**. The application organizes information and can use AI to extract, structure, summarize, and surface guideline-backed suggestions, but the physician remains responsible for reviewing clinical information and making clinical decisions.

BachTranSBO is not intended to replace the hospital EHR or act as an autonomous diagnostic or treatment system.

## Product principles

The system is built around a few core rules:

1. **One clinical case, one source of truth.** Shared patient attributes and workflow state should have one canonical representation rather than duplicate UI-specific copies.
2. **Clinical state must survive reloads.** Important case information belongs in the backend, not only in browser state.
3. **Incomplete work should be visible.** Missing required documentation and investigations still waiting for results are deliberately highlighted in the UI.
4. **AI may assist, not silently overwrite.** Extracted or generated content must remain reviewable by the physician before it becomes authoritative clinical documentation.
5. **Privacy is a backend invariant.** Permanent clinical writes are de-identified before storage and before reuse as AI learning material.
6. **Finalized physician text is the strongest learning signal.** Generated drafts can be compared with physician-approved final summaries to improve future documentation behavior without automatically changing the master Skill.

## Main workflow

A typical case moves through the system like this:

```text
Start / restore active shift
        ↓
Create case
        ↓
Clinical documentation
Complaint · History · Physical status
        ↓
Investigations
Lab · EKG · AVG/VVG · Radiology · Consultation · Other
        ↓
Therapy / clinical course
        ↓
Disposition
        ↓
AI-assisted summary
        ↓
Physician review and editing
        ↓
Finalize
        ↓
De-identified permanent learning corpus
```

The operational UI is designed to make unresolved items obvious so the physician can see what still needs documentation or which investigations are still pending.

## Architecture at a glance

### Frontend

The production web application is a lightweight HTML/CSS/JavaScript client served through GitHub Pages.

Primary files include:

- `index.html` — stable application entry point
- `styles.css` — shared responsive UI
- `app.js` — main application logic
- `case-ui.js` — case-oriented UI behavior
- `backend.js` — browser-to-Supabase client layer
- `assistant-core.js` — shared Case Assistant proposal validation/application logic
- `config.js` — public browser configuration only

Older/recovery UI files may remain in the repository to support rollback and regression recovery. They are not independent sources of clinical truth.

### Backend

Supabase provides:

- authentication,
- PostgreSQL persistence,
- Row Level Security,
- migrations,
- Edge Functions for privileged clinical and AI operations.

Permanent clinical writes are routed through the backend privacy layer rather than allowing normal browser code to write directly to the permanent clinical corpus.

### AI layer

AI functionality is implemented server-side through Supabase Edge Functions.

Important functions include:

- `clinical-store` — privacy-gated clinical persistence
- `generate-summary` — SBO Documentation Skill-based summary generation
- `case-assistant` — clinical text extraction and guideline-backed case suggestions
- `analyze-style` — physician-reviewed writing-style learning
- `analyze-skill` — proposes Skill improvements from Generated → Finalized differences
- `learning-admin` — AI learning administration

The Case Assistant calls the OpenAI Responses API server-side. Its model is configurable through Supabase environment variables; the repository currently falls back to `gpt-5.6-terra` when no assistant/summary model override is configured.

## Case Assistant

The **Case Assistant** has two distinct responsibilities.

### 1. Clinical text extraction

A physician can paste source text. The assistant proposes structured items that map into supported clinical fields or investigation entries. Proposals are validated against the pasted source before they can be applied.

This is intended to reduce repetitive data entry, not to invent missing clinical facts.

### 2. Guideline-backed case review

For an existing case, the assistant can review the de-identified case snapshot and retrieve information from the configured guideline registry.

The backend requires citable guideline evidence before returning structured suggestions. Suggestions remain advisory and do not automatically become diagnoses, orders, or treatment decisions.

## Privacy boundary

The project intentionally avoids modeling direct patient identifiers such as patient name, TAJ, full date of birth, address, phone number, or email.

The permanent-write path is conceptually:

```text
Browser clinical input
        ↓
Authenticated Supabase Edge Function
        ↓
Deterministic de-identification
        ↓
AI missed-identifier/person-name pass
        ↓
Sanitized clinical state
        ↓
PostgreSQL / AI learning corpus
```

If the de-identification pipeline cannot complete safely, permanent clinical writes are designed to fail closed.

See [PRIVACY.md](PRIVACY.md) for the detailed privacy model.

## AI learning philosophy

The long-term learning unit is:

```text
de-identified case
      +
AI-generated draft
      +
physician-finalized summary
```

This allows the system to learn reusable documentation patterns from actual physician corrections while keeping changes reviewable.

Style candidates and Skill suggestions do **not** activate themselves automatically.

See [AI_LEARNING.md](AI_LEARNING.md), [STYLE_LEARNING.md](STYLE_LEARNING.md), and [SKILL_SUGGESTIONS.md](SKILL_SUGGESTIONS.md).

## Where to go next

- [PROJECT_SPEC.md](PROJECT_SPEC.md) — detailed product/workflow specification
- [BACKEND_SETUP.md](BACKEND_SETUP.md) — backend and deployment setup
- [PRIVACY.md](PRIVACY.md) — de-identification and permanent-write boundary
- [AI_LEARNING.md](AI_LEARNING.md) — physician-reviewed learning workflow
- [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md) — deployment verification

When modifying the project, preserve the system invariants first: **single source of truth, persistent clinical state, explicit workflow status, privacy-gated storage, and physician control over AI output.**
