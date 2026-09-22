import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("APP_ORIGIN") || "*";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function namedKey(variableName: string): string {
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

async function authenticatedOwner(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization) throw new Error("Missing Authorization header.");

  const authClient = createClient(
    requireEnv("SUPABASE_URL"),
    namedKey("SUPABASE_PUBLISHABLE_KEYS"),
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    },
  );

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
    namedKey("SUPABASE_SECRET_KEYS"),
    { auth: { persistSession: false } },
  );
}

function normalizePhrase(value: unknown) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("hu-HU")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:]+$/g, "")
    .trim();
}

function cleanText(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

function cleanFindingKey(value: unknown) {
  const key = cleanText(value, 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(key)) {
    throw new Error("Invalid finding key.");
  }
  return key;
}

function cleanAttributes(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function counts(db: ReturnType<typeof serviceClient>, ownerId: string) {
  const [learning, candidates] = await Promise.all([
    db
      .from("finding_learning_records")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("status", "approved"),
    db
      .from("finding_registry_candidates")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("state", "pending"),
  ]);

  if (learning.error) throw learning.error;
  if (candidates.error) throw candidates.error;

  return {
    approvedLearning: learning.count || 0,
    pendingCandidates: candidates.count || 0,
  };
}

async function loadRegistry(db: ReturnType<typeof serviceClient>, ownerId: string) {
  const { data, error } = await db
    .from("finding_learning_records")
    .select(
      "id, source_phrase, normalized_phrase, mapping_kind, finding_key, canonical_label, target, section, output_text, conflict_text, attributes, created_at",
    )
    .eq("owner_id", ownerId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) throw error;

  const seen = new Set<string>();
  const records = [];
  for (const row of data || []) {
    const signature = `${row.normalized_phrase}::${row.finding_key}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    records.push({
      id: row.id,
      sourcePhrase: row.source_phrase,
      normalizedPhrase: row.normalized_phrase,
      mappingKind: row.mapping_kind,
      findingKey: row.finding_key,
      canonicalLabel: row.canonical_label,
      target: row.target,
      section: row.section,
      outputText: row.output_text,
      conflictText: row.conflict_text,
      attributes: row.attributes || {},
      createdAt: row.created_at,
    });
  }
  return records;
}

async function pendingPatch(db: ReturnType<typeof serviceClient>, ownerId: string) {
  const { data, error } = await db
    .from("finding_registry_candidates")
    .select(
      "id, normalized_phrase, sample_phrase, mapping_kind, finding_key, canonical_label, target, section, output_text, conflict_text, attributes, confirmations, first_confirmed_at, last_confirmed_at, built_at",
    )
    .eq("owner_id", ownerId)
    .eq("state", "pending")
    .order("confirmations", { ascending: false })
    .order("last_confirmed_at", { ascending: false })
    .limit(1000);

  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    alias: row.normalized_phrase,
    sample: row.sample_phrase,
    mappingKind: row.mapping_kind,
    findingKey: row.finding_key,
    canonicalLabel: row.canonical_label,
    target: row.target,
    section: row.section,
    outputText: row.output_text,
    conflictText: row.conflict_text,
    attributes: row.attributes || {},
    confirmations: row.confirmations,
    firstConfirmedAt: row.first_confirmed_at,
    lastConfirmedAt: row.last_confirmed_at,
    builtAt: row.built_at,
  }));
}

async function maybeBuildThreshold(
  db: ReturnType<typeof serviceClient>,
  ownerId: string,
) {
  const { data: newestCandidate, error: newestError } = await db
    .from("finding_registry_candidates")
    .select("built_at")
    .eq("owner_id", ownerId)
    .order("built_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (newestError) throw newestError;

  let query = db
    .from("finding_learning_records")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("status", "approved");

  if (newestCandidate?.built_at) {
    query = query.gt("created_at", newestCandidate.built_at);
  }

  const { count, error } = await query;
  if (error) throw error;

  if ((count || 0) < 10) {
    return { built: false, newLearningSinceBuild: count || 0 };
  }

  const result = await db.rpc("build_finding_registry_candidates");
  if (result.error) throw result.error;
  return {
    built: true,
    newLearningSinceBuild: count || 0,
    pendingCandidates: Number(result.data || 0),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const user = await authenticatedOwner(req);
    const db = serviceClient();
    const body = await req.json().catch(() => ({}));
    const action = cleanText(body?.action, 64);

    if (action === "load_registry") {
      const [records, overview] = await Promise.all([
        loadRegistry(db, user.id),
        counts(db, user.id),
      ]);
      return json({ records, overview });
    }

    if (action === "overview") {
      const overview = await counts(db, user.id);
      return json({ overview });
    }

    if (action === "confirm_mapping") {
      const sourcePhrase = cleanText(body?.sourcePhrase, 500);
      const normalizedPhrase = normalizePhrase(sourcePhrase);
      if (!normalizedPhrase) throw new Error("Missing finding phrase.");

      const mappingKind = body?.mappingKind === "new" ? "new" : "existing";
      const findingKey = cleanFindingKey(body?.findingKey);
      const canonicalLabel = cleanText(body?.canonicalLabel, 180);
      const target = cleanText(body?.target, 64);
      const section = cleanText(body?.section, 8).toUpperCase();
      const outputText = cleanText(body?.outputText, 1000);
      const conflictText = cleanText(body?.conflictText, 500);
      const attributes = cleanAttributes(body?.attributes);

      if (mappingKind === "new") {
        if (!canonicalLabel) throw new Error("New finding requires a label.");
        if (!target) throw new Error("New finding requires a target.");
        if (!["A", "B", "C", "D", "E"].includes(section)) {
          throw new Error("New finding requires an ABCDE section.");
        }
        if (!outputText) throw new Error("New finding requires output text.");
      }

      const { data, error } = await db
        .from("finding_learning_records")
        .insert({
          owner_id: user.id,
          source_phrase: sourcePhrase,
          normalized_phrase: normalizedPhrase,
          mapping_kind: mappingKind,
          finding_key: findingKey,
          canonical_label: canonicalLabel,
          target,
          section,
          output_text: outputText,
          conflict_text: conflictText,
          attributes,
          status: "approved",
          updated_at: new Date().toISOString(),
        })
        .select(
          "id, source_phrase, normalized_phrase, mapping_kind, finding_key, canonical_label, target, section, output_text, conflict_text, attributes, created_at",
        )
        .single();

      if (error) throw error;
      const threshold = await maybeBuildThreshold(db, user.id);
      const overview = await counts(db, user.id);

      return json({
        record: {
          id: data.id,
          sourcePhrase: data.source_phrase,
          normalizedPhrase: data.normalized_phrase,
          mappingKind: data.mapping_kind,
          findingKey: data.finding_key,
          canonicalLabel: data.canonical_label,
          target: data.target,
          section: data.section,
          outputText: data.output_text,
          conflictText: data.conflict_text,
          attributes: data.attributes || {},
          createdAt: data.created_at,
        },
        threshold,
        overview,
      });
    }

    if (action === "undo_learning") {
      const learningId = cleanText(body?.learningId, 80);
      if (!learningId) throw new Error("Missing learning record.");

      const { data, error } = await db
        .from("finding_learning_records")
        .update({
          status: "reverted",
          updated_at: new Date().toISOString(),
        })
        .eq("id", learningId)
        .eq("owner_id", user.id)
        .eq("status", "approved")
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Learning record was not found or already reverted.");

      const result = await db.rpc("build_finding_registry_candidates");
      if (result.error) throw result.error;

      const overview = await counts(db, user.id);
      return json({ reverted: learningId, overview });
    }

    if (action === "build_candidates") {
      const result = await db.rpc("build_finding_registry_candidates");
      if (result.error) throw result.error;
      const [patch, overview] = await Promise.all([
        pendingPatch(db, user.id),
        counts(db, user.id),
      ]);
      return json({ patch, overview });
    }

    if (action === "candidate_patch") {
      const [patch, overview] = await Promise.all([
        pendingPatch(db, user.id),
        counts(db, user.id),
      ]);
      return json({
        generatedAt: new Date().toISOString(),
        registryPatchVersion: 1,
        patch,
        overview,
      });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "Unknown error." },
      400,
    );
  }
});
