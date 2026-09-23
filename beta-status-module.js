(() => {
  "use strict";

  const SECTION_DEFS = [
    ["A", "A – Légút"],
    ["B", "B – Légzés / Mellkas / Pulmo"],
    ["C", "C – Keringés / Szív"],
    ["D", "D – Neurológia"],
    ["E1", "E1 – Általános állapot"],
    ["E2", "E2 – Bőr / nyálkahártyák"],
    ["E3", "E3 – Sérülés"],
    ["E4", "E4 – Végtagok / oedema / MVT"],
    ["E5", "E5 – Has"],
    ["E6", "E6 – Vese / urogenitalis"]
  ];

  const PARAM_DEFS = [
    ["bloodPressure", "Vérnyomás", "pl. 135/80"],
    ["pulse", "Pulsus", "pl. 88"],
    ["temperature", "Testhőmérséklet", "pl. 36,7"],
    ["respiratoryRate", "Légzésszám", "pl. 18"],
    ["spo2", "SpO₂", "pl. 97"],
    ["oxygen", "Oxigén", "pl. szobalevegő / 2 l/perc"]
  ];

  let activeCaseId = null;
  let localStatus = null;
  let ekgCaseId = null;
  let statusAutosaveTimer = null;

  function clinicalUi() {
    return window.BachSBOClinicalUi || null;
  }

  function statusEngine() {
    return window.BachSBOPhysicalStatusEngine || null;
  }

  function currentPatient() {
    return clinicalUi()?.getPatientSnapshot?.() || null;
  }

  function blankStatus() {
    return clinicalUi()?.defaultPhysicalStatusData?.() || {
      version: 1,
      parameters: Object.fromEntries(PARAM_DEFS.map(([key]) => [key, ""])),
      sections: Object.fromEntries(SECTION_DEFS.map(([key]) => [key, ""])),
      generatedAt: null
    };
  }

  function normalizeStatus(value) {
    return clinicalUi()?.normalizePhysicalStatusData?.(value) || value || blankStatus();
  }

  function statusSource(data) {
    return clinicalUi()?.physicalStatusPositiveText?.(data) || SECTION_DEFS
      .map(([key]) => {
        const text = String(data?.sections?.[key] || "").trim();
        return text ? `${key}: ${text}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function parameterLine(data) {
    const p = data?.parameters || {};
    const parts = [];
    if (String(p.bloodPressure || "").trim()) {
      parts.push(`vérnyomás ${String(p.bloodPressure).trim()} Hgmm`);
    }
    if (String(p.pulse || "").trim()) {
      parts.push(`pulsus ${String(p.pulse).trim()}/perc`);
    }
    if (String(p.temperature || "").trim()) {
      parts.push(`testhőmérséklet ${String(p.temperature).trim()} °C`);
    }
    if (String(p.respiratoryRate || "").trim()) {
      parts.push(`légzésszám ${String(p.respiratoryRate).trim()}/perc`);
    }
    if (String(p.spo2 || "").trim()) {
      parts.push(`SpO₂ ${String(p.spo2).trim()}%`);
    }
    if (String(p.oxygen || "").trim()) {
      parts.push(`oxigén ${String(p.oxygen).trim()}`);
    }
    return parts.length ? `Paraméterek: ${parts.join(", ")}.` : "";
  }

  function generatedStatusText(data) {
    const engine = statusEngine();
    const source = statusSource(data);
    const findings = engine?.parseFindings?.(source) || [];
    const active = engine?.activeFindings?.(findings) || findings;
    const clinical = engine?.abcdeStatus?.(active) || "";
    const params = parameterLine(data);
    return [params, clinical].filter(Boolean).join("\n");
  }

  function unresolvedFindings(data) {
    const engine = statusEngine();
    return engine?.unknownSegments?.(statusSource(data)) || [];
  }

  function writeBridge(data) {
    const patient = currentPatient();
    if (!patient?.id || !clinicalUi()?.setPhysicalStatusData) return;
    clinicalUi().setPhysicalStatusData(patient.id, data);

    // The legacy finding-learning composer listens to this bridge textarea.
    const bridge = document.getElementById("fPhysical");
    if (bridge) {
      bridge.dispatchEvent(new Event("input", { bubbles: true }));
      statusEngine()?.syncComposer?.();
    }
  }

  function readBuilder(root) {
    const next = normalizeStatus(localStatus || blankStatus());
    next.version = 1;
    next.parameters ||= {};
    next.sections ||= {};

    root.querySelectorAll("[data-status-param]").forEach((input) => {
      next.parameters[input.dataset.statusParam] = String(input.value || "").trim();
    });
    root.querySelectorAll("[data-status-section]").forEach((input) => {
      next.sections[input.dataset.statusSection] = String(input.value || "").trim();
    });
    return next;
  }

  function hasStructuredInput(data) {
    return [
      ...Object.values(data?.parameters || {}),
      ...Object.values(data?.sections || {})
    ].some((value) => String(value || "").trim());
  }

  function scheduleStatusAutosave(root) {
    clearTimeout(statusAutosaveTimer);
    const caseId = currentPatient()?.id || "";
    statusAutosaveTimer = window.setTimeout(async () => {
      if (!caseId || currentPatient()?.id !== caseId) return;
      try {
        await clinicalUi()?.autosaveCurrentCase?.();
      } catch (saveError) {
        const error = root.querySelector("#betaStructuredStatusError");
        if (error) {
          error.textContent = `Automatikus mentési hiba: ${saveError?.message || saveError}`;
          error.classList.remove("hidden");
        }
      }
    }, 650);
  }

  function refreshRealtimeStatus(root, { autosave = true } = {}) {
    localStatus = readBuilder(root);
    const unknowns = unresolvedFindings(localStatus);
    const hasInput = hasStructuredInput(localStatus);

    localStatus.generatedAt = hasInput && unknowns.length === 0
      ? new Date().toISOString()
      : null;

    writeBridge(localStatus);
    updateGeneratedUi(root, unknowns);

    if (autosave) scheduleStatusAutosave(root);
  }

  function markEdited(root) {
    refreshRealtimeStatus(root);
  }

  function updateGeneratedUi(root, unknowns = unresolvedFindings(localStatus)) {
    const hasInput = hasStructuredInput(localStatus);
    const ready = Boolean(hasInput && localStatus?.generatedAt && unknowns.length === 0);
    const preview = root.querySelector("#betaStructuredStatusPreview");
    const copy = root.querySelector("#betaStructuredStatusCopy");
    const state = root.querySelector("#betaStructuredStatusState");
    const error = root.querySelector("#betaStructuredStatusError");

    root.classList.toggle("is-generated", ready);

    if (preview) preview.value = generatedStatusText(localStatus);
    if (copy) copy.disabled = !ready;

    if (state) {
      state.textContent = !hasInput
        ? "Még nincs adat"
        : unknowns.length
        ? `Folyamatban • ${unknowns.length} ismeretlen finding`
        : "✓ Kész";
    }

    if (error) {
      if (unknowns.length) {
        error.textContent = `${unknowns.length} nem felismert finding van. Tanítsa meg vagy rendelje meglévő findinghez; a STATUS ezután automatikusan frissül.`;
        error.classList.remove("hidden");
      } else {
        error.textContent = "";
        error.classList.add("hidden");
      }
    }
  }

  function populateBuilder(root, data) {
    root.querySelectorAll("[data-status-param]").forEach((input) => {
      input.value = data?.parameters?.[input.dataset.statusParam] || "";
    });
    root.querySelectorAll("[data-status-section]").forEach((input) => {
      input.value = data?.sections?.[input.dataset.statusSection] || "";
    });
    localStatus = normalizeStatus(data);
    const unknowns = unresolvedFindings(localStatus);
    if (hasStructuredInput(localStatus) && unknowns.length === 0 && !localStatus.generatedAt) {
      localStatus.generatedAt = new Date().toISOString();
      writeBridge(localStatus);
    }
    updateGeneratedUi(root, unknowns);
    statusEngine()?.syncComposer?.();
  }

  function buildStructuredStatusUi() {
    const physical = document.getElementById("fPhysical");
    const field = physical?.closest('[data-narrative-field="physical"]');
    if (!physical || !field) return null;

    let root = document.getElementById("betaStructuredStatus");
    if (!root) {
      root = document.createElement("div");
      root.id = "betaStructuredStatus";
      root.className = "beta-structured-status";
      field.insertBefore(root, physical);
    }

    if (!root.querySelector("[data-status-param]")) {
      root.className = "beta-structured-status";
      root.innerHTML = `
        <div class="beta-status-block-head">
          <div>
            <strong>Paraméterek</strong>
            <span>külön mentve • Summary AI nem kapja meg</span>
          </div>
        </div>
        <div class="beta-status-parameters">
          ${PARAM_DEFS.map(([key, label, placeholder]) => `
            <label>
              <span>${escapeHtml(label)}</span>
              <input type="text" inputmode="${key === "bloodPressure" ? "text" : "decimal"}"
                data-status-param="${escapeHtml(key)}"
                placeholder="${escapeHtml(placeholder)}" autocomplete="off"
                ${key === "bloodPressure" ? 'autocapitalize="off" spellcheck="false"' : ""} />
            </label>
          `).join("")}
        </div>

        <div class="beta-status-positive-head">
          <div>
            <strong>Pozitív fizikális eltérések</strong>
            <span>Csak az eltérést írja be. Üres sor = normál alapstátusz.</span>
          </div>
        </div>
        <div class="beta-status-positive-grid">
          ${SECTION_DEFS.map(([key, label], index) => `
            <label class="beta-status-positive-row"
              data-status-row="${escapeHtml(key)}"
              style="order:${index + 1}">
              <span>${escapeHtml(label)}</span>
              <textarea data-status-section="${escapeHtml(key)}"
                placeholder="+ csak pozitív eltérés"></textarea>
            </label>
          `).join("")}
        </div>

        <div class="beta-structured-status-actions">
          <span class="subtle">Automatikusan frissül és mentődik. A teljes generált szöveg csak másolási nézet.</span>
        </div>

        <div class="beta-structured-status-error hidden" id="betaStructuredStatusError"></div>

        <div class="beta-structured-status-done" id="betaStructuredStatusDone">
          <div class="beta-structured-status-done-head">
            <div>
              <strong>ÉLŐ STATUS ELŐNÉZET</strong>
              <span class="beta-structured-status-state" id="betaStructuredStatusState">Még nincs adat</span>
            </div>
            <button type="button" class="btn small primary" id="betaStructuredStatusCopy" disabled>MÁSOLÁS</button>
          </div>
          <textarea class="beta-structured-status-preview"
            id="betaStructuredStatusPreview" readonly></textarea>
        </div>
      `;
    }

    root.dataset.statusInitialized = "true";
    if (!root.dataset.statusBound) {
      root.dataset.statusBound = "true";

      root.querySelectorAll("[data-status-param], [data-status-section]").forEach((input) => {
        input.addEventListener("input", () => markEdited(root));
      });

      root.querySelector("#betaStructuredStatusCopy")?.addEventListener("click", async (event) => {
        const text = generatedStatusText(localStatus).trim();
        if (!text) return;
        const preview = root.querySelector("#betaStructuredStatusPreview");
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          if (preview) {
            preview.value = text;
            preview.classList.remove("hidden");
            preview.focus();
            preview.select();
            document.execCommand("copy");
          }
        }
        const button = event.currentTarget;
        const original = button.textContent;
        button.textContent = "MÁSOLVA ✓";
        window.setTimeout(() => {
          if (button.isConnected) button.textContent = original;
        }, 1200);
      });
    }

    placeStructuredStatusUi(root);
    return root;
  }

  function placeStructuredStatusUi(root) {
    if (!root) return;

    const physicalField = document.querySelector('[data-narrative-field="physical"]');
    const physicalBridge = document.getElementById("fPhysical");
    if (physicalField && root.parentElement !== physicalField) {
      physicalField.insertBefore(root, physicalBridge || null);
    }

    // Finding Learning stays directly below the structured STATUS controls.
    const composer = document.getElementById("betaFindingComposer");
    if (composer && composer.previousElementSibling !== root) {
      root.insertAdjacentElement("afterend", composer);
    }
  }

  function ensureEkgBuilder() {
    const patient = currentPatient();
    const host = document.getElementById("ekgCard");
    if (!patient?.id || !host) return;

    let builder = document.getElementById("betaEkgCopyBuilder");
    if (ekgCaseId !== patient.id) {
      builder?.remove();
      builder = null;
      ekgCaseId = patient.id;
    }

    if (!builder) {
      builder = document.createElement("div");
      builder.id = "betaEkgCopyBuilder";
      builder.className = "beta-ekg-copy-builder";
      builder.innerHTML = `
        <div class="beta-ekg-builder-head">
          <div>
            <strong>EKG gyors sablon</strong>
            <span>csak másoláshoz • nem mentődik • Summary AI nem kapja meg</span>
          </div>
          <select id="betaEkgTemplate">
            <option value="detailed">Részletes</option>
            <option value="short">Rövid</option>
          </select>
        </div>
        <div class="beta-ekg-inputs">
          <label><span>Frekvencia /min</span><input id="betaEkgFr" inputmode="numeric" placeholder="70" /></label>
          <label data-ekg-detailed><span>PQ ms</span><input id="betaEkgPq" inputmode="numeric" placeholder="160" /></label>
          <label data-ekg-detailed><span>QRS ms</span><input id="betaEkgQrs" inputmode="numeric" placeholder="90" /></label>
          <label data-ekg-detailed><span>QTc ms</span><input id="betaEkgQtc" inputmode="numeric" placeholder="420" /></label>
          <label><span>Mellkasi átm.</span><input id="betaEkgTransition" placeholder="V3–V4" /></label>
        </div>
        <div class="beta-ekg-output-row">
          <textarea id="betaEkgOutput" readonly></textarea>
          <button class="btn small" id="betaEkgCopy" type="button">EKG MÁSOLÁSA</button>
        </div>
      `;
      host.parentNode.insertBefore(builder, host);

      const refreshOutput = () => {
        const detailed = builder.querySelector("#betaEkgTemplate").value === "detailed";
        builder.querySelectorAll("[data-ekg-detailed]").forEach((node) => {
          node.classList.toggle("hidden", !detailed);
        });

        const fr = builder.querySelector("#betaEkgFr").value.trim();
        const pq = builder.querySelector("#betaEkgPq").value.trim();
        const qrs = builder.querySelector("#betaEkgQrs").value.trim();
        const qtc = builder.querySelector("#betaEkgQtc").value.trim();
        const transition = builder.querySelector("#betaEkgTransition").value.trim();

        const frText = fr ? `${fr}/min` : "/min";
        const transitionText = transition || "";

        builder.querySelector("#betaEkgOutput").value = detailed
          ? `EKG: SR, fr: ${frText}, fiz. tengelyállás, PQ: ${pq} ms, QRS: ${qrs} ms, QTc: ${qtc} ms, ie ST szakaszok, konkordáns T-k. Mellkasi átm: ${transitionText}`
          : `EKG: SR, fr: ${frText}, fiz. tengelyállás, norm. átvezetési idők, ie ST szakaszok, konkordáns T-k. Mellkasi átm: ${transitionText}`;
      };

      builder.querySelectorAll("input, select").forEach((control) => {
        control.addEventListener("input", refreshOutput);
        control.addEventListener("change", refreshOutput);
      });

      builder.querySelector("#betaEkgCopy")?.addEventListener("click", async (event) => {
        refreshOutput();
        const output = builder.querySelector("#betaEkgOutput");
        const text = output.value.trim();
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          output.focus();
          output.select();
          document.execCommand("copy");
        }
        const button = event.currentTarget;
        const original = button.textContent;
        button.textContent = "MÁSOLVA ✓";
        window.setTimeout(() => {
          if (button.isConnected) button.textContent = original;
        }, 1200);
      });

      refreshOutput();
    }

    // Cockpit may move #ekgCard into its unified investigations list after the
    // Beta helper was first created. Always follow the canonical EKG host so
    // the copy-only helper stays directly above the visible EKG cards.
    if (host.parentNode && builder.nextElementSibling !== host) {
      host.insertAdjacentElement("beforebegin", builder);
    }
  }

  function refresh() {
    if (!document.body.classList.contains("beta-build")) return;

    const patient = currentPatient();
    const root = buildStructuredStatusUi();

    if (!patient?.id || !root) {
      activeCaseId = null;
      localStatus = null;
      return;
    }

    if (activeCaseId !== patient.id) {
      activeCaseId = patient.id;
      localStatus = normalizeStatus(
        patient?.physicalStatus?.version === 1
          ? patient.physicalStatus
          : blankStatus()
      );
      populateBuilder(root, localStatus);
    } else if (patient?.physicalStatus?.version === 1) {
      localStatus = normalizeStatus(patient.physicalStatus);
      populateBuilder(root, localStatus);
    }

    ensureEkgBuilder();
  }

  document.addEventListener("bachsbo:finding-learning-changed", () => {
    const root = document.getElementById("betaStructuredStatus");
    if (!root || !currentPatient()?.id) return;
    refreshRealtimeStatus(root);
  });

  document.addEventListener("bachsbo:ui-rendered", () => {
    window.setTimeout(refresh, 0);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.setTimeout(refresh, 0), { once: true });
  } else {
    window.setTimeout(refresh, 0);
  }
})();
