import { createClient } from "npm:@supabase/supabase-js@2";
import {
  deidentifyPatient,
  deidentifyState,
  reportTotal,
} from "../_shared/deidentify.ts";
import { openAiApiKey } from "../_shared/openai.ts";

const allowedOrigin = Deno.env.get("APP_ORIGIN") || "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

function supabaseNamedKey(variableName: string): string {
  const raw = requireEnv(variableName);
  let keys: Record<string, string>;

  try {
    keys = JSON.parse(raw);
  } catch {
    throw new Error(`${variableName} is not valid JSON.`);
  }

  const key = keys.default;
  if (!key) throw new Error(`${variableName} has no default key.`);
  return key;
}

async function authenticatedUser(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization) throw new Error("Missing Authorization header.");

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const anonKey = supabaseNamedKey("SUPABASE_PUBLISHABLE_KEYS");

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) throw new Error("Invalid authenticated session.");

  const ownerUserId = requireEnv("APP_OWNER_USER_ID");
  if (data.user.id !== ownerUserId) {
    throw new Error("This personal application is restricted to its owner account.");
  }

  return data.user;
}

function serviceClient() {
  return createClient(
    requireEnv("SUPABASE_URL"),
    supabaseNamedKey("SUPABASE_SECRET_KEYS"),
    { auth: { persistSession: false } },
  );
}

function flattenTests(patient: any, ownerId: string) {
  const rows: any[] = [];
  const now = new Date().toISOString();

  const add = (entry: any, category: string, sequence: number) => {
    if (!entry?.id) return;
    rows.push({
      id: entry.id,
      case_id: patient.id,
      owner_id: ownerId,
      category,
      sequence,
      subtype: entry.type || "",
      body_part: entry.bodyPart || "",
      modality: entry.modality || "",
      other_test: entry.otherTest || "",
      mode: entry.mode || "waiting",
      result_text: entry.text || "",
      saved_result_text: entry.savedText || "",
      updated_at: now,
    });
  };

  (patient.tests?.labs || []).forEach((x: any, i: number) =>
    add(x, "lab", i + 1)
  );
  add(patient.tests?.ekg, "ekg", 1);
  add(patient.tests?.gas, "gas", 1);
  (patient.tests?.radiology || []).forEach((x: any, i: number) =>
    add(x, "radiology", i + 1)
  );
  (patient.tests?.consultations || []).forEach((x: any, i: number) =>
    add(x, "consultation", i + 1)
  );

  return rows;
}

async function syncTests(db: any, ownerId: string, patient: any) {
  const rows = flattenTests(patient, ownerId);
  const currentIds = new Set(rows.map((row) => row.id));

  const { data: existingRows, error: existingError } = await db
    .from("test_entries")
    .select("id")
    .eq("case_id", patient.id)
    .eq("owner_id", ownerId);

  if (existingError) throw existingError;

  if (rows.length) {
    const { error: upsertError } = await db
      .from("test_entries")
      .upsert(rows, { onConflict: "id" });
    if (upsertError) throw upsertError;
  }

  const staleIds = (existingRows || [])
    .map((row: any) => row.id)
    .filter((id: string) => !currentIds.has(id));

  if (staleIds.length) {
    const { error: deleteError } = await db
      .from("test_entries")
      .delete()
      .eq("case_id", patient.id)
      .eq("owner_id", ownerId)
      .in("id", staleIds);

    if (deleteError) throw deleteError;
  }
}

function patientWorkflowBlockers(patient: any) {
  const blockers: string[] = [];

  const requiredNarrative = [
    ["Complaint", patient.complaint, patient.complaintSkipped],
    ["Patient history", patient.history, patient.historySkipped],
    ["Physical examination", patient.physical, patient.physicalSkipped],
    ["Diagnoses", patient.diagnoses, patient.diagnosesSkipped],
    ["Therapy", patient.therapy, patient.therapySkipped],
    ["Clinical course", patient.course, patient.courseSkipped],
  ];

  for (const [label, value, skipped] of requiredNarrative) {
    if (!skipped && !String(value || "").trim()) blockers.push(String(label));
  }

  const testEntries = [
    ...(patient.tests?.labs || []).map((entry: any, i: number) => ["Lab " + (i + 1), entry]),
    ["EKG", patient.tests?.ekg],
    ["AVG / VVG", patient.tests?.gas],
    ...(patient.tests?.radiology || []).map((entry: any, i: number) => [
      String(entry?.type || "").trim() || "Radiology " + (i + 1),
      entry,
    ]),
    ...(patient.tests?.consultations || []).map((entry: any, i: number) => [
      String(entry?.type || "").trim() || "Consultation " + (i + 1),
      entry,
    ]),
  ];

  for (const [label, entry] of testEntries) {
    if (!entry) continue;
    if (entry.mode === "notordered") continue;
    if (!String(entry.text || "").trim()) blockers.push(String(label));
  }

  return blockers;
}

function snapshotTest(entry: any, category: string, sequence: number) {
  const mode = entry?.mode || "waiting";
  const text = String(entry?.text || "").trim();
  const saved = String(entry?.savedText || "").trim();

  const status = mode === "notordered"
    ? "not_ordered"
    : saved && text === saved
    ? "result_available"
    : "waiting_for_result";

  return {
    category,
    type: entry?.type || "",
    body_part: entry?.bodyPart || "",
    modality: entry?.modality || "",
    other_test: entry?.otherTest || "",
    sequence,
    status,
    result: status === "result_available" ? saved : null,
  };
}

function arrivalLabel(mode: string, other: string) {
  const normalized = String(mode || "").trim();
  const otherText = String(other || "").trim();
  const labels: Record<string, string> = {
    omsz: "OMSz szállította",
    esetkocsi: "Esetkocsi szállította",
    walk_in: "saját lábán érkezett",
    gp_referral: "HO beutalóval",
    other: otherText || "egyéb",
  };
  return labels[normalized] || "";
}

function corpusSnapshot(patient: any) {
  const age = patient?.yob
    ? new Date().getUTCFullYear() - Number(patient.yob)
    : null;

  const tests: any[] = [];
  (patient.tests?.labs || []).forEach((x: any, i: number) =>
    tests.push(snapshotTest(x, "lab", i + 1))
  );
  if (patient.tests?.ekg) tests.push(snapshotTest(patient.tests.ekg, "ekg", 1));
  if (patient.tests?.gas) tests.push(snapshotTest(patient.tests.gas, "gas", 1));
  (patient.tests?.radiology || []).forEach((x: any, i: number) =>
    tests.push(snapshotTest(x, "radiology", i + 1))
  );
  (patient.tests?.consultations || []).forEach((x: any, i: number) =>
    tests.push(snapshotTest(x, "consultation", i + 1))
  );

  return {
    sex: patient.sex || "",
    age,
    main_complaint: patient.mainComplaint || "",
    arrival_to_sbo: patient.arrivalMode
      ? {
          mode: patient.arrivalMode,
          label: arrivalLabel(patient.arrivalMode, patient.arrivalOther),
          details: patient.arrivalMode === "other" ? patient.arrivalOther || "" : "",
        }
      : null,
    complaint: patient.complaint || "",
    complaint_status: patient.complaintSkipped ? "none" : "provided",
    history: patient.history || "",
    history_status: patient.historySkipped ? "none" : "provided",
    physical_examination: patient.physical || "",
    physical_examination_status: patient.physicalSkipped ? "none" : "provided",
    diagnoses: patient.diagnoses || "",
    diagnoses_status: patient.diagnosesSkipped ? "none" : "provided",
    tests,
    others: patient.others || "",
    therapy: patient.therapy || "",
    therapy_status: patient.therapySkipped ? "none" : "provided",
    clinical_course: patient.course || "",
    clinical_course_status: patient.courseSkipped ? "none" : "provided",
    disposition: patient.disposition || "",
    recommendations: patient.recommendations || [],
    admission: {
      hospital: patient.hospital || "",
      ward: patient.ward || "",
      accepting_physician: patient.physician || "",
      note: patient.admissionNote || "",
    },
    other_outcome: {
      outcome: patient.otherOutcome || "",
      details: patient.otherDetails || "",
    },
  };
}

async function createEmbedding(input: string) {
  const model = Deno.env.get("EMBEDDING_MODEL") || "text-embedding-3-small";
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openAiApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Embedding generation failed (${response.status}): ${detail.slice(0, 500)}`,
    );
  }

  const payload = await response.json();
  const embedding = payload?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Embedding API returned no vector.");
  }

  return { embedding, model };
}

async function saveState(db: any, ownerId: string, inputState: any) {
  const { state, report } = await deidentifyState(inputState);

  if (!state?.shift?.id) throw new Error("Missing active shift.");

  const { data: shift, error: shiftError } = await db
    .from("shifts")
    .select("id, owner_id, status")
    .eq("id", state.shift.id)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (shiftError) throw shiftError;
  if (!shift) throw new Error("Shift does not belong to authenticated user.");

  const patients = (state.patients || []).filter(
    (p: any) => p.shiftId === state.shift.id
  );

  const now = new Date().toISOString();

  if (patients.length) {
    const caseRows = patients.map((p: any) => ({
      id: p.id,
      shift_id: p.shiftId,
      owner_id: ownerId,
      local_id: p.localId,
      sex: p.sex || null,
      year_of_birth: p.yob ? Number(p.yob) : null,
      main_complaint: p.mainComplaint || "",
      arrival_mode: p.arrivalMode || "",
      arrival_other: p.arrivalMode === "other" ? p.arrivalOther || "" : "",
      complaint: p.complaint || "",
      complaint_skipped: Boolean(p.complaintSkipped),
      history: p.history || "",
      history_skipped: Boolean(p.historySkipped),
      physical_exam: p.physical || "",
      physical_exam_skipped: Boolean(p.physicalSkipped),
      diagnoses: p.diagnoses || "",
      diagnoses_skipped: Boolean(p.diagnosesSkipped),
      others: p.others || "",
      therapy: p.therapy || "",
      therapy_skipped: Boolean(p.therapySkipped),
      clinical_course: p.course || "",
      clinical_course_skipped: Boolean(p.courseSkipped),
      disposition: p.disposition || "",
      recommendations: p.recommendations || [""],
      hospital: p.hospital || "",
      ward: p.ward || "",
      accepting_physician: p.physician || "",
      admission_note: p.admissionNote || "",
      other_outcome: p.otherOutcome || "",
      other_details: p.otherDetails || "",
      status: p.summaryFinalizedAt ? "completed" : "active",
      completed_at: p.summaryFinalizedAt || null,
      created_at: p.createdAt || now,
      updated_at: p.updatedAt || now,
      deidentified_at: now,
      deidentification_version: "v1",
    }));

    const { error: caseError } = await db
      .from("cases")
      .upsert(caseRows, { onConflict: "id" });
    if (caseError) throw caseError;

    for (const patient of patients) {
      await syncTests(db, ownerId, patient);
    }

    const summaryRows = patients
      .filter(
        (p: any) =>
          p.summary ||
          p.summaryGeneratedAt ||
          p.summaryFinalizedAt ||
          p.summaryFinalizedText
      )
      .map((p: any) => ({
        case_id: p.id,
        owner_id: ownerId,
        generated_text: p.summaryGeneratedText || p.summary || "",
        working_text: p.summary || "",
        finalized_text: p.summaryFinalizedText || "",
        generated_at: p.summaryGeneratedAt || null,
        finalized_at: p.summaryFinalizedAt || null,
        updated_at: now,
      }));

    if (summaryRows.length) {
      const { error: summaryError } = await db
        .from("summaries")
        .upsert(summaryRows, { onConflict: "case_id" });
      if (summaryError) throw summaryError;
    }
  }

  return { state, report, removed: reportTotal(report) };
}

async function savePatient(
  db: any,
  ownerId: string,
  shiftId: string,
  patientInput: any,
) {
  const { patient, report } = await deidentifyPatient(patientInput);

  if (!shiftId || patient?.shiftId !== shiftId) {
    throw new Error("Case/shift mismatch.");
  }

  const { data: shift, error: shiftError } = await db
    .from("shifts")
    .select("id")
    .eq("id", shiftId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (shiftError) throw shiftError;
  if (!shift) throw new Error("Shift does not belong to authenticated user.");

  const now = new Date().toISOString();

  const { error: caseError } = await db.from("cases").upsert(
    {
      id: patient.id,
      shift_id: shiftId,
      owner_id: ownerId,
      local_id: patient.localId,
      sex: patient.sex || null,
      year_of_birth: patient.yob ? Number(patient.yob) : null,
      main_complaint: patient.mainComplaint || "",
      arrival_mode: patient.arrivalMode || "",
      arrival_other: patient.arrivalMode === "other" ? patient.arrivalOther || "" : "",
      complaint: patient.complaint || "",
      complaint_skipped: Boolean(patient.complaintSkipped),
      history: patient.history || "",
      history_skipped: Boolean(patient.historySkipped),
      physical_exam: patient.physical || "",
      physical_exam_skipped: Boolean(patient.physicalSkipped),
      diagnoses: patient.diagnoses || "",
      diagnoses_skipped: Boolean(patient.diagnosesSkipped),
      others: patient.others || "",
      therapy: patient.therapy || "",
      therapy_skipped: Boolean(patient.therapySkipped),
      clinical_course: patient.course || "",
      clinical_course_skipped: Boolean(patient.courseSkipped),
      disposition: patient.disposition || "",
      recommendations: patient.recommendations || [""],
      hospital: patient.hospital || "",
      ward: patient.ward || "",
      accepting_physician: patient.physician || "",
      admission_note: patient.admissionNote || "",
      other_outcome: patient.otherOutcome || "",
      other_details: patient.otherDetails || "",
      status: patient.summaryFinalizedAt ? "completed" : "active",
      completed_at: patient.summaryFinalizedAt || null,
      created_at: patient.createdAt || now,
      updated_at: patient.updatedAt || now,
      deidentified_at: now,
      deidentification_version: "v1",
    },
    { onConflict: "id" },
  );

  if (caseError) throw caseError;

  await syncTests(db, ownerId, patient);

  if (
    patient.summary ||
    patient.summaryGeneratedAt ||
    patient.summaryFinalizedAt ||
    patient.summaryFinalizedText
  ) {
    const { error: summaryError } = await db.from("summaries").upsert(
      {
        case_id: patient.id,
        owner_id: ownerId,
        generated_text:
          patient.summaryGeneratedText || patient.summary || "",
        working_text: patient.summary || "",
        finalized_text: patient.summaryFinalizedText || "",
        generated_at: patient.summaryGeneratedAt || null,
        finalized_at: patient.summaryFinalizedAt || null,
        updated_at: now,
      },
      { onConflict: "case_id" },
    );

    if (summaryError) throw summaryError;
  }

  return {
    patient,
    report,
    removed: reportTotal(report),
  };
}

async function updateCaseMetadata(
  db: any,
  ownerId: string,
  caseId: string,
  metadataInput: any,
) {
  if (!caseId || !/^[0-9a-f-]{36}$/i.test(caseId)) {
    throw new Error("Case metadata payload is incomplete.");
  }

  const input = metadataInput && typeof metadataInput === "object"
    ? metadataInput
    : {};
  const sex = String(input.sex || "").trim().toUpperCase();
  if (sex && !["F", "M", "O"].includes(sex)) {
    throw new Error("Invalid sex value.");
  }

  const yearOfBirth = input.yearOfBirth === null || input.yearOfBirth === ""
    ? null
    : Number(input.yearOfBirth);
  const currentYear = new Date().getUTCFullYear();
  if (
    yearOfBirth !== null &&
    (!Number.isInteger(yearOfBirth) || yearOfBirth < 1900 || yearOfBirth > currentYear)
  ) {
    throw new Error("Invalid year of birth.");
  }

  const arrivalMode = String(input.arrivalMode || "").trim();
  if (
    arrivalMode &&
    !["omsz", "esetkocsi", "walk_in", "gp_referral", "other"].includes(arrivalMode)
  ) {
    throw new Error("Invalid arrival mode.");
  }

  const { patient, report } = await deidentifyPatient({
    mainComplaint: String(input.mainComplaint || ""),
    arrivalOther: arrivalMode === "other" ? String(input.arrivalOther || "") : "",
    otherDetails: Object.prototype.hasOwnProperty.call(input, "otherDetails")
      ? String(input.otherDetails || "")
      : "",
  });

  const update: Record<string, unknown> = {
    sex: sex || null,
    year_of_birth: yearOfBirth,
    main_complaint: patient.mainComplaint || "",
    arrival_mode: arrivalMode,
    arrival_other: arrivalMode === "other" ? patient.arrivalOther || "" : "",
    updated_at: new Date().toISOString(),
    deidentified_at: new Date().toISOString(),
    deidentification_version: "v1",
  };
  if (Object.prototype.hasOwnProperty.call(input, "otherDetails")) {
    update.other_details = patient.otherDetails || "";
  }

  const { data, error } = await db
    .from("cases")
    .update(update)
    .eq("id", caseId)
    .eq("owner_id", ownerId)
    .select("id, sex, year_of_birth, main_complaint, arrival_mode, arrival_other, other_details")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Case does not belong to authenticated user.");

  return {
    caseId,
    metadata: data,
    report,
    removed: reportTotal(report),
  };
}

async function finalizePatient(
  db: any,
  ownerId: string,
  shiftId: string,
  patientInput: any,
) {
  const { patient, report } = await deidentifyPatient(patientInput);

  if (!shiftId || patient?.shiftId !== shiftId) {
    throw new Error("Case/shift mismatch.");
  }
  if (!patient?.summaryFinalizedAt || !patient?.summaryFinalizedText) {
    throw new Error("Finalized summary is required.");
  }

  const blockers = patientWorkflowBlockers(patient);
  if (blockers.length) {
    throw new Error(
      `Case cannot be finalized while orange fields remain: ${blockers.join(", ")}.`,
    );
  }

  const now = new Date().toISOString();
  const snapshot = corpusSnapshot(patient);
  const caseRow = {
    id: patient.id,
    shift_id: shiftId,
    owner_id: ownerId,
    local_id: patient.localId,
    sex: patient.sex || null,
    year_of_birth: patient.yob ? Number(patient.yob) : null,
    main_complaint: patient.mainComplaint || "",
    arrival_mode: patient.arrivalMode || "",
    arrival_other: patient.arrivalMode === "other" ? patient.arrivalOther || "" : "",
    complaint: patient.complaint || "",
    complaint_skipped: Boolean(patient.complaintSkipped),
    history: patient.history || "",
    history_skipped: Boolean(patient.historySkipped),
    physical_exam: patient.physical || "",
    physical_exam_skipped: Boolean(patient.physicalSkipped),
    diagnoses: patient.diagnoses || "",
    others: patient.others || "",
    therapy: patient.therapy || "",
    therapy_skipped: Boolean(patient.therapySkipped),
    clinical_course: patient.course || "",
    clinical_course_skipped: Boolean(patient.courseSkipped),
    disposition: patient.disposition || "",
    recommendations: patient.recommendations || [""],
    hospital: patient.hospital || "",
    ward: patient.ward || "",
    accepting_physician: patient.physician || "",
    admission_note: patient.admissionNote || "",
    other_outcome: patient.otherOutcome || "",
    other_details: patient.otherDetails || "",
    status: "completed",
    completed_at: patient.summaryFinalizedAt,
    created_at: patient.createdAt || now,
    updated_at: patient.updatedAt || now,
    deidentified_at: now,
    deidentification_version: "v1",
  };

  const summaryRow = {
    case_id: patient.id,
    owner_id: ownerId,
    generated_text: patient.summaryGeneratedText || patient.summary || "",
    working_text: patient.summary || "",
    finalized_text: patient.summaryFinalizedText,
    generated_at: patient.summaryGeneratedAt || null,
    finalized_at: patient.summaryFinalizedAt,
    updated_at: now,
  };

  const revisionPayload = {
    generated_text: patient.summaryGeneratedText || patient.summary || "",
    finalized_text: patient.summaryFinalizedText,
    finalized_at: patient.summaryFinalizedAt,
    deidentification_version: "v1",
    case_snapshot: snapshot,
  };

  const { data: revisionId, error } = await db.rpc("finalize_case_atomic", {
    p_owner_id: ownerId,
    p_case: caseRow,
    p_tests: flattenTests(patient, ownerId),
    p_summary: summaryRow,
    p_revision: revisionPayload,
  });

  if (error) throw error;
  if (!revisionId) throw new Error("Atomic finalization returned no revision ID.");

  let embeddingWarning: string | null = null;
  try {
    const embedded = await createEmbedding(JSON.stringify(snapshot));
    const { error: embeddingError } = await db
      .from("summary_revisions")
      .update({
        embedding: embedded.embedding,
        embedding_model: embedded.model,
        embedding_created_at: new Date().toISOString(),
      })
      .eq("id", revisionId)
      .eq("owner_id", ownerId);

    if (embeddingError) throw embeddingError;
  } catch (embeddingError) {
    embeddingWarning = embeddingError instanceof Error
      ? embeddingError.message
      : "Embedding generation failed.";
    console.error(embeddingError);
  }

  return {
    patient,
    report,
    removed: reportTotal(report),
    revisionId,
    embedded: !embeddingWarning,
    embeddingWarning,
  };
}

async function reopenCase(
  db: any,
  ownerId: string,
  shiftId: string,
  caseId: string,
) {
  if (!shiftId || !caseId) throw new Error("Case reopen payload is incomplete.");

  const { data: reopenedAt, error } = await db.rpc("reopen_case_atomic", {
    p_owner_id: ownerId,
    p_shift_id: shiftId,
    p_case_id: caseId,
  });

  if (error) throw error;
  if (!reopenedAt) throw new Error("Atomic case reopen returned no timestamp.");

  return {
    caseId,
    reopenedAt,
  };
}

async function deleteCase(db: any, ownerId: string, caseId: string) {
  if (!caseId || !/^[0-9a-f-]{36}$/i.test(caseId)) {
    throw new Error("Case delete payload is incomplete.");
  }

  const { data: ownedCase, error: caseError } = await db
    .from("cases")
    .select("id, shift_id, local_id, status")
    .eq("id", caseId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (caseError) throw caseError;
  if (!ownedCase) throw new Error("Case does not belong to authenticated user.");

  const { count, error: deleteError } = await db
    .from("cases")
    .delete({ count: "exact" })
    .eq("id", caseId)
    .eq("owner_id", ownerId);

  if (deleteError) throw deleteError;
  if (count !== 1) throw new Error("Case delete did not remove exactly one case.");

  return {
    caseId,
    shiftId: ownedCase.shift_id,
    localId: ownedCase.local_id,
    status: ownedCase.status,
    deleted: true,
    deletedAt: new Date().toISOString(),
  };
}

async function appendRevision(db: any, ownerId: string, patientInput: any) {
  const { patient, report } = await deidentifyPatient(patientInput);

  if (!patient?.summaryFinalizedAt || !patient?.summaryFinalizedText) {
    throw new Error("Finalized summary is required.");
  }

  const { data: ownedCase, error: caseError } = await db
    .from("cases")
    .select("id")
    .eq("id", patient.id)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (caseError) throw caseError;
  if (!ownedCase) throw new Error("Case does not belong to authenticated user.");

  const { data: summaryMeta, error: summaryMetaError } = await db
    .from("summaries")
    .select("model, skill_version")
    .eq("case_id", patient.id)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (summaryMetaError) throw summaryMetaError;

  const snapshot = corpusSnapshot(patient);

  const { data: revision, error } = await db
    .from("summary_revisions")
    .insert({
      case_id: patient.id,
      owner_id: ownerId,
      generated_text: patient.summaryGeneratedText || patient.summary || "",
      finalized_text: patient.summaryFinalizedText,
      finalized_at: patient.summaryFinalizedAt,
      model: summaryMeta?.model || null,
      skill_version: summaryMeta?.skill_version || null,
      deidentification_version: "v1",
      case_snapshot: snapshot,
    })
    .select("id")
    .single();

  if (error) throw error;

  let embeddingWarning: string | null = null;
  try {
    const embedded = await createEmbedding(JSON.stringify(snapshot));
    const { error: embeddingError } = await db
      .from("summary_revisions")
      .update({
        embedding: embedded.embedding,
        embedding_model: embedded.model,
        embedding_created_at: new Date().toISOString(),
      })
      .eq("id", revision.id)
      .eq("owner_id", ownerId);

    if (embeddingError) throw embeddingError;
  } catch (embeddingError) {
    embeddingWarning = embeddingError instanceof Error
      ? embeddingError.message
      : "Embedding generation failed.";
    console.error(embeddingError);
  }

  return {
    patient,
    report,
    removed: reportTotal(report),
    embedded: !embeddingWarning,
    embeddingWarning,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const user = await authenticatedUser(req);
    const db = serviceClient();
    const body = await req.json();

    if (body?.action === "save_state") {
      return json(await saveState(db, user.id, body.state));
    }

    if (body?.action === "save_patient") {
      return json(
        await savePatient(db, user.id, String(body.shiftId || ""), body.patient),
      );
    }

    if (body?.action === "update_case_metadata") {
      return json(
        await updateCaseMetadata(
          db,
          user.id,
          String(body.caseId || ""),
          body.metadata,
        ),
      );
    }

    if (body?.action === "finalize_patient") {
      return json(
        await finalizePatient(
          db,
          user.id,
          String(body.shiftId || ""),
          body.patient,
        ),
      );
    }

    if (body?.action === "reopen_case") {
      return json(
        await reopenCase(
          db,
          user.id,
          String(body.shiftId || ""),
          String(body.caseId || ""),
        ),
      );
    }

    if (body?.action === "delete_case") {
      return json(
        await deleteCase(
          db,
          user.id,
          String(body.caseId || ""),
        ),
      );
    }

    if (body?.action === "append_revision") {
      return json(await appendRevision(db, user.id, body.patient));
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json(
      {
        error: error instanceof Error ? error.message : "Clinical store failed.",
      },
      500,
    );
  }
});
