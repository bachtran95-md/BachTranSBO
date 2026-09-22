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


function clamp(value: unknown, max = 3500) {
  const text = String(value ?? "").trim();
  return text.length <= max ? text : text.slice(0, max) + "…";
}

async function generateSuggestion(skill: any, revisions: any[]) {
  const model = Deno.env.get("SKILL_ANALYSIS_MODEL") || "gpt-5.6-luna";

  const pairs = revisions.map((r, index) => [
    `PAIR ${index + 1}`,
    "Generated draft:",
    clamp(r.generated_text),
    "Doctor-finalized:",
    clamp(r.finalized_text),
  ].join("\n")).join("\n\n");

  const prompt = [
    "You are auditing an SBO clinical documentation Skill against repeated doctor edits.",
    "Identify ONLY recurring DOCUMENTATION-RULE problems that may justify changing the master Skill.",
    "Do NOT include ordinary personal writing-style preferences; those belong to a separate style profile.",
    "Do NOT make clinical recommendations, diagnose cases, judge treatment, or infer patient-specific facts.",
    "Do NOT quote or preserve unique patient facts, ages, dates, institutions, medications, laboratory values, or case details.",
    "Prefer no suggestion over a weak or one-off suggestion.",
    "The output is advisory only and will NOT be applied automatically.",
    "",
    "Return concise plain text with:",
    "1. Repeated issue",
    "2. Evidence pattern in abstract terms",
    "3. Suggested Skill rule change",
    "4. Confidence: low / medium / high",
    "",
    "=== ACTIVE SKILL ===",
    skill.instructions,
    "",
    "=== GENERATED -> FINALIZED PAIRS ===",
    pairs,
  ].join("\n");

  const payload = await callResponses({
    model,
    input: prompt,
    max_output_tokens: 8000,
    prompt_cache_key: "bachtransbo-analyze-skill-v1",
  });

  const suggestion = responseText(payload);
  if (!suggestion) throw new Error("Skill analysis returned no suggestion.");

  return { suggestion, model };
}

async function analyze(db: any, ownerId: string) {
  const { data: skill, error: skillError } = await db
    .from("skill_versions")
    .select("version, instructions")
    .eq("owner_id", ownerId)
    .eq("is_active", true)
    .maybeSingle();

  if (skillError) throw skillError;
  if (!skill) throw new Error("No active SBO Documentation Skill is configured.");

  const { data: revisions, error: revisionsError } = await db
    .from("summary_revisions")
    .select("generated_text, finalized_text, finalized_at")
    .eq("owner_id", ownerId)
    .order("finalized_at", { ascending: false })
    .limit(40);

  if (revisionsError) throw revisionsError;

  const usable = (revisions || []).filter(
    (r: any) =>
      String(r.generated_text || "").trim().length > 0 &&
      String(r.finalized_text || "").trim().length > 0,
  );

  if (usable.length < 10) {
    throw new Error(
      "At least 10 Generated → Finalized pairs are required for Skill suggestions.",
    );
  }

  const generated = await generateSuggestion(skill, usable);

  const { data: inserted, error: insertError } = await db
    .from("skill_suggestions")
    .insert({
      owner_id: ownerId,
      base_skill_version: Number(skill.version),
      source_revision_count: usable.length,
      suggestion_text: generated.suggestion,
      status: "pending",
      model: generated.model,
      generated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (insertError) throw insertError;

  return {
    suggestion: inserted,
    requiresApproval: true,
    changesSkillAutomatically: false,
  };
}

async function review(
  db: any,
  ownerId: string,
  suggestionId: string,
  decision: string,
) {
  if (!suggestionId) throw new Error("suggestionId is required.");
  if (!["accepted", "rejected"].includes(decision)) {
    throw new Error("Decision must be accepted or rejected.");
  }

  const { data: existing, error: existingError } = await db
    .from("skill_suggestions")
    .select("id, status")
    .eq("id", suggestionId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (!existing) throw new Error("Skill suggestion not found.");
  if (existing.status !== "pending") {
    throw new Error("Only pending suggestions can be reviewed.");
  }

  const { data, error } = await db
    .from("skill_suggestions")
    .update({
      status: decision,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", suggestionId)
    .eq("owner_id", ownerId)
    .select("*")
    .single();

  if (error) throw error;

  return {
    suggestion: data,
    note:
      decision === "accepted"
        ? "Accepted for human follow-up. No Skill version was changed automatically."
        : "Suggestion rejected. No Skill version was changed.",
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

    if (action === "review") {
      return json(
        await review(
          db,
          user.id,
          String(body?.suggestionId || ""),
          String(body?.decision || ""),
        ),
      );
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json(
      {
        error:
          error instanceof Error ? error.message : "Skill suggestion failed.",
      },
      500,
    );
  }
});

