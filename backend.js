(() => {
  "use strict";

  let client = null;
  const PASSWORD_REAUTH_INTERVAL_MS = 60 * 60 * 1000;
  const PASSWORD_REAUTH_STORAGE_PREFIX = "bach_sbo_password_reauth_at_v1:";

  function passwordReauthKey(userId) {
    return PASSWORD_REAUTH_STORAGE_PREFIX + String(userId || "unknown");
  }

  function markPasswordAuthenticated(userId, authenticatedAt = Date.now()) {
    if (!userId) throw new Error("Missing authenticated user ID.");
    localStorage.setItem(passwordReauthKey(userId), String(authenticatedAt));
  }

  function clearPasswordAuthentication(userId) {
    if (!userId) return;
    localStorage.removeItem(passwordReauthKey(userId));
  }

  function getPasswordReauthStatus(userId, now = Date.now()) {
    if (!userId) {
      return {
        required: true,
        authenticatedAt: null,
        expiresAt: null,
        remainingMs: 0,
        intervalMs: PASSWORD_REAUTH_INTERVAL_MS
      };
    }

    const raw = localStorage.getItem(passwordReauthKey(userId));
    const authenticatedAt = Number(raw);
    const validTimestamp =
      Number.isFinite(authenticatedAt) &&
      authenticatedAt > 0 &&
      authenticatedAt <= now + 60_000;
    const expiresAt = validTimestamp
      ? authenticatedAt + PASSWORD_REAUTH_INTERVAL_MS
      : null;
    const remainingMs = expiresAt ? Math.max(0, expiresAt - now) : 0;

    return {
      required: !validTimestamp || remainingMs <= 0,
      authenticatedAt: validTimestamp ? authenticatedAt : null,
      expiresAt,
      remainingMs,
      intervalMs: PASSWORD_REAUTH_INTERVAL_MS
    };
  }

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

    let session = data.session;
    let reauthRequired = false;

    if (session?.user?.id) {
      const reauth = getPasswordReauthStatus(session.user.id);
      if (reauth.required) {
        clearPasswordAuthentication(session.user.id);
        const { error: signOutError } = await client.auth.signOut({ scope: "local" });
        assertOk(signOutError, "Expire password authentication");
        session = null;
        reauthRequired = true;
      }
    }

    return { configured: true, session, reauthRequired };
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
    markPasswordAuthenticated(data.session.user.id);
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
    if (data.user?.id) markPasswordAuthenticated(data.user.id);

    return data.user;
  }

  async function requirePasswordReauth(userId) {
    clearPasswordAuthentication(userId);
    const { error } = await requireClient().auth.signOut({ scope: "local" });
    assertOk(error, "Expire password authentication");
  }

  async function signOut() {
    const session = await getSession();
    if (session?.user?.id) clearPasswordAuthentication(session.user.id);
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
      .select("id, started_at, status, next_case_number")
      .eq("status", "active")
      .maybeSingle();

    assertOk(error, "Load active shift");
    return data;
  }

  async function getShiftCaseCounter(shiftId) {
    if (!shiftId) throw new Error("Missing shift ID.");

    const shift = await getActiveShift();
    if (!shift || shift.id !== shiftId) {
      throw new Error("Active shift changed.");
    }

    const nextCaseNumber = Number(shift.next_case_number || 1);
    return {
      shiftId: shift.id,
      nextCaseNumber,
      localId: String(nextCaseNumber).padStart(2, "0")
    };
  }

  async function startShift() {
    const db = requireClient();
    const user = await getUser();

    const existing = await getActiveShift();
    if (existing) {
      return {
        id: existing.id,
        startedAt: existing.started_at,
        status: existing.status,
        nextCaseNumber: Number(existing.next_case_number || 1)
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
      .select("id, started_at, status, next_case_number")
      .single();

    if (error) {
      // A partial unique index permits only one ACTIVE shift per owner.
      // If another device won the race, recover the existing shift.
      const active = await getActiveShift();
      if (active) {
        return {
          id: active.id,
          startedAt: active.started_at,
          status: active.status,
          nextCaseNumber: Number(active.next_case_number || 1)
        };
      }
      assertOk(error, "Start shift");
    }

    return {
      id: data.id,
      startedAt: data.started_at,
      status: data.status,
      nextCaseNumber: Number(data.next_case_number || 1)
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

  async function saveStatusGeneratorRecords(records) {
    const list = Array.isArray(records)
      ? records.filter((record) => record?.caseId && record?.shiftId && record?.payload)
      : [];

    if (!list.length) return { saved: 0 };

    return invokeAuthedFunction(
      "clinical-store",
      {
        action: "save_status_generator_records",
        records: list
      },
      "Save finalized Státusz"
    );
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
      const ekgs = byCategory("ekg").map((x) => rowToEntry(x));
      const gases = byCategory("gas").map((x) => rowToEntry(x));
      const summary = summariesByCase.get(row.id);

      return {
        id: row.id,
        shiftId: row.shift_id,
        localId: row.local_id,
        sex: row.sex || "",
        yob: row.year_of_birth ? String(row.year_of_birth) : "",
        arrivalMode: row.arrival_mode || "",
        arrivalOther: row.arrival_other || "",
        triageStatus: row.triage_status || "",
        mainComplaint: row.main_complaint || "",
        complaint: row.complaint || "",
        complaintSkipped: Boolean(row.complaint_skipped),
        history: row.history || "",
        historySkipped: Boolean(row.history_skipped),
        physical: row.physical_exam || "",
        physicalSkipped: Boolean(row.physical_exam_skipped),
        statusExplicitNormals: Array.isArray(row.status_explicit_normals)
          ? row.status_explicit_normals
          : [],
        physicalStatus:
          row.physical_status_data &&
          typeof row.physical_status_data === "object" &&
          Number(row.physical_status_data.version) === 1
            ? row.physical_status_data
            : null,
        diagnoses: row.diagnoses || "",
        diagnosesSkipped: Boolean(row.diagnoses_skipped),
        tests: {
          labs: labs.length ? labs : [blankEntry()],
          ekgs: ekgs.length ? ekgs : [blankEntry("EKG")],
          gases: gases.length ? gases : [blankEntry("AVG")],
          radiology: radiology.length ? radiology : [blankEntry("")],
          consultations: consultations.length ? consultations : [blankEntry("")]
        },
        others: row.others || "",
        therapy: row.therapy || "",
        therapySkipped: Boolean(row.therapy_skipped),
        course: row.clinical_course || "",
        courseSkipped: Boolean(row.clinical_course_skipped),
        disposition: row.disposition || "",
        dischargeCondition: row.discharge_condition || "",
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
        status: shiftRow.status,
        nextCaseNumber: Number(shiftRow.next_case_number || 1)
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

  async function allocateCaseLocalId(shiftId) {
    if (!shiftId) throw new Error("Missing shift ID.");

    return invokeAuthedFunction(
      "clinical-store",
      {
        action: "allocate_case_id",
        shiftId
      },
      "Case ID allocation"
    );
  }

  async function savePatient(shiftId, patient) {
    if (!shiftId || !patient) return { removed: 0, report: null };

    // Snapshot immediately. invokeAuthedFunction awaits auth before sending,
    // so passing a live mutable object can otherwise serialize newer/older
    // form state than the caller intended.
    const patientSnapshot = structuredClone(patient);

    return invokeAuthedFunction(
      "clinical-store",
      {
        action: "save_patient",
        shiftId,
        patient: patientSnapshot
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

  async function deleteCase(caseId) {
    if (!caseId) throw new Error("Missing case ID.");

    return invokeAuthedFunction(
      "clinical-store",
      {
        action: "delete_case",
        caseId
      },
      "Case delete"
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

  async function caseAssistantGetState(patient) {
    if (!patient?.id) throw new Error("A saved case is required.");

    return invokeAuthedFunction(
      "case-assistant",
      {
        action: "get_state",
        caseId: patient.id,
        patient
      },
      "Case Assistant state"
    );
  }

  async function caseAssistantDecide(caseId, itemId, decision) {
    if (!caseId || !itemId) throw new Error("Missing Case Assistant item.");
    return invokeAuthedFunction(
      "case-assistant",
      {
        action: "decide",
        caseId,
        itemId,
        decision
      },
      "Case Assistant decision"
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

  async function findingLearningLoadRegistry() {
    return invokeAuthedFunction(
      "finding-learning",
      { action: "load_registry" },
      "Finding learning registry"
    );
  }

  async function findingLearningSuggest(sourcePhrase) {
    const phrase = String(sourcePhrase || "").trim();
    if (!phrase) throw new Error("Missing unknown finding phrase.");
    return invokeAuthedFunction(
      "finding-learning",
      { action: "suggest_mapping", sourcePhrase: phrase },
      "Finding AI suggestion"
    );
  }

  async function findingLearningConfirmMapping(mapping) {
    if (!mapping?.sourcePhrase || !mapping?.findingKey) {
      throw new Error("Finding learning mapping is incomplete.");
    }
    return invokeAuthedFunction(
      "finding-learning",
      {
        action: "confirm_mapping",
        sourcePhrase: String(mapping.sourcePhrase),
        mappingKind: mapping.mappingKind === "new" ? "new" : "existing",
        findingKey: String(mapping.findingKey),
        canonicalLabel: String(mapping.canonicalLabel || ""),
        target: String(mapping.target || ""),
        section: String(mapping.section || ""),
        outputText: String(mapping.outputText || ""),
        conflictText: String(mapping.conflictText || ""),
        attributes: mapping.attributes && typeof mapping.attributes === "object"
          ? mapping.attributes
          : {}
      },
      "Finding learning save"
    );
  }

  async function findingLearningUndo(learningId) {
    if (!learningId) throw new Error("Missing learning record.");
    return invokeAuthedFunction(
      "finding-learning",
      { action: "undo_learning", learningId: String(learningId) },
      "Finding learning undo"
    );
  }

  async function findingLearningBuildCandidates() {
    return invokeAuthedFunction(
      "finding-learning",
      { action: "build_candidates" },
      "Finding candidate build"
    );
  }

  async function findingLearningCandidatePatch() {
    return invokeAuthedFunction(
      "finding-learning",
      { action: "candidate_patch" },
      "Finding candidate patch"
    );
  }

  async function loadRawTransferWorkspace() {
    const db = requireClient();
    const user = await getUser();
    const shiftRow = await getActiveShift();

    if (!shiftRow) {
      return { shift: null, cases: [] };
    }

    const { data, error } = await db
      .from("cases")
      .select("id, local_id, sex, year_of_birth, main_complaint, status, created_at, updated_at")
      .eq("shift_id", shiftRow.id)
      .eq("owner_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    assertOk(error, "Load raw transfer cases");

    return {
      shift: {
        id: shiftRow.id,
        startedAt: shiftRow.started_at,
        status: shiftRow.status
      },
      cases: (data || []).map((row) => ({
        id: row.id,
        localId: row.local_id,
        sex: row.sex || "",
        yearOfBirth: row.year_of_birth ? String(row.year_of_birth) : "",
        mainComplaint: row.main_complaint || "",
        status: row.status || "active",
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    };
  }

  async function getCaseRawData(caseId) {
    if (!caseId) throw new Error("Missing case ID.");

    const { data, error } = await requireClient()
      .from("case_raw_data")
      .select("case_id, content, source, created_at, updated_at")
      .eq("case_id", caseId)
      .maybeSingle();

    assertOk(error, "Load raw data");
    if (!data) return null;

    return {
      caseId: data.case_id,
      content: data.content || "",
      source: data.source || "heidi",
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  }

  async function saveCaseRawData(caseId, content) {
    if (!caseId) throw new Error("Missing case ID.");
    const text = String(content ?? "");
    if (!text.trim()) throw new Error("Raw data is empty.");
    if (text.length > 100000) throw new Error("Raw data is too long.");

    return invokeAuthedFunction(
      "clinical-store",
      {
        action: "save_raw_data",
        caseId,
        content: text
      },
      "Raw data privacy service"
    );
  }

  async function deleteCaseRawData(caseId) {
    if (!caseId) throw new Error("Missing case ID.");

    return invokeAuthedFunction(
      "clinical-store",
      {
        action: "delete_raw_data",
        caseId
      },
      "Raw data privacy service"
    );
  }

  function subscribeCaseRawData(caseId, onChange) {
    if (!caseId || typeof onChange !== "function") return () => {};

    const db = requireClient();
    const channel = db
      .channel(`case-raw-data-${caseId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "case_raw_data",
          filter: `case_id=eq.${caseId}`
        },
        (payload) => onChange(payload)
      )
      .subscribe();

    return () => {
      void db.removeChannel(channel);
    };
  }

  async function getLearningOverview() {
    return invokeAuthedFunction(
      "learning-admin",
      { action: "overview" },
      "AI Learning overview"
    );
  }

  async function reviewCorpusRevision(revisionId, decision, note = "") {
    if (!revisionId) throw new Error("Missing corpus revision.");
    if (!["approved", "excluded"].includes(decision)) {
      throw new Error("Invalid corpus review decision.");
    }
    return invokeAuthedFunction(
      "learning-admin",
      {
        action: "review_revision",
        revisionId,
        decision,
        note: String(note || "")
      },
      "Corpus review"
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

  async function rejectStyle(profileId) {
    if (!profileId) throw new Error("Missing style profile.");
    return invokeAuthedFunction(
      "analyze-style",
      { action: "reject", profileId },
      "Style rejection"
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
    getPasswordReauthStatus,
    signInWithPassword,
    changeAdminPassword,
    requirePasswordReauth,
    signOut,
    startShift,
    getShiftCaseCounter,
    closeShift,
    saveStatusGeneratorRecords,
    loadState,
    saveState,
    allocateCaseLocalId,
    savePatient,
    finalizePatient,
    reopenCase,
    deleteCase,
    appendSummaryRevision,
    generateSummary,
    caseAssistantSuggest,
    caseAssistantGetState,
    caseAssistantDecide,
    caseAssistantExtract,
    findingLearningLoadRegistry,
    findingLearningSuggest,
    findingLearningConfirmMapping,
    findingLearningUndo,
    findingLearningBuildCandidates,
    findingLearningCandidatePatch,
    loadRawTransferWorkspace,
    getCaseRawData,
    saveCaseRawData,
    deleteCaseRawData,
    subscribeCaseRawData,
    getLearningOverview,
    reviewCorpusRevision,
    analyzeStyle,
    activateStyle,
    rejectStyle,
    analyzeSkill,
    reviewSkillSuggestion
  };
})();
