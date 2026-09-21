// Compact cockpit beta. Activates only after the authenticated patient workspace is visible.
(() => {
  "use strict";

  const TAB_MAP = ["clinical", "tests", "course", "disposition", "summary"];
  let activeTab = "clinical";
  let lastSelectedCaseId = "";
  let assistantBusy = false;
  let assistantLoadToken = 0;
  let assistantCoreLoadPromise = null;
  let assistantCoreRef = null;
  let patientBoardLoad = null;
  let extractionPreviewState = null;
  let caseAutosaveTimer = null;
  let caseAutosaveInFlight = false;
  let caseAutosaveQueued = false;
  const patientProgressByCase = new Map();
  const assistantStateByCase = new Map();

  const label = (en, hu) => {
    const huActive =
      document.documentElement.lang === "hu" ||
      document.getElementById("langHuBtn")?.classList.contains("active");
    return huActive ? hu : en;
  };

  const esc = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  async function ensureAssistantCore() {
    if (assistantCoreRef?.validateProposal && assistantCoreRef?.applyItems) {
      return assistantCoreRef;
    }
    if (window.BachAssistantCore?.validateProposal && window.BachAssistantCore?.applyItems) {
      assistantCoreRef = window.BachAssistantCore;
      return assistantCoreRef;
    }

    if (!assistantCoreLoadPromise) {
      assistantCoreLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "assistant-core.js?v=runtime-recovery-20260921-1";
        script.async = false;
        script.dataset.bachAssistantCoreRecovery = "true";

        script.onload = () => {
          if (window.BachAssistantCore?.validateProposal && window.BachAssistantCore?.applyItems) {
            assistantCoreRef = window.BachAssistantCore;
            resolve(assistantCoreRef);
            return;
          }
          reject(new Error(label(
            "Assistant validation core loaded but did not initialize.",
            "Az asszisztens validációs modul betöltődött, de nem inicializálódott."
          )));
        };
        script.onerror = () => reject(new Error(label(
          "Assistant validation core could not be loaded. Refresh the page and try again.",
          "Az asszisztens validációs modul nem tölthető be. Frissítse az oldalt, majd próbálja újra."
        )));
        document.head.appendChild(script);
      }).catch((error) => {
        assistantCoreLoadPromise = null;
        throw error;
      });
    }

    return assistantCoreLoadPromise;
  }

  function selectedCaseId() {
    return document.querySelector("#patientTbody tr.selected[data-id]")?.dataset.id || "";
  }

  async function selectedPatient() {
    const id = selectedCaseId();
    if (!id || !window.BachSBOBackend?.loadState) return null;
    const snapshot = await window.BachSBOBackend.loadState();
    return (snapshot.patients || []).find((patient) => patient.id === id) || null;
  }

  function testEntryStatus(entry) {
    if (entry?.mode === "notordered") return "notordered";
    if (String(entry?.text || "").trim()) return "complete";
    return "waiting";
  }

  function radiologyLabel(entry, index) {
    const body = String(entry?.bodyPart || "").trim();
    const modality = String(entry?.modality || "").trim();
    const other = String(entry?.otherTest || "").trim();
    const detail = modality === "other"
      ? [body, other].filter(Boolean).join(" — ")
      : [body, modality].filter(Boolean).join(" ");
    return detail
      ? `${label("Radiology", "Radiológia")} · ${detail}`
      : `${label("Radiology", "Radiológia")} ${index + 1}`;
  }

  function patientTestItems(patient) {
    const tests = patient?.tests || {};
    return [
      ...(tests.labs || []).map((entry, index) => ({ entry, name: `Lab ${index + 1}` })),
      ...(tests.ekgs || []).map((entry, index) => ({ entry, name: `EKG ${index + 1}` })),
      ...(tests.gases || []).map((entry, index) => ({
        entry,
        name: `${/\bVVG\b/i.test(String(entry?.text || "")) ? "VVG" : "AVG"} ${index + 1}`
      })),
      ...(tests.radiology || []).map((entry, index) => ({ entry, name: radiologyLabel(entry, index) })),
      ...(tests.consultations || []).map((entry, index) => {
        const specialty = String(entry?.type || "").trim();
        return {
          entry,
          name: specialty
            ? `${label("Consultation", "Konzílium")} · ${specialty}`
            : `${label("Consultation", "Konzílium")} ${index + 1}`
        };
      })
    ].map((item) => ({ ...item, status: testEntryStatus(item.entry) }));
  }

  function patientProgress(patient) {
    const clinicalDefinitions = [
      ["complaint", "complaintSkipped", label("Complaint", "Panasz")],
      ["history", "historySkipped", label("History", "Anamnézis")],
      ["physical", "physicalSkipped", label("Physical examination", "Fizikális vizsgálat")],
      ["therapy", "therapySkipped", label("Therapy", "Terápia")],
      ["course", "courseSkipped", label("Clinical course", "Klinikai lefolyás")]
    ];
    const clinical = clinicalDefinitions.map(([valueKey, skippedKey, name]) => ({
      name,
      complete: Boolean(patient?.[skippedKey] || String(patient?.[valueKey] || "").trim())
    }));
    const tests = patientTestItems(patient);
    return {
      clinical,
      tests,
      completeClinical: clinical.filter((item) => item.complete),
      incompleteClinical: clinical.filter((item) => !item.complete),
      completeTests: tests.filter((item) => item.status !== "waiting"),
      waitingTests: tests.filter((item) => item.status === "waiting")
    };
  }

  function progressFromVisibleForm() {
    const form = document.getElementById("patientForm");
    if (!form || form.classList.contains("hidden")) return null;

    const clinical = [...form.querySelectorAll("[data-narrative-field]")].map((field) => ({
      name: field.querySelector("label")?.textContent?.trim() || label("Clinical field", "Klinikai mező"),
      complete: field.classList.contains("result") || field.classList.contains("none")
    }));
    const tests = [...form.querySelectorAll(".test-card")].map((card, index) => ({
      name: card.querySelector(".test-name")?.textContent?.trim() || `${label("Test", "Vizsgálat")} ${index + 1}`,
      status: card.classList.contains("result")
        ? "complete"
        : card.classList.contains("notordered")
        ? "notordered"
        : "waiting"
    }));
    return {
      clinical,
      tests,
      completeClinical: clinical.filter((item) => item.complete),
      incompleteClinical: clinical.filter((item) => !item.complete),
      completeTests: tests.filter((item) => item.status !== "waiting"),
      waitingTests: tests.filter((item) => item.status === "waiting")
    };
  }

  function narrativeResolved(key) {
    const field = document.querySelector(`[data-narrative-field="${key}"]`);
    if (!field) return false;

    // Prefer the semantic state, but also trust the live value/None toggle.
    // This prevents a stale CSS class from keeping a workflow tab orange after
    // AI fill, paste, reload, or another synchronous form update.
    if (field.classList.contains("result") || field.classList.contains("none")) return true;
    const input = field.querySelector("textarea, input:not([type='button'])");
    if (String(input?.value || "").trim()) return true;
    return Boolean(field.querySelector(`[data-none-toggle="${key}"].active`));
  }

  function hasValue(id) {
    return Boolean(String(document.getElementById(id)?.value || "").trim());
  }

  function clinicalMetadata() {
    return window.BachSBOClinicalUi?.getCaseMetadata?.() || {};
  }

  function validClinicalYob(metadata = clinicalMetadata()) {
    const yob = window.BachSBOClinicalUi?.normalizeYob?.(metadata.year_of_birth);
    return Boolean(yob);
  }

  function validClinicalSex(metadata = clinicalMetadata()) {
    return ["M", "F", "O"].includes(
      window.BachSBOClinicalUi?.normalizeSex?.(metadata.sex) || ""
    );
  }

  function tabSummaryGaps() {
    const metadata = clinicalMetadata();
    const arrival = window.BachSBOClinicalUi?.normalizeArrivalMode?.(metadata.arrival_mode) || "";
    const disposition = document.getElementById("fDisposition")?.value || "";
    const testsPending = [...document.querySelectorAll('[data-cockpit-panel="tests"] .test-card')]
      .some((card) => !card.classList.contains("result") && !card.classList.contains("notordered"));

    const clinical =
      !hasValue("fMainComplaint") ||
      !validClinicalSex(metadata) ||
      !validClinicalYob(metadata) ||
      !arrival ||
      (arrival === "other" && !String(metadata.arrival_other || "").trim()) ||
      !narrativeResolved("complaint") ||
      !narrativeResolved("history");

    const tests = !narrativeResolved("physical") || testsPending;
    const course = !narrativeResolved("therapy") || !narrativeResolved("course");

    let decision = !narrativeResolved("diagnoses") || !disposition;
    if (disposition === "discharged") {
      const recommendation = [...document.querySelectorAll("[data-rec]")]
        .some((input) => String(input.value || "").trim());
      decision = decision || !hasValue("fDischargeCondition") || !recommendation;
    } else if (disposition === "admitted") {
      decision = decision || !hasValue("fWard");
    } else if (disposition === "other") {
      decision = decision || !hasValue("fOtherOutcome");
    }

    return { clinical, tests, course, disposition: decision };
  }

  function syncTabWarnings() {
    const hasCase = Boolean(selectedCaseId());
    const gaps = hasCase ? tabSummaryGaps() : {};
    const summaryReady =
      hasCase &&
      ["clinical", "tests", "course", "disposition"].every((key) => !gaps[key]);

    document.querySelectorAll("[data-cockpit-tab]").forEach((button) => {
      const key = button.dataset.cockpitTab;
      const warn = key !== "summary" && Boolean(gaps[key]);
      const ready = key === "summary" && summaryReady;

      button.classList.toggle("has-summary-gap", warn);
      button.classList.toggle("summary-ready", ready);

      button.title = warn
        ? label(
            "Missing information in this tab may affect the Summary.",
            "Ebben a fülben hiányzó adat befolyásolhatja az összefoglalót."
          )
        : ready
        ? label(
            "Summary is ready. Open this tab to review or generate it.",
            "Az összefoglaló készíthető. Nyissa meg ezt a fület az ellenőrzéshez vagy generáláshoz."
          )
        : "";
    });
  }

  function createTabBar() {
    const form = document.getElementById("patientForm");
    if (!form || document.getElementById("cockpitCaseTabs")) return;

    const tabs = document.createElement("div");
    tabs.id = "cockpitCaseTabs";
    tabs.className = "cockpit-case-tabs hidden";
    tabs.innerHTML = [
      ["clinical", label("Clinical", "Klinikum")],
      ["tests", label("Physical status & investigations", "Fizikális státusz és vizsgálatok")],
      ["course", label("Therapy & course", "Terápia és kórlefolyás")],
      ["disposition", label("Disposition", "Döntés")],
      ["summary", label("Summary", "Összefoglaló")]
    ].map(([key, text]) =>
      `<button type="button" class="cockpit-tab ${key === activeTab ? "active" : ""}" data-cockpit-tab="${key}">${text}</button>`
    ).join("");

    form.parentElement?.insertBefore(tabs, form);

    tabs.addEventListener("click", (event) => {
      const button = event.target.closest("[data-cockpit-tab]");
      if (!button) return;
      activateTab(button.dataset.cockpitTab);
    });

    const sections = [...form.querySelectorAll(":scope > .section")];
    sections.forEach((section, index) => {
      section.dataset.cockpitPanel = TAB_MAP[index] || "clinical";
      if (index === 0) section.classList.add("cockpit-clinical-primary");
      if (index === 2) section.classList.add("cockpit-clinical-course");
    });

    applyTabVisibility();
  }

  function updateTabLabels() {
    const labels = {
      clinical: label("Clinical", "Klinikum"),
      tests: label("Physical status & investigations", "Fizikális státusz és vizsgálatok"),
      course: label("Therapy & course", "Terápia és kórlefolyás"),
      disposition: label("Disposition", "Döntés"),
      summary: label("Summary", "Összefoglaló")
    };
    document.querySelectorAll("[data-cockpit-tab]").forEach((button) => {
      button.textContent = labels[button.dataset.cockpitTab] || button.textContent;
    });
    const aiButton = document.getElementById("cockpitAiToggle");
    if (aiButton) aiButton.textContent = label("AI", "AI");
    syncRailLabels();
    syncUnifiedTestLabels();
    syncTabWarnings();
  }

  function activateTab(tab) {
    const nextTab = tab || "clinical";

    if (nextTab !== activeTab) {
      // Capture every visible/hidden form control into the in-memory patient
      // before changing panel visibility, then persist that snapshot.
      window.BachSBOClinicalUi?.commitCurrentDraft?.();
      clearTimeout(caseAutosaveTimer);
      void runCaseAutosave();
    }

    activeTab = nextTab;
    document.querySelectorAll("[data-cockpit-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.cockpitTab === activeTab);
    });
    applyTabVisibility();
    if (activeTab === "summary") {
      document.getElementById("fSummary")?.focus({ preventScroll: true });
    }
  }

  function applyTabVisibility() {
    const form = document.getElementById("patientForm");
    if (!form) return;
    form.querySelectorAll(":scope > .section").forEach((section) => {
      section.classList.toggle(
        "cockpit-panel-hidden",
        section.dataset.cockpitPanel !== activeTab
      );
    });
  }

  function makeRail() {
    const grid = document.querySelector("#patientsView > .grid2");
    if (!grid || document.getElementById("cockpitAiRail")) return;

    const left = grid.children[0];
    const detail = grid.children[1];
    left?.classList.add("cockpit-board-column");
    detail?.classList.add("cockpit-case-column");

    const boardCards = left ? [...left.children] : [];
    boardCards[0]?.classList.add("cockpit-new-case");
    boardCards[1]?.classList.add("cockpit-case-list");

    const rail = document.createElement("aside");
    rail.id = "cockpitAiRail";
    rail.className = "cockpit-ai-rail";
    rail.innerHTML = `
      <div class="cockpit-rail-card">
        <div class="cockpit-rail-head">
          <div>
            <strong id="cockpitAssistantTitle">🩺 Case Assistant</strong>
            <div class="cockpit-rail-sub" id="cockpitAssistantSub"></div>
          </div>
          <span class="cockpit-ai-badge">AI · <span id="cockpitAssistantCount">0</span></span>
        </div>
        <div class="cockpit-rail-body">
          <button class="btn cockpit-wide-btn cockpit-ai-action cockpit-ai-action-analysis" id="cockpitAnalyzeCase" type="button">
            <svg class="cockpit-ai-logo" viewBox="0 0 24 24" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
    <rect x="10.4" y="2.6" width="3.2" height="9.2" rx="1.6"/>
    <rect x="10.4" y="12.2" width="3.2" height="9.2" rx="1.6"/>
    <rect x="10.4" y="2.6" width="3.2" height="9.2" rx="1.6" transform="rotate(60 12 12)"/>
    <rect x="10.4" y="12.2" width="3.2" height="9.2" rx="1.6" transform="rotate(60 12 12)"/>
    <rect x="10.4" y="2.6" width="3.2" height="9.2" rx="1.6" transform="rotate(120 12 12)"/>
    <rect x="10.4" y="12.2" width="3.2" height="9.2" rx="1.6" transform="rotate(120 12 12)"/>
  </g>
</svg>
            <span id="cockpitAnalyzeCaseLabel"></span>
          </button>
          <div id="cockpitAssistantStatus" class="cockpit-status"></div>
          <div id="cockpitAssistantResults" class="cockpit-assistant-results">
            <div class="subtle cockpit-empty-ai" id="cockpitAssistantEmpty"></div>
          </div>
        </div>
      </div>

    `;
    grid.appendChild(rail);

    document.getElementById("cockpitAnalyzeCase")?.addEventListener("click", analyzeCurrentCase);
    document.getElementById("cockpitExtractText")?.addEventListener("click", extractPastedText);
    document.getElementById("cockpitDataEntryBtn")?.addEventListener("click", openDataEntryDialog);
    document.getElementById("cockpitDataEntryClose")?.addEventListener("click", closeDataEntryDialog);
    document.getElementById("cockpitDataEntryOverlay")?.addEventListener("click", (event) => {
      if (event.target?.id === "cockpitDataEntryOverlay") closeDataEntryDialog();
    });
    document.getElementById("cockpitExtractConfirmCancel")?.addEventListener("click", closeExtractionConfirmation);
    document.getElementById("cockpitExtractConfirmApply")?.addEventListener("click", applyAcceptedExtraction);

    const toggle = document.createElement("button");
    toggle.id = "cockpitAiToggle";
    toggle.type = "button";
    toggle.className = "btn small cockpit-ai-toggle";
    toggle.textContent = "AI";
    toggle.addEventListener("click", () => document.body.classList.toggle("cockpit-ai-open"));
    document.querySelector(".topbar-tools")?.appendChild(toggle);

    syncRailLabels();
    syncRailState();
  }

  function syncRailLabels() {
    const set = (id, text) => {
      const node = document.getElementById(id);
      if (node) node.textContent = text;
    };
    set("cockpitAssistantTitle", "🩺 " + label("Case Assistant", "Case Assistant"));
    set(
      "cockpitAssistantSub",
      label(
        "Guideline-informed decision support. Doctor decides.",
        "Irányelv-alapú döntéstámogatás. A döntés az orvosé."
      )
    );
    set("cockpitAnalyzeCaseLabel", label("ANALYZE CURRENT CASE", "AKTUÁLIS ESET ELEMZÉSE"));
    set(
      "cockpitAssistantEmpty",
      label(
        "Select an active case, then run the assistant. Suggestions never change the chart automatically.",
        "Válasszon aktív esetet, majd indítsa az asszisztenst. A javaslatok nem módosítják automatikusan a dokumentációt."
      )
    );
    set("cockpitPasteTitle", label("✨ AI-assisted data entry", "✨ AI-assisted adatbevitel"));
    set("cockpitDataEntryLabel", label("AI DATA ENTRY", "AI ADATBEVITEL"));
    set(
      "cockpitPasteSub",
      label(
        "Paste a note or Heidi text. Review every extracted fact before writing it to the chart.",
        "Illessze be a jegyzetet vagy Heidi szöveget. Minden kinyert tényt ellenőrizzen a dokumentációba írás előtt."
      )
    );
    set("cockpitExtractText", label("EXTRACT FACTS", "TÉNYEK KINYERÉSE"));
    const paste = document.getElementById("cockpitPasteText");
    if (paste) {
      paste.placeholder = label(
        "Paste referral, ambulance or Heidi note here…",
        "Illessze be a beutaló, mentő vagy Heidi szövegét…"
      );
    }
  }

  function renderSummaryProgress(progress, ready) {
    if (!progress) {
      return esc(label(
        "Review unresolved fields before generation.",
        "Generálás előtt ellenőrizze a hiányzó mezőket."
      ));
    }

    const completeCount = progress.completeClinical.length + progress.completeTests.length;
    const totalCount = progress.clinical.length + progress.tests.length;
    const incompleteNames = progress.incompleteClinical.map((item) => item.name);
    const waitingNames = progress.waitingTests.map((item) => item.name);
    const completedClinicalNames = progress.completeClinical.map((item) => item.name);

    const nameList = (names, emptyLabel) => names.length
      ? names.map((name) => `<span class="cockpit-summary-chip">${esc(name)}</span>`).join("")
      : `<span class="cockpit-summary-empty">${esc(emptyLabel)}</span>`;

    return `
      <div class="cockpit-summary-overview ${ready ? "ready" : "waiting"}">
        <strong>${esc(label("Complete", "Kész"))}: ${completeCount}/${totalCount}</strong>
        <span>${esc(label(
          `${progress.completeClinical.length}/${progress.clinical.length} clinical · ${progress.completeTests.length}/${progress.tests.length} tests`,
          `${progress.completeClinical.length}/${progress.clinical.length} klinikai · ${progress.completeTests.length}/${progress.tests.length} vizsgálat`
        ))}</span>
      </div>
      <div class="cockpit-summary-group complete">
        <b>✓ ${esc(label("Completed clinical", "Kész klinikai részek"))}</b>
        <div class="cockpit-summary-chips">${nameList(completedClinicalNames, label("None yet", "Még nincs"))}</div>
      </div>
      <div class="cockpit-summary-group incomplete">
        <b>○ ${esc(label("Still incomplete", "Még hiányos"))} · ${incompleteNames.length}</b>
        <div class="cockpit-summary-chips">${nameList(incompleteNames, label("None", "Nincs"))}</div>
      </div>
      <div class="cockpit-summary-group waiting-tests">
        <b>● ${esc(label("Waiting tests", "Függő vizsgálatok"))} · ${waitingNames.length}</b>
        <div class="cockpit-summary-chips">${nameList(waitingNames, label("None", "Nincs"))}</div>
      </div>
    `;
  }

  function documentationReviewEntries() {
    const caseId = selectedCaseId();
    if (!caseId) return [];

    const entries = [];
    const seen = new Set();
    const add = (kind, text) => {
      const normalized = String(text || "").trim();
      if (!normalized) return;
      const key = kind + "::" + normalized.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({ kind, text: normalized });
    };

    const progress = progressFromVisibleForm() || patientProgressByCase.get(caseId) || null;
    (progress?.incompleteClinical || []).forEach((item) =>
      add("required", item.name)
    );
    (progress?.waitingTests || []).forEach((item) =>
      add("pending", item.name)
    );

    const assistant = assistantStateByCase.get(caseId);
    for (const item of assistant?.suggestions || []) {
      if (item?.category === "missing_information") {
        add("missing", item.title || item.reason);
      }
      for (const missing of item?.missingInformation || []) {
        add("missing", missing);
      }
    }

    if (extractionPreviewState?.caseId === caseId) {
      for (const warning of extractionPreviewState.warnings || []) {
        add("warning", warning);
      }
    }

    return entries.slice(0, 18);
  }

  function documentationKindMeta(kind) {
    const values = {
      required: {
        label: label("REQUIRED", "KÖTELEZŐ"),
        icon: "○"
      },
      pending: {
        label: label("PENDING", "FÜGGŐ"),
        icon: "●"
      },
      missing: {
        label: label("MISSING", "HIÁNYZIK"),
        icon: "?"
      },
      warning: {
        label: label("WARNING", "FIGYELEM"),
        icon: "⚠"
      }
    };
    return values[kind] || values.warning;
  }

  function renderDocumentationReview() {
    const host = document.getElementById("cockpitDocumentationReview");
    const count = document.getElementById("cockpitDocumentationCount");
    if (!host || !count) return;

    const caseId = selectedCaseId();
    if (!caseId) {
      count.textContent = "0";
      count.className = "cockpit-summary-badge neutral";
      host.innerHTML = `<div class="subtle cockpit-empty-ai">${esc(label(
        "Select a case to review documentation gaps.",
        "Válasszon esetet a dokumentációs hiányok ellenőrzéséhez."
      ))}</div>`;
      return;
    }

    const entries = documentationReviewEntries();
    count.textContent = String(entries.length);
    count.className = "cockpit-summary-badge " + (entries.length ? "blocked" : "ready");

    if (!entries.length) {
      host.innerHTML = `<div class="cockpit-doc-clear">✓ ${esc(label(
        "No currently surfaced documentation gaps.",
        "Jelenleg nincs jelzett dokumentációs hiány."
      ))}</div>`;
      return;
    }

    host.innerHTML = entries.map((entry) => {
      const meta = documentationKindMeta(entry.kind);
      return `
        <div class="cockpit-doc-issue kind-${esc(entry.kind)}">
          <span class="cockpit-doc-kind">${meta.icon} ${esc(meta.label)}</span>
          <span class="cockpit-doc-text">${esc(entry.text)}</span>
        </div>
      `;
    }).join("");
  }

  function syncRailState() {
    const form = document.getElementById("patientForm");
    const tabs = document.getElementById("cockpitCaseTabs");
    const hasCase = Boolean(form && !form.classList.contains("hidden") && selectedCaseId());
    const caseClosed = Boolean(form?.classList.contains("case-readonly"));
    tabs?.classList.toggle("hidden", !hasCase);

    const analyze = document.getElementById("cockpitAnalyzeCase");
    const dataEntry = document.getElementById("cockpitDataEntryBtn");
    const extract = document.getElementById("cockpitExtractText");

    if (analyze) analyze.disabled = !hasCase || assistantBusy;
    if (dataEntry) {
      dataEntry.disabled = !hasCase || caseClosed || assistantBusy;
      dataEntry.title = caseClosed
        ? label("Reopen the case before AI-assisted data entry.", "AI-assisted adatbevitel előtt nyissa újra az esetet.")
        : "";
    }
    if (extract) extract.disabled = !hasCase || caseClosed || assistantBusy;
    renderDocumentationReview();

    syncArrivalVisual();
    syncTabWarnings();
    if (!hasCase) return;
  }

  async function analyzeCurrentCase() {
    if (assistantBusy) return;
    const requestCaseId = selectedCaseId();
    const status = document.getElementById("cockpitAssistantStatus");
    const results = document.getElementById("cockpitAssistantResults");
    try {
      assistantBusy = true;
      syncRailState();
      if (status) status.textContent = label("Refreshing assistant…", "Asszisztens frissítése…");
      const patient = await selectedPatient();
      if (!patient) throw new Error(label("Select an active case first.", "Először válasszon aktív esetet."));
      if (!window.BachSBOBackend?.caseAssistantSuggest) {
        throw new Error(label("Case Assistant frontend bridge is unavailable.", "A Case Assistant frontend kapcsolat nem érhető el."));
      }
      const response = await window.BachSBOBackend.caseAssistantSuggest(patient);
      assistantStateByCase.set(patient.id, response);

      // The physician may switch patients while the AI request is running.
      // Cache the result for its original case, but never paint it over another case.
      if (selectedCaseId() === patient.id) {
        renderAssistantResponse(response);
        if (status) {
          status.textContent = label(
            "Updated. Suggestions are advisory only.",
            "Frissítve. A javaslatok kizárólag döntéstámogatók."
          );
        }
      }
    } catch (error) {
      if (!requestCaseId || selectedCaseId() === requestCaseId) {
        if (status) status.textContent = error?.message || label("Analysis failed.", "Elemzés sikertelen.");
        if (results) results.innerHTML = `<div class="cockpit-ai-error">${esc(error?.message || label("Analysis failed.", "Elemzés sikertelen."))}</div>`;
      }
    } finally {
      assistantBusy = false;
      syncRailState();
    }
  }

  function decisionUiValue(value) {
    if (value === "already_done") return "done";
    if (value === "not_applicable") return "pending";
    return ["done", "yes", "no"].includes(value) ? value : "pending";
  }

  function priorityMeta(priority) {
    if (priority === "now") return { icon: "●", label: label("NOW", "MOST") };
    if (priority === "next") return { icon: "●", label: label("NEXT", "KÖVETKEZŐ") };
    return { icon: "○", label: label("CONSIDER", "MÉRLEGELENDŐ") };
  }

  async function saveAssistantDecision(button) {
    const item = button.closest(".cockpit-todo-item");
    const caseId = selectedCaseId();
    const itemId = item?.dataset.itemId || "";
    const decision = button.dataset.decision || "";
    if (!caseId || !itemId || !decision || assistantBusy) return;

    const row = button.closest(".cockpit-decision-row");
    row?.querySelectorAll(".cockpit-decision").forEach((node) => {
      node.disabled = true;
    });

    try {
      const updated = await window.BachSBOBackend.caseAssistantDecide(
        caseId,
        itemId,
        decision
      );
      const cached = assistantStateByCase.get(caseId);
      const suggestion = cached?.suggestions?.find((entry) => entry.id === itemId);
      if (suggestion) {
        suggestion.doctorDecision = updated.doctorDecision;
        suggestion.decidedAt = updated.decidedAt;
      }
      const uiDecision = decisionUiValue(updated.doctorDecision);
      row?.querySelectorAll(".cockpit-decision").forEach((node) => {
        node.classList.toggle("selected", node.dataset.decision === uiDecision);
      });
      if (item) {
        ["done", "yes", "no"].forEach((value) => {
          item.classList.toggle("decision-" + value, value === uiDecision);
        });
        item.dataset.doctorDecision = uiDecision;
      }
    } catch (error) {
      if (selectedCaseId() === caseId) {
        const status = document.getElementById("cockpitAssistantStatus");
        if (status) status.textContent = error?.message || label("Could not save decision.", "A döntés mentése sikertelen.");
      }
    } finally {
      row?.querySelectorAll(".cockpit-decision").forEach((node) => {
        node.disabled = false;
      });
    }
  }

  function renderAssistantResponse(response) {
    const results = document.getElementById("cockpitAssistantResults");
    if (!results) return;

    renderDocumentationReview();
    const suggestions = Array.isArray(response?.suggestions)
      ? response.suggestions
      : [];
    const count = document.getElementById("cockpitAssistantCount");
    if (count) count.textContent = String(suggestions.length);

    if (!suggestions.length) {
      results.innerHTML = `<div class="subtle cockpit-empty-ai">${esc(label(
        "No saved assistant list yet. Run analysis for this case.",
        "Ehhez az esethez még nincs mentett asszisztenslista. Indítsa el az elemzést."
      ))}</div>`;
      return;
    }

    const stale = response?.stale
      ? `<div class="cockpit-stale-banner">⚠ ${esc(label(
          "Case changed since this list was generated. Refresh recommended.",
          "Az eset adatai az elemzés óta változtak. Frissítés javasolt."
        ))}</div>`
      : "";

    results.innerHTML = stale + suggestions.map((item) => {
      const meta = priorityMeta(item.priority);
      const decision = decisionUiValue(item.doctorDecision);
      const missing = Array.isArray(item.missingInformation)
        ? item.missingInformation
        : [];
      const sources = Array.isArray(item.sources) ? item.sources : [];
      const sourceLinks = sources.map((source) => {
        const url = String(source?.url || "");
        if (!url.startsWith("https://")) return "";
        const organization = String(source?.organization || "").trim();
        const sourceTitle = String(source?.title || "").trim();
        const title = [organization, sourceTitle]
          .filter(Boolean)
          .filter((value, index, array) => array.indexOf(value) === index)
          .join(" — ") || url;
        const meta = [
          source?.year ? String(source.year) : "",
          source?.jurisdiction || ""
        ].filter(Boolean).join(" · ");
        return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>${meta ? ` · ${esc(meta)}` : ""}`;
      }).filter(Boolean).join("<br>");

      return `
        <article class="cockpit-todo-item priority-${esc(item.priority || "consider")} ${decision !== "pending" ? "decision-" + esc(decision) : ""}" data-item-id="${esc(item.id || "")}" data-doctor-decision="${esc(decision)}">
          <div class="cockpit-todo-main">
            <span class="cockpit-priority">${meta.icon} ${meta.label}</span>
            <strong class="cockpit-todo-title">${esc(item.title || "")}</strong>
            <details class="cockpit-todo-info">
              <summary title="${esc(label("Why / source", "Indoklás / forrás"))}">ⓘ</summary>
              <div class="cockpit-info-body">
                ${item.reason ? `<div><b>${esc(label("Why", "Miért"))}:</b> ${esc(item.reason)}</div>` : ""}
                ${missing.length ? `<div><b>${esc(label("Missing", "Hiányzik"))}:</b> ${missing.map(esc).join("; ")}</div>` : ""}
                ${sourceLinks ? `<div class="cockpit-ai-sources"><b>${esc(label("Source", "Forrás"))}:</b><br>${sourceLinks}</div>` : ""}
              </div>
            </details>
          </div>
          <div class="cockpit-decision-row">
            <button type="button" data-decision="done" class="cockpit-decision done ${decision === "done" ? "selected" : ""}">DONE</button>
            <button type="button" data-decision="yes" class="cockpit-decision yes ${decision === "yes" ? "selected" : ""}">YES</button>
            <button type="button" data-decision="no" class="cockpit-decision no ${decision === "no" ? "selected" : ""}">NO</button>
          </div>
        </article>
      `;
    }).join("");

    results.querySelectorAll(".cockpit-decision").forEach((button) => {
      button.addEventListener("click", () => saveAssistantDecision(button));
    });
  }

  async function loadAssistantStateForCurrentCase() {
    const id = selectedCaseId();
    const results = document.getElementById("cockpitAssistantResults");
    const status = document.getElementById("cockpitAssistantStatus");
    if (!id) {
      if (results) results.innerHTML = "";
      return;
    }

    const token = ++assistantLoadToken;
    const cached = assistantStateByCase.get(id);
    if (cached) renderAssistantResponse(cached);
    if (status) status.textContent = label("Loading saved assistant…", "Mentett asszisztens betöltése…");

    try {
      const patient = await selectedPatient();
      if (!patient || token !== assistantLoadToken || selectedCaseId() !== id) return;
      if (!window.BachSBOBackend?.caseAssistantGetState) {
        throw new Error(label("Assistant state backend unavailable.", "Az asszisztens állapot backend nem érhető el."));
      }
      const response = await window.BachSBOBackend.caseAssistantGetState(patient);
      if (token !== assistantLoadToken || selectedCaseId() !== id) return;
      assistantStateByCase.set(id, response);
      renderAssistantResponse(response);
      if (status) {
        status.textContent = response?.run
          ? label("Saved list restored for this case.", "Az eset mentett listája visszatöltve.")
          : label("No assistant list yet.", "Még nincs asszisztenslista.");
      }
    } catch (error) {
      if (token !== assistantLoadToken) return;
      if (status) status.textContent = error?.message || label("Could not load assistant state.", "Az asszisztens állapot betöltése sikertelen.");
    }
  }

  function openDataEntryDialog() {
    const id = selectedCaseId();
    const form = document.getElementById("patientForm");
    if (!id || form?.classList.contains("case-readonly")) return;

    const overlay = document.getElementById("cockpitDataEntryOverlay");
    if (!overlay) return;

    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("cockpit-data-entry-open");
    document.getElementById("cockpitPasteText")?.focus();
  }

  function closeDataEntryDialog() {
    if (assistantBusy) return;
    closeExtractionConfirmation();
    const overlay = document.getElementById("cockpitDataEntryOverlay");
    if (!overlay) return;
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("cockpit-data-entry-open");
  }

  function closeExtractionConfirmation() {
    const overlay = document.getElementById("cockpitExtractConfirmOverlay");
    if (!overlay) return;
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }

  function acceptedExtractionNodes() {
    const preview = document.getElementById("cockpitExtractPreview");
    if (!preview) return [];
    return [...preview.querySelectorAll(".cockpit-extract-item")]
      .filter((node) => node.dataset.decision === "accept" && node.dataset.applied !== "true");
  }

  function requestExtractionApplyConfirmation() {
    if (assistantBusy) return;
    const accepted = acceptedExtractionNodes();
    if (!accepted.length) return;

    const overlay = document.getElementById("cockpitExtractConfirmOverlay");
    const title = document.getElementById("cockpitExtractConfirmTitle");
    const textNode = document.getElementById("cockpitExtractConfirmText");
    const apply = document.getElementById("cockpitExtractConfirmApply");
    if (!overlay || !textNode || !apply) return;

    if (title) title.textContent = label("Confirm AI-assisted entry", "AI-assisted adatbevitel megerősítése");
    textNode.textContent = label(
      `${accepted.length} accepted item(s) will be written to the selected patient's chart. Please confirm after reviewing them.`,
      `${accepted.length} elfogadott elem kerül beírásra a kiválasztott beteg dokumentációjába. Ellenőrzés után erősítse meg.`
    );
    apply.textContent = label("CONFIRM AND WRITE", "MEGERŐSÍTÉS ÉS BEÍRÁS");
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
  }

  async function extractPastedText() {
    if (assistantBusy) return;
    const text = document.getElementById("cockpitPasteText")?.value || "";
    const status = document.getElementById("cockpitExtractStatus");
    const preview = document.getElementById("cockpitExtractPreview");
    try {
      assistantBusy = true;
      syncRailState();
      const id = selectedCaseId();
      if (!id) throw new Error(label("Select an active case first.", "Először válasszon aktív esetet."));
      if (!text.trim()) throw new Error(label("Paste text to analyze.", "Illesszen be elemezhető szöveget."));
      if (!window.BachSBOBackend?.caseAssistantExtract) {
        throw new Error(label("Case Assistant extraction bridge is unavailable.", "A Case Assistant szövegkinyerő kapcsolat nem érhető el."));
      }
      // A mixed/stale browser cache can load cockpit-beta.js without the matching
      // assistant-core.js. Recover the local validation module before spending an
      // extraction request, while still failing closed if the module cannot load.
      const assistantCore = await ensureAssistantCore();
      if (status) status.textContent = label("Extracting documented facts…", "Dokumentált tények kinyerése…");
      const response = await window.BachSBOBackend.caseAssistantExtract(id, text);
      renderExtractionPreview(response, text, id, assistantCore);
      if (status) status.textContent = label(
        "Review each item before applying it to the chart.",
        "Minden elemet ellenőrizzen, mielőtt a dokumentációba kerül."
      );
    } catch (error) {
      if (status) status.textContent = error?.message || label("Extraction failed.", "Kinyerés sikertelen.");
      if (preview) preview.innerHTML = "";
    } finally {
      assistantBusy = false;
      syncRailState();
    }
  }

  function extractionTargetLabel(target) {
    const labels = {
      mainComplaint: label("Main complaint", "Fő panasz"),
      complaint: label("Present complaints", "Jelen panaszok"),
      history: label("History", "Anamnézis"),
      physical: label("Physical examination", "Fizikális vizsgálat"),
      therapy: label("Therapy", "Terápia"),
      course: label("Clinical course", "Kórlefolyás"),
      diagnoses: label("Diagnoses", "Diagnózisok"),
      others: label("Other", "Egyéb"),
      lab: label("Laboratory", "Labor"),
      ekg: "EKG",
      gas: label("Blood gas (AVG / VVG)", "Vérgáz (AVG / VVG)"),
      radiology: label("Imaging", "Képalkotó"),
      consultation: label("Consultation", "Konzílium")
    };
    return labels[target] || String(target || label("Unknown", "Ismeretlen"));
  }

  function extractionItemModeControl(item, assistantCore = assistantCoreRef || window.BachAssistantCore) {
    if (!assistantCore?.fields?.includes(item.target)) return "";
    return `
      <label class="cockpit-apply-mode-wrap">
        <span>${esc(label("When applied", "Alkalmazáskor"))}</span>
        <select class="cockpit-apply-mode" aria-label="${esc(label("Apply mode", "Alkalmazási mód"))}">
          <option value="append">${esc(label("Append", "Hozzáfűzés"))}</option>
          <option value="replace">${esc(label("Replace", "Csere"))}</option>
        </select>
      </label>
    `;
  }

  function refreshExtractionApplyButton() {
    const preview = document.getElementById("cockpitExtractPreview");
    const apply = document.getElementById("cockpitApplyAccepted");
    if (!preview || !apply) return;
    const accepted = [...preview.querySelectorAll(".cockpit-extract-item")]
      .filter((item) => item.dataset.decision === "accept" && item.dataset.applied !== "true");
    apply.disabled = !accepted.length || assistantBusy;
    apply.textContent = accepted.length
      ? label(`APPLY ACCEPTED (${accepted.length})`, `ELFOGADOTTAK ALKALMAZÁSA (${accepted.length})`)
      : label("APPLY ACCEPTED", "ELFOGADOTTAK ALKALMAZÁSA");
  }

  async function applyAcceptedExtraction() {
    if (assistantBusy) return;
    closeExtractionConfirmation();
    const preview = document.getElementById("cockpitExtractPreview");
    const status = document.getElementById("cockpitExtractStatus");
    const state = extractionPreviewState;
    if (!preview || !state) return;

    const currentCaseId = selectedCaseId();
    if (!currentCaseId || currentCaseId !== state.caseId) {
      if (status) status.textContent = label(
        "The selected case changed. Extract again before applying.",
        "A kiválasztott eset megváltozott. Alkalmazás előtt végezze el újra a kinyerést."
      );
      return;
    }
    if (!window.BachSBOClinicalUi?.applyAcceptedExtraction) {
      if (status) status.textContent = label(
        "Clinical apply bridge is unavailable.",
        "A klinikai alkalmazási kapcsolat nem érhető el."
      );
      return;
    }

    const selected = acceptedExtractionNodes()
      .map((node) => {
        const index = Number(node.dataset.index);
        const item = structuredClone(state.items[index]);
        const mode = node.querySelector(".cockpit-apply-mode")?.value;
        if (mode) item.mode = mode;
        return item;
      });

    if (!selected.length) return;

    try {
      assistantBusy = true;
      refreshExtractionApplyButton();
      syncRailState();
      if (status) status.textContent = label(
        "Applying accepted facts and saving…",
        "Elfogadott tények alkalmazása és mentése…"
      );
      await window.BachSBOClinicalUi.applyAcceptedExtraction(state.caseId, selected);

      preview.querySelectorAll(".cockpit-extract-item").forEach((node) => {
        if (node.dataset.decision !== "accept" || node.dataset.applied === "true") return;
        node.dataset.applied = "true";
        node.classList.add("applied");
        node.querySelectorAll("button, select").forEach((control) => control.disabled = true);
        const yes = node.querySelector(".cockpit-decision.yes");
        if (yes) yes.textContent = label("APPLIED", "ALKALMAZVA");
      });
      if (status) status.textContent = label(
        "Accepted facts applied and saved. Review the chart before continuing.",
        "Az elfogadott tények alkalmazva és mentve. Folytatás előtt ellenőrizze a dokumentációt."
      );
    } catch (error) {
      if (status) status.textContent = label(
        `Nothing was applied. ${error?.message || "Save failed."}`,
        `Nem történt alkalmazás. ${error?.message || "A mentés sikertelen."}`
      );
    } finally {
      assistantBusy = false;
      refreshExtractionApplyButton();
      syncRailState();
    }
  }

  function renderExtractionPreview(response, sourceText, caseId, assistantCore = assistantCoreRef || window.BachAssistantCore) {
    const preview = document.getElementById("cockpitExtractPreview");
    if (!preview) return;

    if (!assistantCore?.validateProposal) {
      throw new Error(label(
        "Assistant validation core is unavailable.",
        "Az asszisztens validációs modul nem érhető el."
      ));
    }

    assistantCoreRef = assistantCore;
    const validated = assistantCore.validateProposal(response, sourceText);
    const items = validated.items;
    const warnings = validated.warnings;
    extractionPreviewState = { caseId, items, warnings };

    const itemHtml = items.map((item, index) => `
      <div class="cockpit-extract-item" data-index="${index}" data-decision="">
        <div class="cockpit-extract-head">
          <strong>${esc(item.label || item.target || label("Fact", "Tény"))}</strong>
          <span>${esc(item.status || label("documented", "dokumentált"))}</span>
        </div>
        <div class="cockpit-extract-target">
          <span>${esc(label("Destination field", "Célmező"))}</span>
          <strong>→ ${esc(extractionTargetLabel(item.target))}</strong>
        </div>
        <div class="cockpit-extract-text">${esc(item.text || "")}</div>
        <details>
          <summary>${esc(label("Evidence", "Bizonyíték"))}</summary>
          <div class="cockpit-evidence">${esc(item.evidence || "")}</div>
        </details>
        ${extractionItemModeControl(item, assistantCore)}
        <div class="cockpit-decision-row">
          <button type="button" class="cockpit-decision yes" data-extract-decision="accept">${esc(label("ACCEPT", "ELFOGAD"))}</button>
          <button type="button" class="cockpit-decision no" data-extract-decision="ignore">${esc(label("IGNORE", "KIHAGY"))}</button>
        </div>
      </div>
    `).join("");

    const warningHtml = warnings.length
      ? `<div class="cockpit-extract-warnings"><strong>${esc(label("Warnings", "Figyelmeztetések"))}</strong>${warnings.map((w) => `<div>• ${esc(w)}</div>`).join("")}</div>`
      : "";

    const applyHtml = items.length
      ? `<div class="cockpit-extract-apply-bar">
          <button type="button" class="btn primary cockpit-wide-btn" id="cockpitApplyAccepted" disabled>${esc(label("APPLY ACCEPTED", "ELFOGADOTTAK ALKALMAZÁSA"))}</button>
          <div class="cockpit-extract-apply-note">${esc(label(
            "Accept only marks items for review. Apply Accepted is the explicit write action.",
            "Az Elfogad csak kijelöli az elemeket. Az Elfogadottak alkalmazása végzi a tényleges beírást."
          ))}</div>
        </div>`
      : "";

    preview.innerHTML = warningHtml + (itemHtml || `<div class="subtle">${esc(label("No supported facts extracted.", "Nem sikerült alátámasztott tényt kinyerni."))}</div>`) + applyHtml;

    preview.querySelectorAll(".cockpit-decision-row").forEach((row) => {
      row.addEventListener("click", (event) => {
        const button = event.target.closest("[data-extract-decision]");
        if (!button || button.disabled) return;
        const item = row.closest(".cockpit-extract-item");
        if (!item || item.dataset.applied === "true") return;
        item.dataset.decision = button.dataset.extractDecision || "";
        row.querySelectorAll(".cockpit-decision").forEach((choice) => choice.classList.remove("selected"));
        button.classList.add("selected");
        refreshExtractionApplyButton();
      });
    });

    document.getElementById("cockpitApplyAccepted")?.addEventListener("click", requestExtractionApplyConfirmation);
    renderDocumentationReview();
    refreshExtractionApplyButton();
  }

  function sexClass(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (["m", "male", "férfi"].includes(normalized)) return "male";
    if (["f", "female", "nő"].includes(normalized)) return "female";
    return "other";
  }

  function waitingTestMarkup(progress, completed) {
    if (completed) {
      return `<div class="cockpit-test-chip-list"><span class="cockpit-row-complete">${esc(label("Completed", "Lezárt"))}</span></div>`;
    }

    const waiting = progress?.waitingTests || [];
    if (!waiting.length) {
      return `<div class="cockpit-test-chip-list"><span class="cockpit-row-ready">${esc(label("No waiting tests", "Nincs függő vizsgálat"))}</span></div>`;
    }

    const names = waiting.map((item) => String(item?.name || "").trim()).filter(Boolean);
    const title = names.join(", ");
    const text = label(
      `${waiting.length} waiting${title ? " · " + title : ""}`,
      `${waiting.length} függő${title ? " · " + title : ""}`
    );

    return `<div class="cockpit-test-chip-list" title="${esc(title)}" aria-label="${esc(label("Waiting tests", "Függő vizsgálatok"))}: ${esc(title)}">
      <span class="cockpit-test-summary">${esc(text)}</span>
    </div>`;
  }

  function installPatientListStatusHook() {
    window.BachSBOUiHooks ||= {};
    window.BachSBOUiHooks.patientListStatusHtml = (patient, context = {}) => {
      const progress = patientProgress(patient);
      if (patient?.id) patientProgressByCase.set(patient.id, progress);
      return waitingTestMarkup(progress, Boolean(context.completed));
    };
  }

  function decoratePatientIdentity(row, patient = null) {
    const cells = row.querySelectorAll(":scope > td");
    if (cells.length < 5) return null;

    row.classList.add("cockpit-compact-patient");
    cells[0].classList.add("cockpit-local-id");
    cells[1].classList.add("cockpit-sex-source");
    cells[2].className = `cockpit-age-badge sex-${sexClass(patient?.sex || cells[1].textContent)}`;
    cells[2].setAttribute(
      "aria-label",
      `${label("Age", "Életkor")} ${cells[2].textContent.trim()}, ${label("sex", "nem")} ${String(patient?.sex || cells[1].textContent).trim()}`
    );
    cells[3].classList.add("cockpit-main-complaint");
    cells[4].classList.add("cockpit-waiting-tests");
    return cells;
  }

  function decoratePatientRow(row, patient) {
    const cells = decoratePatientIdentity(row, patient);
    if (!cells) return;

    const progress = patient ? patientProgress(patient) : null;
    if (patient?.id) patientProgressByCase.set(patient.id, progress);
    cells[4].innerHTML = waitingTestMarkup(progress, row.classList.contains("completed"));
  }

  async function enhancePatientRows() {
    const rows = [...document.querySelectorAll("#patientTbody tr[data-id]")];
    rows.forEach((row) => decoratePatientIdentity(row));
    const pendingRows = rows.filter((row) => !row.querySelector(".cockpit-test-chip-list"));
    if (!pendingRows.length || patientBoardLoad || !window.BachSBOBackend?.loadState) return;

    patientBoardLoad = window.BachSBOBackend.loadState();
    try {
      const snapshot = await patientBoardLoad;
      const patients = new Map((snapshot?.patients || []).map((patient) => [patient.id, patient]));
      pendingRows.forEach((row) => {
        if (row.isConnected) decoratePatientRow(row, patients.get(row.dataset.id));
      });
      syncRailState();
    } catch (error) {
      pendingRows.forEach((row) => {
        if (!row.isConnected) return;
        decoratePatientIdentity(row);
      });
    } finally {
      patientBoardLoad = null;
    }
  }

  function syncUnifiedTestLabels() {
    const title = document.getElementById("cockpitInvestigationsTitle");
    const add = document.getElementById("cockpitAddTest");
    const other = document.getElementById("cockpitOtherTestName");
    if (title) title.textContent = label("Investigations", "Vizsgálatok");
    if (add) add.textContent = label("+ Add test", "+ Vizsgálat hozzáadása");
    if (other) other.placeholder = label("Test name", "Vizsgálat neve");

    const optionLabels = {
      lab: label("Lab", "Labor"),
      ekg: "EKG",
      gas: "AVG",
      imaging: label("Radiology", "Radiológia"),
      consultation: label("Consultation", "Konzílium"),
      other: label("Other", "Egyéb")
    };
    document.querySelectorAll("[data-add-test-type]").forEach((button) => {
      button.textContent = optionLabels[button.dataset.addTestType] || button.textContent;
    });

    const otherConfirm = document.getElementById("cockpitOtherTestConfirm");
    if (otherConfirm) otherConfirm.textContent = label("ADD", "HOZZÁADÁS");
  }

  function decorateTestCard(card, context = {}) {
    if (!card) return;
    card.classList.add("cockpit-test-row");

    const save = card.querySelector(".test-save");
    if (save) {
      save.textContent = "✓";
      save.title = label("Save result", "Eredmény mentése");
      save.setAttribute("aria-label", save.title);
    }

    card.querySelectorAll("[data-delete-test]").forEach((button) => {
      button.textContent = "×";
      button.title = label("Delete test", "Vizsgálat törlése");
      button.setAttribute("aria-label", button.title);
      button.classList.add("cockpit-test-delete-end");
      // Keep status dots isolated. Delete belongs to the far end of the row.
      if (button.parentElement !== card) card.appendChild(button);
    });

    const dots = card.querySelector(".mode-dots");
    if (dots && !dots.dataset.cockpitOrdered) {
      const notOrdered = dots.querySelector('[data-mode-choice="notordered"]');
      const waiting = dots.querySelector('[data-mode-choice="waiting"]');
      const result = dots.querySelector(".mode-dot-btn.result");
      [notOrdered, waiting, result].filter(Boolean).forEach((node) => dots.appendChild(node));
      dots.dataset.cockpitOrdered = "true";
    }

    const dynamicGrid = card.querySelector(".dynamic-grid");
    const typeInput = dynamicGrid?.querySelector(":scope > [data-type]");
    if (
      dynamicGrid &&
      typeInput &&
      String(context?.key || "").startsWith("consultations-") &&
      !dynamicGrid.querySelector(":scope > .cockpit-consultation-identity")
    ) {
      const identity = document.createElement("div");
      identity.className = "cockpit-consultation-identity";
      const prefix = document.createElement("span");
      prefix.className = "cockpit-consultation-prefix";
      prefix.textContent = label("Consultation", "Konzílium");
      dynamicGrid.insertBefore(identity, typeInput);
      identity.append(prefix, typeInput);
    }

    const radiologyGrid = card.querySelector(".radiology-grid");
    if (radiologyGrid && !radiologyGrid.querySelector(":scope > .cockpit-radiology-identity")) {
      const identity = document.createElement("div");
      identity.className = "cockpit-radiology-identity";
      const prefix = document.createElement("span");
      prefix.className = "cockpit-radiology-prefix";
      prefix.textContent = label("Radiology", "Radiológia");
      const first = radiologyGrid.firstElementChild;
      if (first) radiologyGrid.insertBefore(identity, first);
      identity.appendChild(prefix);
      ["[data-body]", "[data-modality]", "[data-other]"].forEach((selector) => {
        const control = radiologyGrid.querySelector(`:scope > ${selector}`);
        if (control) identity.appendChild(control);
      });
    }
  }

  function installTestCardHook() {
    window.BachSBOUiHooks ||= {};
    window.BachSBOUiHooks.decorateTestCard = (card, context) => decorateTestCard(card, context);
  }

  function compactTestCards(panel) {
    panel.querySelectorAll(".test-card").forEach((card) => {
      const key = card.dataset.card || "";
      decorateTestCard(card, {
        key,
        kind: key.startsWith("consultations-") ? "dynamic" : ""
      });
    });
  }

  function closeUnifiedTestMenu() {
    const menu = document.getElementById("cockpitAddTestMenu");
    const trigger = document.getElementById("cockpitAddTest");
    const otherRow = document.getElementById("cockpitOtherTestRow");
    if (menu) menu.classList.add("hidden");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    if (otherRow) otherRow.classList.add("hidden");
  }

  function toggleUnifiedTestMenu() {
    const trigger = document.getElementById("cockpitAddTest");
    const menu = document.getElementById("cockpitAddTestMenu");
    if (!trigger || !menu || trigger.disabled) return;

    const opening = menu.classList.contains("hidden");
    closeUnifiedTestMenu();
    if (!opening) return;

    menu.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
    menu.querySelector("[data-add-test-type]")?.focus();
  }

  function addUnifiedTest(type, options = {}) {
    const add = window.BachSBOClinicalUi?.addInvestigation;
    const trigger = document.getElementById("cockpitAddTest");
    if (typeof add !== "function" || trigger?.disabled) return false;

    const added = add(type, options);
    if (!added) return false;

    closeUnifiedTestMenu();
    setTimeout(() => {
      enhanceTestsUi();
      window.BachSBOClinicalUi?.commitCurrentDraft?.();
      scheduleCaseAutosave(350);
    }, 0);
    return true;
  }

  function handleUnifiedTestChoice(type) {
    if (type === "other") {
      const row = document.getElementById("cockpitOtherTestRow");
      const input = document.getElementById("cockpitOtherTestName");
      row?.classList.remove("hidden");
      input?.focus();
      return;
    }
    addUnifiedTest(type);
  }

  function addOtherUnifiedTest() {
    const input = document.getElementById("cockpitOtherTestName");
    const name = String(input?.value || "").trim();
    if (!name) {
      input?.focus();
      input?.classList.add("invalid");
      return;
    }
    input.classList.remove("invalid");
    if (addUnifiedTest("other", { name })) input.value = "";
  }

  function enhanceTestsUi() {
    const panel = document.querySelector('[data-cockpit-panel="tests"]');
    if (!panel) return;

    const physical = panel.querySelector('[data-narrative-field="physical"]');
    const physicalLabel = physical?.querySelector("label");
    if (physicalLabel) physicalLabel.textContent = label("Physical examination", "Fizikális vizsgálat");
    const physicalInput = document.getElementById("fPhysical");
    if (physicalInput) {
      physicalInput.placeholder = label(
        "Relevant findings for the physician…",
        "Lényeges eltérések az orvos számára…"
      );
    }
    if (physical && !physical.querySelector(".cockpit-physical-note")) {
      const note = document.createElement("span");
      note.className = "cockpit-physical-note";
      physical.querySelector(".narrative-head")?.appendChild(note);
    }
    const note = physical?.querySelector(".cockpit-physical-note");
    if (note) note.textContent = label("Note: relevant findings", "Megjegyzés: lényeges eltérések");

    let header = document.getElementById("cockpitInvestigationsHeader");
    if (!header) {
      header = document.createElement("div");
      header.id = "cockpitInvestigationsHeader";
      header.className = "cockpit-investigations-header";
      header.innerHTML = `
        <strong id="cockpitInvestigationsTitle"></strong>
        <div class="cockpit-add-test-controls">
          <div class="cockpit-add-test-wrap">
            <button class="btn small cockpit-add-test-trigger" id="cockpitAddTest" type="button"
              aria-haspopup="menu" aria-expanded="false"></button>
            <div class="cockpit-add-test-menu hidden" id="cockpitAddTestMenu" role="menu">
              <button type="button" role="menuitem" data-add-test-type="lab">Labor</button>
              <button type="button" role="menuitem" data-add-test-type="ekg">EKG</button>
              <button type="button" role="menuitem" data-add-test-type="gas">AVG</button>
              <button type="button" role="menuitem" data-add-test-type="imaging">Radiológia</button>
              <button type="button" role="menuitem" data-add-test-type="consultation">Konzílium</button>
              <button type="button" role="menuitem" data-add-test-type="other">Egyéb</button>
              <div class="cockpit-add-test-other hidden" id="cockpitOtherTestRow">
                <input id="cockpitOtherTestName" autocomplete="off" />
                <button class="btn small" id="cockpitOtherTestConfirm" type="button">HOZZÁADÁS</button>
              </div>
            </div>
          </div>
        </div>`;
      const firstToolbar = panel.querySelector(".test-group-toolbar");
      firstToolbar?.insertAdjacentElement("beforebegin", header);

      header.querySelector("#cockpitAddTest")?.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleUnifiedTestMenu();
      });
      header.querySelectorAll("[data-add-test-type]").forEach((button) => {
        button.addEventListener("click", () => handleUnifiedTestChoice(button.dataset.addTestType || ""));
      });
      header.querySelector("#cockpitOtherTestConfirm")?.addEventListener("click", addOtherUnifiedTest);
      header.querySelector("#cockpitOtherTestName")?.addEventListener("input", (event) => {
        event.target.classList.remove("invalid");
      });
      header.querySelector("#cockpitOtherTestName")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          addOtherUnifiedTest();
        }
        if (event.key === "Escape") closeUnifiedTestMenu();
      });

      document.addEventListener("click", (event) => {
        const wrap = document.querySelector("#cockpitInvestigationsHeader .cockpit-add-test-wrap");
        if (wrap && !wrap.contains(event.target)) closeUnifiedTestMenu();
      }, true);
    }

    let list = document.getElementById("cockpitInvestigationsList");
    if (!list) {
      list = document.createElement("div");
      list.id = "cockpitInvestigationsList";
      list.className = "cockpit-investigations-list";
      header.insertAdjacentElement("afterend", list);
      ["labCards", "ekgCard", "gasCard", "radiologyCards", "consultCards"].forEach((id) => {
        const host = document.getElementById(id);
        if (host) list.appendChild(host);
      });
      document.getElementById("fOthers")?.closest(".field")?.classList.add("cockpit-legacy-others");
    }

    let legend = document.getElementById("cockpitInvestigationsLegend");
    if (!legend) {
      legend = document.createElement("div");
      legend.id = "cockpitInvestigationsLegend";
      legend.className = "cockpit-investigations-legend";
      list.insertAdjacentElement("afterend", legend);
    }
    legend.innerHTML = label(
      '<span class="legend-item"><span class="legend-dot grey"></span>Grey = not ordered</span><span class="legend-item"><span class="legend-dot orange"></span>Orange = waiting / pending</span><span class="legend-item"><span class="legend-dot green"></span>Green = result available / completed</span>',
      '<span class="legend-item"><span class="legend-dot grey"></span>Szürke = nem történt</span><span class="legend-item"><span class="legend-dot orange"></span>Narancs = függő / eredményre vár</span><span class="legend-item"><span class="legend-dot green"></span>Zöld = eredmény rendelkezésre áll / kész</span>'
    );

    syncUnifiedTestLabels();
    compactTestCards(panel);
  }

  const wardOptions = [
    "Belgyógyászat",
    "Kardiológia",
    "Gasztroenterológia",
    "Infektológia",
    "SBO",
    "Sebészet",
    "Neurológia",
    "Idegsebészet",
    "Nefrológia"
  ];

  function syncArrivalVisual() {
    const select = document.getElementById("iceArrival");
    const field = select?.closest(".field");
    if (!select || !field) return;

    const missing = !String(select.value || "").trim();
    field.classList.toggle("cockpit-arrival-missing", missing);
    select.setAttribute("aria-invalid", missing ? "true" : "false");
  }

  function enhanceClinicalHeader() {
    const host = document.getElementById("inlineCaseEditor");
    if (!host) return;
    host.classList.add("cockpit-demographics-inline");
    document.getElementById("iceArrival")?.closest(".field")?.classList.add("cockpit-arrival-field");
    document.getElementById("iceArrivalOtherWrap")?.classList.add("cockpit-arrival-other");
    host.querySelector(":scope > .toolbar")?.classList.add("cockpit-demographics-toolbar");
    syncArrivalVisual();
  }

  function ensureWardPicker() {
    const source = document.getElementById("fWard");
    if (!source || document.getElementById("cockpitWardSelect")) return;
    source.classList.add("cockpit-ward-source");

    const select = document.createElement("select");
    select.id = "cockpitWardSelect";
    select.innerHTML =
      `<option value="">—</option>` +
      wardOptions.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join("") +
      `<option value="__other__">Egyéb</option>`;

    const other = document.createElement("input");
    other.id = "cockpitWardOther";
    other.placeholder = "Egyéb osztály / részleg";
    other.className = "hidden";

    source.insertAdjacentElement("afterend", other);
    source.insertAdjacentElement("afterend", select);

    const writeBack = () => {
      if (select.value === "__other__") {
        other.classList.remove("hidden");
        source.value = other.value.trim();
      } else {
        other.classList.add("hidden");
        source.value = select.value;
      }
      source.dispatchEvent(new Event("input", { bubbles: true }));
      source.dispatchEvent(new Event("change", { bubbles: true }));
    };

    select.addEventListener("change", writeBack);
    other.addEventListener("input", writeBack);
    syncWardPicker();
  }

  function syncWardPicker() {
    const source = document.getElementById("fWard");
    const select = document.getElementById("cockpitWardSelect");
    const other = document.getElementById("cockpitWardOther");
    if (!source || !select || !other) return;
    if ([select, other].includes(document.activeElement)) return;

    const value = String(source.value || "").trim();
    if (!value) {
      select.value = "";
      other.value = "";
      other.classList.add("hidden");
      return;
    }
    if (wardOptions.includes(value)) {
      select.value = value;
      other.value = "";
      other.classList.add("hidden");
      return;
    }
    select.value = "__other__";
    other.value = value;
    other.classList.remove("hidden");
  }

  function syncDischargeConditionVisual() {
    const disposition = document.getElementById("fDisposition")?.value || "";
    const wrap = document.getElementById("dischargeConditionWrap");
    const field = document.getElementById("fDischargeCondition");
    const state = document.getElementById("dischargeConditionState");
    if (!wrap || !field || !state) return;

    const visible = disposition === "discharged";
    const complete = Boolean(String(field.value || "").trim());

    wrap.classList.toggle("hidden", !visible);
    wrap.classList.toggle("waiting", visible && !complete);
    wrap.classList.toggle("result", visible && complete);

    state.textContent = complete
      ? label("COMPLETE", "KÉSZ")
      : label("REQUIRED", "KÖTELEZŐ");
    state.className = `field-state ${complete ? "result" : "waiting"}`;
  }

  function enhanceDispositionUi() {
    ensureWardPicker();
    syncWardPicker();
    syncDischargeConditionVisual();

    const note = document.getElementById("fAdmissionNote");
    if (note) {
      note.placeholder = "Milyen állapotban, szállítás?";
      const labelNode = note.closest(".field")?.querySelector("label");
      if (labelNode) {
        labelNode.textContent = label(
          "Additional note — condition / transport?",
          "Kiegészítő megjegyzés — milyen állapotban, szállítás?"
        );
      }
    }
  }

  function syncCaseSelection() {
    const id = selectedCaseId();
    if (id !== lastSelectedCaseId) {
      lastSelectedCaseId = id;
      activeTab = "clinical";
      document.querySelectorAll("[data-cockpit-tab]").forEach((button) => {
        button.classList.toggle("active", button.dataset.cockpitTab === activeTab);
      });
      applyTabVisibility();

      const extraction = document.getElementById("cockpitExtractPreview");
      if (extraction) extraction.innerHTML = "";
      extractionPreviewState = null;
      closeDataEntryDialog();
      renderDocumentationReview();
      enhanceDispositionUi();
      loadAssistantStateForCurrentCase();
    }
  }

  let cockpitActivated = false;

  function patientWorkspaceVisible() {
    const view = document.getElementById("patientsView");
    return Boolean(view && !view.classList.contains("hidden"));
  }

  function addBetaControls() {
    // Beta has been promoted to Stable. Keep this hook as a no-op for compatibility.
  }

  function activateCockpitIfReady() {
    addBetaControls();
    if (!patientWorkspaceVisible()) return;

    if (!cockpitActivated) {
      document.body.classList.add("cockpit-ui");
      cockpitActivated = true;
    }

    createTabBar();
    makeRail();
    enhanceClinicalHeader();
    enhanceTestsUi();
    enhanceDispositionUi();
    syncCaseSelection();
    enhancePatientRows();
    syncRailState();
  }

  function scheduleCaseAutosave(delay = 700) {
    const form = document.getElementById("patientForm");
    if (!form || form.classList.contains("hidden") || !selectedCaseId()) return;

    clearTimeout(caseAutosaveTimer);
    caseAutosaveTimer = setTimeout(runCaseAutosave, Math.max(0, delay));
  }

  async function runCaseAutosave() {
    const save = window.BachSBOClinicalUi?.autosaveCurrentCase;
    if (typeof save !== "function" || !selectedCaseId()) return;

    if (caseAutosaveInFlight) {
      caseAutosaveQueued = true;
      return;
    }

    caseAutosaveInFlight = true;
    try {
      await save();
    } catch (error) {
      console.warn("Beta autosave failed", error);
    } finally {
      caseAutosaveInFlight = false;
      if (caseAutosaveQueued) {
        caseAutosaveQueued = false;
        scheduleCaseAutosave(120);
      }
    }
  }

  function installSync() {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!document.getElementById("cockpitAddTestMenu")?.classList.contains("hidden")) {
        closeUnifiedTestMenu();
        return;
      }
      if (!document.getElementById("cockpitExtractConfirmOverlay")?.classList.contains("hidden")) {
        closeExtractionConfirmation();
        return;
      }
      if (!document.getElementById("cockpitDataEntryOverlay")?.classList.contains("hidden")) {
        closeDataEntryDialog();
      }
    }, true);

    document.addEventListener("input", (event) => {
      if (event.target?.id === "fDischargeCondition") syncDischargeConditionVisual();

      if (
        event.target?.matches?.("#patientForm textarea, #patientForm input") &&
        !event.target.disabled &&
        !event.target.readOnly &&
        event.target.type !== "button"
      ) {
        // Keep the in-memory draft current immediately; only the network write
        // remains debounced.
        window.BachSBOClinicalUi?.commitCurrentDraft?.();
        scheduleCaseAutosave(2500);
      }

      setTimeout(syncRailState, 0);
      const id = selectedCaseId();
      if (
        id &&
        event.target?.closest?.("#patientForm") &&
        !event.target?.closest?.("#cockpitAiRail")
      ) {
        const cached = assistantStateByCase.get(id);
        if (cached?.run) {
          cached.stale = true;
          renderAssistantResponse(cached);
        }
      }
    }, true);
    document.addEventListener("change", (event) => {
      if (event.target?.id === "fDisposition" || event.target?.id === "fDischargeCondition") {
        syncDischargeConditionVisual();
      }
      if (event.target?.id === "iceArrival") {
        syncArrivalVisual();
      }

      if (
        event.target?.matches?.("#patientForm select") &&
        !event.target.disabled
      ) {
        window.BachSBOClinicalUi?.commitCurrentDraft?.();
        scheduleCaseAutosave(600);
      }

      setTimeout(syncRailState, 0);
    }, true);

    document.addEventListener("focusout", (event) => {
      if (
        event.target?.matches?.("#patientForm textarea, #patientForm input") &&
        !event.target.disabled &&
        !event.target.readOnly &&
        event.target.type !== "button"
      ) {
        // Keep blur lightweight: cache immediately, persist in the background.
        window.BachSBOClinicalUi?.commitCurrentDraft?.();
        scheduleCaseAutosave(900);
      }
    }, true);
    document.addEventListener("click", (event) => {
      const autosaveAction = event.target?.closest?.(
        "#patientForm [data-mode-choice], " +
        "#patientForm [data-none-toggle], " +
        "#patientForm [data-delete-test], " +
        "#patientForm [data-del-rec], " +
        "#patientForm #addRecBtn, " +
        "#patientForm #addLabBtn, " +
        "#patientForm #addRadiologyBtn, " +
        "#patientForm #addConsultBtn"
      );
      if (autosaveAction) {
        // Let the button's own handler mutate the case first, then capture and save.
        setTimeout(() => {
          window.BachSBOClinicalUi?.commitCurrentDraft?.();
          scheduleCaseAutosave(500);
        }, 0);
      }

      if (event.target?.id === "langEnBtn" || event.target?.id === "langHuBtn") {
        setTimeout(updateTabLabels, 0);
      }
      if (!event.target.closest("#cockpitAiRail") && !event.target.closest("#cockpitAiToggle")) {
        if (window.matchMedia("(max-width: 1180px)").matches) {
          document.body.classList.remove("cockpit-ai-open");
        }
      }
      setTimeout(activateCockpitIfReady, 0);
    }, true);

    window.setInterval(() => {
      if (document.visibilityState === "visible") activateCockpitIfReady();
    }, 600);
  }

  function install() {
    installPatientListStatusHook();
    installTestCardHook();
    addBetaControls();
    activateCockpitIfReady();
    installSync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
