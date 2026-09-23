# OpenAI API review — 2026-09-22

The application already uses Responses API. Keep the existing workload routing
and configured model environment overrides. GPT-6 Luna is now the proposed default
for extraction, structuring, style and skill analysis. These changes are on the PR
branch only; live access and clinical quality evaluation are still pending.

## Implemented

- Shared Responses transport for summary, case assistant, style and skill analysis.
- Enforce `store: false` on every Responses call.
- Reject incomplete, failed, refused or empty results before downstream persistence.
- 105-second request timeouts; embedding retrieval has a 15-second timeout and
  retains the existing optional-retrieval fallback.
- Cap summary/style/skill output at 8,000 tokens (including reasoning); preserve
  the assistant's existing 6,500-token cap. Reaching the cap produces an error,
  never a partially accepted document.
- Strict JSON schema for Style Coach; retain existing clinical schemas.
- Stable prompt cache keys for style and skill requests. Savings depend on actual
  prefix reuse; no measured cost/latency improvement is claimed.
- Upstream Responses error bodies are not echoed into client errors or logs.
- No automatic retries, which could repeat billed work after a timeout.

## Proposed routing (not deployed)

| Workload | PR code default | Candidate to evaluate |
| --- | --- | --- |
| Summary | gpt-5.6-terra | gpt-6-sol |
| Clinical Case Assistant | gpt-5.6-terra | gpt-6-sol |
| Extraction / structuring | gpt-6-luna | gpt-6-luna |
| Style / skill analysis | gpt-6-luna | gpt-6-luna |

GPT-5.6 Luna is the rollback setting for the upgraded workloads.
Server environment overrides take precedence; these defaults do not establish
which model the deployed functions actually use. Retain text-embedding-3-small:
changing embedding models requires separate vector/retrieval migration work.

Official docs list GPT-6 Astra, Sol and Luna and recommend workload-based selection.
Sol is listed at $2/M input tokens and $10/M output tokens, with separate cache
and tool pricing. Actual savings depend on token consumption and tool calls.

Before switching each environment override, verify project model access with a
synthetic request and compare Hungarian clinical examples: missing versus normal
findings, pending tests, chronology, negations, disposition and no invented facts.
Measure latency, input/output/reasoning tokens and schema failures. Do not use
real patient data for these synthetic checks. Keep the previous model setting
available for rollback. Never silently downgrade the clinical reviewer on failure.

Validation: `node --test tests/openai-responses.mjs` (Node 24+) uses mocked API
responses. This checks transport behavior, not live model quality or access.

Known remaining limit: Case Assistant makes sequential review and structuring
calls; per-call timeouts do not guarantee an end-to-end response within the
Supabase 150-second idle limit. A request-wide deadline or asynchronous job flow
should be a separate change with UI handling.

Sources:
- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/models/gpt-6-sol
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://supabase.com/docs/guides/functions/limits
