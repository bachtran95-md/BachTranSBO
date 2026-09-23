import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const workflowFixtures = JSON.parse(
  await readFile(new URL("./workflow-fixtures.json", import.meta.url), "utf8")
);

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:4173";
const backendMock = String.raw`
(() => {
  const STORE_KEY = "__bach_sbo_e2e_state";
  const SESSION_KEY = "__bach_sbo_e2e_session";
  const shiftId = "11111111-1111-4111-8111-111111111111";
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const entry = (id) => ({ id, type: "", mode: "notordered", text: "", savedText: "" });
  const seed = () => ({
    shift: { id: shiftId, startedAt: new Date().toISOString(), status: "active" },
    patients: [{
      id: "22222222-2222-4222-8222-222222222222",
      shiftId,
      localId: "01",
      sex: "M",
      yob: "1970",
      arrivalMode: "walk_in",
      arrivalOther: "",
      mainComplaint: "Existing smoke case",
      complaint: "",
      complaintSkipped: true,
      history: "",
      historySkipped: true,
      physical: "",
      physicalSkipped: true,
      tests: {
        labs: [entry("30000000-0000-4000-8000-000000000001")],
        ekgs: [entry("30000000-0000-4000-8000-000000000002")],
        gases: [entry("30000000-0000-4000-8000-000000000003")],
        radiology: [{ ...entry("30000000-0000-4000-8000-000000000004"), bodyPart: "", modality: "", otherTest: "" }],
        consultations: [entry("30000000-0000-4000-8000-000000000005")]
      },
      others: "",
      therapy: "",
      therapySkipped: true,
      course: "",
      courseSkipped: true,
      diagnoses: "",
      disposition: "",
      recommendations: [""],
      hospital: "",
      ward: "",
      physician: "",
      admissionNote: "",
      otherOutcome: "",
      otherDetails: "",
      summary: "",
      summaryGeneratedText: "",
      summaryGeneratedAt: null,
      summaryFinalizedText: "",
      summaryFinalizedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    references: []
  });

  const read = () => {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) {
      const state = seed();
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      return state;
    }
    return JSON.parse(raw);
  };
  const write = (state) => localStorage.setItem(STORE_KEY, JSON.stringify(state));
  const RAW_KEY = "__bach_sbo_e2e_raw_data";
  const readRaw = () => JSON.parse(localStorage.getItem(RAW_KEY) || "{}");
  const writeRaw = (value) => localStorage.setItem(RAW_KEY, JSON.stringify(value));
  const row = (p) => ({
    id: p.id,
    sex: p.sex || null,
    year_of_birth: p.yob ? Number(p.yob) : null,
    main_complaint: p.mainComplaint || "",
    arrival_mode: p.arrivalMode || "",
    arrival_other: p.arrivalOther || "",
    disposition: p.disposition || "",
    discharge_condition: p.dischargeCondition || "",
    other_details: p.otherDetails || ""
  });

  window.__BACH_E2E_CASE_ROW = (id) => {
    const patient = read().patients.find((p) => p.id === id);
    return patient ? row(patient) : null;
  };

  window.__BACH_E2E_FAIL_NEXT_SAVE = false;
  let corpusStatus = "approved";
  let corpusNote = "";
  let styleProfiles = [
    {
      id: "88888888-8888-4888-8888-888888888881",
      version: 1,
      profile_text: "Concise legacy candidate.",
      is_active: false,
      source_revision_count: 5,
      model: "mock"
    },
    {
      id: "88888888-8888-4888-8888-888888888882",
      version: 2,
      profile_text: "Short chronological Hungarian SBO style.",
      is_active: false,
      source_revision_count: 5,
      model: "mock"
    }
  ];
  let styleCoachRuns = [
    {
      id: "99999999-9999-4999-8999-999999999991",
      candidate_profile_id: "88888888-8888-4888-8888-888888888881",
      source_revision_count: 5,
      official_rule_count: 12,
      corpus_maturity: "early",
      analysis_text: "Candidate one analysis.",
      candidate_profile_text: "Concise legacy candidate.",
      status: "pending",
      model: "mock",
      generated_at: new Date().toISOString(),
      reviewed_at: null
    },
    {
      id: "99999999-9999-4999-8999-999999999992",
      candidate_profile_id: "88888888-8888-4888-8888-888888888882",
      source_revision_count: 5,
      official_rule_count: 12,
      corpus_maturity: "early",
      analysis_text: "Candidate two analysis.",
      candidate_profile_text: "Short chronological Hungarian SBO style.",
      status: "pending",
      model: "mock",
      generated_at: new Date().toISOString(),
      reviewed_at: null
    }
  ];
  let findingLearningRecords = [];
  let findingCandidates = [];

  const findingOverview = () => ({
    approvedLearning: findingLearningRecords.length,
    pendingCandidates: findingCandidates.length
  });

  const rebuildFindingCandidates = () => {
    const byKey = new Map();
    for (const record of findingLearningRecords) {
      const signature = record.normalizedPhrase + "::" + record.findingKey;
      const current = byKey.get(signature);
      if (current) {
        current.confirmations += 1;
        current.lastConfirmedAt = record.createdAt;
      } else {
        byKey.set(signature, {
          id: "candidate-" + record.id,
          alias: record.normalizedPhrase,
          sample: record.sourcePhrase,
          mappingKind: record.mappingKind,
          findingKey: record.findingKey,
          canonicalLabel: record.canonicalLabel,
          target: record.target,
          section: record.section,
          outputText: record.outputText,
          conflictText: record.conflictText,
          attributes: clone(record.attributes || {}),
          confirmations: 1,
          firstConfirmedAt: record.createdAt,
          lastConfirmedAt: record.createdAt,
          builtAt: new Date().toISOString()
        });
      }
    }
    findingCandidates = [...byKey.values()];
    return clone(findingCandidates);
  };



  const session = () => localStorage.getItem(SESSION_KEY)
    ? { user: { email: "e2e@example.test" }, access_token: "e2e-access", refresh_token: "e2e-refresh" }
    : null;

  window.BachSBOBackend = {
    async init() { return { configured: true, session: session() }; },
    async getSession() { return session(); },
    async getUser() { return session()?.user || null; },
    async signInWithPassword(password) {
      if (String(password).length < 6) throw new Error("Bad test password");
      localStorage.setItem(SESSION_KEY, "1");
      return session();
    },
    async signOut() { localStorage.removeItem(SESSION_KEY); },
    async changeAdminPassword() { return true; },
    async loadState() { return clone(read()); },
    async getShiftCaseCounter() {
      const state = read();
      const nextCaseNumber = Number(state.shift?.nextCaseNumber || 1);
      return {
        shiftId: state.shift?.id || shiftId,
        nextCaseNumber,
        localId: String(nextCaseNumber).padStart(2, "0")
      };
    },
    async startShift() {
      const state = read();
      state.shift ||= { id: shiftId, startedAt: new Date().toISOString(), status: "active" };
      write(state);
      return clone(state.shift);
    },
    async closeShift() {
      const state = read();
      state.shift = null;
      state.patients = [];
      write(state);
      return true;
    },
    async saveState(next) { write(clone(next)); return { state: clone(next), removed: 0, report: null }; },
    async allocateCaseLocalId(requestedShiftId) {
      const state = read();
      if (!state.shift || state.shift.id !== requestedShiftId) {
        throw new Error("Missing shift ID.");
      }
      const maxExisting = (state.patients || []).reduce((max, patient) => {
        const value = Number.parseInt(String(patient.localId || ""), 10);
        return Number.isInteger(value) ? Math.max(max, value) : max;
      }, 0);
      const caseNumber = Math.max(
        maxExisting + 1,
        Number(state.shift.nextCaseNumber || 1)
      );
      state.shift.nextCaseNumber = caseNumber + 1;
      write(state);
      return {
        shiftId: requestedShiftId,
        caseNumber,
        localId: String(caseNumber).padStart(2, "0"),
        nextCaseNumber: caseNumber + 1
      };
    },
    async savePatient(_shiftId, patient) {
      if (window.__BACH_E2E_FAIL_NEXT_SAVE) {
        window.__BACH_E2E_FAIL_NEXT_SAVE = false;
        throw new Error("Synthetic save failure");
      }
      const state = read();
      const index = state.patients.findIndex((p) => p.id === patient.id);
      if (index >= 0) state.patients[index] = clone(patient);
      else state.patients.push(clone(patient));
      write(state);
      return { patient: clone(patient), removed: 0, report: null };
    },

    async deleteCase(caseId) {
      const state = read();
      state.patients = state.patients.filter((p) => p.id !== caseId);
      write(state);
      return { caseId, deleted: true };
    },
    async reopenCase(_shiftId, caseId) {
      const state = read();
      const p = state.patients.find((x) => x.id === caseId);
      if (p) p.summaryFinalizedAt = null;
      write(state);
      return { caseId, reopenedAt: new Date().toISOString() };
    },
    async finalizePatient(_shiftId, patient) {
      const state = read();
      const index = state.patients.findIndex((p) => p.id === patient.id);
      if (index >= 0) state.patients[index] = clone(patient);
      write(state);
      return { patient: clone(patient), removed: 0, revisionId: "44444444-4444-4444-8444-444444444444", embedded: true };
    },
    async appendSummaryRevision() { return { removed: 0, embedded: true }; },
    async generateSummary() { return { summary: "Mock summary", generatedAt: new Date().toISOString(), model: "mock", skillVersion: "1", similarCasesUsed: [] }; },
    async caseAssistantSuggest(patient) {
      return {
        run: { id: "55555555-5555-4555-8555-555555555555" },
        caseId: patient.id,
        stale: false,
        suggestions: [{
          id: "66666666-6666-4666-8666-666666666666",
          itemKey: "item-01",
          priority: "next",
          category: "missing_information",
          title: "Allergy status unknown",
          reason: "Medication allergy status is not documented.",
          missingInformation: ["Gyógyszerallergia"],
          sources: [],
          doctorDecision: "pending"
        }, {
          id: "66666666-6666-4666-8666-666666666667",
          itemKey: "item-02",
          priority: "consider",
          category: "documentation",
          title: "Document reassessment",
          reason: "Reassessment can clarify the course.",
          missingInformation: [],
          sources: [],
          doctorDecision: "pending"
        }]
      };
    },
    async caseAssistantGetState(patient) { return { run: null, suggestions: [], caseId: patient.id }; },
    async caseAssistantDecide(_caseId, _itemId, decision) {
      const doctorDecision = decision === "done"
        ? "already_done"
        : decision === "na"
        ? "not_applicable"
        : decision;
      return { doctorDecision, decidedAt: new Date().toISOString() };
    },
    async caseAssistantExtract(_caseId, source) {
      if (window.__BACH_E2E_DROP_ASSISTANT_CORE_DURING_EXTRACT) {
        window.__BACH_E2E_DROP_ASSISTANT_CORE_DURING_EXTRACT = false;
        const savedCore = window.BachAssistantCore;
        window.BachAssistantCore = undefined;
        setTimeout(() => { window.BachAssistantCore = savedCore; }, 50);
      }
      if (/hypertonia/i.test(source)) {
        return {
          items: [{
            target: "history",
            status: "documented",
            text: "Hypertonia",
            evidence: "hypertonia",
            label: "History"
          }],
          warnings: ["Conflicting timing in source"]
        };
      }
      return {
        items: [{
          target: "complaint",
          status: "documented",
          text: "mellkasi fájdalom",
          evidence: "mellkasi fájdalom",
          label: "Complaint"
        }],
        warnings: []
      };
    },
    async findingLearningLoadRegistry() {
      return {
        records: clone(findingLearningRecords),
        overview: findingOverview()
      };
    },
    async findingLearningSuggest(sourcePhrase) {
      const phrase = String(sourcePhrase || "").trim();
      if (/dörzszörej/i.test(phrase)) {
        return {
          sourcePhrase: phrase,
          model: "mock",
          suggestion: {
            mappingKind: "new",
            findingKey: "pleural-friction-rub",
            canonicalLabel: "Pleuralis dörzszörej",
            target: "respiratory",
            section: "B",
            outputText: "Bal oldalon pleuralis dörzszörej hallható.",
            conflictText: "Zörejek: nincs.",
            attributes: { laterality: "left", location: "bal oldalon", grade: "", value: "" },
            reason: "A finding a légzési státuszhoz tartozik."
          }
        };
      }
      return {
        sourcePhrase: phrase,
        model: "mock",
        suggestion: {
          mappingKind: "existing",
          findingKey: "systolic-murmur",
          canonicalLabel: "Systolés zörej",
          target: "circulation",
          section: "C",
          outputText: phrase,
          conflictText: "zörej nem hallható",
          attributes: { laterality: "", location: "", grade: "", value: "" },
          reason: "Meglévő szívzörej finding."
        }
      };
    },
    async findingLearningConfirmMapping(mapping) {
      const sourcePhrase = String(mapping.sourcePhrase || "").trim();
      const normalizedPhrase = sourcePhrase
        .toLocaleLowerCase("hu-HU")
        .replace(/\s+/g, " ")
        .replace(/[\s.,;:]+$/g, "")
        .trim();
      const record = {
        id: "learn-" + String(findingLearningRecords.length + 1).padStart(3, "0"),
        sourcePhrase,
        normalizedPhrase,
        mappingKind: mapping.mappingKind === "new" ? "new" : "existing",
        findingKey: String(mapping.findingKey || ""),
        canonicalLabel: String(mapping.canonicalLabel || ""),
        target: String(mapping.target || ""),
        section: String(mapping.section || ""),
        outputText: String(mapping.outputText || ""),
        conflictText: String(mapping.conflictText || ""),
        attributes: clone(mapping.attributes || {}),
        createdAt: new Date().toISOString()
      };
      findingLearningRecords.unshift(record);
      return {
        record: clone(record),
        threshold: { built: false, newLearningSinceBuild: findingLearningRecords.length },
        overview: findingOverview()
      };
    },
    async findingLearningUndo(learningId) {
      findingLearningRecords = findingLearningRecords.filter((record) => record.id !== learningId);
      rebuildFindingCandidates();
      return { reverted: learningId, overview: findingOverview() };
    },
    async findingLearningBuildCandidates() {
      const patch = rebuildFindingCandidates();
      return { patch, overview: findingOverview() };
    },
    async findingLearningCandidatePatch() {
      if (!findingCandidates.length && findingLearningRecords.length) rebuildFindingCandidates();
      return {
        generatedAt: new Date().toISOString(),
        registryPatchVersion: 1,
        patch: clone(findingCandidates),
        overview: findingOverview()
      };
    },
    async loadRawTransferWorkspace() {
      const state = read();
      return {
        shift: state.shift ? clone(state.shift) : null,
        cases: state.shift
          ? state.patients
              .filter((p) => !p.summaryFinalizedAt)
              .map((p) => ({
                id: p.id,
                localId: p.localId,
                sex: p.sex,
                yearOfBirth: p.yob,
                mainComplaint: p.mainComplaint,
                status: "active",
                createdAt: p.createdAt,
                updatedAt: p.updatedAt
              }))
          : []
      };
    },
    async getCaseRawData(caseId) {
      const value = readRaw()[caseId] || null;
      return value ? clone(value) : null;
    },
    async saveCaseRawData(caseId, content) {
      const raw = readRaw();
      const previous = raw[caseId] || {};
      const now = new Date().toISOString();
      raw[caseId] = {
        caseId,
        content: String(content || ""),
        source: "heidi",
        createdAt: previous.createdAt || now,
        updatedAt: now,
        removed: 0
      };
      writeRaw(raw);
      return clone(raw[caseId]);
    },
    async deleteCaseRawData(caseId) {
      const raw = readRaw();
      delete raw[caseId];
      writeRaw(raw);
      return { deleted: true, caseId };
    },
    subscribeCaseRawData() { return () => {}; },
    async getLearningOverview() {
      return {
        finalizedCount: 1,
        corpusRevisions: [{
          id: "77777777-7777-4777-8777-777777777777",
          case_id: "22222222-2222-4222-8222-222222222222",
          finalized_text: "Mock finalized corpus text",
          generated_text: "Mock generated corpus text",
          finalized_at: new Date().toISOString(),
          learning_status: corpusStatus,
          learning_note: corpusNote,
          learning_reviewed_at: null,
          model: "mock"
        }],
        styleProfiles: clone(styleProfiles),
        styleCoachRuns: clone(styleCoachRuns),
        skillSuggestions: [],
        activeSkill: { name: "Mock", version: 1 }
      };
    },
    async reviewCorpusRevision(_revisionId, decision, note = "") {
      corpusStatus = decision;
      corpusNote = note;
      return { learningStatus: corpusStatus, learningNote: corpusNote };
    },
    async analyzeStyle() { return { candidate: { version: 3 }, coach: { corpus_maturity: "early" } }; },
    async activateStyle(profileId) {
      styleProfiles = styleProfiles.map((p) => ({ ...p, is_active: p.id === profileId }));
      styleCoachRuns = styleCoachRuns.map((run) =>
        run.candidate_profile_id === profileId && run.status === "pending"
          ? { ...run, status: "accepted", reviewed_at: new Date().toISOString() }
          : run
      );
      return { activeProfile: clone(styleProfiles.find((p) => p.id === profileId)) };
    },
    async rejectStyle(profileId) {
      styleCoachRuns = styleCoachRuns.map((run) =>
        run.candidate_profile_id === profileId && run.status === "pending"
          ? { ...run, status: "rejected", reviewed_at: new Date().toISOString() }
          : run
      );
      return { profileId, status: "rejected" };
    },
    async analyzeSkill() { return true; },
    async reviewSkillSuggestion() { return true; }
  };
})();
`;

const supabaseMock = String.raw`
window.supabase = {
  createClient() {
    return {
      auth: { async setSession() { return { data: {}, error: null }; } },
      from(table) {
        const filters = {};
        const chain = {
          select() { return chain; },
          eq(key, value) { filters[key] = value; return chain; },
          order() { return chain; },
          async maybeSingle() {
            if (table === "cases") {
              return { data: window.__BACH_E2E_CASE_ROW?.(filters.id) || null, error: null };
            }
            return { data: null, error: null };
          }
        };
        return chain;
      }
    };
  }
};
`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const errors = [];
context.on("page", (page) => page.on("pageerror", (error) => {
  errors.push(error.message);
  console.error("[browser pageerror]", error.message);
}));

await context.route(/supabase-js@2\.116\.0/, async (route) => {
  await route.fulfill({ status: 200, contentType: "application/javascript", body: supabaseMock });
});
await context.route(/\/backend\.js(?:\?.*)?$/, async (route) => {
  await route.fulfill({ status: 200, contentType: "application/javascript", body: backendMock });
});

const page = await context.newPage();
page.on("dialog", async (dialog) => dialog.accept());

await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
await page.locator("#authPassword").waitFor();
await page.locator("#authPassword").fill("smoke-test-password");
await page.locator("#passwordSignIn").click();

// Exercise the phone-only Raw Data Transfer mode before entering the clinical workspace.
await page.locator("#chooseRawMode").waitFor();
await page.locator("#chooseRawMode").click();
await page.locator("#rawTransferView:not(.hidden)").waitFor();
await page.locator('[data-raw-case-id="22222222-2222-4222-8222-222222222222"]').click();
await page.locator("#rawTransferText").fill("Heidi raw transcript: mellkasi fájdalom.");
await page.locator("#rawTransferSaveBtn").click();
await page.waitForFunction(() =>
  (document.querySelector("#rawTransferStatus")?.textContent || "").includes("elküldve")
);

// Switch the same device to Normal mode and verify the raw inbox → AI bridge.
await page.locator("#switchModeBtn").click();
await page.locator("#chooseNormalMode").click();
await page.locator("#patientsView:not(.hidden)").waitFor();
await page.locator("#patientTbody tr[data-id]", { hasText: "Existing smoke case" }).click();

// Promoted Stable header: dated shift start, live active duration, and light status counters.
await page.waitForFunction(() => {
  const text = document.querySelector("#shiftMeta .shift-dashboard-pill")?.textContent || "";
  return /\d{4}/.test(text) && /(Aktív|Active)\s*:/.test(text);
});
for (const metricClass of ["shift-metric-cases", "shift-metric-active", "shift-metric-completed"]) {
  if (await page.locator("#shiftMeta ." + metricClass).count() !== 1) {
    throw new Error("Stable shift metric class missing: " + metricClass);
  }
}

// Manual triage is Stable workflow metadata: it persists and changes only the case-list border.
await page.locator("#caseTriageControl").waitFor();
if (await page.locator('#caseTriageControl [data-case-triage]').count() !== 3) {
  throw new Error("Stable case triage must expose exactly red/yellow/green choices");
}
await page.locator('#caseTriageControl [data-case-triage="yellow"]').click();
await page.waitForFunction(() => {
  const p = window.BachSBOClinicalUi?.getPatientSnapshot?.();
  const row = document.querySelector("#patientTbody tr.selected[data-id]");
  return p?.triageStatus === "yellow" && row?.classList.contains("triage-yellow");
});
const stablePersistedTriage = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("__bach_sbo_e2e_state") || "{}")?.patients?.[0]?.triageStatus || ""
);
if (stablePersistedTriage !== "yellow") {
  throw new Error("Stable case triage did not persist: " + stablePersistedTriage);
}

await page.locator("#normalRawBadge:not(.hidden)").waitFor();
if (await page.locator("#normalRawDataInbox").count()) {
  throw new Error("Permanent Raw Data Inbox still occupies case content space");
}
await page.locator("#normalRawBadge").click();
await page.waitForFunction(() =>
  document.querySelector("#normalRawDrawer")?.classList.contains("open")
);
await page.waitForFunction(() =>
  (document.querySelector("#normalRawDataText")?.value || "").includes("Heidi raw transcript")
);
await page.locator("#normalRawUseAiBtn").click();
await page.waitForFunction(() =>
  !document.querySelector("#normalRawDrawer")?.classList.contains("open")
);
await page.waitForFunction(() =>
  document.querySelector("#cockpitDataEntryOverlay")?.classList.contains("open")
);
if (!(await page.locator("#cockpitPasteText").inputValue()).includes("Heidi raw transcript")) {
  throw new Error("Raw data was not loaded into AI data entry");
}
await page.locator("#cockpitDataEntryClose").click();

// The compact badge should remain available until the raw source is explicitly deleted.
await page.locator("#normalRawBadge:not(.hidden)").waitFor();
await page.locator("#normalRawBadge").click();
await page.waitForFunction(() =>
  document.querySelector("#normalRawDrawer")?.classList.contains("open")
);
await page.locator("#normalRawDeleteBtn").click();
await page.waitForFunction(() =>
  document.querySelector("#normalRawBadge")?.classList.contains("hidden") &&
  !document.querySelector("#normalRawDrawer")?.classList.contains("open")
);

const newSexOptions = await page.locator("#newSex").evaluate((select) =>
  [...select.options].map((option) => ({ value: option.value, text: option.textContent }))
);
const expectedNewSexOptions = [
  { value: "", text: "—" },
  { value: "M", text: "Férfi" },
  { value: "F", text: "Nő" },
  { value: "O", text: "Egyéb" }
];
if (JSON.stringify(newSexOptions) !== JSON.stringify(expectedNewSexOptions)) {
  throw new Error("Unexpected new-case sex option order: " + JSON.stringify(newSexOptions));
}

const initialRows = page.locator("#patientTbody tr[data-id]");
if (await initialRows.count() !== 1) {
  throw new Error("Expected one existing case after sign-in");
}
if (!(await page.locator("#patientTbody").textContent()).includes("Existing smoke case")) {
  throw new Error("Existing case did not render");
}

await page.locator("#newSex").selectOption("F");
await page.locator("#newYob").fill("1988");
await page.locator("#newComplaint").fill("E2E synthetic complaint");
await page.locator("#addPatientBtn").click();
await page.waitForFunction(() => document.querySelectorAll("#patientTbody tr[data-id]").length === 2);

const syntheticRow = page.locator("#patientTbody tr[data-id]", { hasText: "E2E synthetic complaint" });
await syntheticRow.click();
await page.locator("#iceDeleteCase").waitFor();
await page.locator("#iceDeleteCase").click();

await page.waitForLoadState("domcontentloaded");
await page.locator("#patientsView:not(.hidden)").waitFor();
await page.waitForFunction(() => document.querySelectorAll("#patientTbody tr[data-id]").length === 1);
const afterDelete = await page.locator("#patientTbody").textContent();
if (afterDelete.includes("E2E synthetic complaint")) {
  throw new Error("Synthetic case survived delete + reload");
}
if (!afterDelete.includes("Existing smoke case")) {
  throw new Error("Existing case was lost during smoke flow");
}
await page.locator("#patientTbody tr[data-id]", { hasText: "Existing smoke case" }).click();
await page.waitForFunction(() => {
  const p = window.BachSBOClinicalUi?.getPatientSnapshot?.();
  const row = document.querySelector("#patientTbody tr.selected[data-id]");
  return p?.triageStatus === "yellow" &&
    row?.classList.contains("triage-yellow") &&
    document.querySelector('#caseTriageControl [data-case-triage="yellow"]')?.getAttribute("aria-pressed") === "true";
});

// Prepare three meaningful pending investigations for Stable Case-list coverage.
await page.evaluate(() => {
  const key = "__bach_sbo_e2e_state";
  const state = JSON.parse(localStorage.getItem(key) || "{}");
  const p = state?.patients?.[0];
  if (!p) return;
  for (const entry of [p.tests?.ekgs?.[0], p.tests?.gases?.[0], p.tests?.radiology?.[0]]) {
    if (!entry) continue;
    entry.mode = "waiting";
    entry.text = "";
    entry.savedText = "";
  }
  if (p.tests?.radiology?.[0]) {
    p.tests.radiology[0].bodyPart = "koponya";
    p.tests.radiology[0].modality = "Native CT";
    p.tests.radiology[0].otherTest = "";
    p.tests.radiology[0].type = "koponya Native CT";
  }
  if (p.tests?.consultations?.[0]) {
    p.tests.consultations[0].type = "Kardiológia";
    p.tests.consultations[0].mode = "waiting";
    p.tests.consultations[0].text = "";
    p.tests.consultations[0].savedText = "";
  }
  localStorage.setItem(key, JSON.stringify(state));
});

const beta = await context.newPage();
let cancelNextBetaDialog = false;
beta.on("dialog", async (dialog) => {
  if (cancelNextBetaDialog) {
    cancelNextBetaDialog = false;
    await dialog.dismiss();
    return;
  }
  await dialog.accept();
});
await beta.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
if (await beta.locator("#chooseNormalMode").count()) {
  await beta.locator("#chooseNormalMode").click();
}
await beta.locator("#patientsView:not(.hidden)").waitFor();
await beta.waitForFunction(() => document.body.classList.contains("cockpit-ui"));

const frontendParity = await beta.evaluate((fixtures) => {
  const evaluate = window.BachSBOClinicalUi?.evaluateWorkflowStatus;
  if (typeof evaluate !== "function") {
    throw new Error("Frontend workflow parity evaluator is unavailable");
  }

  const basePatient = () => ({
    sex: "F",
    yob: "1970",
    mainComplaint: "Mellkasi fájdalom",
    arrivalMode: "walk_in",
    arrivalOther: "",
    complaint: "",
    complaintSkipped: true,
    history: "",
    historySkipped: true,
    physical: "",
    physicalSkipped: true,
    therapy: "",
    therapySkipped: true,
    course: "",
    courseSkipped: true,
    diagnoses: "",
    diagnosesSkipped: true,
    tests: {
      labs: [],
      ekgs: [],
      gases: [],
      radiology: [],
      consultations: []
    },
    disposition: "discharged",
    dischargeCondition: "Panaszmentes, jó általános állapotú.",
    recommendations: ["Háziorvosi kontroll."],
    hospital: "",
    ward: "",
    physician: "",
    admissionNote: "",
    otherOutcome: "",
    otherDetails: ""
  });

  const merge = (base, patch) => {
    if (Array.isArray(patch)) return structuredClone(patch);
    if (!patch || typeof patch !== "object") return patch;

    const out = structuredClone(base);
    for (const [key, value] of Object.entries(patch)) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        out?.[key] &&
        typeof out[key] === "object" &&
        !Array.isArray(out[key])
      ) {
        out[key] = merge(out[key], value);
      } else {
        out[key] = structuredClone(value);
      }
    }
    return out;
  };

  return fixtures.map((fixture) => {
    const status = evaluate(merge(basePatient(), fixture.patch));
    return {
      name: fixture.name,
      expectedReady: fixture.expectedReady,
      actualReady: Boolean(status?.summaryReady)
    };
  });
}, workflowFixtures);

for (const result of frontendParity) {
  if (result.actualReady !== result.expectedReady) {
    throw new Error(
      `Frontend workflow parity failed for ${result.name}: expected ready=${result.expectedReady}, got ready=${result.actualReady}`
    );
  }
}

if (await beta.locator("#patientTbody tr[data-id]").count() !== 1) {
  throw new Error("Stable cockpit did not restore the expected case state");
}

await beta.locator("#patientTbody tr[data-id]", { hasText: "Existing smoke case" }).click();
await beta.locator("#cockpitDataEntryBtn").waitFor({ state: "visible" });
await beta.waitForFunction(() => {
  const button = document.querySelector("#cockpitDataEntryBtn");
  return Boolean(button && !button.disabled);
});

const caseRow = beta.locator("#patientTbody tr[data-id]", { hasText: "Existing smoke case" });
await beta.waitForFunction(() =>
  Boolean(document.querySelector("#patientTbody tr[data-id] .cockpit-test-summary"))
);
const pendingSummary = await caseRow.locator(".cockpit-test-summary").textContent();
for (const expected of ["EKG 1", "AVG 1", "koponya Native CT", "Kardiológia"]) {
  if (!pendingSummary.includes(expected)) {
    throw new Error(`Case list hid pending test ${expected}: ${pendingSummary}`);
  }
}
if (/\+\d+/.test(pendingSummary)) {
  throw new Error(`Case list still truncates waiting tests with +N: ${pendingSummary}`);
}

// Stable case tabs must be five distinct workflow steps in the requested order.
const tabOrder = await beta.locator("#cockpitCaseTabs [data-cockpit-tab]").evaluateAll((nodes) =>
  nodes.map((node) => node.dataset.cockpitTab)
);
const expectedTabOrder = ["clinical", "tests", "course", "disposition", "summary"];
if (JSON.stringify(tabOrder) !== JSON.stringify(expectedTabOrder)) {
  throw new Error(`Unexpected Stable tab order: ${JSON.stringify(tabOrder)}`);
}
if (await beta.locator("#cockpitSummaryTitle").count()) {
  throw new Error("Right-side Summary card still exists");
}
await beta.waitForFunction(() =>
  document.querySelector('[data-cockpit-tab="tests"]')?.classList.contains("has-summary-gap") &&
  document.querySelector('[data-cockpit-tab="disposition"]')?.classList.contains("has-summary-gap")
);
if (await beta.locator('[data-cockpit-tab="clinical"].has-summary-gap').count()) {
  throw new Error("Klinikum stayed orange despite complete demographics and Jelen panaszok/Anamnézis resolved as NINCS");
}
if (await beta.locator('[data-cockpit-tab="summary"].has-summary-gap').count()) {
  throw new Error("Summary tab must never show an orange readiness dot");
}

// Klinikum demographics must be native-visible markup, not a late dynamic insertion.
if (await beta.locator("#cockpitDemographicsMount > #inlineCaseEditor").count() !== 1) {
  throw new Error("Klinikum demographics editor is not mounted in the Stable clinical section");
}

// Klinikum demographics must stay visible and editable.
await beta.locator('[data-cockpit-tab="clinical"]').click();
await beta.waitForFunction(() => {
  const row = document.querySelector("#patientTbody tr.selected[data-id]");
  const editor = document.querySelector("#inlineCaseEditor");
  return Boolean(row?.dataset.id && editor?.dataset.loadedCaseId === row.dataset.id);
});
await beta.locator("#cockpitDemographicsMount #iceYob").waitFor({ state: "visible" });
await beta.locator("#cockpitDemographicsMount #iceAge").waitFor({ state: "visible" });
await beta.locator("#cockpitDemographicsMount #iceArrival").waitFor({ state: "visible" });
if (!(await beta.locator("#iceAge").getAttribute("readonly") !== null)) {
  throw new Error("Klinikum Age must be read-only and derived from YOB");
}

// SBO arrival is required: blank must be visibly orange, a valid selection clears it.
await beta.locator("#iceArrival").selectOption("");
await beta.waitForFunction(() =>
  document.querySelector("#iceArrival")?.closest(".field")?.classList.contains("cockpit-arrival-missing")
);
const missingArrivalStyle = await beta.locator("#iceArrival").evaluate((el) => ({
  background: getComputedStyle(el).backgroundColor,
  border: getComputedStyle(el).borderColor,
  ariaInvalid: el.getAttribute("aria-invalid")
}));
if (
  missingArrivalStyle.background === "rgb(255, 255, 255)" ||
  missingArrivalStyle.border === "rgb(208, 213, 221)" ||
  missingArrivalStyle.ariaInvalid !== "true"
) {
  throw new Error("Blank SBO arrival is not highlighted orange: " + JSON.stringify(missingArrivalStyle));
}
await beta.locator("#iceArrival").selectOption("walk_in");
await beta.waitForFunction(() =>
  !document.querySelector("#iceArrival")?.closest(".field")?.classList.contains("cockpit-arrival-missing")
);
if ((await beta.locator("#iceArrival").getAttribute("aria-invalid")) !== "false") {
  throw new Error("SBO arrival remained invalid after choosing an option");
}

// Jelen panaszok and Anamnézis should be full-width stacked rows, not side-by-side.
const clinicalNarrativeLayout = await beta.evaluate(() => {
  const complaint = document.querySelector('[data-narrative-field="complaint"]')?.getBoundingClientRect();
  const history = document.querySelector('[data-narrative-field="history"]')?.getBoundingClientRect();
  return {
    complaint: complaint ? { left: complaint.left, top: complaint.top, width: complaint.width, bottom: complaint.bottom } : null,
    history: history ? { left: history.left, top: history.top, width: history.width, bottom: history.bottom } : null
  };
});
if (
  !clinicalNarrativeLayout.complaint ||
  !clinicalNarrativeLayout.history ||
  clinicalNarrativeLayout.history.top < clinicalNarrativeLayout.complaint.bottom - 1 ||
  Math.abs(clinicalNarrativeLayout.complaint.left - clinicalNarrativeLayout.history.left) > 2 ||
  Math.abs(clinicalNarrativeLayout.complaint.width - clinicalNarrativeLayout.history.width) > 2
) {
  throw new Error("Klinikum complaint/history are not stacked full-width rows: " + JSON.stringify(clinicalNarrativeLayout));
}
const narrativeHeights = await beta.evaluate(() => ({
  complaint: document.querySelector("#fComplaint")?.getBoundingClientRect().height || 0,
  history: document.querySelector("#fHistory")?.getBoundingClientRect().height || 0
}));
if (narrativeHeights.complaint < 130 || narrativeHeights.history < 130) {
  throw new Error("Klinikum complaint/history textareas are not approximately 2x default height: " + JSON.stringify(narrativeHeights));
}

// Regression from screen recording: Klinikum Sex uses three exclusive radio
// choices rather than a native dropdown.
if (await beta.locator('#iceSexChoices select').count()) {
  throw new Error("Klinikum sex still contains a dropdown");
}
const sexChoiceState = await beta.locator('#iceSexChoices input[name="iceSexChoice"]').evaluateAll((nodes) =>
  nodes.map((node) => ({
    value: node.value,
    text: node.closest("label")?.querySelector("[data-sex-choice-label]")?.textContent || ""
  }))
);
const expectedSexChoices = [
  { value: "M", text: "Férfi" },
  { value: "F", text: "Nő" },
  { value: "O", text: "Egyéb" }
];
if (JSON.stringify(sexChoiceState) !== JSON.stringify(expectedSexChoices)) {
  throw new Error("Unexpected Klinikum sex radio order: " + JSON.stringify(sexChoiceState));
}
const sexIndicatorText = await beta.locator(".sex-choice-check").evaluateAll((nodes) =>
  nodes.map((node) => node.textContent || "")
);
if (sexIndicatorText.some((text) => text.trim())) {
  throw new Error("Klinikum sex radio still contains a redundant check glyph: " + JSON.stringify(sexIndicatorText));
}

const demographicLayout = await beta.locator("#inlineCaseEditor").evaluate(() => {
  const sex = document.querySelector("#iceSexChoices")?.getBoundingClientRect();
  const yob = document.querySelector("#iceYob")?.getBoundingClientRect();
  const age = document.querySelector("#iceAge")?.getBoundingClientRect();
  const arrival = document.querySelector("#iceArrival")?.getBoundingClientRect();
  const indicator = document.querySelector(".sex-choice-check");
  const indicatorStyle = indicator ? getComputedStyle(indicator) : null;
  return {
    sex: sex?.width || 0,
    yob: yob?.width || 0,
    age: age?.width || 0,
    arrival: arrival?.width || 0,
    indicatorWidth: indicator?.getBoundingClientRect().width || 0,
    indicatorHeight: indicator?.getBoundingClientRect().height || 0,
    indicatorRadius: indicatorStyle?.borderRadius || ""
  };
});
if (!(demographicLayout.yob < demographicLayout.sex && demographicLayout.age < demographicLayout.yob)) {
  throw new Error("Klinikum YOB/Age columns are not compact: " + JSON.stringify(demographicLayout));
}
if (!(demographicLayout.arrival > demographicLayout.yob && demographicLayout.arrival > demographicLayout.age)) {
  throw new Error("Klinikum arrival column should receive the freed width: " + JSON.stringify(demographicLayout));
}
if (
  Math.abs(demographicLayout.indicatorWidth - demographicLayout.indicatorHeight) > 1 ||
  !["999px", "50%"].includes(demographicLayout.indicatorRadius)
) {
  throw new Error("Klinikum sex selector indicator is not round: " + JSON.stringify(demographicLayout));
}

for (const value of ["F", "O", "M", "F"]) {
  await beta.locator(`#iceSexChoices label:has(input[value="${value}"])`).click();
  await beta.waitForTimeout(180);
  if ((await beta.locator("#iceSex").inputValue()) !== value) {
    throw new Error(`Klinikum sex hidden value did not follow tick ${value}`);
  }
  const checked = await beta.locator('#iceSexChoices input[name="iceSexChoice"]:checked').evaluateAll((nodes) =>
    nodes.map((node) => node.value)
  );
  if (JSON.stringify(checked) !== JSON.stringify([value])) {
    throw new Error("Klinikum sex ticks are not exclusive: " + JSON.stringify(checked));
  }
}

const expectedYob = String(new Date().getFullYear() - 44);

// Invalid/incomplete YOB must keep Klinikum orange; Age itself is derived and
// is not an independent requirement.
await beta.locator("#iceYob").fill("1");
await beta.locator("#iceYob").dispatchEvent("input");
await beta.waitForFunction(() =>
  document.querySelector('[data-cockpit-tab="clinical"]')?.classList.contains("has-summary-gap")
);

// Two-digit YOB is a birth-year shorthand everywhere, never an age.
// In 2026, for example, 55 means 1955 rather than "55 years old".
await beta.locator("#iceYob").fill("55");
await beta.locator("#iceYob").dispatchEvent("change");
await beta.locator("#iceYob").blur();
await beta.waitForFunction(() => {
  const currentYear = new Date().getFullYear();
  const meta = window.BachSBOClinicalUi?.getCaseMetadata?.();
  return document.querySelector("#iceYob")?.value === "1955" &&
    document.querySelector("#iceAge")?.value === String(currentYear - 1955) &&
    String(meta?.year_of_birth || "") === "1955";
});

await beta.locator("#iceYob").fill(expectedYob);
await beta.locator("#iceYob").dispatchEvent("change");

// Chrome regression: while the native arrival select owns focus, observer /
// label refreshes must not replace its option nodes.
const arrivalOptionState = await beta.locator("#iceArrival").evaluate((select) => {
  window.__BACH_E2E_ARRIVAL_OMSZ_OPTION = select.querySelector('option[value="omsz"]');
  return [...select.options].map((option) => ({ value: option.value, text: option.textContent }));
});
const expectedArrivalOptions = [
  { value: "", text: "— válasszon —" },
  { value: "omsz", text: "OMSz szállította" },
  { value: "esetkocsi", text: "Esetkocsi szállította" },
  { value: "walk_in", text: "Saját lábán érkezett" },
  { value: "gp_referral", text: "Háziorvosi beutalóval" },
  { value: "other", text: "Egyéb" }
];
if (JSON.stringify(arrivalOptionState) !== JSON.stringify(expectedArrivalOptions)) {
  throw new Error("Unexpected Klinikum arrival option order: " + JSON.stringify(arrivalOptionState));
}
await beta.locator("#iceArrival").focus();
await beta.locator("#recordHeader").evaluate((header) => header.classList.toggle("arrival-focus-regression"));
await beta.waitForTimeout(250);
const arrivalOptionNodeStable = await beta.locator("#iceArrival").evaluate((select) =>
  window.__BACH_E2E_ARRIVAL_OMSZ_OPTION === select.querySelector('option[value="omsz"]')
);
if (!arrivalOptionNodeStable) {
  throw new Error("Focused Klinikum arrival select rebuilt option nodes during Chrome interaction");
}

await beta.locator("#iceArrival").selectOption("omsz");
await beta.waitForFunction(() => document.querySelector("#iceAge")?.value === "44");
if (await beta.locator("#iceArrival").isDisabled()) {
  throw new Error("Klinikum arrival mode is disabled");
}

// Klinikum completion must come from canonical patient demographics, with Age
// derived from YOB and no second demographic state in the DOM.
await beta.waitForFunction(() => {
  const meta = window.BachSBOClinicalUi?.getCaseMetadata?.();
  const clinicalTab = document.querySelector('[data-cockpit-tab="clinical"]');
  return meta?.sex === "F" &&
    String(meta?.year_of_birth || "") === String(new Date().getFullYear() - 44) &&
    meta?.arrival_mode === "omsz" &&
    clinicalTab &&
    !clinicalTab.classList.contains("has-summary-gap");
});

// Single-source invariant: the app patient model and Esetlista must change
// immediately, before the 900ms autosave reaches the backend.
await beta.waitForFunction(({ expectedYob }) => {
  const meta = window.BachSBOClinicalUi?.getCaseMetadata?.();
  const row = document.querySelector("#patientTbody tr.selected[data-id]");
  const rowSex = row?.querySelector('td:nth-child(2) [data-sex-badge="F"]');
  const rowAge = row?.querySelector("td:nth-child(3)")?.textContent?.trim();
  return meta?.sex === "F" &&
    String(meta?.year_of_birth || "") === expectedYob &&
    meta?.arrival_mode === "omsz" &&
    Boolean(rowSex) &&
    rowAge === "44";
}, { expectedYob });

await beta.waitForTimeout(1600);
const demographicSaveDiagnostic = await beta.evaluate(({ expectedYob }) => {
  const state = JSON.parse(localStorage.getItem("__bach_sbo_e2e_state") || "{}");
  const patient = state?.patients?.[0] || null;
  const editor = document.querySelector("#inlineCaseEditor");
  const row = document.querySelector("#patientTbody tr.selected[data-id]");
  return {
    expectedYob,
    persistedSex: patient?.sex || "",
    persistedYob: patient?.yob || "",
    persistedArrival: patient?.arrivalMode || "",
    status: document.querySelector("#iceStatus")?.textContent || "",
    loadedCaseId: editor?.dataset.loadedCaseId || "",
    selectedCaseId: row?.dataset.id || ""
  };
}, { expectedYob });
if (
  demographicSaveDiagnostic.persistedSex !== "F" ||
  demographicSaveDiagnostic.persistedYob !== expectedYob ||
  demographicSaveDiagnostic.persistedArrival !== "omsz"
) {
  throw new Error("Demographic metadata did not persist: " + JSON.stringify(demographicSaveDiagnostic));
}
await beta.waitForFunction(() => {
  const row = document.querySelector("#patientTbody tr[data-id]");
  return row?.querySelector('td:nth-child(2) [data-sex-badge="F"]') &&
    row?.querySelector("td:nth-child(3)")?.textContent?.trim() === "44";
});

await beta.reload({ waitUntil: "domcontentloaded" });
await beta.locator("#patientsView:not(.hidden)").waitFor();
await beta.locator("#patientTbody tr[data-id]", { hasText: "Existing smoke case" }).click();
await beta.waitForFunction(({ expectedYob }) => {
  const meta = window.BachSBOClinicalUi?.getCaseMetadata?.();
  return meta?.sex === "F" &&
    String(meta?.year_of_birth || "") === expectedYob &&
    meta?.arrival_mode === "omsz";
}, { expectedYob });

// Pending investigations must be visually distinct: orange while waiting,
// green when a result exists, and grey when marked not ordered.
await beta.locator('[data-cockpit-tab="tests"]').click();
const pendingInvestigationStyle = await beta.locator('[data-cockpit-panel="tests"] .test-card.cockpit-test-row:not(.result):not(.notordered)').first().evaluate((card) => {
  const style = getComputedStyle(card);
  const textarea = card.querySelector("textarea");
  const textareaStyle = textarea ? getComputedStyle(textarea) : null;
  return {
    background: style.backgroundColor,
    border: style.borderColor,
    textareaBackground: textareaStyle?.backgroundColor || "",
    textareaBorder: textareaStyle?.borderColor || ""
  };
});
if (
  pendingInvestigationStyle.background === "rgb(255, 255, 255)" ||
  pendingInvestigationStyle.border === "rgb(208, 213, 221)"
) {
  throw new Error("Pending investigation is not visibly orange: " + JSON.stringify(pendingInvestigationStyle));
}

// Section 2 wording and the dedicated third Therapy/Course tab.
await beta.locator("#langHuBtn").click();
await beta.waitForFunction(() =>
  (document.querySelector('[data-cockpit-panel="tests"] .section-title')?.textContent || "").includes("Fizikális státusz és vizsgálatok")
);

await beta.locator('[data-cockpit-tab="course"]').click();
await beta.locator('[data-cockpit-panel="course"]:not(.cockpit-panel-hidden)').waitFor();
await beta.locator('[data-cockpit-panel="course"] #fTherapy').waitFor({ state: "visible" });
await beta.locator('[data-cockpit-panel="course"] #fCourse').waitFor({ state: "visible" });
if (await beta.locator('[data-cockpit-panel="tests"]:not(.cockpit-panel-hidden)').count()) {
  throw new Error("Tests panel remained visible while Therapy/Course tab was active");
}

// Regression: the fixed summary footer is only relevant for discharge and
// discharged disposition + discharge condition must survive save/reload.
await beta.locator('[data-cockpit-tab="summary"]').click();
if (!(await beta.locator("#fixedSummaryFooterField").evaluate((el) => el.classList.contains("hidden")))) {
  throw new Error("Fixed summary footer must be hidden before discharge is selected");
}

await beta.locator('[data-cockpit-tab="disposition"]').click();
await beta.locator("#fDisposition").selectOption("discharged");
await beta.locator('[data-cockpit-tab="summary"]').click();
if (await beta.locator("#fixedSummaryFooterField").evaluate((el) => el.classList.contains("hidden"))) {
  throw new Error("Fixed summary footer must be visible for discharged cases");
}
await beta.locator('[data-cockpit-tab="disposition"]').click();
await beta.locator("#fDischargeCondition").fill("Panaszmentes, jó általános állapotú.");

// Dedicated metadata persistence must save these fields even before manual ESET MENTÉSE.
await beta.locator("#fDischargeCondition").blur();
await beta.waitForTimeout(220);
let dischargePersisted = await beta.evaluate(() => {
  const state = JSON.parse(localStorage.getItem("__bach_sbo_e2e_state") || "{}");
  const patient = state?.patients?.[0] || null;
  return {
    disposition: patient?.disposition || "",
    dischargeCondition: patient?.dischargeCondition || ""
  };
});
if (
  dischargePersisted.disposition !== "discharged" ||
  dischargePersisted.dischargeCondition !== "Panaszmentes, jó általános állapotú."
) {
  throw new Error("Decision discharge metadata did not persist: " + JSON.stringify(dischargePersisted));
}

// Manual save must keep the same canonical values.
await beta.locator("#savePatientBtn").click();
await beta.waitForTimeout(250);

await beta.reload({ waitUntil: "domcontentloaded" });
await beta.locator("#patientsView:not(.hidden)").waitFor();
await beta.locator("#patientTbody tr[data-id]", { hasText: "Existing smoke case" }).click();
await beta.locator('[data-cockpit-tab="disposition"]').click();
if ((await beta.locator("#fDisposition").inputValue()) !== "discharged") {
  throw new Error("Discharged disposition was lost after reload");
}
if ((await beta.locator("#fDischargeCondition").inputValue()) !== "Panaszmentes, jó általános állapotú.") {
  throw new Error("Discharge condition was lost after reload");
}

// Disposition is mutually exclusive in canonical patient state. Switching
// branches must immediately clear hidden data from the previous branch.
await beta.locator("#recList [data-rec]").first().fill("Háziorvosi kontroll.");
await beta.waitForFunction(() =>
  window.BachSBOClinicalUi?.getPatientSnapshot?.()?.recommendations?.[0] === "Háziorvosi kontroll."
);

await beta.locator("#fDisposition").selectOption("admitted");
await beta.waitForFunction(() => {
  const p = window.BachSBOClinicalUi?.getPatientSnapshot?.();
  return p?.disposition === "admitted" &&
    p?.dischargeCondition === "" &&
    Array.isArray(p?.recommendations) &&
    p.recommendations.length === 0 &&
    document.querySelector("#dischargedFields")?.classList.contains("hidden") &&
    !document.querySelector("#admittedFields")?.classList.contains("hidden");
});

await beta.locator("#cockpitWardSelect").selectOption("Kardiológia");
await beta.waitForFunction(() =>
  window.BachSBOClinicalUi?.getPatientSnapshot?.()?.ward === "Kardiológia"
);

await beta.locator("#fDisposition").selectOption("other");
await beta.waitForFunction(() => {
  const p = window.BachSBOClinicalUi?.getPatientSnapshot?.();
  return p?.disposition === "other" &&
    p?.ward === "" &&
    p?.hospital === "" &&
    !document.querySelector("#otherFields")?.classList.contains("hidden") &&
    document.querySelector("#admittedFields")?.classList.contains("hidden");
});
await beta.locator("#fOtherOutcome").fill("Saját felelősségre távozott");
await beta.waitForFunction(() =>
  window.BachSBOClinicalUi?.getPatientSnapshot?.()?.otherOutcome === "Saját felelősségre távozott"
);

await beta.locator("#fDisposition").selectOption("discharged");
await beta.waitForFunction(() => {
  const p = window.BachSBOClinicalUi?.getPatientSnapshot?.();
  return p?.disposition === "discharged" &&
    p?.otherOutcome === "" &&
    p?.otherDetails === "" &&
    !document.querySelector("#dischargedFields")?.classList.contains("hidden") &&
    document.querySelector("#otherFields")?.classList.contains("hidden");
});

// Restore the discharge branch for the rest of the smoke workflow.
await beta.locator("#fDischargeCondition").fill("Panaszmentes, jó általános állapotú.");
await beta.locator("#recList [data-rec]").first().fill("Háziorvosi kontroll.");
await beta.locator("#fDischargeCondition").blur();
await beta.waitForTimeout(220);

// Regression from the uploaded recording: typing into a result must not remove
// Stable cockpit's compact test-row class and temporarily expand the card.
await beta.locator('[data-cockpit-tab="tests"]').click();
await beta.locator('[data-card="ekg-0"].cockpit-test-row').waitFor();
if (await beta.locator('[data-card="ekg-0"] .test-save').isVisible()) {
  throw new Error("Stable cockpit still shows the redundant Save Result button");
}
await beta.locator('[data-card="ekg-0"] textarea[data-text="ekg-0"]').fill("temporary EKG text");
await beta.waitForFunction(() =>
  window.BachSBOClinicalUi?.getPatientSnapshot?.()?.tests?.ekgs?.[0]?.text === "temporary EKG text"
);
let testClasses = await beta.locator('[data-card="ekg-0"]').getAttribute("class");
if (!String(testClasses).includes("cockpit-test-row")) {
  throw new Error(`EKG card lost compact layout while typing: ${testClasses}`);
}
await beta.locator('[data-card="ekg-0"] textarea[data-text="ekg-0"]').fill("");
await beta.locator('[data-card="radiology-0"].cockpit-test-row').waitFor();
await beta.locator('[data-card="radiology-0"] textarea[data-text="radiology-0"]').fill("temporary radiology text");
await beta.waitForFunction(() =>
  window.BachSBOClinicalUi?.getPatientSnapshot?.()?.tests?.radiology?.[0]?.text === "temporary radiology text"
);
testClasses = await beta.locator('[data-card="radiology-0"]').getAttribute("class");
if (!String(testClasses).includes("cockpit-test-row")) {
  throw new Error(`Radiology card lost compact layout while typing: ${testClasses}`);
}
await beta.locator('[data-card="radiology-0"] textarea[data-text="radiology-0"]').fill("");

// Unified direct-add menu order is clinically fixed and must retain free-form Other.
await beta.locator("#cockpitAddTest").click();
await beta.locator("#cockpitAddTestMenu:not(.hidden)").waitFor();
const unifiedTestOptions = await beta.locator("#cockpitAddTestMenu [data-add-test-type]").evaluateAll((nodes) =>
  nodes.map((node) => node.getAttribute("data-add-test-type"))
);
const expectedUnifiedOrder = ["lab", "ekg", "gas", "imaging", "consultation", "other"];
if (JSON.stringify(unifiedTestOptions) !== JSON.stringify(expectedUnifiedOrder)) {
  throw new Error("Unexpected unified investigation order: " + JSON.stringify(unifiedTestOptions));
}

// Every unified investigation type must add exactly one entry from the promoted Stable menu.
const labCountBeforeAdd = await beta.locator('#labCards .test-card').count();
await beta.locator('#cockpitAddTestMenu [data-add-test-type="lab"]').click();
await beta.waitForFunction((expected) =>
  document.querySelectorAll("#labCards .test-card").length === expected,
  labCountBeforeAdd + 1
);
await beta.locator('#labCards .test-card').last().locator("[data-delete-test]").click();

const consultationCountBeforeAdd = await beta.locator('#consultCards .test-card').count();
await beta.locator("#cockpitAddTest").click();
await beta.locator('#cockpitAddTestMenu [data-add-test-type="consultation"]').click();
await beta.waitForFunction((expected) =>
  document.querySelectorAll("#consultCards .test-card").length === expected,
  consultationCountBeforeAdd + 1
);
await beta.locator('#consultCards .test-card').last().locator("[data-delete-test]").click();

const otherCountBeforeAdd = await beta.locator('#consultCards .test-card').count();
await beta.locator("#cockpitAddTest").click();
await beta.locator('#cockpitAddTestMenu [data-add-test-type="other"]').click();
await beta.locator("#cockpitOtherTestRow:not(.hidden)").waitFor();
await beta.locator("#cockpitOtherTestName").fill("Smoke Egyéb");
await beta.locator("#cockpitOtherTestConfirm").click();
await beta.waitForFunction((expected) =>
  document.querySelectorAll("#consultCards .test-card").length === expected,
  otherCountBeforeAdd + 1
);
const addedOther = beta.locator('#consultCards .test-card').last();
if ((await addedOther.locator("[data-type]").inputValue()) !== "Smoke Egyéb") {
  throw new Error("Free-form Egyéb investigation name was not preserved");
}
await addedOther.locator("[data-delete-test]").click();

// EKG and AVG are one-menu-click multi-entry groups.
const ekgCountBeforeAdd = await beta.locator('#ekgCard .test-card').count();
await beta.locator("#cockpitAddTest").click();
await beta.locator('#cockpitAddTestMenu [data-add-test-type="ekg"]').click();
await beta.waitForFunction((expected) =>
  document.querySelectorAll("#ekgCard .test-card").length === expected,
  ekgCountBeforeAdd + 1
);
await beta.locator('#ekgCard .test-card').last().locator("[data-delete-test]").click();

const gasCountBeforeAdd = await beta.locator('#gasCard .test-card').count();
await beta.locator("#cockpitAddTest").click();
await beta.locator('#cockpitAddTestMenu [data-add-test-type="gas"]').click();
await beta.waitForFunction((expected) =>
  document.querySelectorAll("#gasCard .test-card").length === expected,
  gasCountBeforeAdd + 1
);
await beta.locator('#gasCard .test-card').last().locator("[data-delete-test]").click();

// Radiology also adds from one menu choice, with no second Add click.
const radiologyCountBeforeAdd = await beta.locator('#radiologyCards .test-card').count();
await beta.locator("#cockpitAddTest").click();
await beta.locator('#cockpitAddTestMenu [data-add-test-type="imaging"]').click();
await beta.waitForFunction((expected) =>
  document.querySelectorAll("#radiologyCards .test-card").length === expected,
  radiologyCountBeforeAdd + 1
);
const addedRadiology = beta.locator('#radiologyCards .test-card').last();

// A blank Radiology entry must stay structurally blank. The display fallback
// "Radiology" must never be persisted as a fake custom modality after autosave.
if ((await addedRadiology.locator("[data-modality]").inputValue()) !== "") {
  throw new Error("New Radiology row unexpectedly selected a modality");
}
if ((await addedRadiology.locator("[data-other]").inputValue()) !== "") {
  throw new Error("New Radiology row unexpectedly contains a custom test name");
}
if (await addedRadiology.locator("[data-other]").isVisible()) {
  throw new Error("Blank Radiology row incorrectly shows the custom-test input");
}

const radiologyControlWidths = await addedRadiology.evaluate((card) => {
  const body = card.querySelector("[data-body]");
  const modality = card.querySelector("[data-modality]");
  if (!body || !modality) return null;
  return {
    body: body.getBoundingClientRect().width,
    modality: modality.getBoundingClientRect().width
  };
});
if (!radiologyControlWidths || radiologyControlWidths.body < 70 || radiologyControlWidths.modality < 80) {
  throw new Error("Radiology selectors are still collapsed in compact layout: " + JSON.stringify(radiologyControlWidths));
}

const deleteAtEnd = await addedRadiology.evaluate((card) => {
  const result = card.querySelector("textarea");
  const remove = card.querySelector("[data-delete-test]");
  const dots = card.querySelector(".mode-dots");
  if (!result || !remove || !dots) return null;
  const rr = result.getBoundingClientRect();
  const dr = remove.getBoundingClientRect();
  return {
    deleteAfterResult: dr.left >= rr.right - 2,
    deleteInsideDots: dots.contains(remove)
  };
});
if (!deleteAtEnd?.deleteAfterResult || deleteAtEnd?.deleteInsideDots) {
  throw new Error("Investigation delete action is not isolated at the end of the row: " + JSON.stringify(deleteAtEnd));
}
await addedRadiology.locator("[data-delete-test]").click();
await beta.waitForFunction((expected) =>
  document.querySelectorAll("#radiologyCards .test-card").length === expected,
  radiologyCountBeforeAdd
);

const consultationPrefix = beta.locator('#consultCards [data-card="consultations-0"] .cockpit-consultation-prefix');
await consultationPrefix.waitFor({ state: "visible" });
if (!/Consultation|Konzílium/.test(await consultationPrefix.textContent())) {
  throw new Error("Consultation card does not show a generic consultation label");
}
if ((await beta.locator('#consultCards [data-type="consultations-0"]').inputValue()) !== "Kardiológia") {
  throw new Error("Consultation specialty was lost");
}
await beta.locator('[data-cockpit-tab="clinical"]').click();

// Regression: a case with many unresolved fields must not expand the Case list row
// or push neighbouring cases down while app.js rewrites the status cell.
const initialCaseRowHeight = await caseRow.evaluate((node) => node.getBoundingClientRect().height);
await beta.evaluate(() => {
  for (const field of ["complaint", "history", "physical", "therapy", "course"]) {
    document.querySelector(`[data-none-toggle="${field}"]`)?.click();
  }
});
await beta.waitForTimeout(80);
const blockedCaseRowHeight = await caseRow.evaluate((node) => node.getBoundingClientRect().height);
if (Math.abs(blockedCaseRowHeight - initialCaseRowHeight) > 1.5 || blockedCaseRowHeight > 56) {
  throw new Error(
    `Stable Case list row resized with unresolved items: ${initialCaseRowHeight} -> ${blockedCaseRowHeight}`
  );
}
// Restore the seeded "none" state for the remainder of the smoke flow.
await beta.evaluate(() => {
  for (const field of ["complaint", "history", "physical", "therapy", "course"]) {
    document.querySelector(`[data-none-toggle="${field}"]`)?.click();
  }
});

await beta.locator("#cockpitAnalyzeCase").click();
await beta.waitForFunction(() =>
  (document.querySelector("#cockpitAssistantResults")?.textContent || "").includes("Gyógyszerallergia")
);
const assistantTextAfterRun = await beta.locator("#cockpitAssistantResults").textContent();
if (!assistantTextAfterRun.includes("Gyógyszerallergia")) {
  throw new Error("Case Assistant did not surface expected missing information");
}

const assistantOrderBefore = await beta.locator("#cockpitAssistantResults .cockpit-todo-item").evaluateAll((nodes) =>
  nodes.map((node) => node.dataset.itemId)
);
const firstAssistantItem = beta.locator('#cockpitAssistantResults .cockpit-todo-item[data-item-id="66666666-6666-4666-8666-666666666666"]');
const assistantButtonOrder = await firstAssistantItem.locator(".cockpit-decision").evaluateAll((nodes) =>
  nodes.map((node) => node.textContent.trim())
);
if (JSON.stringify(assistantButtonOrder) !== JSON.stringify(["DONE", "YES", "NO"])) {
  throw new Error("Case Assistant decision order must be DONE → YES → NO");
}
if (await firstAssistantItem.locator('[data-decision="na"]').count()) {
  throw new Error("Case Assistant still exposes N/A");
}

for (const spec of [
  { decision: "done", buttonRgb: "rgb(6, 118, 71)", boxRgb: "rgb(236, 253, 243)" },
  { decision: "yes", buttonRgb: "rgb(181, 71, 8)", boxRgb: "rgb(255, 247, 237)" },
  { decision: "no", buttonRgb: "rgb(71, 84, 103)", boxRgb: "rgb(208, 213, 221)" }
]) {
  await firstAssistantItem.locator(`.cockpit-decision.${spec.decision}`).click();
  await beta.waitForFunction(({ decision }) =>
    document.querySelector('#cockpitAssistantResults .cockpit-todo-item[data-item-id="66666666-6666-4666-8666-666666666666"]')?.classList.contains("decision-" + decision),
    { decision: spec.decision }
  );
  const visual = await firstAssistantItem.evaluate((node, decision) => {
    const button = node.querySelector(".cockpit-decision." + decision + ".selected");
    return {
      buttonBackground: button ? getComputedStyle(button).backgroundColor : "",
      buttonColor: button ? getComputedStyle(button).color : "",
      boxBackground: getComputedStyle(node).backgroundColor
    };
  }, spec.decision);
  if (
    visual.buttonBackground !== spec.buttonRgb ||
    visual.buttonColor !== "rgb(255, 255, 255)" ||
    visual.boxBackground !== spec.boxRgb
  ) {
    throw new Error(`Unexpected Case Assistant ${spec.decision} visual: ${JSON.stringify(visual)}`);
  }
}
const assistantOrderAfter = await beta.locator("#cockpitAssistantResults .cockpit-todo-item").evaluateAll((nodes) =>
  nodes.map((node) => node.dataset.itemId)
);
if (JSON.stringify(assistantOrderAfter) !== JSON.stringify(assistantOrderBefore)) {
  throw new Error("Case Assistant reordered items after doctor decision");
}

// AI-assisted fact application must be able to save a still-incomplete active
// chart. Discharge completeness is a Save/Generate/Finalize gate, not a reason
// to discard explicitly accepted extracted facts.
await beta.locator('[data-cockpit-tab="disposition"]').click();
await beta.locator("#fDisposition").selectOption("discharged");
await beta.locator("#fDischargeCondition").fill("");
await beta.locator('[data-cockpit-tab="clinical"]').click();

await beta.locator("#cockpitDataEntryBtn").click();
await beta.waitForFunction(() =>
  document.querySelector("#cockpitDataEntryOverlay")?.classList.contains("open")
);

// Regression: losing the global validation-core reference while the extraction
// request is in flight must not break preview rendering.
await beta.evaluate(() => { window.__BACH_E2E_DROP_ASSISTANT_CORE_DURING_EXTRACT = true; });
await beta.locator("#cockpitPasteText").fill("Jelen panasz: mellkasi fájdalom.");
await beta.locator("#cockpitExtractText").click();
await beta.locator(".cockpit-extract-item").waitFor();
const validationStatus = await beta.locator("#cockpitExtractStatus").textContent();
if (/validációs modul nem érhető el|validation core is unavailable/i.test(validationStatus || "")) {
  throw new Error("Extraction lost the validation core during the API round trip");
}
await beta.waitForTimeout(80);

await beta.locator("#cockpitPasteText").fill("Jelen panasz: mellkasi fájdalom.");
await beta.locator("#cockpitExtractText").click();
await beta.locator(".cockpit-extract-item").waitFor();

// Doctor override: destination field and proposed wording must both remain editable.
const firstExtract = beta.locator(".cockpit-extract-item").first();
await firstExtract.locator(".cockpit-target-select").selectOption("others");
await firstExtract.locator(".cockpit-extract-edit").fill("mellkasi fájdalom – orvos által felülírt szöveg");
await firstExtract.locator(".cockpit-decision.yes").click();
await beta.locator("#cockpitApplyAccepted").click();
await beta.locator("#cockpitExtractConfirmOverlay:not(.hidden)").waitFor();
await beta.locator("#cockpitExtractConfirmApply").click();
await beta.waitForFunction(() => document.querySelector("#fOthers")?.value.includes("orvos által felülírt"));

const appliedOverride = await beta.locator("#fOthers").inputValue();
if (!appliedOverride.includes("mellkasi fájdalom – orvos által felülírt szöveg")) {
  throw new Error("Doctor-edited extracted text or target override was not applied");
}
const applyStatusWithIncompleteDischarge = await beta.locator("#cockpitExtractStatus").textContent();
if (/Otthonába bocsátás esetén kötelező|Discharge condition \/ symptoms is required/i.test(applyStatusWithIncompleteDischarge || "")) {
  throw new Error("AI fact apply was incorrectly blocked by discharge completeness");
}
const persistedOverride = await beta.evaluate(() => {
  const state = JSON.parse(localStorage.getItem("__bach_sbo_e2e_state") || "{}");
  return state?.patients?.[0]?.others || "";
});
if (!persistedOverride.includes("orvos által felülírt szöveg")) {
  throw new Error("Doctor override from AI data entry was not persisted");
}

// Close the modal before editing the underlying clinical form, then reopen it
// for the conflict/failure extraction scenario.
await beta.locator("#cockpitDataEntryClose").click();
await beta.waitForFunction(() =>
  !document.querySelector("#cockpitDataEntryOverlay")?.classList.contains("open")
);
await beta.locator('[data-none-toggle="history"]').click();
await beta.locator("#fHistory").fill("Doctor draft must survive");
await beta.locator("#cockpitDataEntryBtn").click();
await beta.waitForFunction(() =>
  document.querySelector("#cockpitDataEntryOverlay")?.classList.contains("open")
);
await beta.locator("#cockpitPasteText").fill("Anamnézis: hypertonia.");
await beta.locator("#cockpitExtractText").click();
await beta.locator(".cockpit-extract-item", { hasText: "Hypertonia" }).waitFor();
await beta.waitForFunction(() =>
  (document.querySelector("#cockpitExtractPreview")?.textContent || "").includes("Conflicting timing in source")
);
const extractionWarningText = await beta.locator("#cockpitExtractPreview").textContent();
if (!extractionWarningText.includes("Conflicting timing in source")) {
  throw new Error("Extraction preview did not surface extraction warning");
}
await beta.locator(".cockpit-extract-item", { hasText: "Hypertonia" }).locator(".cockpit-decision.yes").click();
await beta.evaluate(() => { window.__BACH_E2E_FAIL_NEXT_SAVE = true; });
await beta.locator("#cockpitApplyAccepted").click();
await beta.locator("#cockpitExtractConfirmOverlay:not(.hidden)").waitFor();
await beta.locator("#cockpitExtractConfirmApply").click();
await beta.waitForFunction(() => (document.querySelector("#cockpitExtractStatus")?.textContent || "").includes("Synthetic save failure"));

const historyAfterFailure = await beta.locator("#fHistory").inputValue();
if (historyAfterFailure !== "Doctor draft must survive") {
  throw new Error("Doctor draft was not restored after failed AI apply");
}
if (historyAfterFailure.includes("Hypertonia")) {
  throw new Error("Failed AI apply leaked extracted content into clinician draft");
}

await beta.locator("#cockpitDataEntryClose").click();
await beta.waitForFunction(() =>
  !document.querySelector("#cockpitDataEntryOverlay")?.classList.contains("open")
);

await beta.locator("#aiLearningNav").click();
await beta.locator("#styleProfilesList").waitFor();
await beta.waitForFunction(() =>
  (document.querySelector("#styleProfilesList")?.textContent || "").includes("Candidate two analysis")
);

const styleV1 = beta.locator('[data-style-profile="88888888-8888-4888-8888-888888888881"]');
const styleV2 = beta.locator('[data-style-profile="88888888-8888-4888-8888-888888888882"]');

await styleV1.locator("[data-reject-style]").click();
await beta.waitForFunction(() =>
  (document.querySelector('[data-style-profile="88888888-8888-4888-8888-888888888881"]')?.textContent || "").includes("REJECTED")
);
const rejectedActive = await beta.evaluate(() => {
  const node = document.querySelector('[data-style-profile="88888888-8888-4888-8888-888888888881"]');
  return (node?.textContent || "").includes("ACTIVE");
});
if (rejectedActive) throw new Error("Rejected style became active");

cancelNextBetaDialog = true;
await styleV2.locator("[data-activate-style]").click();
await beta.waitForTimeout(50);
const activeAfterCancel = await beta.locator("#learningActiveStyle").textContent();
if (activeAfterCancel.includes("v2")) {
  throw new Error("Style activated despite cancelled confirmation");
}

await styleV2.locator("[data-activate-style]").click();
await beta.waitForFunction(() =>
  (document.querySelector("#learningActiveStyle")?.textContent || "").includes("v2")
);
const activeStyle = await beta.locator("#learningActiveStyle").textContent();
if (!activeStyle.includes("v2")) {
  throw new Error("Confirmed Style Coach candidate was not activated");
}

await beta.locator("#corpusReviewList").waitFor();
await beta.waitForFunction(() =>
  (document.querySelector("#corpusReviewList")?.textContent || "").includes("Mock finalized corpus text")
);
const corpusItem = beta.locator(".corpus-review-item", { hasText: "Mock finalized corpus text" });
await corpusItem.locator('[data-decision="excluded"]').click();
await beta.waitForFunction(() =>
  (document.querySelector("#corpusReviewList")?.textContent || "").includes("EXCLUDED")
);
const corpusAfterReview = await beta.locator("#corpusReviewList").textContent();
if (!corpusAfterReview.includes("EXCLUDED")) {
  throw new Error("Corpus review did not update to EXCLUDED");
}

// Final promoted-Stable gate: prepare a fully resolved case, then generate and finalize.
await beta.locator("#patientsNav").click();
await beta.evaluate(() => {
  const key = "__bach_sbo_e2e_state";
  const state = JSON.parse(localStorage.getItem(key) || "{}");
  const p = state?.patients?.[0];
  if (!p) throw new Error("Missing smoke patient before summary/finalize");
  for (const field of ["complaint", "history", "physical", "therapy", "course", "diagnoses"]) {
    p[field] = "";
    p[field + "Skipped"] = true;
  }
  for (const group of ["labs", "ekgs", "gases", "radiology", "consultations"]) {
    for (const entry of p.tests?.[group] || []) {
      entry.mode = "notordered";
      entry.text = "";
      entry.savedText = "";
    }
  }
  p.disposition = "discharged";
  p.dischargeCondition = "Panaszmentes, jó általános állapotú.";
  p.recommendations = ["Háziorvosi kontroll javasolt."];
  p.summary = "";
  p.summaryGeneratedText = "";
  p.summaryGeneratedAt = null;
  p.summaryFinalizedText = "";
  p.summaryFinalizedAt = null;
  localStorage.setItem(key, JSON.stringify(state));
});
await beta.reload({ waitUntil: "domcontentloaded" });
await beta.locator("#patientsView:not(.hidden)").waitFor();
await beta.locator("#patientTbody tr[data-id]", { hasText: "Existing smoke case" }).click();
await beta.locator('[data-cockpit-tab="summary"]').click();
await beta.waitForFunction(() => {
  const generate = document.querySelector("#generateSummaryBtn");
  const finalize = document.querySelector("#finalizeSummaryBtn");
  const workflow = window.BachSBOClinicalUi?.getWorkflowStatus?.();
  const tabsReady = ["clinical", "tests", "course", "disposition"].every((key) =>
    !document.querySelector(`[data-cockpit-tab="${key}"]`)?.classList.contains("has-summary-gap")
  );
  return Boolean(
    workflow?.summaryReady &&
    tabsReady &&
    generate &&
    finalize &&
    !generate.disabled &&
    !finalize.disabled
  );
});
await beta.locator("#generateSummaryBtn").click();
await beta.waitForFunction(() => document.querySelector("#fSummary")?.value === "Mock summary");
if ((await beta.locator("#fSummary").inputValue()) !== "Mock summary") {
  throw new Error("Summary generation did not populate the summary text");
}
await beta.locator("#finalizeSummaryBtn").click();
await beta.waitForFunction(() => {
  const raw = localStorage.getItem("__bach_sbo_e2e_state");
  const p = raw ? JSON.parse(raw)?.patients?.[0] : null;
  return Boolean(p?.summaryFinalizedAt && p?.summaryFinalizedText === "Mock summary");
});
const finalizedState = await beta.evaluate(() => {
  const p = JSON.parse(localStorage.getItem("__bach_sbo_e2e_state") || "{}")?.patients?.[0];
  return {
    finalizedAt: p?.summaryFinalizedAt || null,
    finalizedText: p?.summaryFinalizedText || "",
    status: document.querySelector("#summaryStatus")?.textContent || ""
  };
});
if (!finalizedState.finalizedAt || finalizedState.finalizedText !== "Mock summary") {
  throw new Error("Finalize did not persist the generated summary: " + JSON.stringify(finalizedState));
}

// Beta remains an isolated experiment entrypoint. Promoted features come from
// Stable production assets; beta-only features must not appear on Stable.
await beta.evaluate(() => {
  const key = "__bach_sbo_e2e_state";
  const state = JSON.parse(localStorage.getItem(key) || "{}");
  const p = state?.patients?.[0];
  if (!p) throw new Error("Missing smoke patient before beta shell gate");
  p.summaryFinalizedAt = null;
  p.summaryFinalizedText = "";
  p.physical = "";
  p.physicalSkipped = false;
  localStorage.setItem(key, JSON.stringify(state));
});

const betaFeatures = await context.newPage();
betaFeatures.on("dialog", async (dialog) => dialog.accept());
await betaFeatures.goto(baseUrl + "/beta.html", { waitUntil: "domcontentloaded" });
if (await betaFeatures.locator("#authPassword").count()) {
  await betaFeatures.locator("#authPassword").fill("smoke-test-password");
  await betaFeatures.locator("#passwordSignIn").click();
}
if (await betaFeatures.locator("#chooseNormalMode").count()) {
  await betaFeatures.locator("#chooseNormalMode").click();
}
await betaFeatures.locator("#patientsView:not(.hidden)").waitFor();
await betaFeatures.waitForFunction(() =>
  document.body.classList.contains("beta-build") &&
  document.body.classList.contains("cockpit-ui")
);
if (!await betaFeatures.evaluate(() => Boolean(window.BACH_SBO_BETA_FINDING_REGISTRY))) {
  throw new Error("Beta generated finding registry did not load before beta features");
}
await betaFeatures.locator(".beta-build-badge").waitFor();
await betaFeatures.waitForFunction(() => {
  const text = document.querySelector("#shiftMeta .shift-dashboard-pill")?.textContent || "";
  return /\d{4}/.test(text) && /(Aktív|Active)\s*:/.test(text);
});
for (const metricClass of ["shift-metric-cases", "shift-metric-active", "shift-metric-completed"]) {
  if (await betaFeatures.locator("#shiftMeta ." + metricClass).count() !== 1) {
    throw new Error("Beta shell is not tracking Stable shift metric: " + metricClass);
  }
}
await betaFeatures.locator("#patientTbody tr[data-id]").first().click();
await betaFeatures.locator("#caseTriageControl").waitFor();
if (await betaFeatures.locator("#betaTriageControl").count()) {
  throw new Error("Promoted triage is still duplicated in the beta-only layer");
}

await betaFeatures.locator('[data-cockpit-tab="tests"]').click();

// Structured STATUS: parameters + positive findings are persisted, while the
// full generated copy text remains derived UI output only.
await betaFeatures.locator("#betaStructuredStatus").waitFor();
await betaFeatures.locator('[data-status-param="bloodPressure"]').fill("135/80");
await betaFeatures.locator('[data-status-param="pulse"]').fill("88");
await betaFeatures.locator('[data-status-section="E5"]').fill("Hasa érzékeny.");
await betaFeatures.locator("#betaGenerateStructuredStatus").click();
await betaFeatures.waitForFunction(() =>
  document.querySelector("#betaStructuredStatus")?.classList.contains("is-generated") &&
  !document.querySelector("#betaStructuredStatusDone")?.classList.contains("hidden")
);
for (const selector of [
  '[data-status-param="bloodPressure"]',
  '[data-status-param="pulse"]',
  '[data-status-section="E5"]'
]) {
  if (!await betaFeatures.locator(selector).isVisible()) {
    throw new Error("Structured STATUS input was hidden after generation: " + selector);
  }
}
const structuredStatusState = await betaFeatures.evaluate(() => {
  const patient = window.BachSBOClinicalUi?.getPatientSnapshot?.();
  const workflow = window.BachSBOClinicalUi?.getWorkflowStatus?.();
  return {
    physical: patient?.physical || "",
    physicalStatus: patient?.physicalStatus || null,
    physicalReady: !workflow?.sections?.tests?.blockers?.some((x) =>
      /Fizik|Physical examination/i.test(String(x))
    )
  };
});
if (
  structuredStatusState.physicalStatus?.parameters?.bloodPressure !== "135/80" ||
  structuredStatusState.physicalStatus?.parameters?.pulse !== "88" ||
  structuredStatusState.physicalStatus?.sections?.E5 !== "Hasa érzékeny." ||
  !structuredStatusState.physicalStatus?.generatedAt
) {
  throw new Error("Structured STATUS data did not persist in the case state: " + JSON.stringify(structuredStatusState));
}
if (
  !structuredStatusState.physical.includes("E5: Hasa érzékeny.") ||
  structuredStatusState.physical.includes("135/80") ||
  structuredStatusState.physical.includes("Légutak átjárhatók")
) {
  throw new Error("Physical summary bridge contains parameters or generated normal text: " + structuredStatusState.physical);
}
if (!structuredStatusState.physicalReady) {
  throw new Error("Generated structured STATUS did not resolve the Physical examination workflow blocker");
}
await betaFeatures.locator("#betaStructuredStatusView").click();
const structuredCopyPreview = await betaFeatures.locator("#betaStructuredStatusPreview").inputValue();
for (const expected of [
  "Paraméterek: vérnyomás 135/80 Hgmm, pulsus 88/perc.",
  "A: Légutak átjárhatók.",
  "E5 – Has:",
  "nyomásérzékeny"
]) {
  if (!structuredCopyPreview.includes(expected)) {
    throw new Error("Structured STATUS copy preview missing: " + expected + "\n" + structuredCopyPreview);
  }
}
await betaFeatures.locator("#betaStructuredStatusView").click();

// EKG helper is deliberately ephemeral: editing its two templates must not
// mutate the patient test state or feed the Summary data path.
await betaFeatures.locator("#betaEkgCopyBuilder").waitFor();
const ekgStateBefore = await betaFeatures.evaluate(() =>
  JSON.stringify(window.BachSBOClinicalUi?.getPatientSnapshot?.()?.tests?.ekgs || [])
);
await betaFeatures.locator("#betaEkgFr").fill("72");
await betaFeatures.locator("#betaEkgPq").fill("160");
await betaFeatures.locator("#betaEkgQrs").fill("90");
await betaFeatures.locator("#betaEkgQtc").fill("420");
await betaFeatures.locator("#betaEkgTransition").fill("V3–V4");
const detailedEkg = await betaFeatures.locator("#betaEkgOutput").inputValue();
for (const expected of ["SR", "72/min", "PQ: 160 ms", "QRS: 90 ms", "QTc: 420 ms", "V3–V4"]) {
  if (!detailedEkg.includes(expected)) {
    throw new Error("Detailed EKG helper missing: " + expected + "\n" + detailedEkg);
  }
}
await betaFeatures.locator("#betaEkgTemplate").selectOption("short");
const shortEkg = await betaFeatures.locator("#betaEkgOutput").inputValue();
if (!shortEkg.includes("norm. átvezetési idők") || shortEkg.includes("PQ: 160 ms")) {
  throw new Error("Short EKG helper did not switch templates: " + shortEkg);
}
const ekgStateAfter = await betaFeatures.evaluate(() =>
  JSON.stringify(window.BachSBOClinicalUi?.getPatientSnapshot?.()?.tests?.ekgs || [])
);
if (ekgStateAfter !== ekgStateBefore) {
  throw new Error("Local-only EKG helper mutated persisted EKG test state");
}

// Reload regression: structured STATUS survives; EKG helper resets because it
// is intentionally copy-only and never part of patient persistence.
await betaFeatures.reload({ waitUntil: "domcontentloaded" });
if (await betaFeatures.locator("#authPassword").count()) {
  await betaFeatures.locator("#authPassword").fill("smoke-test-password");
  await betaFeatures.locator("#passwordSignIn").click();
}
if (await betaFeatures.locator("#chooseNormalMode").count()) {
  await betaFeatures.locator("#chooseNormalMode").click();
}
await betaFeatures.locator("#patientsView:not(.hidden)").waitFor();
await betaFeatures.locator("#patientTbody tr[data-id]").first().click();
await betaFeatures.locator('[data-cockpit-tab="tests"]').click();
await betaFeatures.locator("#betaStructuredStatus").waitFor();
await betaFeatures.locator("#betaStructuredStatusDone:not(.hidden)").waitFor();
if ((await betaFeatures.locator('[data-status-param="bloodPressure"]').inputValue()) !== "135/80") {
  throw new Error("Structured STATUS blood pressure did not survive reload");
}
if ((await betaFeatures.locator('[data-status-section="E5"]').inputValue()) !== "Hasa érzékeny.") {
  throw new Error("Structured STATUS positive E5 finding did not survive reload");
}
if (!await betaFeatures.locator('[data-status-param="bloodPressure"]').isVisible() ||
    !await betaFeatures.locator('[data-status-section="E5"]').isVisible()) {
  throw new Error("Structured STATUS facts should remain visible after reload");
}
if (!await betaFeatures.locator("#betaStructuredStatusPreview").isHidden()) {
  throw new Error("Generated full STATUS preview should stay hidden after reload");
}
if ((await betaFeatures.locator('[data-status-param="bloodPressure"]').inputValue()) !== "135/80" ||
    (await betaFeatures.locator('[data-status-section="E5"]').inputValue()) !== "Hasa érzékeny.") {
  throw new Error("Structured STATUS values changed after reload");
}
if ((await betaFeatures.locator("#betaEkgFr").inputValue()) !== "") {
  throw new Error("Local-only EKG helper incorrectly survived reload");
}

// Beta-only physical finding composer: deterministic local parsing only.
// fPhysical is now an intentionally hidden compatibility bridge behind the
// structured STATUS UI, so parser regression coverage writes to it directly.
await betaFeatures.locator('[data-cockpit-tab="tests"]').click();
const fillBetaPhysicalBridge = async (value) => {
  await betaFeatures.locator("#fPhysical").evaluate((element, text) => {
    element.value = text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
};
await fillBetaPhysicalBridge("epig nyomérz, dyspnoe nincs, jobb basalis crepitatio");
await betaFeatures.waitForFunction(() =>
  document.querySelectorAll("#betaFindingComposer .beta-finding-chip").length === 3 &&
  !(document.querySelector("#betaCopyStatus")?.disabled)
);
const abcdePreview = await betaFeatures.locator("#betaStatusPreview").inputValue();
for (const expected of [
  "A: Légutak átjárhatók.",
  "Nehézlégzés nincs.",
  "jobb basalis crepitatio hallható",
  "epigastriumban nyomásérzékeny"
]) {
  if (!abcdePreview.includes(expected)) {
    throw new Error("ABCDE finding composer preview missing: " + expected + "\n" + abcdePreview);
  }
}
if (abcdePreview.includes("Zörejek: nincs.")) {
  throw new Error("ABCDE preview kept normal lung-noise text despite crepitatio");
}

// Real-world shorthand coverage: abdominal tenderness + tachyarrhythmia + murmur + bilateral congestion.
await fillBetaPhysicalBridge("Hasa érzékeny. Tachyarritmiás szívritmus, 6/5ös systolés zörej. Mko. tüdő fölött pangás hallható.");
await betaFeatures.waitForFunction(() =>
  document.querySelectorAll("#betaFindingComposer .beta-finding-chip").length === 4 &&
  document.querySelectorAll("#betaUnknownChips .beta-unknown-chip").length === 0
);
const realWorldChips = await betaFeatures.locator("#betaFindingComposer .beta-finding-chip").allTextContents();
for (const expected of [
  "Hasi nyomásérzékenység",
  "Tachyarrhythmiás szívritmus",
  "6/5 systolés zörej",
  "mko. tüdő felett pangás"
]) {
  if (!realWorldChips.includes(expected)) {
    throw new Error("Real-world finding parser missed: " + expected + " -> " + JSON.stringify(realWorldChips));
  }
}
const realWorldPreview = await betaFeatures.locator("#betaStatusPreview").inputValue();
for (const expected of [
  "nyomásérzékeny",
  "tachyarrhythmiás",
  "6/5 systolés zörej hallható",
  "mko. tüdő felett pangás hallható"
]) {
  if (!realWorldPreview.includes(expected)) {
    throw new Error("Real-world status preview missed: " + expected + "\n" + realWorldPreview);
  }
}

// Every line must be reviewed independently: a known first line must not hide an unknown second line.
await fillBetaPhysicalBridge("Hasa érzékeny.\nBal oldalon pleuralis dörzszörej hallható.");
await betaFeatures.waitForFunction(() =>
  document.querySelectorAll("#betaFindingComposer .beta-finding-chip").length === 1 &&
  document.querySelectorAll("#betaUnknownChips .beta-unknown-chip").length === 1 &&
  (document.querySelector("#betaUnknownChips .beta-unknown-chip")?.textContent || "").includes("pleuralis dörzszörej") &&
  document.querySelector("#betaCopyStatus")?.disabled
);
const directAiButtons = betaFeatures.locator("#betaUnknownChips [data-ai-unknown-phrase]");
if (await directAiButtons.count() !== 1) {
  throw new Error("Unknown finding does not expose a direct AI suggestion action");
}

// AI may populate a proposal, but it must not save anything before physician confirmation.
await directAiButtons.click();
await betaFeatures.waitForFunction(() =>
  !document.querySelector("#betaSuggestFinding")?.disabled &&
  !document.querySelector("#betaUnknownChips [data-ai-unknown-phrase]")?.disabled
);
const aiFindingState = await betaFeatures.evaluate(() => ({
  label: document.querySelector("#betaNewFindingLabel")?.value || "",
  target: document.querySelector("#betaNewFindingTarget")?.value || "",
  output: document.querySelector("#betaNewFindingOutput")?.value || "",
  message: document.querySelector("#betaLearningMessage")?.textContent || ""
}));
if (
  aiFindingState.label !== "Pleuralis dörzszörej" ||
  aiFindingState.target !== "respiratory" ||
  !aiFindingState.output.includes("pleuralis dörzszörej")
) {
  throw new Error("AI finding suggestion did not populate review form: " + JSON.stringify(aiFindingState));
}
if (!/0 tanítás/.test(await betaFeatures.locator("#betaLearningMeta").textContent())) {
  throw new Error("AI finding suggestion was persisted without physician confirmation");
}
if (await betaFeatures.locator("#betaUnknownChips .beta-unknown-chip").count() !== 1) {
  throw new Error("AI finding suggestion incorrectly resolved the unknown before confirmation");
}

await betaFeatures.locator("#betaSaveNewFinding").click();
await betaFeatures.waitForFunction(() =>
  document.querySelectorAll("#betaUnknownChips .beta-unknown-chip").length === 0 &&
  [...document.querySelectorAll("#betaFindingComposer .beta-finding-chip")]
    .some((node) => (node.textContent || "").includes("Pleuralis dörzszörej")) &&
  !(document.querySelector("#betaCopyStatus")?.disabled)
);
const learnedPreview = await betaFeatures.locator("#betaStatusPreview").inputValue();
if (!learnedPreview.includes("Bal oldalon pleuralis dörzszörej hallható.")) {
  throw new Error("New learned finding was not rendered into the status preview");
}

// Existing-finding teaching must preserve structured attributes such as murmur grade.
await fillBetaPhysicalBridge("Durva syst. zörej 4/6.");
await betaFeatures.waitForFunction(() =>
  document.querySelectorAll("#betaUnknownChips .beta-unknown-chip").length === 1
);
await betaFeatures.locator("#betaUnknownChips .beta-unknown-chip").click();
await betaFeatures.locator("#betaExistingFindingSearch").fill("systolés zörej");
await betaFeatures.locator('[data-existing-finding-key="systolic-murmur"]').click();
if (!/Systolés zörej/.test(await betaFeatures.locator("#betaExistingFindingSelection").textContent())) {
  throw new Error("Searchable existing-finding picker did not select systolic murmur");
}
await betaFeatures.locator("#betaSaveExistingFinding").click();
await betaFeatures.waitForFunction(() =>
  document.querySelectorAll("#betaUnknownChips .beta-unknown-chip").length === 0 &&
  (document.querySelector("#betaStatusPreview")?.value || "").includes("4/6 systolés zörej hallható")
);

await betaFeatures.waitForFunction(() =>
  /2 tanítás mentve/.test(document.querySelector("#betaLearningMeta")?.textContent || "")
);
if (await betaFeatures.locator("#betaBuildCandidates, #betaCopyCandidatePatch").count()) {
  throw new Error("Technical candidate/patch controls leaked into the physician workflow");
}
if (await betaFeatures.locator("#betaUndoLearning").isHidden()) {
  throw new Error("Contextual undo action should be available after a teaching action");
}

// Restore the earlier fixture for chip suppression coverage.
await fillBetaPhysicalBridge("epig nyomérz, dyspnoe nincs, jobb basalis crepitatio");
await betaFeatures.waitForFunction(() =>
  document.querySelector('[data-finding-key="crackles"]')
);

// Suppressing a chip must change only the local preview.
await betaFeatures.locator('[data-finding-key="crackles"]').click();
await betaFeatures.waitForFunction(() =>
  document.querySelector('[data-finding-key="crackles"]')?.classList.contains("suppressed") &&
  (document.querySelector("#betaStatusPreview")?.value || "").includes("Zörejek: nincs.")
);

// Standard template uses the same reviewed finding set.
await betaFeatures.locator('[data-status-mode="standard"]').evaluate((button) => button.click());
await betaFeatures.waitForFunction(() =>
  (document.querySelector("#betaStatusPreview")?.value || "").startsWith("Kp táplált.")
);
const standardPreview = await betaFeatures.locator("#betaStatusPreview").inputValue();
if (!standardPreview.includes("epigastriumban nyomásérzékeny")) {
  throw new Error("Standard finding composer did not apply epigastric tenderness");
}

// Generated status must not become part of the patient/workflow state.
const composerPersistenceCheck = await betaFeatures.evaluate(() => {
  const patient = window.BachSBOClinicalUi?.getPatientSnapshot?.();
  const serialized = JSON.stringify(patient || {});
  return {
    physical: patient?.physical || "",
    generatedLeaked: serialized.includes("Légutak átjárhatók") || serialized.includes("Kp táplált.")
  };
});
if (
  composerPersistenceCheck.physical !== "epig nyomérz, dyspnoe nincs, jobb basalis crepitatio" ||
  composerPersistenceCheck.generatedLeaked
) {
  throw new Error("Generated beta status leaked into patient state: " + JSON.stringify(composerPersistenceCheck));
}

// Structured STATUS v1: Parameters + positive findings persist; generated full
// normal-status prose remains copy-only and must not leak into patient state.
await betaFeatures.locator('[data-status-param="bloodPressure"]').fill("135/80");
await betaFeatures.locator('[data-status-param="pulse"]').fill("88");
await betaFeatures.locator('[data-status-section="B"]').fill("jobb basalis crepitatio");
await betaFeatures.locator('[data-status-section="E5"]').fill("epig nyomérz");
await betaFeatures.locator("#betaGenerateStructuredStatus").click();
await betaFeatures.locator("#betaStructuredStatusDone:not(.hidden)").waitFor();

const structuredPreview = await betaFeatures.locator("#betaStructuredStatusPreview").inputValue();
for (const expected of [
  "Paraméterek: vérnyomás 135/80 Hgmm, pulsus 88/perc.",
  "B:",
  "jobb basalis crepitatio hallható",
  "E1 – Általános állapot:",
  "E5 – Has:",
  "epigastriumban nyomásérzékeny",
  "E6 – Vese / urogenitalis:"
]) {
  if (!structuredPreview.includes(expected)) {
    throw new Error("Structured STATUS preview missing: " + expected + "\n" + structuredPreview);
  }
}

const structuredPersistence = await betaFeatures.evaluate(() => {
  const patient = window.BachSBOClinicalUi?.getPatientSnapshot?.();
  const serialized = JSON.stringify(patient || {});
  return {
    status: patient?.physicalStatus || null,
    physical: patient?.physical || "",
    generatedFullStatusLeaked:
      serialized.includes("Légutak átjárhatók") ||
      serialized.includes("E1 – Általános állapot:")
  };
});
if (
  structuredPersistence.status?.version !== 1 ||
  structuredPersistence.status?.parameters?.bloodPressure !== "135/80" ||
  structuredPersistence.status?.parameters?.pulse !== "88" ||
  structuredPersistence.status?.sections?.B !== "jobb basalis crepitatio" ||
  structuredPersistence.status?.sections?.E5 !== "epig nyomérz" ||
  !structuredPersistence.status?.generatedAt ||
  structuredPersistence.physical !== "B: jobb basalis crepitatio\nE5: epig nyomérz" ||
  structuredPersistence.generatedFullStatusLeaked
) {
  throw new Error("Structured STATUS persistence contract failed: " + JSON.stringify(structuredPersistence));
}

// EKG quick template is deliberately local/copy-only and must never touch the case.
await betaFeatures.locator("#betaEkgTemplate").selectOption("detailed");
await betaFeatures.locator("#betaEkgFr").fill("70");
await betaFeatures.locator("#betaEkgPq").fill("160");
await betaFeatures.locator("#betaEkgQrs").fill("90");
await betaFeatures.locator("#betaEkgQtc").fill("420");
await betaFeatures.locator("#betaEkgTransition").fill("V3–V4");
const ekgQuickText = await betaFeatures.locator("#betaEkgOutput").inputValue();
for (const expected of [
  "EKG: SR, fr: 70/min",
  "PQ: 160 ms",
  "QRS: 90 ms",
  "QTc: 420 ms",
  "Mellkasi átm: V3–V4"
]) {
  if (!ekgQuickText.includes(expected)) {
    throw new Error("Local EKG helper missing: " + expected + " -> " + ekgQuickText);
  }
}
const ekgDidNotPersist = await betaFeatures.evaluate(() => {
  const patient = window.BachSBOClinicalUi?.getPatientSnapshot?.();
  return !JSON.stringify(patient || {}).includes("EKG: SR, fr: 70/min");
});
if (!ekgDidNotPersist) {
  throw new Error("Local EKG quick template leaked into patient state");
}

await betaFeatures.close();

if (errors.length) {
  throw new Error("Browser page errors: " + errors.join(" | "));
}

await browser.close();
console.log("Browser smoke passed: promoted Stable UI -> patient -> demographics -> investigations -> save/reload -> disposition -> summary/finalize.");
