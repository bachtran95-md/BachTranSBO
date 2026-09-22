(() => {
  "use strict";

  const SHIFT_META_REFRESH_MS = 5 * 60 * 1000;
  let shiftStartedAt = null;
  let lastShiftFetchAt = 0;
  let shiftFetchPromise = null;

  const hu = () => document.getElementById("langHuBtn")?.classList.contains("active");

  function formatShiftStart(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    return new Intl.DateTimeFormat(hu() ? "hu-HU" : "en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function activeDuration(value) {
    const start = new Date(value).getTime();
    if (!Number.isFinite(start)) return "—";
    const totalMinutes = Math.max(0, Math.floor((Date.now() - start) / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (hu()) {
      if (days) return `${days} n ${hours} ó ${minutes} p`;
      if (hours) return `${hours} ó ${minutes} p`;
      return `${minutes} p`;
    }
    if (days) return `${days} d ${hours} h ${minutes} m`;
    if (hours) return `${hours} h ${minutes} m`;
    return `${minutes} m`;
  }

  async function refreshShiftSource({ force = false } = {}) {
    const now = Date.now();
    if (!force && shiftStartedAt && now - lastShiftFetchAt < SHIFT_META_REFRESH_MS) return;
    if (shiftFetchPromise) return shiftFetchPromise;
    const loader = window.BachSBOBackend?.loadRawTransferWorkspace;
    if (typeof loader !== "function") return;

    shiftFetchPromise = (async () => {
      try {
        const result = await loader();
        shiftStartedAt = result?.shift?.startedAt || null;
        lastShiftFetchAt = Date.now();
      } catch {
        // Beta decoration is non-critical; stable UI stays authoritative.
      } finally {
        shiftFetchPromise = null;
      }
    })();
    return shiftFetchPromise;
  }

  function decorateShiftDashboard() {
    const meta = document.getElementById("shiftMeta");
    if (!meta) return;

    meta.classList.add("beta-shift-dashboard");
    meta.querySelectorAll(".metric").forEach((metric) => {
      metric.classList.add("beta-shift-metric");
      metric.classList.remove("beta-metric-cases", "beta-metric-active", "beta-metric-completed");
      const labelText = (metric.childNodes?.[0]?.textContent || metric.textContent || "").trim().toLowerCase();
      if (labelText.startsWith("esetek") || labelText.startsWith("cases")) {
        metric.classList.add("beta-metric-cases");
      } else if (labelText.startsWith("aktív") || labelText.startsWith("active")) {
        metric.classList.add("beta-metric-active");
      } else if (labelText.startsWith("lezárt") || labelText.startsWith("completed")) {
        metric.classList.add("beta-metric-completed");
      }
    });

    const pill = meta.querySelector(".shift-pill");
    if (!pill || !shiftStartedAt) return;

    pill.classList.add("beta-shift-pill");
    pill.innerHTML = `
      <span class="dot"></span>
      <span class="beta-shift-primary">${hu() ? "AKTÍV MŰSZAK" : "SHIFT ACTIVE"}</span>
      <span class="beta-shift-start">${hu() ? "Kezdés" : "Started"}: ${formatShiftStart(shiftStartedAt)}</span>
      <span class="beta-shift-duration">${hu() ? "Aktív" : "Active"}: ${activeDuration(shiftStartedAt)}</span>
    `;
  }

  function decorateCaseTriage() {
    const ui = window.BachSBOClinicalUi;
    document.querySelectorAll("#patientTbody tr[data-id]").forEach((row) => {
      const patient = ui?.getPatientSnapshot?.(row.dataset.id);
      row.classList.remove("beta-triage-red", "beta-triage-yellow", "beta-triage-green");
      const status = ui?.normalizeTriageStatus?.(patient?.triageStatus) || "";
      if (status) row.classList.add(`beta-triage-${status}`);
    });

    const selected = document.querySelector("#patientTbody tr.selected[data-id]");
    const patient = selected ? ui?.getPatientSnapshot?.(selected.dataset.id) : null;
    const heading = document.querySelector("#recordHeader .record-patient-heading");
    let control = document.getElementById("betaTriageControl");

    if (!patient || !heading) {
      control?.remove();
      return;
    }

    if (!control) {
      control = document.createElement("span");
      control.id = "betaTriageControl";
      control.className = "beta-triage-control";
      control.innerHTML = `
        <span class="beta-triage-label">— ${hu() ? "Triázs" : "Triage"}</span>
        <span class="beta-triage-options" role="group" aria-label="${hu() ? "Case triázs" : "Case triage"}">
          <button type="button" class="beta-triage-dot red" data-beta-triage="red" title="${hu() ? "Piros triázs" : "Red triage"}" aria-label="${hu() ? "Piros triázs" : "Red triage"}"></button>
          <button type="button" class="beta-triage-dot yellow" data-beta-triage="yellow" title="${hu() ? "Sárga triázs" : "Yellow triage"}" aria-label="${hu() ? "Sárga triázs" : "Yellow triage"}"></button>
          <button type="button" class="beta-triage-dot green" data-beta-triage="green" title="${hu() ? "Zöld triázs" : "Green triage"}" aria-label="${hu() ? "Zöld triázs" : "Green triage"}"></button>
        </span>
      `;
      heading.appendChild(control);
    }

    const current = ui?.normalizeTriageStatus?.(patient.triageStatus) || "";
    control.querySelector(".beta-triage-label").textContent = `— ${hu() ? "Triázs" : "Triage"}`;
    control.querySelector(".beta-triage-options")?.setAttribute("aria-label", hu() ? "Case triázs" : "Case triage");
    control.querySelectorAll("[data-beta-triage]").forEach((button) => {
      const active = button.dataset.betaTriage === current;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.disabled = Boolean(patient.summaryFinalizedAt);
    });
    control.classList.toggle("readonly", Boolean(patient.summaryFinalizedAt));
  }

  async function changeCaseTriage(button) {
    const ui = window.BachSBOClinicalUi;
    const row = document.querySelector("#patientTbody tr.selected[data-id]");
    const caseId = row?.dataset.id || "";
    const patient = caseId ? ui?.getPatientSnapshot?.(caseId) : null;
    if (!caseId || !patient || patient.summaryFinalizedAt) return;

    const choice = ui?.normalizeTriageStatus?.(button.dataset.betaTriage) || "";
    const previous = ui?.normalizeTriageStatus?.(patient.triageStatus) || "";
    const next = previous === choice ? "" : choice;

    const changed = ui?.setCaseTriageStatus?.(caseId, next);
    if (!changed) return;
    decorateCaseTriage();

    try {
      await ui?.autosaveCurrentCase?.();
      decorateCaseTriage();
    } catch (error) {
      ui?.setCaseTriageStatus?.(caseId, previous);
      decorateCaseTriage();
      console.warn("Case triage save failed", error);
    }
  }

  function addBetaBadge() {
    const brand = document.querySelector(".brand");
    if (!brand || brand.querySelector(".beta-build-badge")) return;
    const badge = document.createElement("span");
    badge.className = "beta-build-badge";
    badge.textContent = "BETA";
    brand.appendChild(badge);
  }

  async function refreshBetaUi({ forceShift = false } = {}) {
    addBetaBadge();
    await refreshShiftSource({ force: forceShift });
    decorateShiftDashboard();
    decorateCaseTriage();
  }

  function scheduleRefresh() {
    window.setTimeout(() => {
      void refreshBetaUi();
      scheduleRefresh();
    }, 60_000);
  }

  document.addEventListener("bachsbo:ui-rendered", () => {
    void refreshBetaUi();
  });

  document.addEventListener("click", (event) => {
    const triageButton = event.target?.closest?.("[data-beta-triage]");
    if (triageButton) {
      event.preventDefault();
      void changeCaseTriage(triageButton);
      return;
    }

    if (event.target?.id === "langHuBtn" || event.target?.id === "langEnBtn") {
      window.setTimeout(() => void refreshBetaUi(), 0);
    }
  }, true);

  window.addEventListener("focus", () => void refreshBetaUi({ forceShift: true }));

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void refreshBetaUi({ forceShift: true });
      scheduleRefresh();
    }, { once: true });
  } else {
    void refreshBetaUi({ forceShift: true });
    scheduleRefresh();
  }
})();
