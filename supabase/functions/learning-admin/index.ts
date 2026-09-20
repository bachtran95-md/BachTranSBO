import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("APP_ORIGIN") || "*";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
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

async function overview(db: any, ownerId: string) {
  const [
    revisionsResult,
    corpusResult,
    approvedCasesResult,
    skillResult,
    profilesResult,
    suggestionsResult,
  ] = await Promise.all([
    db.from("summary_revisions")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId),

    db.from("summary_revisions")
      .select(
        "id, case_id, finalized_text, generated_text, finalized_at, learning_status, learning_note, learning_reviewed_at, model, embedding_model",
      )
      .eq("owner_id", ownerId)
      .order("finalized_at", { ascending: false })
      .limit(20),

    db.from("summary_revisions")
      .select("case_id")
      .eq("owner_id", ownerId)
      .eq("learning_status", "approved")
      .limit(1000),

    db.from("skill_versions")
      .select("id, version, name, is_active, created_at")
      .eq("owner_id", ownerId)
      .eq("is_active", true)
      .maybeSingle(),

    db.from("style_profiles")
      .select(
        "id, version, profile_text, is_active, source_revision_count, model, generated_at, created_at",
      )
      .eq("owner_id", ownerId)
      .order("version", { ascending: false })
      .limit(10),

    db.from("skill_suggestions")
      .select(
        "id, base_skill_version, source_revision_count, suggestion_text, status, model, generated_at, reviewed_at",
      )
      .eq("owner_id", ownerId)
      .order("generated_at", { ascending: false })
      .limit(10),
  ]);

  for (const result of [
    revisionsResult,
    corpusResult,
    approvedCasesResult,
    skillResult,
    profilesResult,
    suggestionsResult,
  ]) {
    if (result.error) throw result.error;
  }

  const corpusRevisions = corpusResult.data || [];
  const approvedCount = corpusRevisions.filter((item: any) => item.learning_status === "approved").length;
  const excludedCount = corpusRevisions.filter((item: any) => item.learning_status === "excluded").length;
  const approvedDistinctCaseCount = new Set(
    (approvedCasesResult.data || [])
      .map((item: any) => String(item.case_id || ""))
      .filter(Boolean),
  ).size;

  return {
    finalizedCount: revisionsResult.count || 0,
    corpusReviewedWindow: corpusRevisions.length,
    corpusApprovedInWindow: approvedCount,
    corpusExcludedInWindow: excludedCount,
    approvedDistinctCaseCount,
    corpusRevisions,
    activeSkill: skillResult.data || null,
    styleProfiles: profilesResult.data || [],
    skillSuggestions: suggestionsResult.data || [],
  };
}

async function reviewRevision(
  db: any,
  ownerId: string,
  revisionId: string,
  decision: string,
  noteInput: unknown,
) {
  if (!/^[0-9a-f-]{36}$/i.test(revisionId)) {
    throw new Error("Invalid corpus revision.");
  }
  if (!["approved", "excluded"].includes(decision)) {
    throw new Error("Invalid corpus review decision.");
  }

  const note = String(noteInput || "").trim().slice(0, 1000);
  const reviewedAt = new Date().toISOString();

  const { data, error } = await db
    .from("summary_revisions")
    .update({
      learning_status: decision,
      learning_note: note || null,
      learning_reviewed_at: reviewedAt,
    })
    .eq("id", revisionId)
    .eq("owner_id", ownerId)
    .select("id,learning_status,learning_note,learning_reviewed_at")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Corpus revision not found.");

  return {
    revisionId: data.id,
    learningStatus: data.learning_status,
    learningNote: data.learning_note,
    reviewedAt: data.learning_reviewed_at,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const user = await getUser(req);
    const db = serviceClient();
    const body = await req.json();
    const action = String(body?.action || "overview");

    if (action === "overview") {
      return json(await overview(db, user.id));
    }

    if (action === "review_revision") {
      return json(
        await reviewRevision(
          db,
          user.id,
          String(body?.revisionId || ""),
          String(body?.decision || ""),
          body?.note,
        ),
      );
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json(
      {
        error:
          error instanceof Error ? error.message : "Learning admin failed.",
      },
      500,
    );
  }
});
