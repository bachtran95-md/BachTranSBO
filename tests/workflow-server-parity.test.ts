import fixtures from "./workflow-fixtures.json" with { type: "json" };
import { patientWorkflowBlockers } from "../supabase/functions/_shared/workflow.ts";

function basePatient() {
  return {
    sex: "F",
    yob: "1970",
    mainComplaint: "Mellkasi fájdalom",
    arrivalMode: "walk_in",
    arrivalOther: "",
    complaint: "",
    complaintSkipped: true,
    history: "",
    historySkipped: true,
    physical: "",
    physicalSkipped: true,
    therapy: "",
    therapySkipped: true,
    course: "",
    courseSkipped: true,
    diagnoses: "",
    diagnosesSkipped: true,
    tests: {
      labs: [],
      ekgs: [],
      gases: [],
      radiology: [],
      consultations: [],
    },
    disposition: "discharged",
    dischargeCondition: "Panaszmentes, jó általános állapotú.",
    recommendations: ["Háziorvosi kontroll."],
    hospital: "",
    ward: "",
    physician: "",
    admissionNote: "",
    otherOutcome: "",
    otherDetails: "",
  };
}

function merge(base: any, patch: any): any {
  if (Array.isArray(patch)) return structuredClone(patch);
  if (!patch || typeof patch !== "object") return patch;

  const out = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      out?.[key] &&
      typeof out[key] === "object" &&
      !Array.isArray(out[key])
    ) {
      out[key] = merge(out[key], value);
    } else {
      out[key] = structuredClone(value);
    }
  }
  return out;
}

Deno.test("server workflow readiness matches shared fixtures", () => {
  for (const fixture of fixtures) {
    const patient = merge(basePatient(), fixture.patch);
    const blockers = patientWorkflowBlockers(patient);
    const ready = blockers.length === 0;

    if (ready !== fixture.expectedReady) {
      throw new Error(
        `${fixture.name}: expected ready=${fixture.expectedReady}, got ready=${ready}; blockers=${JSON.stringify(blockers)}`,
      );
    }
  }
});
