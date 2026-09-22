import { createClient } from "npm:@supabase/supabase-js@2";
import { callResponses, responseText } from "../_shared/responses.ts";

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


function clampText(value: unknown, max = 4500) {
  const text = String(value ?? "").trim();
  return text.length <= max ? text : text.slice(0, max) + "…";
}

async function generateStyleProfile(
  revisions: any[],
  rules: any[],
  activeStyle: any,
  maturity: string,
) {
  const model = Deno.env.get("STYLE_COACH_MODEL") ||
    Deno.env.get("STYLE_MODEL") ||
    "gpt-5.6-luna";

  const examples = revisions.map((r, index) => [
    `PAIR ${index + 1}`,
    "AI draft:",
    clampText(r.generated_text),
    "Doctor-finalized version:",
    clampText(r.finalized_text),
  ].join("\n")).join("\n\n");

  const officialRules = rules.map((rule: any) =>
    `[${rule.code}] ${String(rule.prompt_text || "").trim()}`
  ).join("\n");

  const prompt = [
    "You are the Style Coach for Hungarian emergency-department clinical documentation.",
    "Your job is to improve the doctor's reusable WRITING STYLE using two inputs:",
    "1) recurring edits in de-identified AI-draft → doctor-finalized pairs, and",
    "2) official documentation-quality rules.",
    "",
    "STRICT SAFETY BOUNDARY:",
    "- Official rules may influence structure, completeness, continuity, clarity, concision and placement of supplied information only.",
    "- Never infer, recommend or create a diagnosis, investigation, treatment, medication, consultation, advice, follow-up or disposition.",
    "- Never include patient-specific facts, diagnoses, medications, values, ages, institutions, dates, names or unique case details in your output.",
    "- Do not change the master clinical Skill.",
    "",
    `Corpus maturity: ${maturity}. Treat early corpora conservatively and avoid strong conclusions from weak patterns.`,
    "",
    "CURRENT ACTIVE STYLE PROFILE:",
    activeStyle?.profile_text || "(none)",
    "",
    "OFFICIAL DOCUMENTATION QUALITY RULES:",
    officialRules || "(none)",
    "",
    "DE-IDENTIFIED EDIT PAIRS:",
    examples,
    "",
    "Return STRICT JSON with exactly these keys:",
    '{"analysis":"short abstract assessment of recurring style strengths/gaps versus the official rules","candidate_profile":"compact reusable style instructions for future summaries"}',
    "The candidate_profile should preserve the doctor's consistent preferences unless they reduce clarity or continuity, and should gently improve them toward the official documentation rules.",
  ].join("\n");

  const payload = await callResponses({
    model,
    input: prompt,
    max_output_tokens: 8000,
    prompt_cache_key: "bachtransbo-analyze-style-v1",
    text: { format: {
      type: "json_schema", name: "style_profile", strict: true,
      schema: {
        type: "object", additionalProperties: false,
        required: ["analysis", "candidate_profile"],
        properties: {
          analysis: { type: "string" },
          candidate_profile: { type: "string" },
        },
      },
    } },
  });

  const raw = responseText(payload);
  if (!raw) throw new Error("Style Coach returned an empty response.");

  const cleaned = raw
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Style Coach returned invalid JSON.");
  }

  const analysis = String(parsed?.analysis || "").trim();
  const profile = String(parsed?.candidate_profile || "").trim();
  if (!analysis || !profile) {
    throw new Error("Style Coach JSON is missing analysis or candidate_profile.");
  }

  return { analysis, profile, model };
}

function latestPerCase(revisions: any[]) {
  const seen = new Set<string>();
  const latest: any[] = [];
  for (const revision of revisions || []) {
    const caseId = String(revision?.case_id || "");
    if (!caseId || seen.has(caseId)) continue;
    seen.add(caseId);
    latest.push(revision);
  }
  return latest;
}

async function analyze(db: any, ownerId: string) {
  const [revisionsResult, rulesResult, activeStyleResult] = await Promise.all([
    db.from("summary_revisions")
      .select("id, case_id, generated_text, finalized_text, finalized_at")
      .eq("owner_id", ownerId)
      .eq("learning_status", "approved")
      .order("finalized_at", { ascending: false })
      .limit(60),

    db.from("documentation_rules")
      .select("code, category, prompt_text, priority")
      .eq("is_active", true)
      .eq("allow_clinical_inference", false)
      .order("priority", { ascending: false })
      .limit(20),

    db.from("style_profiles")
      .select("id, version, profile_text")
      .eq("owner_id", ownerId)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (revisionsResult.error) throw revisionsResult.error;
  if (rulesResult.error) throw rulesResult.error;
  if (activeStyleResult.error) throw activeStyleResult.error;

  const usable = latestPerCase(revisionsResult.data || []).filter(
    (r: any) =>
      String(r.generated_text || "").trim().length > 0 &&
      String(r.finalized_text || "").trim().length > 0,
  );

  if (usable.length < 5) {
    throw new Error(
      "At least 5 approved distinct Generated → Finalized cases are required for Style Coach.",
    );
  }

  const maturity =
    usable.length >= 20 ? "stable" :
    usable.length >= 10 ? "developing" :
    "early";

  const generated = await generateStyleProfile(
    usable,
    rulesResult.data || [],
    activeStyleResult.data || null,
    maturity,
  );

  const { data: latest, error: latestError } = await db
    .from("style_profiles")
    .select("version")
    .eq("owner_id", ownerId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) throw latestError;

  const nextVersion = Number(latest?.version || 0) + 1;
  const now = new Date().toISOString();

  const { data: inserted, error: insertError } = await db
    .from("style_profiles")
    .insert({
      owner_id: ownerId,
      version: nextVersion,
      profile_text: generated.profile,
      is_active: false,
      source_revision_count: usable.length,
      model: generated.model,
      generated_at: now,
    })
    .select("id, version, profile_text, is_active, source_revision_count, model, generated_at")
    .single();

  if (insertError) throw insertError;

  let coachRun = null;
  let coachWarning = null;
  const { data: runData, error: runError } = await db
    .from("style_coach_runs")
    .insert({
      owner_id: ownerId,
      source_revision_count: usable.length,
      official_rule_count: (rulesResult.data || []).length,
      corpus_maturity: maturity,
      analysis_text: generated.analysis,
      candidate_profile_text: generated.profile,
      candidate_profile_id: inserted.id,
      status: "pending",
      model: generated.model,
      generated_at: now,
    })
    .select("id, source_revision_count, official_rule_count, corpus_maturity, analysis_text, status, generated_at")
    .single();

  if (runError) {
    console.error("Style Coach audit insert failed:", runError);
    coachWarning = "Candidate created, but Style Coach audit history could not be stored.";
  } else {
    coachRun = runData;
  }

  return {
    candidate: inserted,
    coach: coachRun,
    coachWarning,
    requiresApproval: true,
  };
}

async function activate(db: any, ownerId: string, profileId: string) {
  if (!profileId) throw new Error("profileId is required.");

  const { data: owned, error: ownedError } = await db
    .from("style_profiles")
    .select("id, version")
    .eq("id", profileId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (ownedError) throw ownedError;
  if (!owned) throw new Error("Style profile not found.");

  const { error: deactivateError } = await db
    .from("style_profiles")
    .update({ is_active: false })
    .eq("owner_id", ownerId);

  if (deactivateError) throw deactivateError;

  const { data: activated, error: activateError } = await db
    .from("style_profiles")
    .update({ is_active: true })
    .eq("id", profileId)
    .eq("owner_id", ownerId)
    .select("id, version, profile_text, is_active, source_revision_count, model, generated_at")
    .single();

  if (activateError) throw activateError;

  const reviewedAt = new Date().toISOString();
  const { error: coachReviewError } = await db
    .from("style_coach_runs")
    .update({
      status: "accepted",
      reviewed_at: reviewedAt,
    })
    .eq("owner_id", ownerId)
    .eq("candidate_profile_id", profileId)
    .eq("status", "pending");

  if (coachReviewError) {
    console.error("Style Coach acceptance audit failed:", coachReviewError);
  }

  return { activeProfile: activated };
}

async function rejectCandidate(db: any, ownerId: string, profileId: string) {
  if (!profileId) throw new Error("profileId is required.");

  const { data: owned, error: ownedError } = await db
    .from("style_profiles")
    .select("id, version, is_active")
    .eq("id", profileId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (ownedError) throw ownedError;
  if (!owned) throw new Error("Style profile not found.");
  if (owned.is_active) {
    throw new Error("An active style profile cannot be rejected.");
  }

  const reviewedAt = new Date().toISOString();
  const { data: reviewed, error: reviewError } = await db
    .from("style_coach_runs")
    .update({
      status: "rejected",
      reviewed_at: reviewedAt,
    })
    .eq("owner_id", ownerId)
    .eq("candidate_profile_id", profileId)
    .eq("status", "pending")
    .select("id,status,reviewed_at")
    .maybeSingle();

  if (reviewError) throw reviewError;
  if (!reviewed) {
    throw new Error("No pending Style Coach review exists for this candidate.");
  }

  return {
    profileId,
    version: owned.version,
    status: reviewed.status,
    reviewedAt: reviewed.reviewed_at,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const user = await getUser(req);
    const db = serviceClient();
    const body = await req.json();
    const action = String(body?.action || "analyze");

    if (action === "analyze") {
      return json(await analyze(db, user.id));
    }

    if (action === "activate") {
      return json(await activate(db, user.id, String(body?.profileId || "")));
    }

    if (action === "reject") {
      return json(await rejectCandidate(db, user.id, String(body?.profileId || "")));
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json(
      {
        error: error instanceof Error ? error.message : "Style learning failed.",
      },
      500,
    );
  }
});

