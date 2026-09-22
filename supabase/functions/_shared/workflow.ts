export function patientWorkflowBlockers(patient: any) {
  const blockers: string[] = [];
  const currentYear = new Date().getUTCFullYear();

  const sex = String(patient?.sex || "").trim().toUpperCase();
  if (!String(patient?.mainComplaint || "").trim()) blockers.push("Main complaint");
  if (!["M", "F", "O"].includes(sex)) blockers.push("Sex");

  const yob = Number(patient?.yob);
  if (!Number.isInteger(yob) || yob < 1900 || yob > currentYear) {
    blockers.push("Year of birth");
  }

  const arrivalMode = String(patient?.arrivalMode || "").trim();
  const validArrivalModes = ["omsz", "esetkocsi", "walk_in", "gp_referral", "other"];
  if (!validArrivalModes.includes(arrivalMode)) {
    blockers.push("Arrival to SBO");
  } else if (arrivalMode === "other" && !String(patient?.arrivalOther || "").trim()) {
    blockers.push("Arrival details");
  }

  const physicalStructuredComplete = Boolean(
    patient?.physicalStatus?.version === 1 &&
    patient?.physicalStatus?.generatedAt
  );

  const requiredNarrative = [
    ["Complaint", patient?.complaint, patient?.complaintSkipped, false],
    ["Patient history", patient?.history, patient?.historySkipped, false],
    ["Physical examination", patient?.physical, patient?.physicalSkipped, physicalStructuredComplete],
    ["Therapy", patient?.therapy, patient?.therapySkipped, false],
    ["Clinical course", patient?.course, patient?.courseSkipped, false],
    ["Diagnoses", patient?.diagnoses, patient?.diagnosesSkipped, false],
  ];

  for (const [label, value, skipped, structuredComplete] of requiredNarrative) {
    if (skipped) continue;

    if (label === "Physical examination" && patient?.physicalStatus?.version === 1) {
      if (!structuredComplete) blockers.push(String(label));
      continue;
    }

    if (!String(value || "").trim()) blockers.push(String(label));
  }

  const testEntries = [
    ...(patient?.tests?.labs || []).map((entry: any, i: number) => ["Lab " + (i + 1), entry]),
    ...(patient?.tests?.ekgs || []).map((entry: any, i: number) => ["EKG " + (i + 1), entry]),
    ...(patient?.tests?.gases || []).map((entry: any, i: number) => ["AVG / VVG " + (i + 1), entry]),
    ...(patient?.tests?.radiology || []).map((entry: any, i: number) => [
      String(entry?.type || "").trim() || "Radiology " + (i + 1),
      entry,
    ]),
    ...(patient?.tests?.consultations || []).map((entry: any, i: number) => [
      String(entry?.type || "").trim() || "Consultation " + (i + 1),
      entry,
    ]),
  ];

  for (const [label, entry] of testEntries) {
    if (!entry) continue;
    if (entry.mode === "notordered") continue;
    if (!String(entry.text || "").trim()) blockers.push(String(label));
  }

  const disposition = String(patient?.disposition || "").trim();
  const validDispositions = ["discharged", "admitted", "other"];
  if (!validDispositions.includes(disposition)) {
    blockers.push("Disposition");
  } else if (disposition === "discharged") {
    if (!String(patient?.dischargeCondition || "").trim()) {
      blockers.push("Condition / symptoms at discharge");
    }
    if (!(patient?.recommendations || []).some((value: any) => String(value || "").trim())) {
      blockers.push("Home recommendation / plan");
    }
  } else if (disposition === "admitted") {
    if (!String(patient?.ward || "").trim()) blockers.push("Ward / department");
  } else if (disposition === "other") {
    if (!String(patient?.otherOutcome || "").trim()) blockers.push("Outcome");
  }

  return blockers;
}
