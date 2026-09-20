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

const reconciledHistory = core.reconcileItems({ ...patient, historySkipped: false }, validated.items)[0];
assert.equal(reconciledHistory.action, "add");
assert.equal(reconciledHistory.mode, "append");

const duplicateHistory = core.reconcileItems({ ...patient, history: "Hypertonia" }, validated.items)[0];
assert.equal(duplicateHistory.action, "duplicate");

const skippedHistory = core.reconcileItems({ ...patient, historySkipped: true }, validated.items)[0];
assert.equal(skippedHistory.action, "update");
assert.equal(skippedHistory.currentStatus, "none");

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

const waitingLabResult = {
  target: "lab",
  status: "result",
  text: "Troponin 46 ng/L",
  evidence: "Troponin 46 ng/L",
  label: "Lab"
};
const reconciledLab = core.reconcileItems(patient, [waitingLabResult])[0];
assert.equal(reconciledLab.action, "update");
assert.equal(reconciledLab.matchId, "lab-1");

const updatedLabPatient = core.applyItems(patient, [reconciledLab], () => "unused");
assert.equal(updatedLabPatient.tests.labs.length, 1);
assert.equal(updatedLabPatient.tests.labs[0].id, "lab-1");
assert.equal(updatedLabPatient.tests.labs[0].savedText, "Troponin 46 ng/L");

const duplicateLab = core.reconcileItems(updatedLabPatient, [waitingLabResult])[0];
assert.equal(duplicateLab.action, "duplicate");

const ambiguousLabs = core.reconcileItems({
  ...patient,
  tests: {
    ...patient.tests,
    labs: [
      { id: "lab-a", type: "", mode: "waiting", text: "", savedText: "" },
      { id: "lab-b", type: "", mode: "waiting", text: "", savedText: "" }
    ]
  }
}, [waitingLabResult])[0];
assert.equal(ambiguousLabs.action, "conflict");

const consultationPatient = {
  ...patient,
  tests: {
    ...patient.tests,
    consultations: [
      { id: "consult-cardio", type: "Cardiology", mode: "waiting", text: "", savedText: "" },
      { id: "consult-neuro", type: "Neurology", mode: "waiting", text: "", savedText: "" }
    ]
  }
};
const consultationUpdate = core.reconcileItems(consultationPatient, [{
  target: "consultation",
  status: "result",
  text: "CCU admission recommended",
  evidence: "CCU admission recommended",
  label: "Cardiology consultation"
}])[0];
assert.equal(consultationUpdate.action, "update");
assert.equal(consultationUpdate.matchId, "consult-cardio");

const newHistory = core.reconcileItems({ ...patient, history: "Known hypertension", historySkipped: false }, [{
  target: "history",
  status: "documented",
  text: "Takes apixaban at home",
  evidence: "Takes apixaban at home",
  label: "Medication history"
}])[0];
assert.equal(newHistory.action, "update");
assert.equal(newHistory.mode, "append");

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
