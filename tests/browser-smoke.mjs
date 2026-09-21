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

// Prepare three meaningful pending investigations for Beta Case-list coverage.
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
await beta.goto(baseUrl + "/beta.html", { waitUntil: "domcontentloaded" });
await beta.locator("#patientsView:not(.hidden)").waitFor();
await beta.locator("#cockpitBetaBadge").waitFor();
if (await beta.locator("#patientTbody tr[data-id]").count() !== 1) {
  throw new Error("Beta did not restore the expected case state");
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

// Beta case tabs must be five distinct workflow steps in the requested order.
const tabOrder = await beta.locator("#cockpitCaseTabs [data-cockpit-tab]").evaluateAll((nodes) =>
  nodes.map((node) => node.dataset.cockpitTab)
);
const expectedTabOrder = ["clinical", "tests", "course", "disposition", "summary"];
if (JSON.stringify(tabOrder) !== JSON.stringify(expectedTabOrder)) {
  throw new Error(`Unexpected Beta tab order: ${JSON.stringify(tabOrder)}`);
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
  throw new Error("Klinikum demographics editor is not mounted in the Beta clinical section");
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
await beta.locator("#iceYob").fill("12");
await beta.locator("#iceYob").dispatchEvent("input");
await beta.waitForFunction(() =>
  document.querySelector('[data-cockpit-tab="clinical"]')?.classList.contains("has-summary-gap")
);

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
await beta.locator("#savePatientBtn").click();
await beta.waitForTimeout(250);
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
  throw new Error("Decision discharge fields did not persist: " + JSON.stringify(dischargePersisted));
}

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

// Regression from the uploaded recording: typing into a result must not remove
// Beta's compact test-row class and temporarily expand the card.
await beta.locator('[data-cockpit-tab="tests"]').click();
await beta.locator('[data-card="ekg-0"].cockpit-test-row').waitFor();
if (await beta.locator('[data-card="ekg-0"] .test-save').isVisible()) {
  throw new Error("Beta still shows the redundant Save Result button");
}
await beta.locator('[data-card="ekg-0"] textarea[data-text="ekg-0"]').fill("temporary EKG text");
let testClasses = await beta.locator('[data-card="ekg-0"]').getAttribute("class");
if (!String(testClasses).includes("cockpit-test-row")) {
  throw new Error(`EKG card lost compact layout while typing: ${testClasses}`);
}
await beta.locator('[data-card="ekg-0"] textarea[data-text="ekg-0"]').fill("");
await beta.locator('[data-card="radiology-0"].cockpit-test-row').waitFor();
await beta.locator('[data-card="radiology-0"] textarea[data-text="radiology-0"]').fill("temporary radiology text");
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

// EKG and AVG are one-menu-click multi-entry groups.
const ekgCountBeforeAdd = await beta.locator('#ekgCard .test-card').count();
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
  { decision: "no", buttonRgb: "rgb(71, 84, 103)", boxRgb: "rgb(242, 244, 247)" }
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
await beta.locator("#cockpitDataEntryOverlay:not(.hidden)").waitFor();

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
await beta.locator(".cockpit-extract-item .cockpit-decision.yes").click();
await beta.locator("#cockpitApplyAccepted").click();
await beta.locator("#cockpitExtractConfirmOverlay:not(.hidden)").waitFor();
await beta.locator("#cockpitExtractConfirmApply").click();
await beta.waitForFunction(() => document.querySelector("#fComplaint")?.value.includes("mellkasi fájdalom"));

const appliedComplaint = await beta.locator("#fComplaint").inputValue();
if (!appliedComplaint.includes("mellkasi fájdalom")) {
  throw new Error("Accepted extracted complaint was not applied");
}
const applyStatusWithIncompleteDischarge = await beta.locator("#cockpitExtractStatus").textContent();
if (/Otthonába bocsátás esetén kötelező|Discharge condition \/ symptoms is required/i.test(applyStatusWithIncompleteDischarge || "")) {
  throw new Error("AI fact apply was incorrectly blocked by discharge completeness");
}
const persistedComplaint = await beta.evaluate(() => {
  const state = JSON.parse(localStorage.getItem("__bach_sbo_e2e_state") || "{}");
  return state?.patients?.[0]?.complaint || "";
});
if (!persistedComplaint.includes("mellkasi fájdalom")) {
  throw new Error("Accepted extracted complaint was not persisted");
}

await beta.locator('[data-none-toggle="history"]').click();
await beta.locator("#fHistory").fill("Doctor draft must survive");
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
await beta.locator("#cockpitDataEntryOverlay.hidden").waitFor();

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
