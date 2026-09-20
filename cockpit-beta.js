// Compact cockpit beta. Activates only after the authenticated patient workspace is visible.
(() => {
  "use strict";

  const TAB_MAP = ["clinical", "tests", "course", "disposition", "summary"];
  let activeTab = "clinical";
  let lastSelectedCaseId = "";
  let assistantBusy = false;
  let assistantLoadToken = 0;
  let patientBoardLoad = null;
  let extractionPreviewState = null;
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
    if (modality === "other") return [body, other].filter(Boolean).join(" — ") || `${label("Radiology", "Radiológia")} ${index + 1}`;
    return [body, modality].filter(Boolean).join(" ") || `${label("Radiology", "Radiológia")} ${index + 1}`;
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

    let decision = !hasValue("fDiagnoses") || !disposition;
    if (disposition === "discharged") {
      const recommendation = [...document.querySelectorAll("[data-rec]")]
        .some((input) => String(input.value || "").trim());
      decision = decision || !hasValue("fDischargeCondition") || !recommendation;
    } else if (disposition === "admitted") {
      decision = decision || !hasValue("fHospital") || !hasValue("fWard");
    } else if (disposition === "other") {
      decision = decision || !hasValue("fOtherOutcome");
    }

    return { clinical, tests, course, disposition: decision };
  }

  function syncTabWarnings() {
    const hasCase = Boolean(selectedCaseId());
    const gaps = hasCase ? tabSummaryGaps() : {};
    document.querySelectorAll("[data-cockpit-tab]").forEach((button) => {
      const key = button.dataset.cockpitTab;
      const warn = key !== "summary" && Boolean(gaps[key]);
      button.classList.toggle("has-summary-gap", warn);
      button.title = warn
        ? label(
            "Missing information in this tab may affect the Summary.",
            "Ebben a fülben hiányzó adat befolyásolhatja az összefoglalót."
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
    activeTab = tab || "clinical";
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

      <div class="cockpit-rail-card cockpit-doc-review-card">
        <div class="cockpit-rail-head">
          <div>
            <strong id="cockpitDocumentationTitle">🔎 Documentation review</strong>
            <div class="cockpit-rail-sub" id="cockpitDocumentationSub"></div>
          </div>
          <span id="cockpitDocumentationCount" class="cockpit-summary-badge neutral">0</span>
        </div>
        <div class="cockpit-rail-body">
          <div id="cockpitDocumentationReview" class="cockpit-documentation-review"></div>
        </div>
      </div>

      <div class="cockpit-rail-card cockpit-paste-card">
        <div class="cockpit-rail-head">
          <div>
            <strong id="cockpitPasteTitle"></strong>
            <div class="cockpit-rail-sub" id="cockpitPasteSub"></div>
          </div>
        </div>
        <div class="cockpit-rail-body">
          <textarea id="cockpitPasteText" class="cockpit-paste-text" maxlength="30000"></textarea>
          <button class="btn cockpit-wide-btn" id="cockpitExtractText" type="button"></button>
          <div id="cockpitExtractStatus" class="cockpit-status"></div>
          <div id="cockpitExtractPreview"></div>
        </div>
      </div>
    `;
    grid.appendChild(rail);

    document.getElementById("cockpitAnalyzeCase")?.addEventListener("click", analyzeCurrentCase);
    document.getElementById("cockpitExtractText")?.addEventListener("click", extractPastedText);

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
    set("cockpitDocumentationTitle", label("🔎 Documentation review", "🔎 Dokumentációs ellenőrzés"));
    set(
      "cockpitDocumentationSub",
      label(
        "Required, missing, pending and conflicting information. Review only; nothing is written from this panel.",
        "Kötelező, hiányzó, függő és ellentmondásos információk. Csak ellenőrzés; ez a panel nem ír adatot."
      )
    );
    set("cockpitPasteTitle", label("Paste note / Heidi text", "Jegyzet / Heidi szöveg"));
    set(
      "cockpitPasteSub",
      label(
        "Extract documented facts first; review before applying.",
        "Először dokumentált tények kinyerése; alkalmazás előtt ellenőrizendő."
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
    tabs?.classList.toggle("hidden", !hasCase);

    const analyze = document.getElementById("cockpitAnalyzeCase");
    const extract = document.getElementById("cockpitExtractText");

    if (analyze) analyze.disabled = !hasCase || assistantBusy;
    if (extract) extract.disabled = !hasCase || assistantBusy;
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
        if (results) results.innerHTML = `<div class="cockpit-ai-error">${esc(error?.message || "Analysis failed.")}</div>`;
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
    if (priority === "now") return { icon: "●", label: "NOW" };
    if (priority === "next") return { icon: "●", label: "NEXT" };
    return { icon: "○", label: "CONSIDER" };
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
      if (status) status.textContent = label("Extracting documented facts…", "Dokumentált tények kinyerése…");
      const response = await window.BachSBOBackend.caseAssistantExtract(id, text);
      renderExtractionPreview(response, text, id);
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
    if (!window.BachAssistantCore?.fields?.includes(item.target)) return "";
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

    const selected = [...preview.querySelectorAll(".cockpit-extract-item")]
      .filter((node) => node.dataset.decision === "accept" && node.dataset.applied !== "true")
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

  function renderExtractionPreview(response, sourceText, caseId) {
    const preview = document.getElementById("cockpitExtractPreview");
    if (!preview) return;

    if (!window.BachAssistantCore?.validateProposal) {
      throw new Error(label(
        "Assistant validation core is unavailable.",
        "Az asszisztens validációs modul nem érhető el."
      ));
    }

    const validated = window.BachAssistantCore.validateProposal(response, sourceText);
    const items = validated.items;
    const warnings = validated.warnings;
    extractionPreviewState = { caseId, items, warnings };

    const itemHtml = items.map((item, index) => `
      <div class="cockpit-extract-item" data-index="${index}" data-decision="">
        <div class="cockpit-extract-head">
          <strong>${esc(item.label || item.target || "Fact")}</strong>
          <span>${esc(item.status || "documented")}</span>
        </div>
        <div class="cockpit-extract-text">${esc(item.text || "")}</div>
        <details>
          <summary>${esc(label("Evidence", "Bizonyíték"))}</summary>
          <div class="cockpit-evidence">${esc(item.evidence || "")}</div>
        </details>
        ${extractionItemModeControl(item)}
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

    document.getElementById("cockpitApplyAccepted")?.addEventListener("click", applyAcceptedExtraction);
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
    const type = document.getElementById("cockpitTestType");
    const other = document.getElementById("cockpitOtherTestName");
    if (title) title.textContent = label("Investigations", "Vizsgálatok");
    if (add) add.textContent = label("+ Add test", "+ Vizsgálat hozzáadása");
    if (other) other.placeholder = label("Test name", "Vizsgálat neve");
    if (type) {
      const optionLabels = {
        lab: label("Lab", "Labor"),
        imaging: label("Imaging", "Képalkotó"),
        consultation: label("Consultation", "Konzílium"),
        other: label("Other", "Egyéb")
      };
      [...type.options].forEach((option) => {
        option.textContent = optionLabels[option.value] || option.textContent;
      });
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
      const first = radiologyGrid.firstElementChild;
      if (first) radiologyGrid.insertBefore(identity, first);
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

  function addUnifiedTest() {
    const type = document.getElementById("cockpitTestType")?.value || "lab";
    if (type === "lab") document.getElementById("addLabBtn")?.click();
    if (type === "imaging") document.getElementById("addRadiologyBtn")?.click();
    if (type === "consultation") document.getElementById("addConsultBtn")?.click();
    if (type === "other") {
      document.getElementById("addConsultBtn")?.click();
      const inputs = [...document.querySelectorAll('#consultCards [data-type^="consultations-"]')];
      const input = inputs.at(-1);
      if (input) {
        input.value = document.getElementById("cockpitOtherTestName")?.value.trim() || label("Other", "Egyéb");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    const other = document.getElementById("cockpitOtherTestName");
    if (other) other.value = "";
    setTimeout(enhanceTestsUi, 0);
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
          <select id="cockpitTestType" aria-label="Test type">
            <option value="lab">Lab</option>
            <option value="imaging">Imaging</option>
            <option value="consultation">Consultation</option>
            <option value="other">Other</option>
          </select>
          <input id="cockpitOtherTestName" class="hidden" />
          <button class="btn small" id="cockpitAddTest" type="button"></button>
        </div>`;
      const firstToolbar = panel.querySelector(".test-group-toolbar");
      firstToolbar?.insertAdjacentElement("beforebegin", header);
      const type = header.querySelector("#cockpitTestType");
      type.addEventListener("change", () => {
        header.querySelector("#cockpitOtherTestName")?.classList.toggle("hidden", type.value !== "other");
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

  function enhanceDispositionUi() {
    ensureWardPicker();
    syncWardPicker();

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

  function installSync() {
    document.addEventListener("input", (event) => {
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
    document.addEventListener("change", () => setTimeout(syncRailState, 0), true);
    document.addEventListener("click", (event) => {
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
