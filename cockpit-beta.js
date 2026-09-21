// Compact cockpit beta. Activates only after the authenticated patient workspace is visible.
(() => {
  "use strict";

  const TAB_MAP = ["clinical", "tests", "course", "disposition", "summary"];
  let activeTab = "clinical";
  let lastSelectedCaseId = "";
  let assistantBusy = false;
  let assistantLoadToken = 0;
  let extractionLoadToken = 0;
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
      ...(tests.ekg ? [{ entry: tests.ekg, name: "EKG" }] : []),
      ...(tests.gas ? [{
        entry: tests.gas,
        name: /\bVVG\b/i.test(String(tests.gas.text || "")) ? "VVG" : "AVG"
      }] : []),
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
    return Boolean(field?.classList.contains("result") || field?.classList.contains("none"));
  }

  function hasValue(id) {
    return Boolean(String(document.getElementById(id)?.value || "").trim());
  }

  function tabSummaryGaps() {
    const arrival = document.getElementById("iceArrival")?.value || "";
    const disposition = document.getElementById("fDisposition")?.value || "";
    const testsPending = [...document.querySelectorAll('[data-cockpit-panel="tests"] .test-card')]
      .some((card) => !card.classList.contains("result") && !card.classList.contains("notordered"));

    const clinical =
      !hasValue("fMainComplaint") ||
      !hasValue("iceSex") ||
      !hasValue("iceYob") ||
      !arrival ||
      (arrival === "other" && !hasValue("iceArrivalOther")) ||
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
          <button class="btn primary cockpit-wide-btn" id="cockpitAnalyzeCase" type="button"></button>
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
    document.getElementById("cockpitPasteText")?.addEventListener("input", updatePasteCount);
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
    set("cockpitAnalyzeCase", label("ANALYZE CURRENT CASE", "AKTUÁLIS ESET ELEMZÉSE"));
    set(
      "cockpitAssistantEmpty",
      label(
        "Select an active case, then run the assistant. Suggestions never change the chart automatically.",
        "Válasszon aktív esetet, majd indítsa az asszisztenst. A javaslatok nem módosítják automatikusan a dokumentációt."
      )
    );
    set("cockpitPasteTitle", label("✨ AI-assisted data entry", "✨ AI-assisted adatbevitel"));
    set("cockpitDataEntryBtn", label("✨ AI DATA ENTRY", "✨ AI ADATBEVITEL"));
    set(
      "cockpitPasteSub",
      label(
        "Paste newly received information. Existing chart data is compared, and every fact requires review before writing.",
        "Illessze be az újonnan érkezett információt. Összehasonlítjuk a meglévő dokumentációval, és minden tény beírás előtt ellenőrzendő."
      )
    );
    set("cockpitPasteHint", label("Incremental update", "Kiegészítő frissítés"));
    set("cockpitExtractText", label("EXTRACT FACTS", "TÉNYEK KINYERÉSE"));
    const paste = document.getElementById("cockpitPasteText");
    if (paste) {
      paste.placeholder = label(
        "Paste newly received history, result, consultation or course update…",
        "Illessze be az új anamnézist, eredményt, konzíliumot vagy állapotváltozást…"
      );
    }
    updatePasteCount();
  }

  function updatePasteCount() {
    const paste = document.getElementById("cockpitPasteText");
    const count = document.getElementById("cockpitPasteCount");
    if (!paste || !count) return;
    count.textContent = `${paste.value.length} / ${paste.maxLength || 30000}`;
    count.classList.toggle("near-limit", paste.value.length >= 27000);
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
      const requestToken = ++extractionLoadToken;
      if (status) status.textContent = label("Extracting documented facts…", "Dokumentált tények kinyerése…");
      const response = await window.BachSBOBackend.caseAssistantExtract(id, text);
      if (requestToken !== extractionLoadToken || selectedCaseId() !== id) {
        if (status) status.textContent = label(
          "The selected case changed. The previous extraction was discarded.",
          "A kiválasztott eset megváltozott. Az előző kinyerést elvetettük."
        );
        return;
      }
      const patient = window.BachSBOClinicalUi?.getExtractionContext?.(id);
      if (!patient) throw new Error(label(
        "Current case data is unavailable for comparison.",
        "Az aktuális eset adatai nem érhetők el az összehasonlításhoz."
      ));
      renderExtractionPreview(response, response?.source || text, id, patient);
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

  function extractionItemModeControl(item) {
    if (
      !window.BachAssistantCore?.fields?.includes(item.target) ||
      ["duplicate", "conflict"].includes(item.action)
    ) return "";
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

  function extractionActionLabel(action) {
    const labels = {
      add: label("ADD NEW", "ÚJ HOZZÁADÁSA"),
      update: label("UPDATE EXISTING", "MEGLÉVŐ FRISSÍTÉSE"),
      duplicate: label("ALREADY DOCUMENTED", "MÁR DOKUMENTÁLT"),
      conflict: label("NEEDS REVIEW", "ELLENŐRIZENDŐ")
    };
    return labels[action] || action || "";
  }

  function extractionCurrentValue(item) {
    const value = String(item.currentText || "").trim();
    const status = String(item.currentStatus || "").trim();
    if (!value && !status) return "";
    return `<div class="cockpit-extract-compare current">
      <span>${esc(label("Current", "Jelenlegi"))}</span>
      <div>${esc(value || status)}</div>
    </div>`;
  }

  function renderExtractionPreview(response, sourceText, caseId, patient) {
    const preview = document.getElementById("cockpitExtractPreview");
    if (!preview) return;

    if (!window.BachAssistantCore?.validateProposal) {
      throw new Error(label(
        "Assistant validation core is unavailable.",
        "Az asszisztens validációs modul nem érhető el."
      ));
    }

    const validated = window.BachAssistantCore.validateProposal(response, sourceText);
    if (!window.BachAssistantCore?.reconcileItems) {
      throw new Error(label(
        "Incremental comparison core is unavailable.",
        "A kiegészítő összehasonlító modul nem érhető el."
      ));
    }
    const items = window.BachAssistantCore.reconcileItems(patient, validated.items);
    const warnings = validated.warnings;
    extractionPreviewState = { caseId, items, warnings };

    const itemHtml = items.map((item, index) => `
      <div class="cockpit-extract-item action-${esc(item.action)}" data-index="${index}" data-decision="">
        <div class="cockpit-extract-head">
          <strong>${esc(item.label || item.target || label("Fact", "Tény"))}</strong>
          <span class="cockpit-extract-action ${esc(item.action)}">${esc(extractionActionLabel(item.action))}</span>
        </div>
        ${extractionCurrentValue(item)}
        <div class="cockpit-extract-compare proposed">
          <span>${esc(label("Proposed", "Javasolt"))} · ${esc(item.status || "documented")}</span>
          <div class="cockpit-extract-text">${esc(item.text || "")}</div>
        </div>
        <div class="cockpit-extract-reason">${esc(item.reason || "")}</div>
        <details>
          <summary>${esc(label("Evidence", "Bizonyíték"))}</summary>
          <div class="cockpit-evidence">${esc(item.evidence || "")}</div>
        </details>
        ${extractionItemModeControl(item)}
        <div class="cockpit-decision-row">
          <button type="button" class="cockpit-decision yes" data-extract-decision="accept" ${["duplicate", "conflict"].includes(item.action) ? "disabled" : ""}>${esc(
            item.action === "duplicate"
              ? label("NO CHANGE", "NINCS VÁLTOZÁS")
              : item.action === "conflict"
                ? label("REVIEW MANUALLY", "KÉZI ELLENŐRZÉS")
                : label("ACCEPT", "ELFOGAD")
          )}</button>
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
    document.querySelectorAll("[data-add-test-kind]").forEach((button) => {
      const labels = {
        lab: label("Lab", "Labor"),
        imaging: label("Imaging", "Képalkotó"),
        consultation: label("Consultation", "Konzílium"),
        other: label("Other", "Egyéb")
      };
      button.textContent = labels[button.dataset.addTestKind] || button.textContent;
    });
    if (other) {
      const kind = selectedAddTestKind();
      const placeholders = {
        imaging: label("e.g. Chest X-ray, CT head", "pl. Mellkas RTG, Koponya CT"),
        consultation: label("e.g. Cardiology", "pl. Kardiológia"),
        other: label("Test name", "Vizsgálat neve")
      };
      other.placeholder = placeholders[kind] || label("Test name", "Vizsgálat neve");
    }
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

    if (context.kind === "dynamic") {
      const type = String(context.entry?.type || typeInput?.value || "").trim();
      const isOther = /^Egyéb\s+—\s+/i.test(type);
      const cleanType = isOther ? type.replace(/^Egyéb\s+—\s+/i, "") : type;
      const index = Number(String(context.key || "").split("-").at(-1)) + 1;
      const name = card.querySelector(".test-name");
      if (name) name.textContent = `${isOther ? label("Other", "Egyéb") : label("Consultation", "Konzílium")} ${index}`;
      let subtype = card.querySelector(".cockpit-test-subtype");
      if (!subtype) {
        subtype = document.createElement("span");
        subtype.className = "cockpit-test-subtype subtle";
        name?.insertAdjacentElement("afterend", subtype);
      }
      subtype.textContent = cleanType;
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

  function selectedAddTestKind() {
    return document.querySelector("[data-add-test-kind].selected")?.dataset.addTestKind || "lab";
  }

  function selectAddTestKind(kind) {
    document.querySelectorAll("[data-add-test-kind]").forEach((button) => {
      const selected = button.dataset.addTestKind === kind;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const input = document.getElementById("cockpitOtherTestName");
    if (input) input.classList.toggle("hidden", kind === "lab");
    syncUnifiedTestLabels();
  }

  async function addUnifiedTest() {
    const kind = selectedAddTestKind();
    const input = document.getElementById("cockpitOtherTestName");
    const add = document.getElementById("cockpitAddTest");
    const status = document.getElementById("cockpitAddTestStatus");
    const caseId = selectedCaseId();
    if (!caseId) {
      if (status) status.textContent = label("Select a case first.", "Először válasszon esetet.");
      return;
    }
    if (!window.BachSBOClinicalUi?.addInvestigation) {
      if (status) status.textContent = label("Investigation save bridge is unavailable.", "A vizsgálatmentő kapcsolat nem érhető el.");
      return;
    }

    try {
      if (add) add.disabled = true;
      document.querySelectorAll("[data-add-test-kind]").forEach((button) => button.disabled = true);
      if (status) status.textContent = label("Adding and saving…", "Hozzáadás és mentés…");
      await window.BachSBOClinicalUi.addInvestigation(caseId, kind, input?.value || "");
      if (input) input.value = "";
      enhanceTestsUi();
      if (status) status.textContent = label("Test added and saved.", "Vizsgálat hozzáadva és mentve.");
    } catch (error) {
      enhanceTestsUi();
      const nextStatus = document.getElementById("cockpitAddTestStatus");
      if (nextStatus) nextStatus.textContent = error?.message || label("Could not add test.", "A vizsgálat hozzáadása sikertelen.");
    } finally {
      const nextAdd = document.getElementById("cockpitAddTest");
      if (nextAdd) nextAdd.disabled = false;
      document.querySelectorAll("[data-add-test-kind]").forEach((button) => button.disabled = false);
    }
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
          <div class="cockpit-test-kind-buttons" role="group" aria-label="Test type">
            <button type="button" class="selected" data-add-test-kind="lab" aria-pressed="true">Lab</button>
            <button type="button" data-add-test-kind="imaging" aria-pressed="false">Imaging</button>
            <button type="button" data-add-test-kind="consultation" aria-pressed="false">Consultation</button>
            <button type="button" data-add-test-kind="other" aria-pressed="false">Other</button>
          </div>
          <input id="cockpitOtherTestName" class="hidden" />
          <button class="btn small" id="cockpitAddTest" type="button"></button>
          <span id="cockpitAddTestStatus" class="cockpit-add-test-status" aria-live="polite"></span>
        </div>`;
      const firstToolbar = panel.querySelector(".test-group-toolbar");
      firstToolbar?.insertAdjacentElement("beforebegin", header);
      header.querySelectorAll("[data-add-test-kind]").forEach((button) => {
        button.addEventListener("click", () => selectAddTestKind(button.dataset.addTestKind));
      });
      header.querySelector("#cockpitAddTest")?.addEventListener("click", addUnifiedTest);
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

  function enhanceClinicalHeader() {
    const host = document.getElementById("inlineCaseEditor");
    if (!host) return;
    host.classList.add("cockpit-demographics-inline");
    document.getElementById("iceArrival")?.closest(".field")?.classList.add("cockpit-arrival-field");
    document.getElementById("iceArrivalOtherWrap")?.classList.add("cockpit-arrival-other");
    host.querySelector(":scope > .toolbar")?.classList.add("cockpit-demographics-toolbar");
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
      extractionLoadToken += 1;
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
    if (document.getElementById("cockpitBetaBadge")) return;
    const toolbar = document.querySelector(".topbar-tools");
    if (!toolbar) return;

    const badge = document.createElement("span");
    badge.id = "cockpitBetaBadge";
    badge.textContent = "BETA";
    badge.style.cssText =
      "display:inline-flex;align-items:center;height:26px;padding:0 8px;border-radius:999px;" +
      "background:#fef3c7;color:#92400e;font-size:9px;font-weight:900;border:1px solid #fde68a;";
    toolbar.appendChild(badge);

    const stableLink = document.createElement("a");
    stableLink.href = "./";
    stableLink.textContent = label("STABLE UI", "STABIL UI");
    stableLink.className = "btn small";
    stableLink.style.cssText = "text-decoration:none;display:inline-flex;align-items:center;";
    toolbar.appendChild(stableLink);
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
        "#patientForm #addConsultBtn, " +
        "#patientForm #cockpitAddTest"
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
