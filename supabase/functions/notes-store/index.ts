import { createClient } from "npm:@supabase/supabase-js@2";

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

  const authClient = createClient(
    requireEnv("SUPABASE_URL"),
    supabaseNamedKey("SUPABASE_PUBLISHABLE_KEYS"),
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
    supabaseNamedKey("SUPABASE_SECRET_KEYS"),
    { auth: { persistSession: false } },
  );
}

function normalizeNote(row: any) {
  return {
    id: row.id,
    title: row.title || "",
    content: row.content || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function noteText(input: unknown, maxLength: number, label: string) {
  const value = String(input ?? "");
  if (value.length > maxLength) throw new Error(`${label} is too long.`);
  return value;
}

function validNoteId(input: unknown) {
  const id = String(input || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid note ID.");
  return id;
}

async function listNotes(db: any, ownerId: string) {
  const { data, error } = await db
    .from("notes")
    .select("id, title, content, created_at, updated_at")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return { notes: (data || []).map(normalizeNote) };
}

async function createNote(db: any, ownerId: string, noteInput: any) {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("notes")
    .insert({
      id: crypto.randomUUID(),
      owner_id: ownerId,
      title: noteText(noteInput?.title, 200, "Note title"),
      content: noteText(noteInput?.content, 50000, "Note content"),
      created_at: now,
      updated_at: now,
    })
    .select("id, title, content, created_at, updated_at")
    .single();
  if (error) throw error;
  return { note: normalizeNote(data) };
}

async function updateNote(db: any, ownerId: string, rawNoteId: unknown, noteInput: any) {
  const id = validNoteId(rawNoteId);
  const { data, error } = await db
    .from("notes")
    .update({
      title: noteText(noteInput?.title, 200, "Note title"),
      content: noteText(noteInput?.content, 50000, "Note content"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("id, title, content, created_at, updated_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Note does not belong to authenticated user.");
  return { note: normalizeNote(data) };
}

async function deleteNote(db: any, ownerId: string, rawNoteId: unknown) {
  const id = validNoteId(rawNoteId);
  const { count, error } = await db
    .from("notes")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw error;
  if (count !== 1) throw new Error("Note delete did not remove exactly one note.");
  return { noteId: id, deleted: true, deletedAt: new Date().toISOString() };
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

    if (body?.action === "list_notes") {
      return json(await listNotes(db, user.id));
    }
    if (body?.action === "create_note") {
      return json(await createNote(db, user.id, body.note));
    }
    if (body?.action === "update_note") {
      return json(await updateNote(db, user.id, body.noteId, body.note));
    }
    if (body?.action === "delete_note") {
      return json(await deleteNote(db, user.id, body.noteId));
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "Notes store failed." },
      500,
    );
  }
});
