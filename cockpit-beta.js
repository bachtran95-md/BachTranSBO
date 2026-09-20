// Compact cockpit beta. Activates only after the authenticated patient workspace is visible.
(() => {
  "use strict";

  const TAB_MAP = ["clinical", "tests", "clinical", "disposition", "summary"];
  let activeTab = "clinical";
  let lastSelectedCaseId = "";
  let assistantBusy = false;
  let assistantLoadToken = 0;
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

  function createTabBar() {
    const form = document.getElementById("patientForm");
    if (!form || document.getElementById("cockpitCaseTabs")) return;

    const tabs = document.createElement("div");
    tabs.id = "cockpitCaseTabs";
    tabs.className = "cockpit-case-tabs hidden";
    tabs.innerHTML = [
      ["clinical", label("Clinical", "Klinikum")],
      ["tests", label("Tests", "Vizsgálatok")],
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
      tests: label("Tests", "Vizsgálatok"),
      disposition: label("Disposition", "Döntés"),
      summary: label("Summary", "Összefoglaló")
    };
    document.querySelectorAll("[data-cockpit-tab]").forEach((button) => {
      button.textContent = labels[button.dataset.cockpitTab] || button.textContent;
    });
    const aiButton = document.getElementById("cockpitAiToggle");
    if (aiButton) aiButton.textContent = label("AI", "AI");
    syncRailLabels();
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

      <div class="cockpit-rail-card">
        <div class="cockpit-rail-head">
          <div>
            <strong id="cockpitSummaryTitle">📝 Summary</strong>
            <div class="cockpit-rail-sub" id="cockpitSummarySub"></div>
          </div>
          <span id="cockpitSummaryBadge" class="cockpit-summary-badge">—</span>
        </div>
        <div class="cockpit-rail-body">
          <div id="cockpitSummaryReadiness" class="cockpit-readiness"></div>
          <div class="cockpit-rail-actions">
            <button class="btn primary" id="cockpitOpenSummary" type="button"></button>
            <button class="btn" id="cockpitGenerateSummary" type="button"></button>
          </div>
          <button class="btn success cockpit-wide-btn" id="cockpitFinalizeSummary" type="button"></button>
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
    document.getElementById("cockpitOpenSummary")?.addEventListener("click", () => activateTab("summary"));
    document.getElementById("cockpitGenerateSummary")?.addEventListener("click", () => {
      activateTab("summary");
      document.getElementById("generateSummaryBtn")?.click();
    });
    document.getElementById("cockpitFinalizeSummary")?.addEventListener("click", () => {
      activateTab("summary");
      document.getElementById("finalizeSummaryBtn")?.click();
    });
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
    set("cockpitSummaryTitle", "📝 " + label("Summary", "Összefoglaló"));
    set(
      "cockpitSummarySub",
      label("Confirmed facts only", "Csak dokumentált tények")
    );
    set("cockpitOpenSummary", label("OPEN", "MEGNYITÁS"));
    set("cockpitGenerateSummary", label("GENERATE", "GENERÁLÁS"));
    set("cockpitFinalizeSummary", label("FINALIZE SUMMARY", "ÖSSZEFOGLALÓ VÉGLEGESÍTÉSE"));
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

  function syncRailState() {
    const form = document.getElementById("patientForm");
    const tabs = document.getElementById("cockpitCaseTabs");
    const hasCase = Boolean(form && !form.classList.contains("hidden") && selectedCaseId());
    tabs?.classList.toggle("hidden", !hasCase);

    const gate = document.getElementById("summaryGate");
    const badge = document.getElementById("cockpitSummaryBadge");
    const readiness = document.getElementById("cockpitSummaryReadiness");
    const generate = document.getElementById("cockpitGenerateSummary");
    const finalize = document.getElementById("cockpitFinalizeSummary");
    const analyze = document.getElementById("cockpitAnalyzeCase");
    const extract = document.getElementById("cockpitExtractText");

    if (analyze) analyze.disabled = !hasCase || assistantBusy;
    if (extract) extract.disabled = !hasCase || assistantBusy;

    if (!hasCase) {
      if (badge) {
        badge.textContent = label("No case", "Nincs eset");
        badge.className = "cockpit-summary-badge neutral";
      }
      if (readiness) {
        readiness.textContent = label("Select a case to continue.", "Válasszon esetet a folytatáshoz.");
      }
      if (generate) generate.disabled = true;
      if (finalize) finalize.disabled = true;
      return;
    }

    const ready = gate?.classList.contains("ready");
    if (badge) {
      badge.textContent = ready ? label("Ready", "Kész") : label("Blocked", "Blokkolt");
      badge.className = "cockpit-summary-badge " + (ready ? "ready" : "blocked");
    }
    if (readiness) {
      readiness.textContent =
        gate?.textContent?.trim() ||
        label("Review unresolved fields before generation.", "Generálás előtt ellenőrizze a hiányzó mezőket.");
    }
    if (generate) generate.disabled = !ready;
    if (finalize) finalize.disabled = Boolean(document.getElementById("finalizeSummaryBtn")?.disabled);
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
    if (value === "not_applicable") return "na";
    return value || "pending";
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
      row?.querySelectorAll(".cockpit-decision").forEach((node) => {
        node.classList.toggle(
          "selected",
          node.dataset.decision === decisionUiValue(updated.doctorDecision)
        );
      });
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
        <article class="cockpit-todo-item priority-${esc(item.priority || "consider")}" data-item-id="${esc(item.id || "")}">
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
            <button type="button" data-decision="yes" class="cockpit-decision yes ${decision === "yes" ? "selected" : ""}">YES</button>
            <button type="button" data-decision="no" class="cockpit-decision no ${decision === "no" ? "selected" : ""}">NO</button>
            <button type="button" data-decision="done" class="cockpit-decision done ${decision === "done" ? "selected" : ""}">DONE</button>
            <button type="button" data-decision="na" class="cockpit-decision na ${decision === "na" ? "selected" : ""}">N/A</button>
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
      renderExtractionPreview(response);
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

  function renderExtractionPreview(response) {
    const preview = document.getElementById("cockpitExtractPreview");
    if (!preview) return;
    const items = Array.isArray(response?.items) ? response.items : [];
    const warnings = Array.isArray(response?.warnings) ? response.warnings : [];

    const itemHtml = items.map((item) => `
      <div class="cockpit-extract-item">
        <div class="cockpit-extract-head">
          <strong>${esc(item.label || item.target || "Fact")}</strong>
          <span>${esc(item.status || "documented")}</span>
        </div>
        <div class="cockpit-extract-text">${esc(item.text || "")}</div>
        <details>
          <summary>${esc(label("Evidence", "Bizonyíték"))}</summary>
          <div class="cockpit-evidence">${esc(item.evidence || "")}</div>
        </details>
        <div class="cockpit-decision-row">
          <button type="button" class="cockpit-decision yes">${esc(label("ACCEPT", "ELFOGAD"))}</button>
          <button type="button" class="cockpit-decision no">${esc(label("IGNORE", "KIHAGY"))}</button>
        </div>
      </div>
    `).join("");

    const warningHtml = warnings.length
      ? `<div class="cockpit-extract-warnings"><strong>${esc(label("Warnings", "Figyelmeztetések"))}</strong>${warnings.map((w) => `<div>• ${esc(w)}</div>`).join("")}</div>`
      : "";

    preview.innerHTML = warningHtml + (itemHtml || `<div class="subtle">${esc(label("No supported facts extracted.", "Nem sikerült alátámasztott tényt kinyerni."))}</div>`);

    preview.querySelectorAll(".cockpit-decision-row").forEach((row) => {
      row.addEventListener("click", (event) => {
        const button = event.target.closest(".cockpit-decision");
        if (!button) return;
        row.querySelectorAll(".cockpit-decision").forEach((item) => item.classList.remove("selected"));
        button.classList.add("selected");
      });
    });
  }

  function enhancePatientRows() {
    document.querySelectorAll("#patientTbody tr[data-id]").forEach((row) => {
      row.classList.add("cockpit-compact-patient");
      row.querySelectorAll(".cockpit-next-action, .cockpit-status-more").forEach((node) => node.remove());

      const chips = [...row.querySelectorAll(".wait-chip")];
      chips.forEach((chip, index) => {
        chip.classList.toggle("cockpit-status-hidden", index > 0);
      });
      if (chips.length > 1) {
        const more = document.createElement("span");
        more.className = "cockpit-status-more";
        more.textContent = `+${chips.length - 1}`;
        row.querySelector("[data-status-cell] .wait-stack")?.appendChild(more);
      }
    });
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
    enhanceDispositionUi();
    syncCaseSelection();
    enhancePatientRows();
    syncRailState();
  }

  function installSync() {
    document.addEventListener("input", (event) => {
      syncRailState();
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
    document.addEventListener("change", syncRailState, true);
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
