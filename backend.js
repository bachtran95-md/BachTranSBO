(() => {
  "use strict";

  let client = null;

  function config() {
    return window.BACH_SBO_CONFIG || {};
  }

  function isConfigured() {
    const c = config();
    return Boolean(
      c.supabaseUrl &&
      c.supabasePublishableKey &&
      c.adminEmail &&
      !c.supabaseUrl.includes("YOUR_PROJECT") &&
      !c.supabasePublishableKey.includes("YOUR_PUBLISHABLE_KEY")
    );
  }

  function requireClient() {
    if (!client) throw new Error("Supabase backend is not initialized.");
    return client;
  }

  function assertOk(error, context) {
    if (error) {
      const err = new Error(`${context}: ${error.message || "Unknown Supabase error"}`);
      err.cause = error;
      throw err;
    }
  }

  async function init() {
    if (!isConfigured()) {
      return { configured: false, session: null };
    }

    if (!window.supabase?.createClient) {
      throw new Error("Supabase JavaScript client failed to load.");
    }

    const c = config();
    client = window.supabase.createClient(
      c.supabaseUrl,
      c.supabasePublishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    const { data, error } = await client.auth.getSession();
    assertOk(error, "Get auth session");

    return { configured: true, session: data.session };
  }

  async function getSession() {
    const { data, error } = await requireClient().auth.getSession();
    assertOk(error, "Get auth session");
    return data.session;
  }

  async function getUser() {
    const { data, error } = await requireClient().auth.getUser();
    assertOk(error, "Get authenticated user");
    if (!data.user) throw new Error("Not authenticated.");
    return data.user;
  }

  async function signInWithPassword(password) {
    const email = config().adminEmail;
    if (!email) throw new Error("Admin email is not configured.");
    if (!password) throw new Error("Password is required.");

    const { data, error } = await requireClient().auth.signInWithPassword({
      email,
      password
    });

    assertOk(error, "Admin sign in");
    if (!data.session) throw new Error("No authenticated session returned.");
    return data.session;
  }

  async function changeAdminPassword(currentPassword, newPassword) {
    const email = config().adminEmail;
    if (!email) throw new Error("Admin email is not configured.");
    if (!currentPassword) throw new Error("Current password is required.");
    if (!newPassword) throw new Error("New password is required.");

    // Verify the current password first and refresh the authenticated session.
    const { error: verifyError } =
      await requireClient().auth.signInWithPassword({
        email,
        password: currentPassword
      });
    assertOk(verifyError, "Verify current password");

    const { data, error: updateError } =
      await requireClient().auth.updateUser({
        password: newPassword
      });
    assertOk(updateError, "Change admin password");

    return data.user;
  }

  async function signOut() {
    const { error } = await requireClient().auth.signOut();
    assertOk(error, "Sign out");
  }

  function blankEntry(type = "") {
    return {
      id: crypto.randomUUID(),
      type,
      mode: "waiting",
      text: "",
      savedText: "",
      bodyPart: "",
      modality: "",
      otherTest: ""
    };
  }

  function rowToEntry(row, defaultType = "") {
    if (!row) return blankEntry(defaultType);
    return {
      id: row.id,
      type: row.subtype || defaultType,
      mode: row.mode || "waiting",
      text: row.result_text || "",
      savedText: row.saved_result_text || "",
      bodyPart: row.body_part || "",
      modality: row.modality || "",
      otherTest: row.other_test || ""
    };
  }

  async function getActiveShift() {
    const db = requireClient();
    const { data, error } = await db
      .from("shifts")
      .select("id, started_at, status")
      .eq("status", "active")
      .maybeSingle();

    assertOk(error, "Load active shift");
    return data;
  }

  async function startShift() {
    const db = requireClient();
    const user = await getUser();

    const existing = await getActiveShift();
    if (existing) {
      return {
        id: existing.id,
        startedAt: existing.started_at,
        status: existing.status
      };
    }

    const row = {
      id: crypto.randomUUID(),
      owner_id: user.id,
      started_at: new Date().toISOString(),
      status: "active"
    };

    const { data, error } = await db
      .from("shifts")
      .insert(row)
      .select("id, started_at, status")
      .single();

    if (error) {
      // A partial unique index permits only one ACTIVE shift per owner.
      // If another device won the race, recover the existing shift.
      const active = await getActiveShift();
      if (active) {
        return {
          id: active.id,
          startedAt: active.started_at,
          status: active.status
        };
      }
      assertOk(error, "Start shift");
    }

    return {
      id: data.id,
      startedAt: data.started_at,
      status: data.status
    };
  }

  async function closeShift(shiftId) {
    const { error } = await requireClient()
      .from("shifts")
      .update({
        status: "closed",
        ended_at: new Date().toISOString()
      })
      .eq("id", shiftId);

    assertOk(error, "Close shift");
  }

  async function loadState() {
    const db = requireClient();
    await getUser();

    const shiftRow = await getActiveShift();
    if (!shiftRow) {
      return { shift: null, patients: [], references: [] };
    }

    const { data: caseRows, error: caseError } = await db
      .from("cases")
      .select("*")
      .eq("shift_id", shiftRow.id)
      .order("created_at", { ascending: true });

    assertOk(caseError, "Load cases");

    const caseIds = (caseRows || []).map((x) => x.id);
    let testRows = [];
    let summaryRows = [];

    if (caseIds.length) {
      const testsResult = await db
        .from("test_entries")
        .select("*")
        .in("case_id", caseIds)
        .order("sequence", { ascending: true });

      assertOk(testsResult.error, "Load test entries");
      testRows = testsResult.data || [];

      const summariesResult = await db
        .from("summaries")
        .select("*")
        .in("case_id", caseIds);

      assertOk(summariesResult.error, "Load summaries");
      summaryRows = summariesResult.data || [];
    }

    const testsByCase = new Map();
    for (const row of testRows) {
      if (!testsByCase.has(row.case_id)) testsByCase.set(row.case_id, []);
      testsByCase.get(row.case_id).push(row);
    }

    const summariesByCase = new Map(
      summaryRows.map((row) => [row.case_id, row])
    );

    const patients = (caseRows || []).map((row) => {
      const rows = testsByCase.get(row.id) || [];
      const byCategory = (category) =>
        rows.filter((x) => x.category === category)
          .sort((a, b) => a.sequence - b.sequence);

      const labs = byCategory("lab").map((x) => rowToEntry(x));
      const radiology = byCategory("radiology").map((x) => rowToEntry(x));
      const consultations = byCategory("consultation").map((x) => rowToEntry(x));
      const ekg = byCategory("ekg")[0];
      const gas = byCategory("gas")[0];
      const summary = summariesByCase.get(row.id);

      return {
        id: row.id,
        shiftId: row.shift_id,
        localId: row.local_id,
        sex: row.sex || "",
        yob: row.year_of_birth ? String(row.year_of_birth) : "",
        mainComplaint: row.main_complaint || "",
        complaint: row.complaint || "",
        complaintSkipped: Boolean(row.complaint_skipped),
        history: row.history || "",
        historySkipped: Boolean(row.history_skipped),
        physical: row.physical_exam || "",
        physicalSkipped: Boolean(row.physical_exam_skipped),
        diagnoses: row.diagnoses || "",
        tests: {
          labs: labs.length ? labs : [blankEntry()],
          ekg: rowToEntry(ekg),
          gas: rowToEntry(gas),
          radiology: radiology.length ? radiology : [blankEntry("")],
          consultations: consultations.length ? consultations : [blankEntry("")]
        },
        others: row.others || "",
        therapy: row.therapy || "",
        therapySkipped: Boolean(row.therapy_skipped),
        course: row.clinical_course || "",
        courseSkipped: Boolean(row.clinical_course_skipped),
        disposition: row.disposition || "",
        recommendations: Array.isArray(row.recommendations)
          ? row.recommendations
          : [""],
        hospital: row.hospital || "",
        ward: row.ward || "",
        physician: row.accepting_physician || "",
        admissionNote: row.admission_note || "",
        otherOutcome: row.other_outcome || "",
        otherDetails: row.other_details || "",
        summary: summary?.working_text || summary?.generated_text || "",
        summaryGeneratedText: summary?.generated_text || "",
        summaryGeneratedAt: summary?.generated_at || null,
        summaryFinalizedText: summary?.finalized_text || "",
        summaryFinalizedAt: summary?.finalized_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });

    return {
      shift: {
        id: shiftRow.id,
        startedAt: shiftRow.started_at,
        status: shiftRow.status
      },
      patients,
      references: []
    };
  }

  async function invokeAuthedFunction(name, body, label) {
    const session = await getSession();
    if (!session?.access_token) throw new Error("Not authenticated.");

    const { data, error } = await requireClient().functions.invoke(
      name,
      {
        body,
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      }
    );

    if (error) {
      let serverMessage = "";
      try {
        const response = error.context;
        if (response && typeof response.clone === "function") {
          const payload = await response.clone().json();
          serverMessage = String(payload?.error || payload?.message || "");
        }
      } catch {
        // Fall back to the SDK-level error message below.
      }

      throw new Error(
        `${label} failed: ${serverMessage || error.message || "Unknown error"}`
      );
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    return data;
  }

  async function saveState(state) {
    if (!state?.shift) return { removed: 0, report: null };

    return invokeAuthedFunction(
      "clinical-store",
      {
        action: "save_state",
        state
      },
      "Clinical privacy service"
    );
  }

  async function savePatient(shiftId, patient) {
    if (!shiftId || !patient) return { removed: 0, report: null };

    return invokeAuthedFunction(
      "clinical-store",
      {
        action: "save_patient",
        shiftId,
        patient
      },
      "Clinical privacy service"
    );
  }

  async function finalizePatient(shiftId, patient) {
    if (!shiftId || !patient?.summaryFinalizedAt || !patient.summaryFinalizedText) {
      throw new Error("Finalized case payload is incomplete.");
    }

    return invokeAuthedFunction(
      "clinical-store",
      {
        action: "finalize_patient",
        shiftId,
        patient
      },
      "Atomic clinical finalization"
    );
  }

  async function reopenCase(shiftId, caseId) {
    if (!shiftId || !caseId) throw new Error("Case reopen payload is incomplete.");

    return invokeAuthedFunction(
      "clinical-store",
      {
        action: "reopen_case",
        shiftId,
        caseId
      },
      "Case reopen"
    );
  }

  async function appendSummaryRevision(patient) {
    if (!patient?.summaryFinalizedAt || !patient.summaryFinalizedText) {
      return { removed: 0, report: null };
    }

    return invokeAuthedFunction(
      "clinical-store",
      {
        action: "append_revision",
        patient
      },
      "Finalized corpus save"
    );
  }

  async function generateSummary(caseId) {
    if (!caseId) throw new Error("Missing case ID.");

    return invokeAuthedFunction(
      "generate-summary",
      { caseId },
      "Summary generation"
    );
  }

  async function caseAssistantSuggest(patient) {
    if (!patient?.id) throw new Error("A saved case is required.");

    return invokeAuthedFunction(
      "case-assistant",
      {
        action: "suggest",
        caseId: patient.id,
        patient
      },
      "Case Assistant"
    );
  }

  async function caseAssistantExtract(caseId, text) {
    if (!caseId) throw new Error("A saved case is required.");
    if (!String(text || "").trim()) throw new Error("Paste text to analyze.");

    return invokeAuthedFunction(
      "case-assistant",
      {
        action: "extract",
        caseId,
        text: String(text)
      },
      "Case Assistant extraction"
    );
  }

  async function getLearningOverview() {
    return invokeAuthedFunction(
      "learning-admin",
      { action: "overview" },
      "AI Learning overview"
    );
  }

  async function analyzeStyle() {
    return invokeAuthedFunction(
      "analyze-style",
      { action: "analyze" },
      "Style analysis"
    );
  }

  async function activateStyle(profileId) {
    return invokeAuthedFunction(
      "analyze-style",
      { action: "activate", profileId },
      "Style activation"
    );
  }

  async function analyzeSkill() {
    return invokeAuthedFunction(
      "analyze-skill",
      { action: "analyze" },
      "Skill analysis"
    );
  }

  async function reviewSkillSuggestion(suggestionId, decision) {
    return invokeAuthedFunction(
      "analyze-skill",
      { action: "review", suggestionId, decision },
      "Skill suggestion review"
    );
  }

  window.BachSBOBackend = {
    init,
    isConfigured,
    getSession,
    getUser,
    signInWithPassword,
    changeAdminPassword,
    signOut,
    startShift,
    closeShift,
    loadState,
    saveState,
    savePatient,
    finalizePatient,
    reopenCase,
    appendSummaryRevision,
    generateSummary,
    caseAssistantSuggest,
    caseAssistantExtract,
    getLearningOverview,
    analyzeStyle,
    activateStyle,
    analyzeSkill,
    reviewSkillSuggestion
  };
})();
