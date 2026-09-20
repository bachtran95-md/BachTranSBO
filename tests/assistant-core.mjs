import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("assistant-core.js", "utf8");
const context = { structuredClone };
vm.createContext(context);
vm.runInContext(source, context);
const core = context.BachAssistantCore;

assert.ok(core, "BachAssistantCore should be exported");

const patient = {
  complaint: "Existing complaint",
  complaintSkipped: false,
  history: "",
  historySkipped: true,
  physical: "",
  physicalSkipped: true,
  therapy: "",
  therapySkipped: true,
  course: "",
  courseSkipped: true,
  diagnoses: "",
  others: "",
  tests: {
    labs: [
      { id: "lab-1", type: "", mode: "waiting", text: "", savedText: "" }
    ],
    ekg: { id: "ekg-1", type: "EKG", mode: "waiting", text: "", savedText: "" },
    gas: { id: "gas-1", type: "AVG", mode: "waiting", text: "", savedText: "" },
    radiology: [],
    consultations: []
  }
};

const validated = core.validateProposal({
  items: [{
    target: "history",
    status: "documented",
    text: "Hypertonia",
    evidence: "hypertonia",
    label: "History"
  }],
  warnings: []
}, "Anamnézis: hypertonia.");
assert.equal(validated.items[0].target, "history");

const appended = core.applyItems(patient, [{
  target: "complaint",
  status: "documented",
  text: "New detail",
  mode: "append"
}], () => "uuid-1");
assert.equal(appended.complaint, "Existing complaint\nNew detail");
assert.equal(appended.complaintSkipped, false);

const replaced = core.applyItems(patient, [{
  target: "complaint",
  status: "documented",
  text: "Replacement",
  mode: "replace"
}], () => "uuid-2");
assert.equal(replaced.complaint, "Replacement");

assert.throws(() => core.applyItems({
  ...patient,
  tests: {
    ...patient.tests,
    ekg: { id: "ekg-1", type: "EKG", mode: "waiting", text: "Existing result", savedText: "Existing result" }
  }
}, [{
  target: "ekg",
  status: "result",
  text: "New EKG result",
  label: "EKG"
}], () => "uuid-3"), /already has a result/);

assert.throws(() => core.applyItems({
  ...patient,
  tests: {
    ...patient.tests,
    labs: [
      { id: "1", type: "A", text: "1", savedText: "1", mode: "waiting" },
      { id: "2", type: "B", text: "2", savedText: "2", mode: "waiting" },
      { id: "3", type: "C", text: "3", savedText: "3", mode: "waiting" }
    ]
  }
}, [{
  target: "lab",
  status: "result",
  text: "Fourth result",
  label: "Lab"
}], () => "uuid-4"), /three lab cards are occupied/);

assert.throws(() => core.validateProposal({
  items: [{
    target: "therapy",
    status: "documented",
    text: "Aspirin",
    evidence: "not present",
    label: "Therapy"
  }],
  warnings: []
}, "No medication documented."), /no matching source evidence/);

console.log("Assistant core tests passed.");
