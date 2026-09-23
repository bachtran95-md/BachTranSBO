import { createClient } from "npm:@supabase/supabase-js@2";
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

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

function supabaseNamedKey(variableName: string): string {
  const raw = env(variableName);
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

async function getUser(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization) throw new Error("Missing Authorization header.");

  const authClient = createClient(env("SUPABASE_URL"), supabaseNamedKey("SUPABASE_PUBLISHABLE_KEYS"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) throw new Error("Invalid authenticated session.");

  const ownerUserId = env("APP_OWNER_USER_ID");
  if (data.user.id !== ownerUserId) {
    throw new Error("This personal application is restricted to its owner account.");
  }

  return data.user;
}

function serviceClient() {
  return createClient(
    env("SUPABASE_URL"),
    supabaseNamedKey("SUPABASE_SECRET_KEYS"),
    { auth: { persistSession: false } },
  );
}

function responseText(payload: any): string {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();

  const chunks: string[] = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function testStatus(row: any) {
  if (row.mode === "notordered") return "not_ordered";

  const result = String(row.result_text || "").trim();
  const saved = String(row.saved_result_text || "").trim();

  if (saved && result === saved) return "result_available";
  return "waiting_for_result";
}

const PHYSICAL_STATUS_SECTION_KEYS = ["A", "B", "C", "D", "E1", "E2", "E3", "E4", "E5", "E6"];

function structuredPhysicalStatus(caseRow: any) {
  const value = caseRow?.physical_status_data;
  return value && typeof value === "object" && Number(value.version) === 1
    ? value
    : null;
}

function positivePhysicalText(caseRow: any) {
  const status = structuredPhysicalStatus(caseRow);
  if (!status) return String(caseRow?.physical_exam || "").trim();

  const sections = status.sections && typeof status.sections === "object"
    ? status.sections
    : {};

  return PHYSICAL_STATUS_SECTION_KEYS
    .map((key) => {
      const text = String(sections[key] || "").trim();
      return text ? `${key}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function structuredPhysicalHasInput(status: any) {
  return Boolean(
    status &&
    [
      ...Object.values(status.parameters || {}),
      ...Object.values(status.sections || {}),
    ].some((value) => String(value || "").trim())
  );
}

function structuredPhysicalComplete(caseRow: any) {
  const status = structuredPhysicalStatus(caseRow);
  return Boolean(
    status &&
    structuredPhysicalHasInput(status) &&
    status.generatedAt
  );
}

function workflowBlockers(caseRow: any, tests: any[]) {
  const blockers: string[] = [];

  const physicalStructuredComplete = structuredPhysicalComplete(caseRow);

  const requiredNarrative = [
    ["Complaint", caseRow.complaint, caseRow.complaint_skipped, false],
    ["Patient history", caseRow.history, caseRow.history_skipped, false],
    ["Physical examination", caseRow.physical_exam, caseRow.physical_exam_skipped, physicalStructuredComplete],
    ["Diagnoses", caseRow.diagnoses, caseRow.diagnoses_skipped, false],
    ["Therapy", caseRow.therapy, caseRow.therapy_skipped, false],
    ["Clinical course", caseRow.clinical_course, caseRow.clinical_course_skipped, false],
  ];

  for (const [label, value, skipped, structuredComplete] of requiredNarrative) {
    if (skipped) continue;

    if (label === "Physical examination" && structuredPhysicalStatus(caseRow)) {
      if (!structuredComplete) blockers.push(String(label));
      continue;
    }

    if (!String(value || "").trim()) blockers.push(String(label));
  }

  for (const row of tests || []) {
    if (testStatus(row) !== "waiting_for_result") continue;
    const category = String(row.category || "Test");
    const sequence = Number(row.sequence || 1);
    const label =
      category === "lab" ? `Lab ${sequence}` :
      category === "ekg" ? "EKG" :
      category === "gas" ? "AVG / VVG" :
      category === "radiology"
        ? String(row.subtype || "").trim() || `Radiology ${sequence}`
        : category === "consultation"
        ? String(row.subtype || "").trim() || `Consultation ${sequence}`
        : `${category} ${sequence}`;
    blockers.push(label);
  }

  return blockers;
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

function casePayload(caseRow: any, tests: any[]) {
  const age = caseRow.year_of_birth
    ? new Date().getUTCFullYear() - Number(caseRow.year_of_birth)
    : null;
  const arrivalMode = String(caseRow.arrival_mode || "").trim();
  const arrivalOther = String(caseRow.arrival_other || "").trim();

  return {
    case_id: caseRow.id,
    sex: caseRow.sex,
    age,
    main_complaint: caseRow.main_complaint,
    arrival_to_sbo: arrivalMode
      ? {
          mode: arrivalMode,
          label: arrivalLabel(arrivalMode, arrivalOther),
          details: arrivalOther,
        }
      : null,
    complaint: caseRow.complaint,
    complaint_status: caseRow.complaint_skipped ? "none" : "provided",
    history: caseRow.history,
    history_status: caseRow.history_skipped ? "none" : "provided",
    physical_examination: positivePhysicalText(caseRow),
    physical_examination_status: caseRow.physical_exam_skipped
      ? "none"
      : structuredPhysicalComplete(caseRow)
      ? "structured_positive_findings"
      : "provided",
    status_explicit_normal_findings: Array.isArray(caseRow.status_explicit_normals)
      ? caseRow.status_explicit_normals
      : [],
    diagnoses: caseRow.diagnoses || "",
    diagnoses_status: caseRow.diagnoses_skipped ? "none" : "provided",
    tests: tests.map((row) => ({
      category: row.category,
      type: row.subtype || null,
      body_part: row.body_part || null,
      modality: row.modality || null,
      other_test: row.other_test || null,
      sequence: row.sequence,
      status: testStatus(row),
      result:
        testStatus(row) === "result_available"
          ? row.saved_result_text
          : null,
    })),
    others: caseRow.others,
    therapy: caseRow.therapy,
    therapy_status: caseRow.therapy_skipped ? "none" : "provided",
    clinical_course: caseRow.clinical_course,
    clinical_course_status: caseRow.clinical_course_skipped ? "none" : "provided",
    disposition: caseRow.disposition,
    discharge_condition: caseRow.disposition === "discharged"
      ? caseRow.discharge_condition || ""
      : "",
    recommendations: caseRow.disposition === "discharged"
      ? caseRow.recommendations || []
      : [],
    admission: caseRow.disposition === "admitted"
      ? {
          hospital: caseRow.hospital,
          ward: caseRow.ward,
          accepting_physician: caseRow.accepting_physician,
          note: caseRow.admission_note,
        }
      : null,
    other_outcome: caseRow.disposition === "other"
      ? {
          outcome: caseRow.other_outcome,
          details: caseRow.other_details,
        }
      : null,
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

async function similarCases(
  db: any,
  ownerId: string,
  caseId: string,
  clinicalCase: any,
) {
  try {
    const embedded = await createEmbedding(JSON.stringify(clinicalCase));
    const { data, error } = await db.rpc("match_approved_finalized_cases", {
      p_owner_id: ownerId,
      p_query_embedding: embedded.embedding,
      p_embedding_model: embedded.model,
      p_exclude_case_id: caseId,
      p_match_count: 4,
    });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Similar-case retrieval skipped:", error);
    return [];
  }
}

async function callOpenAI(prompt: string) {
  const apiKey = openAiApiKey();
  const model = Deno.env.get("SUMMARY_MODEL") || "gpt-5.6-terra";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      prompt_cache_key: "bachtransbo-summary-v1",
      input: prompt,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `OpenAI summary generation failed (${response.status}): ${detail.slice(0, 500)}`,
    );
  }

  const payload = await response.json();
  const text = responseText(payload);
  if (!text) throw new Error("OpenAI returned an empty summary.");

  return { text, model };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const user = await getUser(req);
    const body = await req.json();
    const caseId = String(body?.caseId || "");

    if (!caseId) return json({ error: "caseId is required." }, 400);

    const db = serviceClient();

    const { data: caseRow, error: caseError } = await db
      .from("cases")
      .select("*")
      .eq("id", caseId)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (caseError) throw caseError;
    if (!caseRow) return json({ error: "Case not found." }, 404);

    if (!caseRow.deidentified_at) {
      throw new Error(
        "Case has not passed permanent-storage de-identification yet.",
      );
    }

    const { data: tests, error: testsError } = await db
      .from("test_entries")
      .select("*")
      .eq("case_id", caseId)
      .eq("owner_id", user.id)
      .order("category", { ascending: true })
      .order("sequence", { ascending: true });

    if (testsError) throw testsError;

    const blockers = workflowBlockers(caseRow, tests || []);
    if (blockers.length) {
      throw new Error(
        `Summary generation is locked until these orange fields are resolved: ${blockers.join(", ")}.`,
      );
    }

    const { data: skill, error: skillError } = await db
      .from("skill_versions")
      .select("id, version, name, instructions")
      .eq("owner_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (skillError) throw skillError;
    if (!skill) {
      throw new Error(
        "No active SBO Documentation Skill version is configured.",
      );
    }

    const { data: style, error: styleError } = await db
      .from("style_profiles")
      .select("version, profile_text")
      .eq("owner_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (styleError) throw styleError;

    const { data: documentationRules, error: documentationRulesError } = await db
      .from("documentation_rules")
      .select("code, category, prompt_text, priority")
      .eq("is_active", true)
      .eq("allow_clinical_inference", false)
      .order("priority", { ascending: false })
      .limit(12);

    if (documentationRulesError) throw documentationRulesError;

    const clinicalCase = casePayload(caseRow, tests || []);
    const examples = await similarCases(db, user.id, caseId, clinicalCase);

    const exampleBlock = examples.length
      ? examples.map((example: any, index: number) => [
          `--- APPROVED EXAMPLE ${index + 1} ---`,
          `Similarity: ${Number(example.similarity || 0).toFixed(3)}`,
          "Clinical input:",
          JSON.stringify(example.case_snapshot, null, 2),
          "Doctor-finalized documentation:",
          String(example.finalized_text || ""),
        ].join("\n")).join("\n\n")
      : "(No similar finalized examples available yet.)";

    const officialRulesBlock = (documentationRules || []).length
      ? (documentationRules || []).map((rule: any) =>
          `[${rule.code}] ${String(rule.prompt_text || "").trim()}`
        ).join("\n")
      : "(No active official documentation rules.)";

    const prompt = [
      "You are generating the final clinical documentation draft for BachTranSBO.",
      "Use ONLY the de-identified clinical facts supplied below.",
      "Never invent a diagnosis, result, treatment, consultation, disposition, or chronology.",
      "If a fact is absent or a result is still waiting, do not fabricate it.",
      "If arrival_to_sbo is present, include that arrival mode naturally in the Hungarian clinical narrative/anamnesis.",
      "For structured physical status, physical_examination contains ONLY physician-entered positive findings. Vital parameters and the generated full normal-status text are intentionally excluded.",
      "Use every supplied positive physical finding when clinically relevant to the narrative, but integrate them concisely rather than copying them as a mechanical status list.",
      "If status_explicit_normal_findings is present, those are normal findings the physician explicitly entered in the Státusz generator because they are clinically worth emphasizing. Preserve them when relevant; do not generalize them into other normal findings.",
      "Do not infer omitted normal findings or numeric vital signs that are not present in the CURRENT case payload.",
      "Follow the SBO Documentation Skill instructions exactly.",
      "Return ONLY the documentation text, without commentary, markdown fences, or explanations.",
      "",
      "=== SBO DOCUMENTATION SKILL ===",
      skill.instructions,
      "",
      "=== WRITING STYLE PROFILE ===",
      style?.profile_text || "(No active style profile yet.)",
      "",
      "=== OFFICIAL DOCUMENTATION QUALITY RULES ===",
      "These rules improve structure, completeness, continuity and readability ONLY.",
      "They must NEVER be used to infer, recommend, or add any clinical fact, diagnosis, result, treatment, medication, consultation, advice, follow-up, or disposition that is absent from the CURRENT case.",
      "When a rule refers to information that is not present in the current case, simply do not add it.",
      officialRulesBlock,
      "",
      "=== SIMILAR DOCTOR-APPROVED CASES ===",
      "Use these only as style/structure examples. Never copy patient-specific facts from them into the current case.",
      exampleBlock,
      "",
      "=== CURRENT DE-IDENTIFIED CASE ===",
      JSON.stringify(clinicalCase, null, 2),
    ].join("\n");

    const generated = await callOpenAI(prompt);
    const now = new Date().toISOString();

    const { error: summaryError } = await db.from("summaries").upsert(
      {
        case_id: caseId,
        owner_id: user.id,
        generated_text: generated.text,
        working_text: generated.text,
        generated_at: now,
        model: generated.model,
        skill_version: String(skill.version),
        updated_at: now,
      },
      { onConflict: "case_id" },
    );

    if (summaryError) throw summaryError;

    return json({
      summary: generated.text,
      generatedAt: now,
      model: generated.model,
      skillVersion: String(skill.version),
      styleVersion: style ? String(style.version) : null,
      officialRulesUsed: (documentationRules || []).map((x: any) => x.code),
      similarCasesUsed: examples.map((x: any) => ({
        caseId: x.case_id,
        revisionId: x.revision_id,
        similarity: x.similarity,
      })),
    });
  } catch (error) {
    console.error(error);
    return json(
      {
        error: error instanceof Error ? error.message : "Summary generation failed.",
      },
      500,
    );
  }
});
