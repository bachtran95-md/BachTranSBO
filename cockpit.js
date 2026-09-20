(() => {
  "use strict";

  const TAB_MAP = ["clinical", "tests", "clinical", "disposition", "summary"];
  let activeTab = "clinical";
  let lastSelectedCaseId = "";
  let assistantBusy = false;

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
          <span class="cockpit-ai-badge">AI</span>
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
    const status = document.getElementById("cockpitAssistantStatus");
    const results = document.getElementById("cockpitAssistantResults");
    try {
      assistantBusy = true;
      syncRailState();
      if (status) status.textContent = label("Analyzing current case…", "Aktuális eset elemzése…");
      const patient = await selectedPatient();
      if (!patient) throw new Error(label("Select an active case first.", "Először válasszon aktív esetet."));
      if (!window.BachSBOBackend?.caseAssistantSuggest) {
        throw new Error(label("Case Assistant frontend bridge is unavailable.", "A Case Assistant frontend kapcsolat nem érhető el."));
      }
      const response = await window.BachSBOBackend.caseAssistantSuggest(patient);
      renderAssistantResponse(response);
      if (status) status.textContent = response?.model
        ? label(`Completed with ${response.model}`, `Elkészült: ${response.model}`)
        : label("Analysis complete.", "Elemzés kész.");
    } catch (error) {
      if (status) status.textContent = error?.message || label("Analysis failed.", "Elemzés sikertelen.");
      if (results) results.innerHTML = `<div class="cockpit-ai-error">${esc(error?.message || "Analysis failed.")}</div>`;
    } finally {
      assistantBusy = false;
      syncRailState();
    }
  }

  function renderAssistantResponse(response) {
    const results = document.getElementById("cockpitAssistantResults");
    if (!results) return;
    const blocks = Array.isArray(response?.blocks) ? response.blocks : [];
    if (!blocks.length) {
      results.innerHTML = `<div class="subtle">${esc(label("No citable suggestion was returned.", "Nem érkezett hivatkozható javaslat."))}</div>`;
      return;
    }

    results.innerHTML = blocks.map((block, index) => {
      const citations = Array.isArray(block.citations) ? block.citations : [];
      const sourceLinks = citations.map((citation) => {
        const title = citation.title || citation.url || "Source";
        const url = String(citation.url || "");
        if (!url.startsWith("https://")) return "";
        return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>`;
      }).filter(Boolean).join(" · ");

      return `
        <article class="cockpit-ai-result">
          <div class="cockpit-ai-result-head">
            <strong>${esc(label("Clinical review", "Klinikai áttekintés"))} ${index + 1}</strong>
            <span>${esc(label("Advisory", "Javaslat"))}</span>
          </div>
          <div class="cockpit-ai-prose">${esc(block.text || "").replaceAll("\n", "<br>")}</div>
          ${sourceLinks ? `<div class="cockpit-ai-sources">${sourceLinks}</div>` : ""}
          <div class="cockpit-decision-row">
            <button type="button" class="cockpit-decision yes">${esc(label("YES", "IGEN"))}</button>
            <button type="button" class="cockpit-decision no">${esc(label("NO", "NEM"))}</button>
            <button type="button" class="cockpit-decision done">${esc(label("DONE", "KÉSZ"))}</button>
            <button type="button" class="cockpit-decision na">N/A</button>
          </div>
        </article>
      `;
    }).join("");

    results.querySelectorAll(".cockpit-decision-row").forEach((row) => {
      row.addEventListener("click", (event) => {
        const button = event.target.closest(".cockpit-decision");
        if (!button) return;
        row.querySelectorAll(".cockpit-decision").forEach((item) => item.classList.remove("selected"));
        button.classList.add("selected");
      });
    });
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
    const rows = document.querySelectorAll("#patientTbody tr[data-id]");
    rows.forEach((row) => {
      const cells = row.querySelectorAll("td");
      const statusCell = cells[4];
      if (!statusCell) return;
      let next = statusCell.querySelector(".cockpit-next-action");
      if (!next) {
        next = document.createElement("div");
        next.className = "cockpit-next-action";
        statusCell.appendChild(next);
      }
      const firstWait = statusCell.querySelector(".wait-chip")?.textContent?.trim();
      const completed = row.classList.contains("completed");
      next.textContent = completed
        ? label("NEXT: completed", "KÖV.: lezárva")
        : firstWait
          ? label(`NEXT: ${firstWait}`, `KÖV.: ${firstWait}`)
          : label("NEXT: review case", "KÖV.: eset áttekintése");
    });
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
      const results = document.getElementById("cockpitAssistantResults");
      const status = document.getElementById("cockpitAssistantStatus");
      const extraction = document.getElementById("cockpitExtractPreview");
      if (results) {
        results.innerHTML = `<div class="subtle cockpit-empty-ai">${esc(label(
          "Run the assistant for this case. Suggestions never change the chart automatically.",
          "Indítsa el az asszisztenst ehhez az esethez. A javaslatok nem módosítják automatikusan a dokumentációt."
        ))}</div>`;
      }
      if (status) status.textContent = "";
      if (extraction) extraction.innerHTML = "";
    }
  }

  function installObservers() {
    const observer = new MutationObserver(() => {
      createTabBar();
      makeRail();
      syncCaseSelection();
      enhancePatientRows();
      syncRailState();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "disabled"]
    });

    document.addEventListener("input", syncRailState, true);
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
      setTimeout(() => {
        syncCaseSelection();
        enhancePatientRows();
        syncRailState();
      }, 0);
    }, true);
  }

  function install() {
    document.body.classList.add("cockpit-ui");
    createTabBar();
    makeRail();
    enhancePatientRows();
    syncCaseSelection();
    syncRailState();
    installObservers();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
