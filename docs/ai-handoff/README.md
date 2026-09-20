# AI Handoff

This directory is the compact source of truth for handing BachTranSBO between ChatGPT Work sessions, Codex sessions, or other coding agents.

## Read order for every new session

1. Read `docs/ai-handoff/PROJECT_STATE.md`.
2. Read `docs/ai-handoff/TODO.md`.
3. Read the repo `README.md` and only the docs/files referenced by PROJECT_STATE.
4. Check recent commits before editing.
5. Continue from the **Resume here** section. Do not redo completed work.

## Update rule

After every meaningful milestone, and always before ending a session:

- update `PROJECT_STATE.md`;
- update `TODO.md`;
- record important architecture/security/privacy decisions;
- record tests/build/deployment checks actually performed;
- record the current commit or branch when known;
- leave one concrete next action under **Resume here**.

Keep these files compact. They are a handoff, not a transcript.

## Privacy

Never copy patient-identifying information, raw clinical text containing identifiers, secrets, API keys, passwords, tokens, or production credentials into this directory.
