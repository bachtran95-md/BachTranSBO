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

console.log("Summary vitals firewall tests passed.");
