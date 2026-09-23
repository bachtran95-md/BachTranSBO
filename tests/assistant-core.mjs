import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("assistant-core.js", "utf8");
const context = { structuredClone };
vm.createContext(context);
vm.runInContext(source, context);
const core = context.BachAssistantCore;

assert.ok(core, "BachAssistantCore should be exported");

const snapshot = core.snapshot({
  sex: "male",
  yob: "1958",
  dischargeCondition: "Panaszmentes",
  physicalStatus: {
    version: 1,
    parameters: {
      bloodPressure: "148/86",
      pulse: "92",
      temperature: "37.2",
      respiratoryRate: "18",
      spo2: "96",
      oxygen: "2 L/min"
    },
    sections: {
      A: "Légút szabad",
      B: "Basalis crepitatio",
      C: "Perifériásan meleg",
      D: "GCS 15",
      E1: "Közepes általános állapot"
    },
    generatedAt: "2026-09-23T12:00:00Z",
    legacyPhysical: "should not be duplicated"
  }
});
assert.equal(snapshot.dischargeCondition, "Panaszmentes");
assert.equal(snapshot.physicalStatus.parameters.bloodPressure, "148/86");
assert.equal(snapshot.physicalStatus.parameters.spo2, "96");
assert.equal(snapshot.physicalStatus.sections.B, "Basalis crepitatio");
assert.equal(snapshot.physicalStatus.sections.E6, "");
assert.equal(snapshot.physicalStatus.generatedAt, undefined);
assert.equal(snapshot.physicalStatus.legacyPhysical, undefined);

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
    ekgs: [{ id: "ekg-1", type: "EKG", mode: "waiting", text: "", savedText: "" }],
    gases: [{ id: "gas-1", type: "AVG", mode: "waiting", text: "", savedText: "" }],
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

const appendedEkg = core.applyItems({
  ...patient,
  tests: {
    ...patient.tests,
    ekgs: [{ id: "ekg-1", type: "EKG", mode: "waiting", text: "Existing result", savedText: "Existing result" }]
  }
}, [{
  target: "ekg",
  status: "result",
  text: "New EKG result",
  label: "EKG"
}], () => "uuid-3");
assert.equal(appendedEkg.tests.ekgs.length, 2);
assert.equal(appendedEkg.tests.ekgs[0].text, "Existing result");
assert.equal(appendedEkg.tests.ekgs[1].text, "New EKG result");

assert.throws(() => core.applyItems({
  ...patient,
  tests: {
    ...patient.tests,
    labs: Array.from({ length: 999 }, (_, i) => ({
      id: String(i + 1),
      type: "Lab",
      text: String(i + 1),
      savedText: String(i + 1),
      mode: "waiting"
    }))
  }
}, [{
  target: "lab",
  status: "result",
  text: "Entry 1000",
  label: "Lab"
}], () => "uuid-4"), /maximum of 999 entries/);

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
