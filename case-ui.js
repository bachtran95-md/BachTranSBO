// Runtime UI bridge extracted from config.js.
// Keeps clinical case-detail behavior separate from public configuration.
// Native-visible case detail controls. This extension is deliberately small and
// defensive because it runs beside the main app while app.js is private-scoped.
(() => {
  "use strict";

  const YEAR = new Date().getFullYear();
  const SAVE_DELAY_MS = 900;
  const DISCHARGE_PREFIX = "Otthonába bocsátáskor: ";
  let lastLoadedCaseId = "";
  let lastSaveFailedAt = 0;
  let metadataDirtyCaseId = "";

  const ARRIVAL_OPTIONS = [
    ["", "— select —", "— válasszon —"],
    ["omsz", "OMSz transported", "OMSz szállította"],
    ["esetkocsi", "Emergency unit transported", "Esetkocsi szállította"],
    ["walk_in", "Arrived walking", "Saját lábán érkezett"],
    ["gp_referral", "With GP referral", "Háziorvosi beutalóval"],
    ["other", "Other", "Egyéb"]
  ];

  const SEX_VALUES = ["M", "F", "O"];
  const SEX_COLORS = {
    F: { background: "#fff1f2", border: "#fbcfe8", color: "#9d174d" },
    M: { background: "#e0f2fe", border: "#7dd3fc", color: "#075985" },
    O: { background: "linear-gradient(90deg,#fee2e2,#fef3c7,#dcfce7,#dbeafe,#f3e8ff)", border: "#c4b5fd", color: "#312e81" }
  };

  const lang = () => document.documentElement.lang === "hu" ? "hu" : "en";
  const label = (en, hu) => lang() === "hu" ? hu : en;

  function clinicalUi() {
    return window.BachSBOClinicalUi || null;
  }

  function normalizeYob(value) {
    return clinicalUi()?.normalizeYob?.(value) || "";
  }

  function ageFromYob(yob) {
    const value = clinicalUi()?.ageFromYob?.(yob);
    return value === 0 ? "0" : String(value || "");
  }

  function normalizeSex(value) {
    const canonical = clinicalUi()?.normalizeSex?.(value);
    if (canonical) return canonical;

    // Bootstrap-only fallback before app.js publishes the canonical helpers.
    const raw = String(value || "").trim().toLowerCase();
    if (["m", "male", "man", "férfi", "ferfi", "férfibeteg"].includes(raw)) return "M";
    if (["f", "female", "woman", "nő", "no", "nőbeteg", "w"].includes(raw)) return "F";
    if (["o", "other", "egyéb", "egyeb", "x", "nonbinary", "non-binary"].includes(raw)) return "O";
    return "";
  }

  function normalizeArrivalMode(value) {
    return clinicalUi()?.normalizeArrivalMode?.(value) || "";
  }

  function sexLabel(value) {
    const normalized = normalizeSex(value);
    if (normalized === "F") return label("Female", "Nő");
    if (normalized === "M") return label("Male", "Férfi");
    if (normalized === "O") return label("Other", "Egyéb");
    return "";
  }

  function sexStyle(value) {
    return SEX_COLORS[normalizeSex(value)] || null;
  }

  function sexOptionsHtml(current) {
    const normalized = normalizeSex(current);
    return [""].concat(SEX_VALUES).map((value) => {
      const selected = value === normalized ? " selected" : "";
      const text = value ? sexLabel(value) : "—";
      return `<option value="${value}"${selected}>${text}</option>`;
    }).join("");
  }

  function sexBadge(value) {
    const normalized = normalizeSex(value);
    if (!normalized) return "";
    const c = sexStyle(normalized);
    return `<span data-sex-badge="${normalized}" style="display:inline-flex;align-items:center;gap:4px;border:1px solid ${c.border};background:${c.background};color:${c.color};border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700;line-height:1.4;white-space:nowrap">${sexLabel(normalized)}</span>`;
  }

  function arrivalOptionsHtml() {
    return ARRIVAL_OPTIONS.map(([value, en, hu]) =>
      `<option value="${value}">${label(en, hu)}</option>`
    ).join("");
  }

  function arrivalOptionsAreCurrent(select) {
    if (!select) return false;
    const options = [...select.options];
    if (options.length !== ARRIVAL_OPTIONS.length) return false;
    return options.every((option, index) => {
      const [value, en, hu] = ARRIVAL_OPTIONS[index];
      return option.value === value && option.textContent === label(en, hu);
    });
  }

  function paintArrivalSelect(select) {
    if (!select) return;
    // Chromium can glitch or close/reopen a native select if its <option> nodes
    // are replaced while the popup owns focus. Only rebuild when language/order
    // is actually stale, and never during an active interaction.
    if (arrivalOptionsAreCurrent(select) || document.activeElement === select) return;
    const current = select.value;
    select.innerHTML = arrivalOptionsHtml();
    select.value = current;
  }

  function styleSexSelect(select, normalized = normalizeSex(select?.value)) {
    if (!select) return;
    const c = sexStyle(normalized);
    select.style.borderColor = c?.border || "";
    select.style.background = c?.background || "";
    select.style.color = c?.color || "";
    select.style.fontWeight = normalized ? "700" : "";
  }

  function paintSexSelect(select) {
    if (!select) return;
    const normalized = normalizeSex(select.value);
    const expected = ["", ...SEX_VALUES];
    const options = [...select.options];
    const current =
      options.length === expected.length &&
      options.every((option, index) => {
        const value = expected[index];
        const expectedText = value ? sexLabel(value) : "—";
        return option.value === value && option.textContent === expectedText;
      });

    if (!current) {
      select.innerHTML = sexOptionsHtml(normalized);
      select.value = normalized;
    }

    select.dataset.sexEnhanced = "true";
    styleSexSelect(select, normalized);
  }

  function sexChoiceHtml(current = "") {
    const normalized = normalizeSex(current);
    const choices = SEX_VALUES.map((value) => {
      const checked = value === normalized ? " checked" : "";
      return `<label class="sex-choice sex-choice-${value.toLowerCase()}">
        <input type="radio" name="iceSexChoice" value="${value}"${checked} />
        <span class="sex-choice-check" aria-hidden="true"></span>
        <span data-sex-choice-label="${value}">${sexLabel(value)}</span>
      </label>`;
    }).join("");

    return `<input id="iceSex" type="hidden" value="${normalized}" />
      <div id="iceSexChoices" class="sex-choice-group" role="radiogroup" aria-label="${label("Sex", "Nem")}">
        ${choices}
      </div>`;
  }

  function syncSexChoiceUi(value = document.getElementById("iceSex")?.value || "") {
    const normalized = normalizeSex(value);
    const hidden = document.getElementById("iceSex");
    if (hidden) hidden.value = normalized;

    document.querySelectorAll('#iceSexChoices input[name="iceSexChoice"]').forEach((radio) => {
      radio.checked = radio.value === normalized;
    });

    const group = document.getElementById("iceSexChoices");
    if (group) group.setAttribute("aria-label", label("Sex", "Nem"));
  }

  function updateSexChoiceLabels() {
    SEX_VALUES.forEach((value) => {
      const text = document.querySelector(`[data-sex-choice-label="${value}"]`);
      if (text) text.textContent = sexLabel(value);
    });

    const group = document.getElementById("iceSexChoices");
    if (group) group.setAttribute("aria-label", label("Sex", "Nem"));
  }

  function wireSexChoiceUi() {
    const hidden = document.getElementById("iceSex");
    if (!hidden) return;

    document.querySelectorAll('#iceSexChoices input[name="iceSexChoice"]').forEach((radio) => {
      if (radio.dataset.sexChoiceWired === "true") return;
      radio.dataset.sexChoiceWired = "true";
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        hidden.value = radio.value;
        syncSexChoiceUi(radio.value);
        hidden.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  }

  function selectedId() {
    return document.querySelector("tr.selected[data-id]")?.dataset?.id || "";
  }

  function selectedRow() {
    return document.querySelector("tr.selected[data-id]");
  }

  function localIdNumber(value) {
    const match = String(value || "").match(/\d+/);
    const n = match ? Number(match[0]) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  function visibleTableLocalIds(excludeCaseId = "") {
    const ids = [];
    document.querySelectorAll("tr[data-id]").forEach((row) => {
      if (excludeCaseId && row.dataset.id === excludeCaseId) return;
      const n = localIdNumber(row.querySelector("td")?.textContent || "");
      if (n > 0) ids.push(n);
    });
    return ids;
  }

  function nextVisibleLocalId(excludeCaseId = "") {
    const nums = visibleTableLocalIds(excludeCaseId);
    return String(Math.max(0, ...nums) + 1).padStart(2, "0");
  }

  function updateNextLocalIdHint() {
    const input = document.getElementById("newId");
    if (!input) return;
    const next = nextVisibleLocalId("");
    if (next !== "01") input.value = next;
  }

  function setStatus(en, hu, isError = false) {
    const st = document.getElementById("iceStatus");
    if (!st) return;
    st.textContent = label(en, hu);
    st.style.color = isError ? "#b91c1c" : "";
  }

  function inlineHost() {
    return document.getElementById("inlineCaseEditor");
  }

  function inlineDetailsLoadedFor(caseId) {
    const host = inlineHost();
    return Boolean(caseId && host?.dataset.loadedCaseId === caseId && lastLoadedCaseId === caseId);
  }

  function clearInlineDetails(nextCaseId = "") {
    const sex = document.getElementById("iceSex");
    const yob = document.getElementById("iceYob");
    const age = document.getElementById("iceAge");
    const arrival = document.getElementById("iceArrival");
    const arrivalOther = document.getElementById("iceArrivalOther");
    const discharge = document.getElementById("fDischargeCondition");
    if (sex) { sex.value = ""; syncSexChoiceUi(""); }
    if (yob) yob.value = "";
    if (age) age.value = "";
    if (arrival) arrival.value = "";
    if (arrivalOther) arrivalOther.value = "";
    document.getElementById("iceArrivalOtherWrap")?.classList.add("hidden");
    if (discharge) discharge.value = "";
    lastLoadedCaseId = "";
    const host = inlineHost();
    if (host) {
      host.dataset.pendingCaseId = nextCaseId || "";
      host.dataset.loadedCaseId = "";
    }
  }

  // Demographics are never reconstructed from rendered table text or subtitle.
  // Patient state in app.js is the only authority; loadSelected() only renders it.

  function dischargeConditionTextFromStored(value) {
    const text = String(value || "").trim();
    return text.startsWith(DISCHARGE_PREFIX) ? text.slice(DISCHARGE_PREFIX.length).trim() : text;
  }

  function ensureDischargeConditionUi() {
    const disposition = document.getElementById("fDisposition");
    if (!disposition) return;
    let wrap = document.getElementById("dischargeConditionWrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "dischargeConditionWrap";
      wrap.className = "field narrative-field waiting hidden";
      wrap.style.marginTop = "8px";
      wrap.innerHTML = `
        <div class="narrative-head">
          <label data-discharge-label>Milyen állapotban, panasz?</label>
          <div class="narrative-actions"><span class="field-state waiting" id="dischargeConditionState">KÖTELEZŐ</span></div>
        </div>
        <textarea id="fDischargeCondition" placeholder="Például: panaszmentesen, jó általános állapotban; mellkasi fájdalma nem jelentkezett..."></textarea>
      `;
      disposition.closest(".field")?.after(wrap);
    }
    const visible = disposition.value === "discharged";
    wrap.classList.toggle("hidden", !visible);
    const text = document.getElementById("fDischargeCondition")?.value.trim() || "";
    wrap.classList.toggle("waiting", visible && !text);
    wrap.classList.toggle("result", visible && Boolean(text));
    const state = document.getElementById("dischargeConditionState");
    if (state) {
      state.textContent = text ? label("COMPLETE", "KÉSZ") : label("REQUIRED", "KÖTELEZŐ");
      state.className = `field-state ${text ? "result" : "waiting"}`;
    }
    const lab = wrap.querySelector("[data-discharge-label]");
    if (lab) lab.textContent = label("Condition / symptoms at discharge", "Milyen állapotban, panasz?");
  }

  function getDischargeCondition() {
    return String(document.getElementById("fDischargeCondition")?.value || "").trim();
  }

  function commitDischargeDraft() {
    return window.BachSBOClinicalUi?.commitCurrentDraft?.() || null;
  }

  function isEditingCaseDetails() {
    const active = document.activeElement;
    return Boolean(active && (active.closest?.("#inlineCaseEditor") || active.id === "fMainComplaint" || active.id === "fDischargeCondition"));
  }

  function ensureUi() {
    const form = document.getElementById("patientForm");
    const main = document.getElementById("fMainComplaint");
    if (!form || !main) return false;

    // Beta ships the demographics editor as native markup so it is always
    // present in Klinikum. Wire that existing editor even while patientForm is
    // still hidden; Stable has no static editor and keeps the old lazy behavior.
    let host = inlineHost();
    if (form.classList.contains("hidden") && !host) return false;
    if (!host) {
      host = document.createElement("div");
      host.id = "inlineCaseEditor";
      host.style.margin = "10px 0 14px";
      host.innerHTML = `
        <div class="inline3">
          <div class="field">
            <label data-ice-label="sex">Sex</label>
            ${sexChoiceHtml("")}
          </div>
          <div class="field">
            <label data-ice-label="yob">Year of birth</label>
            <input id="iceYob" inputmode="numeric" maxlength="4" placeholder="1955" autocomplete="off" />
          </div>
          <div class="field">
            <label data-ice-label="age">Age</label>
            <input id="iceAge" placeholder="auto" readonly aria-readonly="true" tabindex="-1" />
          </div>
        </div>
        <div class="field">
          <label data-ice-label="arrival">Arrival to SBO</label>
          <select id="iceArrival">${arrivalOptionsHtml()}</select>
        </div>
        <div class="field hidden" id="iceArrivalOtherWrap">
          <label data-ice-label="arrivalOther">Arrival details</label>
          <input id="iceArrivalOther" placeholder="Describe arrival..." autocomplete="off" />
        </div>
        <div class="toolbar" style="justify-content:space-between;margin-top:8px">
          <div class="subtle" id="iceStatus"></div>
          <button class="btn small" id="iceDeleteCase" type="button" style="border-color:#fecaca;color:#b91c1c;background:#fff5f5">DELETE CASE</button>
        </div>
      `;
      const mount = document.getElementById("cockpitDemographicsMount");
      if (mount) mount.appendChild(host);
      else main.closest(".field")?.after(host);
    } else {
      const mount = document.getElementById("cockpitDemographicsMount");
      if (mount && host.parentElement !== mount) mount.appendChild(host);
    }
    updateLabels();
    wireSexChoiceUi();
    wireUi();
    enhanceSexUi();
    ensureDischargeConditionUi();
    return true;
  }

  function updateLabels() {
    const labels = {
      sex: label("Sex", "Nem"),
      age: label("Age", "Életkor"),
      yob: label("Year of birth", "Születési év"),
      arrival: label("Arrival to SBO", "SBO-ra érkezés módja"),
      arrivalOther: label("Arrival details", "Érkezés részletei")
    };
    document.querySelectorAll("[data-ice-label]").forEach((el) => {
      el.textContent = labels[el.dataset.iceLabel] || el.textContent;
    });

    const sel = document.getElementById("iceArrival");
    if (sel) paintArrivalSelect(sel);

    const del = document.getElementById("iceDeleteCase");
    if (del) del.textContent = label("DELETE CASE", "ESET TÖRLÉSE");

    updateSexChoiceLabels();
    const newSex = document.getElementById("newSex");
    if (newSex) paintSexSelect(newSex);
  }

  function enhanceSexUi() {
    const iceSex = document.getElementById("iceSex");
    if (iceSex) syncSexChoiceUi(iceSex.value);

    const newSex = document.getElementById("newSex");
    if (newSex) {
      const current = normalizeSex(newSex.value);
      paintSexSelect(newSex);
      newSex.value = current;
    }

    document.querySelectorAll("tr[data-id] td:nth-child(2)").forEach((cell) => {
      const normalized = normalizeSex(cell.textContent || "");
      if (normalized) cell.innerHTML = sexBadge(normalized);
    });
    updateNextLocalIdHint();
  }

  async function loadSelected({ force = false } = {}) {
    if (!ensureUi()) return;
    const id = selectedId();
    if (!id) return;
    const host = inlineHost();

    if (metadataDirtyCaseId === id && inlineDetailsLoadedFor(id)) return;
    if (host && host.dataset.pendingCaseId !== id && host.dataset.loadedCaseId !== id) {
      clearInlineDetails(id);
    }
    if (!force && id === lastLoadedCaseId && isEditingCaseDetails()) return;

    const data = window.BachSBOClinicalUi?.getCaseMetadata?.(id);
    if (!data || selectedId() !== id) return;

    const sex = normalizeSex(data.sex);
    const sexEl = document.getElementById("iceSex");
    const yobEl = document.getElementById("iceYob");
    const ageEl = document.getElementById("iceAge");
    const arrivalEl = document.getElementById("iceArrival");
    const arrivalOtherEl = document.getElementById("iceArrivalOther");

    if (sexEl) {
      sexEl.value = sex;
      syncSexChoiceUi(sex);
    }
    if (yobEl) yobEl.value = data.year_of_birth ? String(data.year_of_birth) : "";
    if (ageEl) ageEl.value = ageFromYob(data.year_of_birth);
    if (arrivalEl) arrivalEl.value = data.arrival_mode || "";
    if (arrivalOtherEl) arrivalOtherEl.value = data.arrival_other || "";
    document.getElementById("iceArrivalOtherWrap")?.classList.toggle(
      "hidden",
      (data.arrival_mode || "") !== "other"
    );

    if ((document.getElementById("fDisposition")?.value || "") === "discharged") {
      const discharge = document.getElementById("fDischargeCondition");
      if (discharge && !discharge.value) {
        discharge.value =
          String(data.discharge_condition || "").trim() ||
          dischargeConditionTextFromStored(data.other_details);
      }
    }

    ensureDischargeConditionUi();
    lastLoadedCaseId = id;
    if (host) {
      host.dataset.pendingCaseId = id;
      host.dataset.loadedCaseId = id;
    }
    enhanceSexUi();
  }

  function buildPayload() {
    const arrival = normalizeArrivalMode(document.getElementById("iceArrival")?.value);
    const yobText = String(document.getElementById("iceYob")?.value || "").trim();
    const normalizedYob = normalizeYob(yobText);
    const validYob = Boolean(normalizedYob);
    const partialYob = Boolean(yobText) && !validYob;
    const age = document.getElementById("iceAge");
    if (age) age.value = validYob ? ageFromYob(normalizedYob) : "";
    const disposition = document.getElementById("fDisposition")?.value || "";
    const discharge = getDischargeCondition();
    const payload = {
      sex: normalizeSex(document.getElementById("iceSex")?.value) || null,
      main_complaint: document.getElementById("fMainComplaint")?.value || "",
      arrival_mode: arrival,
      arrival_other: arrival === "other" ? document.getElementById("iceArrivalOther")?.value || "" : "",
      disposition,
      discharge_condition: disposition === "discharged" ? discharge : "",
      updated_at: new Date().toISOString()
    };
    if (!yobText || validYob) payload.year_of_birth = validYob ? Number(normalizedYob) : null;
    return { payload, partialYob, normalizedYob };
  }

  function rowUpdate(payload) {
    const row = selectedRow();
    if (!row) return;

    const cells = row.querySelectorAll("td");
    const hasYob = Object.prototype.hasOwnProperty.call(payload, "year_of_birth");
    const displayAge = hasYob
      ? ageFromYob(payload.year_of_birth)
      : (document.getElementById("iceAge")?.value || "");
    const sex = normalizeSex(payload.sex);

    if (cells[1]) cells[1].innerHTML = sexBadge(sex) || "";
    if (cells[2] && hasYob) cells[2].textContent = displayAge || "";
    if (cells[3]) {
      cells[3].textContent =
        document.getElementById("fMainComplaint")?.value ||
        cells[3].textContent ||
        "";
    }

    const subtitle = document.getElementById("recordSubtitle");
    if (subtitle) {
      subtitle.textContent =
        `${sexLabel(sex) || "—"} • ${displayAge || "—"} ${lang() === "hu" ? "év" : "y"} • ${document.getElementById("fMainComplaint")?.value || ""}`;
    }

    const header = document.getElementById("recordHeader");
    if (header) {
      header.classList.remove("sex-female", "sex-male", "sex-other");
      if (sex === "F") header.classList.add("sex-female");
      else if (sex === "M") header.classList.add("sex-male");
      else if (sex === "O") header.classList.add("sex-other");
    }
  }

  function syncDraftIntoPatientState() {
    const id = selectedId();
    if (!id) return;
    const { payload, partialYob } = buildPayload();

    // Canonical in-memory state must reflect that an incomplete/invalid YOB is
    // unresolved immediately, while saveSelected() still blocks persistence of
    // the partial value itself.
    const canonicalPayload = partialYob
      ? { ...payload, year_of_birth: null }
      : payload;

    window.BachSBOClinicalUi?.applyCaseMetadata?.(id, canonicalPayload);
    rowUpdate(canonicalPayload);
  }

  async function saveSelected() {
    const id = selectedId();
    if (!id || !inlineDetailsLoadedFor(id)) return;

    const { payload, partialYob } = buildPayload();
    if (partialYob) {
      setStatus(
        "Enter a 4-digit birth year between 1900 and current year.",
        "Adjon meg 4 jegyű születési évet 1900 és az aktuális év között.",
        false
      );
      rowUpdate(payload);
      return;
    }

    try {
      setStatus("Saving case details…", "Esetadatok mentése…");
      syncDraftIntoPatientState();

      const save = window.BachSBOClinicalUi?.autosaveCurrentCase;
      if (typeof save !== "function") {
        throw new Error(label(
          "Canonical case autosave is not available.",
          "Az egységes eset-automatikus mentés nem érhető el."
        ));
      }

      await save();
      metadataDirtyCaseId = "";
      lastLoadedCaseId = id;
      setStatus("Case details saved.", "Esetadatok mentve.");
      loadSelected({ force: true });
    } catch (error) {
      metadataDirtyCaseId = id;
      lastSaveFailedAt = Date.now();
      const detail = error?.message ? ` (${error.message})` : "";
      setStatus(
        `Could not save case details${detail}.`,
        `Nem sikerült menteni az esetadatokat${detail}.`,
        true
      );
      console.warn("Inline case autosave failed", error);
    }
  }

  async function deleteSelectedCase() {
    const id = selectedId();
    if (!id) return;
    const name = selectedRow()?.querySelector("td")?.textContent?.trim() || "selected";
    if (!confirm(label(
      `Delete case ${name}? This will permanently remove the case, tests, summary and finalized revisions.`,
      `Törli a(z) ${name} esetet? Ez véglegesen törli az esetet, vizsgálatokat, összefoglalót és véglegesített verziókat.`
    ))) return;
    if (!confirm(label("This cannot be undone. Continue?", "Ez nem vonható vissza. Folytatja?"))) return;
    const btn = document.getElementById("iceDeleteCase");
    if (btn) btn.disabled = true;
    try {
      setStatus("Deleting case…", "Eset törlése…");
      const backend = window.BachSBOBackend;
      if (!backend?.deleteCase) {
        throw new Error(label(
          "Secure case deletion is not available.",
          "A biztonságos esettörlés nem érhető el."
        ));
      }
      await backend.deleteCase(id);
      window.location.reload();
    } catch (error) {
      if (btn) btn.disabled = false;
      const detail = error?.message ? ` (${error.message})` : "";
      setStatus(`Could not delete case${detail}.`, `Nem sikerült törölni az esetet${detail}.`, true);
      console.warn("Secure case delete failed", error);
    }
  }

  function scheduleSave(delay = SAVE_DELAY_MS) {
    clearTimeout(window.__iceTimer);
    window.__iceTimer = setTimeout(saveSelected, delay);
  }

  function wireUi() {
    const ids = ["iceSex", "iceYob", "iceArrival", "iceArrivalOther", "fMainComplaint"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.dataset.iceWired === "true") return;
      el.dataset.iceWired = "true";
      const handler = () => {
        metadataDirtyCaseId = selectedId() || metadataDirtyCaseId;
        const yob = document.getElementById("iceYob");
        const age = document.getElementById("iceAge");
        const arrival = document.getElementById("iceArrival");
        if (id === "iceYob" && age && yob) age.value = ageFromYob(yob.value);
        if (id === "iceSex") syncSexChoiceUi(el.value);
        document.getElementById("iceArrivalOtherWrap")?.classList.toggle("hidden", (arrival?.value || "") !== "other");
        syncDraftIntoPatientState();
        scheduleSave(id === "iceYob" || id === "fMainComplaint" ? SAVE_DELAY_MS : 100);
      };
      // Native Chromium <select> can emit input while its popup is still open.
      // Commit arrival only on change; otherwise autosave/rerender can interfere
      // with the active popup in Chrome. Text inputs keep their live input path.
      if (id !== "iceSex" && id !== "iceArrival") el.addEventListener("input", handler);
      el.addEventListener("change", handler);
      el.addEventListener("blur", () => {
        if (id === "iceArrival") paintArrivalSelect(el);
        if (id === "iceYob") {
          const normalized = normalizeYob(el.value);
          if (normalized) {
            el.value = normalized;
            const age = document.getElementById("iceAge");
            if (age) age.value = ageFromYob(normalized);
            syncDraftIntoPatientState();
          }
        }
        scheduleSave(50);
      });
    });
    const del = document.getElementById("iceDeleteCase");
    if (del && del.dataset.iceWired !== "true") {
      del.dataset.iceWired = "true";
      del.addEventListener("click", deleteSelectedCase);
    }
    const disposition = document.getElementById("fDisposition");
    if (disposition && disposition.dataset.dischargeWired !== "true") {
      disposition.dataset.dischargeWired = "true";
      disposition.addEventListener("change", () => {
        ensureDischargeConditionUi();
        metadataDirtyCaseId = selectedId() || metadataDirtyCaseId;
        commitDischargeDraft();
        syncDraftIntoPatientState();
        scheduleSave(100);
      });
    }
    const discharge = document.getElementById("fDischargeCondition");
    if (discharge && discharge.dataset.dischargeWired !== "true") {
      discharge.dataset.dischargeWired = "true";
      discharge.addEventListener("input", () => {
        ensureDischargeConditionUi();
        metadataDirtyCaseId = selectedId() || metadataDirtyCaseId;
        commitDischargeDraft();
        syncDraftIntoPatientState();
        scheduleSave(SAVE_DELAY_MS);
      });
      discharge.addEventListener("blur", () => {
        scheduleSave(50);
      });
    }
  }

  function install() {
    if (window.__inlineCaseEditorInstalled) return;
    window.__inlineCaseEditorInstalled = true;

    // Wire the native editor immediately, then react to explicit app renders.
    // No DOM observer or recurring repair loop is needed.
    ensureUi();
    enhanceSexUi();
    loadSelected({ force: true });

    document.addEventListener("bachsbo:ui-rendered", () => {
      ensureUi();
      enhanceSexUi();
      loadSelected({ force: true });
    });

    document.addEventListener("click", (event) => {
      if (event.target?.id === "langEnBtn" || event.target?.id === "langHuBtn") {
        setTimeout(enhanceSexUi, 0);
      }
    }, true);

    document.addEventListener("change", (event) => {
      if (event.target?.id === "newSex") styleSexSelect(event.target);
      if (event.target?.id === "fDisposition") ensureDischargeConditionUi();
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
