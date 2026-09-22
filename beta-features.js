(() => {
  "use strict";

  const STALE_AFTER_MINUTES = 90;
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

  function minutesSince(value) {
    const time = new Date(value || 0).getTime();
    if (!Number.isFinite(time) || time <= 0) return 0;
    return Math.max(0, Math.floor((Date.now() - time) / 60000));
  }

  function staleLabel(minutes) {
    if (hu()) {
      if (minutes < 120) return `⚠ ${minutes} p`;
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest ? `⚠ ${hours} ó ${rest} p` : `⚠ ${hours} ó`;
    }
    if (minutes < 120) return `⚠ ${minutes} m`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `⚠ ${hours} h ${rest} m` : `⚠ ${hours} h`;
  }

  function decoratePatientRows() {
    document.querySelectorAll("#patientTbody tr[data-id]").forEach((row) => {
      const patient = window.BachSBOClinicalUi?.getPatientSnapshot?.(row.dataset.id);
      row.classList.remove("beta-stale-case");
      delete row.dataset.staleLabel;
      if (!patient || patient.summaryFinalizedAt) return;

      const minutes = minutesSince(patient.updatedAt || patient.createdAt);
      if (minutes < STALE_AFTER_MINUTES) return;

      row.classList.add("beta-stale-case");
      row.dataset.staleLabel = staleLabel(minutes);
      row.title = hu()
        ? `${minutes} perce nincs frissítés ebben az esetben.`
        : `No update in this case for ${minutes} minutes.`;
    });
  }

  function renderSelectedCaseStaleBanner() {
    const selected = document.querySelector("#patientTbody tr.selected[data-id]");
    const header = document.getElementById("recordHeader");
    if (!header) return;

    let banner = document.getElementById("betaStaleCaseBanner");
    if (!selected) {
      banner?.remove();
      return;
    }

    const patient = window.BachSBOClinicalUi?.getPatientSnapshot?.(selected.dataset.id);
    if (!patient || patient.summaryFinalizedAt) {
      banner?.remove();
      return;
    }

    const updatedAt = patient.updatedAt || patient.createdAt;
    const minutes = minutesSince(updatedAt);
    if (minutes < STALE_AFTER_MINUTES) {
      banner?.remove();
      return;
    }

    if (!banner) {
      banner = document.createElement("div");
      banner.id = "betaStaleCaseBanner";
      banner.className = "beta-stale-case-banner";
      header.insertAdjacentElement("afterend", banner);
    }

    const lastUpdate = new Intl.DateTimeFormat(hu() ? "hu-HU" : "en-GB", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(updatedAt));

    banner.innerHTML = `
      <span class="beta-stale-icon" aria-hidden="true">◷</span>
      <span>
        <strong>${hu() ? `${minutes} perce nincs frissítés` : `No update for ${minutes} minutes`}</strong>
        <small>${hu() ? "Utolsó módosítás" : "Last modified"}: ${lastUpdate}</small>
      </span>
    `;
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
    decoratePatientRows();
    renderSelectedCaseStaleBanner();
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
