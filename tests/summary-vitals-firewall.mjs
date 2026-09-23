import assert from "node:assert/strict";
import fs from "node:fs";

function sliceFunction(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `Missing source marker: ${start}`);
  const to = source.indexOf(end, from);
  assert.ok(to > from, `Missing end marker: ${end}`);
  return source.slice(from, to);
}

const generateSummary = fs.readFileSync("supabase/functions/generate-summary/index.ts", "utf8");
const clinicalStore = fs.readFileSync("supabase/functions/clinical-store/index.ts", "utf8");
const assistantCore = fs.readFileSync("assistant-core.js", "utf8");
const backend = fs.readFileSync("backend.js", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const statusGenerator = fs.readFileSync("beta-status-generator.js", "utf8");

const summaryPayload = sliceFunction(
  generateSummary,
  "function casePayload(",
  "async function createEmbedding("
);
const learningSnapshot = sliceFunction(
  clinicalStore,
  "function corpusSnapshot(",
  "async function createEmbedding("
);

const forbidden = [
  "vitals",
  "bloodPressure",
  "pulse",
  "temperature",
  "respiratoryRate",
  "spo2",
  "oxygen"
];

for (const token of forbidden) {
  const pattern = new RegExp(`\\b${token}\\b`, "i");
  assert.equal(
    pattern.test(summaryPayload),
    false,
    `Summary payload must not contain vital token: ${token}`
  );
  assert.equal(
    pattern.test(learningSnapshot),
    false,
    `Summary-learning snapshot must not contain vital token: ${token}`
  );
}

assert.match(
  clinicalStore,
  /vitals:\s*canonicalVitals\(patient\)/,
  "Clinical persistence must store canonical vitals."
);
assert.match(
  assistantCore,
  /out\.vitals\s*=\s*clinicalVitals\(/,
  "Case Assistant snapshot must receive canonical vitals."
);
assert.match(
  backend,
  /row\.vitals/,
  "Browser patient state must restore vitals from the database."
);

assert.match(
  generateSummary,
  /sanitizeExampleSnapshot\(example\.case_snapshot\)/,
  "Similar-case snapshots must pass through the vitals sanitizer before entering the Summary prompt."
);

// Release-integrity regression: browser autosave may update the editable/finalized
// Summary state, but generated provenance belongs to generate-summary on the server.
const summaryWorkingSync = sliceFunction(
  clinicalStore,
  "async function syncSummaryWorkingState(",
  "async function saveState("
);
assert.doesNotMatch(
  summaryWorkingSync,
  /update\(\{[\s\S]*generated_text|update\(\{[\s\S]*generated_at/,
  "Autosave must not overwrite server-owned generated Summary provenance."
);
assert.match(
  clinicalStore,
  /select\("generated_text, generated_at, model, skill_version"\)/,
  "Finalization must read canonical generated Summary provenance from the server."
);
assert.match(
  clinicalStore,
  /generated_text:\s*canonicalSummary[\s\S]*patient\.summaryGeneratedText/,
  "Finalized revision must prefer canonical server-generated text over browser metadata."
);

// Status-generator cache is disposable only after its raw revision is confirmed saved.
const finalizeCase = sliceFunction(
  statusGenerator,
  "async function finalizeCase(",
  "function clearShiftCache("
);
assert.match(
  finalizeCase,
  /await window\.BachSBOBackend\.saveStatusGeneratorRecords/,
  "Case finalization must persist the Status-generator revision."
);
assert.match(
  finalizeCase,
  /Number\(result\?\.saved \|\| 0\) !== 1/,
  "Status cache cleanup must require an acknowledged server save."
);
assert.match(
  finalizeCase,
  /clearCaseCache\(shiftId, caseId\)/,
  "Status cache must be cleared after the revision is confirmed saved."
);
assert.match(
  app,
  /BachSBOStatusGenerator\?\.finalizeCase\(state\.shift\?\.id, patient\)/,
  "Clinical case finalization must trigger per-case Status revision persistence."
);
const finalizeShift = sliceFunction(
  statusGenerator,
  "async function finalizeShift(",
  "function clearCaseCache("
);
assert.match(
  finalizeShift,
  /if \(!stateHasData\(state\)\) continue;/,
  "END SHIFT must not rebuild and overwrite a revision after per-case cache cleanup."
);

console.log("Summary vitals + release integrity firewall tests passed.");
