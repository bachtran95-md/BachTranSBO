import { chromium } from "playwright";

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
        ekg: entry("30000000-0000-4000-8000-000000000002"),
        gas: entry("30000000-0000-4000-8000-000000000003"),
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
  const row = (p) => ({
    id: p.id,
    sex: p.sex || null,
    year_of_birth: p.yob ? Number(p.yob) : null,
    main_complaint: p.mainComplaint || "",
    arrival_mode: p.arrivalMode || "",
    arrival_other: p.arrivalOther || "",
    disposition: p.disposition || "",
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
    async updateCaseMetadata(caseId, metadata) {
      const state = read();
      const p = state.patients.find((x) => x.id === caseId);
      if (!p) throw new Error("Missing mock case");
      p.sex = metadata.sex || "";
      p.yob = metadata.yearOfBirth ? String(metadata.yearOfBirth) : "";
      p.mainComplaint = metadata.mainComplaint || "";
      p.arrivalMode = metadata.arrivalMode || "";
      p.arrivalOther = p.arrivalMode === "other" ? metadata.arrivalOther || "" : "";
      if (Object.prototype.hasOwnProperty.call(metadata, "otherDetails")) {
        p.otherDetails = metadata.otherDetails || "";
      }
      p.updatedAt = new Date().toISOString();
      write(state);
      return { metadata: row(p), removed: 0, report: null };
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
        }]
      };
    },
    async caseAssistantGetState(patient) { return { run: null, suggestions: [], caseId: patient.id }; },
    async caseAssistantDecide() { return { doctorDecision: "yes", decidedAt: new Date().toISOString() }; },
    async caseAssistantExtract(_caseId, source) {
      if (/troponin/i.test(source)) {
        return {
          source,
          items: [{
            target: "lab",
            status: "result",
            text: "Troponin 46 ng/L",
            evidence: "Troponin 46 ng/L",
            label: "Lab"
          }],
          warnings: []
        };
      }
      if (/cardiology/i.test(source)) {
        return {
          source,
          items: [{
            target: "consultation",
            status: "result",
            text: "CCU admission recommended",
            evidence: "CCU admission recommended",
            label: "Cardiology consultation"
          }],
          warnings: []
        };
      }
      if (/hypertonia/i.test(source)) {
        return {
          source,
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
        source,
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
context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));

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
await page.locator("#patientsView:not(.hidden)").waitFor();

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

// Prepare three meaningful pending investigations for Beta Case-list coverage.
await page.evaluate(() => {
  const key = "__bach_sbo_e2e_state";
  const state = JSON.parse(localStorage.getItem(key) || "{}");
  const p = state?.patients?.[0];
  if (!p) return;
  for (const entry of [p.tests?.ekg, p.tests?.gas, p.tests?.radiology?.[0]]) {
    if (!entry) continue;
    entry.mode = "waiting";
    entry.text = "";
    entry.savedText = "";
  }
  if (p.tests?.labs?.[0]) {
    p.tests.labs[0].mode = "waiting";
    p.tests.labs[0].text = "";
    p.tests.labs[0].savedText = "";
  }
  if (p.tests?.consultations?.[0]) {
    p.tests.consultations[0].type = "Cardiology";
    p.tests.consultations[0].mode = "waiting";
    p.tests.consultations[0].text = "";
    p.tests.consultations[0].savedText = "";
  }
  if (p.tests?.radiology?.[0]) {
    p.tests.radiology[0].bodyPart = "koponya";
    p.tests.radiology[0].modality = "Native CT";
    p.tests.radiology[0].otherTest = "";
    p.tests.radiology[0].type = "koponya Native CT";
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
await beta.goto(baseUrl + "/beta.html", { waitUntil: "domcontentloaded" });
await beta.locator("#patientsView:not(.hidden)").waitFor();
await beta.locator("#cockpitBetaBadge").waitFor();
if (await beta.locator("#patientTbody tr[data-id]").count() !== 1) {
  throw new Error("Beta did not restore the expected case state");
}

await beta.locator("#patientTbody tr[data-id]", { hasText: "Existing smoke case" }).click();
await beta.locator("#cockpitPasteText").waitFor();
await beta.locator("#cockpitDocumentationReview").waitFor();

const caseRow = beta.locator("#patientTbody tr[data-id]", { hasText: "Existing smoke case" });
await beta.waitForFunction(() =>
  Boolean(document.querySelector("#patientTbody tr[data-id] .cockpit-test-summary"))
);
const pendingSummary = await caseRow.locator(".cockpit-test-summary").textContent();
for (const expected of ["EKG", "AVG", "koponya Native CT"]) {
  if (!pendingSummary.includes(expected)) {
    throw new Error(`Case list hid pending test ${expected}: ${pendingSummary}`);
  }
}
if (/\+\d+/.test(pendingSummary)) {
  throw new Error(`Case list still truncates waiting tests with +N: ${pendingSummary}`);
}

// Beta case tabs must be five distinct workflow steps in the requested order.
const tabOrder = await beta.locator("#cockpitCaseTabs [data-cockpit-tab]").evaluateAll((nodes) =>
  nodes.map((node) => node.dataset.cockpitTab)
);
const expectedTabOrder = ["clinical", "tests", "course", "disposition", "summary"];
if (JSON.stringify(tabOrder) !== JSON.stringify(expectedTabOrder)) {
  throw new Error(`Unexpected Beta tab order: ${JSON.stringify(tabOrder)}`);
}

// Klinikum demographics must be native-visible markup, not a late dynamic insertion.
if (await beta.locator("#cockpitDemographicsMount > #inlineCaseEditor").count() !== 1) {
  throw new Error("Klinikum demographics editor is not mounted in the Beta clinical section");
}

// Klinikum demographics must stay visible and editable.
await beta.locator('[data-cockpit-tab="clinical"]').click();
await beta.locator("#cockpitDemographicsMount #iceYob").waitFor({ state: "visible" });
await beta.locator("#cockpitDemographicsMount #iceAge").waitFor({ state: "visible" });
await beta.locator("#cockpitDemographicsMount #iceArrival").waitFor({ state: "visible" });
if (await beta.locator("#iceAge").isDisabled()) {
  throw new Error("Klinikum Age input is disabled");
}
await beta.locator("#iceAge").fill("44");
await beta.locator("#iceAge").dispatchEvent("change");
const expectedYob = String(new Date().getFullYear() - 44);
await beta.waitForFunction((expected) => document.querySelector("#iceYob")?.value === expected, expectedYob);
if (await beta.locator("#iceArrival").isDisabled()) {
  throw new Error("Klinikum arrival mode is disabled");
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

// Regression from the uploaded recording: typing into a result must not remove
// Beta's compact test-row class and temporarily expand the card.
await beta.locator('[data-cockpit-tab="tests"]').click();
await beta.locator('[data-card="ekg"].cockpit-test-row').waitFor();
await beta.locator('[data-card="ekg"] textarea[data-text="ekg"]').fill("temporary EKG text");
let testClasses = await beta.locator('[data-card="ekg"]').getAttribute("class");
if (!String(testClasses).includes("cockpit-test-row")) {
  throw new Error(`EKG card lost compact layout while typing: ${testClasses}`);
}
await beta.locator('[data-card="ekg"] textarea[data-text="ekg"]').fill("");
await beta.locator('[data-card="radiology-0"].cockpit-test-row').waitFor();
await beta.locator('[data-card="radiology-0"] textarea[data-text="radiology-0"]').fill("temporary radiology text");
testClasses = await beta.locator('[data-card="radiology-0"]').getAttribute("class");
if (!String(testClasses).includes("cockpit-test-row")) {
  throw new Error(`Radiology card lost compact layout while typing: ${testClasses}`);
}
await beta.locator('[data-card="radiology-0"] textarea[data-text="radiology-0"]').fill("");
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
    `Beta Case list row resized with unresolved items: ${initialCaseRowHeight} -> ${blockedCaseRowHeight}`
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
  (document.querySelector("#cockpitDocumentationReview")?.textContent || "").includes("Gyógyszerallergia")
);
const documentationAfterAssistant = await beta.locator("#cockpitDocumentationReview").textContent();
if (!documentationAfterAssistant.includes("Gyógyszerallergia")) {
  throw new Error("Documentation review did not surface assistant missing information");
}

await beta.locator("#cockpitPasteText").fill("Jelen panasz: mellkasi fájdalom.");
await beta.locator("#cockpitExtractText").click();
await beta.locator(".cockpit-extract-item").waitFor();
await beta.locator(".cockpit-extract-item .cockpit-decision.yes").click();
await beta.locator("#cockpitApplyAccepted").click();
await beta.waitForFunction(() => document.querySelector("#fComplaint")?.value.includes("mellkasi fájdalom"));

const appliedComplaint = await beta.locator("#fComplaint").inputValue();
if (!appliedComplaint.includes("mellkasi fájdalom")) {
  throw new Error("Accepted extracted complaint was not applied");
}
const persistedComplaint = await beta.evaluate(() => {
  const state = JSON.parse(localStorage.getItem("__bach_sbo_e2e_state") || "{}");
  return state?.patients?.[0]?.complaint || "";
});
if (!persistedComplaint.includes("mellkasi fájdalom")) {
  throw new Error("Accepted extracted complaint was not persisted");
}

await beta.locator("#cockpitPasteText").fill("Troponin 46 ng/L");
await beta.locator("#cockpitExtractText").click();
const labUpdate = beta.locator(".cockpit-extract-item", { hasText: "Troponin 46 ng/L" });
await labUpdate.waitFor();
if (!(await labUpdate.getAttribute("class")).includes("action-update")) {
  throw new Error("Waiting Lab result was not classified as an update");
}
await labUpdate.locator(".cockpit-decision.yes").click();
await beta.locator("#cockpitApplyAccepted").click();
await beta.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem("__bach_sbo_e2e_state") || "{}");
  return state?.patients?.[0]?.tests?.labs?.[0]?.savedText === "Troponin 46 ng/L";
});
const labsAfterUpdate = await beta.evaluate(() => {
  const state = JSON.parse(localStorage.getItem("__bach_sbo_e2e_state") || "{}");
  return state?.patients?.[0]?.tests?.labs || [];
});
if (labsAfterUpdate.length !== 1 || labsAfterUpdate[0].id !== "30000000-0000-4000-8000-000000000001") {
  throw new Error("Lab update created a duplicate card instead of preserving the waiting Lab identity");
}

await beta.locator("#cockpitPasteText").fill("Troponin 46 ng/L");
await beta.locator("#cockpitExtractText").click();
const duplicateLab = beta.locator(".cockpit-extract-item", { hasText: "Troponin 46 ng/L" });
await duplicateLab.waitFor();
if (!(await duplicateLab.getAttribute("class")).includes("action-duplicate")) {
  throw new Error("Repeated Lab result was not classified as already documented");
}
if (!(await duplicateLab.locator(".cockpit-decision.yes").isDisabled())) {
  throw new Error("Duplicate Lab result remained applicable");
}

await beta.locator("#cockpitPasteText").fill("Cardiology: CCU admission recommended");
await beta.locator("#cockpitExtractText").click();
const consultationUpdate = beta.locator(".cockpit-extract-item", { hasText: "CCU admission recommended" });
await consultationUpdate.waitFor();
if (!(await consultationUpdate.getAttribute("class")).includes("action-update")) {
  throw new Error("Named consultation result was not matched to the waiting consultation");
}
await consultationUpdate.locator(".cockpit-decision.yes").click();
await beta.locator("#cockpitApplyAccepted").click();
await beta.waitForFunction(() => {
  const state = JSON.parse(localStorage.getItem("__bach_sbo_e2e_state") || "{}");
  return state?.patients?.[0]?.tests?.consultations?.[0]?.savedText === "CCU admission recommended";
});

await beta.locator('[data-none-toggle="history"]').click();
await beta.locator("#fHistory").fill("Doctor draft must survive");
await beta.locator("#cockpitPasteText").fill("Anamnézis: hypertonia.");
await beta.locator("#cockpitExtractText").click();
await beta.locator(".cockpit-extract-item", { hasText: "Hypertonia" }).waitFor();
if (!(await beta.locator(".cockpit-extract-item", { hasText: "Hypertonia" }).getAttribute("class")).includes("action-update")) {
  throw new Error("Later patient history was not classified as an append update");
}
await beta.waitForFunction(() =>
  (document.querySelector("#cockpitDocumentationReview")?.textContent || "").includes("Conflicting timing in source")
);
const documentationAfterWarning = await beta.locator("#cockpitDocumentationReview").textContent();
if (!documentationAfterWarning.includes("Conflicting timing in source")) {
  throw new Error("Documentation review did not surface extraction warning");
}
await beta.locator(".cockpit-extract-item", { hasText: "Hypertonia" }).locator(".cockpit-decision.yes").click();
await beta.evaluate(() => { window.__BACH_E2E_FAIL_NEXT_SAVE = true; });
await beta.locator("#cockpitApplyAccepted").click();
await beta.waitForFunction(() => (document.querySelector("#cockpitExtractStatus")?.textContent || "").includes("Synthetic save failure"));

const historyAfterFailure = await beta.locator("#fHistory").inputValue();
if (historyAfterFailure !== "Doctor draft must survive") {
  throw new Error("Doctor draft was not restored after failed AI apply");
}
if (historyAfterFailure.includes("Hypertonia")) {
  throw new Error("Failed AI apply leaked extracted content into clinician draft");
}

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

if (errors.length) {
  throw new Error("Browser page errors: " + errors.join(" | "));
}

await browser.close();
console.log("Browser smoke passed: login -> existing case -> add -> delete -> reload -> beta.");
