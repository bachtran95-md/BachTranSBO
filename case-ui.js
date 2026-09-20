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

  const ARRIVAL_OPTIONS = [
    ["", "— select —", "— válasszon —"],
    ["omsz", "OMSz transported", "OMSz szállította"],
    ["esetkocsi", "Emergency unit transported", "Esetkocsi szállította"],
    ["walk_in", "Arrived walking", "saját lábán érkezett"],
    ["gp_referral", "With GP referral", "HO beutalóval"],
    ["other", "Other", "egyéb"]
  ];

  const SEX_VALUES = ["F", "M", "O"];
  const SEX_COLORS = {
    F: { background: "#fff1f2", border: "#fbcfe8", color: "#9d174d" },
    M: { background: "#e0f2fe", border: "#7dd3fc", color: "#075985" },
    O: { background: "linear-gradient(90deg,#fee2e2,#fef3c7,#dcfce7,#dbeafe,#f3e8ff)", border: "#c4b5fd", color: "#312e81" }
  };

  const lang = () => document.documentElement.lang === "hu" ? "hu" : "en";
  const label = (en, hu) => lang() === "hu" ? hu : en;

  function ageFromYob(yob) {
    const y = Number(yob);
    if (!Number.isInteger(y) || y < 1900 || y > YEAR) return "";
    return String(YEAR - y);
  }

  function yobFromAge(age) {
    const a = Number(String(age || "").replace(/[^0-9]/g, ""));
    if (!Number.isInteger(a) || a < 0 || a > 130) return "";
    return String(YEAR - a);
  }

  function normalizeYob(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const digits = raw.replace(/[^0-9]/g, "");
    if (digits.length === 4) {
      const y = Number(digits);
      return Number.isInteger(y) && y >= 1900 && y <= YEAR ? String(y) : "";
    }
    if (digits.length === 2 || digits.length === 3) {
      // Treat short values as age, matching the Add Case helper text "1955 or 55".
      return yobFromAge(digits);
    }
    return "";
  }

  function normalizeSex(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (["f", "female", "woman", "nő", "no", "nőbeteg", "w"].includes(raw)) return "F";
    if (["m", "male", "man", "férfi", "ferfi", "férfibeteg"].includes(raw)) return "M";
    if (["o", "other", "egyéb", "egyeb", "x", "nonbinary", "non-binary"].includes(raw)) return "O";
    return "";
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

  function paintSexSelect(select) {
    if (!select) return;
    const normalized = normalizeSex(select.value);
    select.innerHTML = sexOptionsHtml(normalized);
    select.value = normalized;
    select.dataset.sexEnhanced = "true";
    const c = sexStyle(normalized);
    select.style.borderColor = c?.border || "";
    select.style.background = c?.background || "";
    select.style.color = c?.color || "";
    select.style.fontWeight = normalized ? "700" : "";
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

  function backendReady() {
    return Boolean(window.BachSBOBackend?.getSession);
  }

  function db() {
    if (!window.supabase?.createClient) return null;
    if (!window.__BachSBOInlineCaseClient) {
      const c = window.BACH_SBO_CONFIG || {};
      window.__BachSBOInlineCaseClient = window.supabase.createClient(
        c.supabaseUrl,
        c.supabasePublishableKey,
        { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
      );
    }
    return window.__BachSBOInlineCaseClient;
  }

  async function syncedClient() {
    const client = db();
    if (!client) throw new Error("Supabase client is not available.");
    if (backendReady()) {
      const session = await window.BachSBOBackend.getSession();
      if (session?.access_token && session?.refresh_token) {
        await client.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });
      }
    }
    return client;
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
    if (sex) { sex.value = ""; paintSexSelect(sex); }
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

  function getSelectedDisplayDemographics() {
    const row = selectedRow();
    const tds = row ? [...row.querySelectorAll("td")] : [];
    let sex = normalizeSex(tds[1]?.textContent || "");
    let age = String(tds[2]?.textContent || "").match(/\d+/)?.[0] || "";

    const subtitle = document.getElementById("recordSubtitle")?.textContent || "";
    const subtitleParts = subtitle.split("•").map((x) => x.trim());
    if (!sex && subtitleParts[0]) sex = normalizeSex(subtitleParts[0]);
    if (!age && subtitleParts[1]) age = subtitleParts[1].match(/\d+/)?.[0] || "";

    return { sex, age, yob: yobFromAge(age) };
  }

  function mirrorSelectedDisplayIntoInline({ force = false } = {}) {
    if (!ensureUi()) return;
    const id = selectedId();
    if (!id || inlineDetailsLoadedFor(id)) return;
    if (!force && isEditingCaseDetails()) return;

    const { sex, yob } = getSelectedDisplayDemographics();
    const sexEl = document.getElementById("iceSex");
    const yobEl = document.getElementById("iceYob");
    const ageEl = document.getElementById("iceAge");

    if (sex && sexEl && (!sexEl.value || force)) {
      sexEl.value = sex;
      paintSexSelect(sexEl);
    }
    if (yob && yobEl && (!yobEl.value || force)) {
      yobEl.value = yob;
      if (ageEl) ageEl.value = ageFromYob(yob);
    }

    const host = inlineHost();
    if (host) host.dataset.pendingCaseId = id;
  }

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

  function mergeDischargeConditionIntoPatient(patient) {
    if (!patient) return;
    const disposition = document.getElementById("fDisposition")?.value || patient.disposition || "";
    if (disposition === "discharged") {
      const discharge = getDischargeCondition();
      patient.disposition = "discharged";
      patient.otherDetails = discharge ? `${DISCHARGE_PREFIX}${discharge}` : "";
    }
  }

  function validateDischargeCondition(patient) {
    const disposition = document.getElementById("fDisposition")?.value || patient?.disposition || "";
    if (disposition !== "discharged") return true;
    const text = getDischargeCondition();
    ensureDischargeConditionUi();
    if (text) return true;
    setStatus(
      "Enter condition / symptoms at discharge before saving or generating.",
      "Otthonába bocsátás esetén kötelező: Milyen állapotban, panasz?",
      true
    );
    return false;
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
            <select id="iceSex">${sexOptionsHtml("")}</select>
          </div>
          <div class="field">
            <label data-ice-label="yob">Year of birth</label>
            <input id="iceYob" inputmode="numeric" maxlength="4" placeholder="1955" autocomplete="off" />
          </div>
          <div class="field">
            <label data-ice-label="age">Age</label>
            <input id="iceAge" inputmode="numeric" maxlength="3" placeholder="auto" autocomplete="off" />
          </div>
        </div>
        <div class="field">
          <label data-ice-label="arrival">Arrival to SBO</label>
          <select id="iceArrival"></select>
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
    if (sel) {
      const current = sel.value;
      sel.innerHTML = ARRIVAL_OPTIONS.map(([value, en, hu]) =>
        `<option value="${value}">${label(en, hu)}</option>`
      ).join("");
      sel.value = current;
    }
    const del = document.getElementById("iceDeleteCase");
    if (del) del.textContent = label("DELETE CASE", "ESET TÖRLÉSE");
  }

  function enhanceSexUi() {
    [document.getElementById("iceSex"), document.getElementById("newSex")].forEach((select) => {
      if (!select) return;
      const current = normalizeSex(select.value);
      paintSexSelect(select);
      select.value = current;
    });
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
    if (host && host.dataset.pendingCaseId !== id && host.dataset.loadedCaseId !== id) {
      clearInlineDetails(id);
    }
    mirrorSelectedDisplayIntoInline({ force: false });
    if (!force) {
      if (id === lastLoadedCaseId && isEditingCaseDetails()) return;
      if (Date.now() - lastSaveFailedAt < 3000) return;
    }
    try {
      const client = await syncedClient();
      const { data, error } = await client
        .from("cases")
        .select("id, sex, year_of_birth, main_complaint, arrival_mode, arrival_other, disposition, other_details")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data || selectedId() !== id) {
        mirrorSelectedDisplayIntoInline({ force: false });
        setTimeout(() => loadSelected({ force: true }), 700);
        return;
      }
      const sex = normalizeSex(data.sex);
      document.getElementById("iceSex").value = sex;
      paintSexSelect(document.getElementById("iceSex"));
      document.getElementById("iceYob").value = data.year_of_birth ? String(data.year_of_birth) : "";
      document.getElementById("iceAge").value = ageFromYob(data.year_of_birth);
      document.getElementById("iceArrival").value = data.arrival_mode || "";
      document.getElementById("iceArrivalOther").value = data.arrival_other || "";
      document.getElementById("iceArrivalOtherWrap")?.classList.toggle("hidden", (data.arrival_mode || "") !== "other");
      if ((document.getElementById("fDisposition")?.value || data.disposition) === "discharged") {
        const discharge = document.getElementById("fDischargeCondition");
        if (discharge && !discharge.value) discharge.value = dischargeConditionTextFromStored(data.other_details);
      }
      ensureDischargeConditionUi();
      lastLoadedCaseId = id;
      if (host) {
        host.dataset.pendingCaseId = id;
        host.dataset.loadedCaseId = id;
      }
      enhanceSexUi();
    } catch (error) {
      mirrorSelectedDisplayIntoInline({ force: false });
      console.warn("Inline case load failed", error);
    }
  }

  function buildPayload() {
    const arrival = document.getElementById("iceArrival")?.value || "";
    const yobText = String(document.getElementById("iceYob")?.value || "").trim();
    const yobNum = Number(yobText);
    const validYob = Number.isInteger(yobNum) && yobNum >= 1900 && yobNum <= YEAR;
    const partialYob = Boolean(yobText) && !validYob;
    document.getElementById("iceAge").value = validYob ? ageFromYob(yobNum) : "";
    const disposition = document.getElementById("fDisposition")?.value || "";
    const discharge = getDischargeCondition();
    const payload = {
      sex: normalizeSex(document.getElementById("iceSex")?.value) || null,
      main_complaint: document.getElementById("fMainComplaint")?.value || "",
      arrival_mode: arrival,
      arrival_other: arrival === "other" ? document.getElementById("iceArrivalOther")?.value || "" : "",
      updated_at: new Date().toISOString()
    };
    if (disposition === "discharged") {
      payload.other_details = discharge ? `${DISCHARGE_PREFIX}${discharge}` : "";
    }
    if (!yobText || validYob) payload.year_of_birth = validYob ? yobNum : null;
    return { payload, partialYob };
  }

  function repairPatientLocalId(patient) {
    if (!patient) return patient;
    const current = String(patient.localId || "").padStart(2, "0");
    const otherIds = visibleTableLocalIds(patient.id).map((n) => String(n).padStart(2, "0"));
    if (!current || otherIds.includes(current)) {
      patient.localId = nextVisibleLocalId(patient.id);
      patient.updatedAt = new Date().toISOString();
      const row = selectedRow();
      const idCell = row?.querySelector("td");
      if (idCell) idCell.textContent = patient.localId;
      const title = document.getElementById("recordTitle");
      if (title) title.textContent = `${label("Case", "Eset")} ${patient.localId}`;
      setStatus(`Duplicate case ID repaired to ${patient.localId}.`, `Ismétlődő esetazonosító javítva: ${patient.localId}.`, false);
    } else {
      patient.localId = current;
    }
    return patient;
  }

  function rowUpdate(payload) {
    const row = selectedRow();
    if (!row) return;
    const tds = row.querySelectorAll("td");
    const hasYob = Object.prototype.hasOwnProperty.call(payload, "year_of_birth");
    const displayAge = hasYob ? ageFromYob(payload.year_of_birth) : (document.getElementById("iceAge")?.value || "");
    const sex = normalizeSex(payload.sex);
    if (tds[1]) tds[1].innerHTML = sexBadge(sex) || "";
    if (tds[2] && hasYob) tds[2].textContent = displayAge || "";
    if (tds[3]) tds[3].textContent = document.getElementById("fMainComplaint")?.value || tds[3].textContent || "";
    const subtitle = document.getElementById("recordSubtitle");
    if (subtitle) subtitle.textContent = `${sexLabel(sex) || "—"} • ${displayAge || "—"} y • ${document.getElementById("fMainComplaint")?.value || ""}`;
  }

  function mirrorPatientIntoInline(patient) {
    if (!patient || patient.id !== selectedId() || !ensureUi()) return;
    const sex = normalizeSex(patient.sex);
    const yob = normalizeYob(patient.yob || patient.year_of_birth || patient.yearOfBirth || "");
    const sexEl = document.getElementById("iceSex");
    const yobEl = document.getElementById("iceYob");
    const ageEl = document.getElementById("iceAge");
    if (sex && sexEl) {
      sexEl.value = sex;
      paintSexSelect(sexEl);
    }
    if (yob && yobEl) {
      yobEl.value = yob;
      if (ageEl) ageEl.value = ageFromYob(yob);
    }
  }

  function mergeInlineDetailsIntoPatient(patient) {
    if (!patient) return patient;
    if (patient.sex) patient.sex = normalizeSex(patient.sex) || patient.sex;
    if (patient.yob) patient.yob = normalizeYob(patient.yob) || patient.yob;
    if (patient.id === selectedId()) {
      repairPatientLocalId(patient);
      mirrorPatientIntoInline(patient);
    }
    mergeDischargeConditionIntoPatient(patient);

    if (patient.id !== selectedId() || !inlineDetailsLoadedFor(patient.id)) {
      return patient;
    }

    const { payload, partialYob } = buildPayload();
    if (partialYob) {
      setStatus("Enter a 4-digit birth year before saving or generating.", "Mentés vagy generálás előtt adjon meg 4 jegyű születési évet.", true);
      return patient;
    }
    patient.sex = payload.sex || "";
    if (Object.prototype.hasOwnProperty.call(payload, "year_of_birth")) {
      patient.yob = payload.year_of_birth ? String(payload.year_of_birth) : "";
    }
    patient.mainComplaint = payload.main_complaint || patient.mainComplaint || "";
    patient.arrivalMode = payload.arrival_mode || "";
    patient.arrivalOther = payload.arrival_other || "";
    if ((document.getElementById("fDisposition")?.value || "") === "discharged") {
      patient.disposition = "discharged";
      patient.otherDetails = payload.other_details || "";
    }
    patient.updatedAt = new Date().toISOString();
    rowUpdate(payload);
    return patient;
  }

  function scheduleLoadRetries() {
    [50, 180, 700, 1500].forEach((ms) => setTimeout(() => {
      mirrorSelectedDisplayIntoInline({ force: false });
      loadSelected({ force: true });
    }, ms));
  }

  function installBackendPayloadBridge() {
    const backend = window.BachSBOBackend;
    if (!backend || backend.__inlineCaseDetailsBridge === true) return false;

    const originalSavePatient = backend.savePatient;
    if (typeof originalSavePatient === "function") {
      backend.savePatient = function patchedSavePatient(shiftId, patient) {
        mergeInlineDetailsIntoPatient(patient);
        if (!validateDischargeCondition(patient)) {
          return Promise.reject(new Error(label("Discharge condition / symptoms is required.", "Otthonába bocsátás esetén kötelező: Milyen állapotban, panasz?")));
        }
        return Promise.resolve(originalSavePatient.call(this, shiftId, patient)).then((result) => {
          scheduleLoadRetries();
          return result;
        });
      };
    }

    const originalFinalizePatient = backend.finalizePatient;
    if (typeof originalFinalizePatient === "function") {
      backend.finalizePatient = function patchedFinalizePatient(shiftId, patient) {
        mergeInlineDetailsIntoPatient(patient);
        if (!validateDischargeCondition(patient)) {
          return Promise.reject(new Error(label("Discharge condition / symptoms is required.", "Otthonába bocsátás esetén kötelező: Milyen állapotban, panasz?")));
        }
        return originalFinalizePatient.call(this, shiftId, patient);
      };
    }

    const originalSaveState = backend.saveState;
    if (typeof originalSaveState === "function") {
      backend.saveState = function patchedSaveState(state) {
        const id = selectedId();
        const patients = Array.isArray(state?.patients) ? state.patients : [];
        const patient = patients.find((item) => item?.id === id);
        mergeInlineDetailsIntoPatient(patient);
        return Promise.resolve(originalSaveState.call(this, state)).then((result) => {
          scheduleLoadRetries();
          return result;
        });
      };
    }

    Object.defineProperty(backend, "__inlineCaseDetailsBridge", { value: true, configurable: true });
    return true;
  }

  async function saveSelected() {
    const id = selectedId();
    if (!id || !inlineDetailsLoadedFor(id)) return;
    const { payload, partialYob } = buildPayload();
    if (partialYob) {
      setStatus("Enter a 4-digit birth year between 1900 and current year.", "Adjon meg 4 jegyű születési évet 1900 és az aktuális év között.", false);
      rowUpdate(payload);
      return;
    }
    try {
      setStatus("Saving case details…", "Esetadatok mentése…");
      const backend = window.BachSBOBackend;
      if (!backend?.updateCaseMetadata) {
        throw new Error(label(
          "Secure case metadata save is not available.",
          "A biztonságos esetadat-mentés nem érhető el."
        ));
      }
      const metadata = {
        sex: payload.sex,
        yearOfBirth: Object.prototype.hasOwnProperty.call(payload, "year_of_birth")
          ? payload.year_of_birth
          : null,
        mainComplaint: payload.main_complaint || "",
        arrivalMode: payload.arrival_mode || "",
        arrivalOther: payload.arrival_other || ""
      };
      if (Object.prototype.hasOwnProperty.call(payload, "other_details")) {
        metadata.otherDetails = payload.other_details || "";
      }
      const result = await backend.updateCaseMetadata(id, metadata);
      const saved = result?.metadata || {};
      if (Object.prototype.hasOwnProperty.call(saved, "main_complaint")) {
        const complaint = document.getElementById("fMainComplaint");
        if (complaint) complaint.value = saved.main_complaint || "";
      }
      if (Object.prototype.hasOwnProperty.call(saved, "arrival_other")) {
        const arrivalOther = document.getElementById("iceArrivalOther");
        if (arrivalOther) arrivalOther.value = saved.arrival_other || "";
      }
      rowUpdate(Object.keys(saved).length ? saved : payload);
      lastLoadedCaseId = id;
      setStatus("Case details saved.", "Esetadatok mentve.");
      loadSelected({ force: true });
    } catch (error) {
      lastSaveFailedAt = Date.now();
      const detail = error?.message ? ` (${error.message})` : "";
      setStatus(`Could not save case details${detail}.`, `Nem sikerült menteni az esetadatokat${detail}.`, true);
      console.warn("Inline case save failed", error);
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
    const ids = ["iceSex", "iceYob", "iceAge", "iceArrival", "iceArrivalOther", "fMainComplaint"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.dataset.iceWired === "true") return;
      el.dataset.iceWired = "true";
      const handler = () => {
        const yob = document.getElementById("iceYob");
        const age = document.getElementById("iceAge");
        const arrival = document.getElementById("iceArrival");
        if (id === "iceYob" && age && yob) age.value = ageFromYob(yob.value);
        if (id === "iceAge" && age && yob) {
          const normalizedAge = String(age.value || "").replace(/[^0-9]/g, "");
          age.value = normalizedAge;
          if (!normalizedAge) {
            yob.value = "";
          } else {
            const derivedYob = yobFromAge(normalizedAge);
            if (derivedYob) yob.value = derivedYob;
          }
        }
        if (id === "iceSex") paintSexSelect(el);
        document.getElementById("iceArrivalOtherWrap")?.classList.toggle("hidden", (arrival?.value || "") !== "other");
        scheduleSave(id === "iceYob" || id === "iceAge" || id === "fMainComplaint" ? SAVE_DELAY_MS : 100);
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
      el.addEventListener("blur", () => scheduleSave(50));
    });
    const del = document.getElementById("iceDeleteCase");
    if (del && del.dataset.iceWired !== "true") {
      del.dataset.iceWired = "true";
      del.addEventListener("click", deleteSelectedCase);
    }
    const disposition = document.getElementById("fDisposition");
    if (disposition && disposition.dataset.dischargeWired !== "true") {
      disposition.dataset.dischargeWired = "true";
      disposition.addEventListener("change", () => { ensureDischargeConditionUi(); scheduleSave(100); });
    }
    const discharge = document.getElementById("fDischargeCondition");
    if (discharge && discharge.dataset.dischargeWired !== "true") {
      discharge.dataset.dischargeWired = "true";
      discharge.addEventListener("input", () => { ensureDischargeConditionUi(); scheduleSave(SAVE_DELAY_MS); });
      discharge.addEventListener("blur", () => scheduleSave(50));
    }
  }

  function install() {
    if (window.__inlineCaseEditorInstalled) return;
    window.__inlineCaseEditorInstalled = true;
    setTimeout(() => window.applyLanguage?.("hu"), 250);
    setTimeout(() => window.applyLanguage?.("hu"), 900);
    new MutationObserver(() => {
      clearTimeout(window.__iceRefresh);
      window.__iceRefresh = setTimeout(() => {
        ensureUi();
        installBackendPayloadBridge();
        enhanceSexUi();
        mirrorSelectedDisplayIntoInline({ force: false });
        loadSelected();
      }, 120);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    document.addEventListener("click", (event) => {
      const selectedCaseRow = event.target?.closest?.("#patientTbody tr[data-id]");
      const editingCaseDetails = event.target?.closest?.(
        "#inlineCaseEditor, #patientForm input, #patientForm textarea, #patientForm select, #patientForm button"
      );
      setTimeout(() => {
        mirrorSelectedDisplayIntoInline({ force: false });
        // Force a backend refresh only when the user actually selects a case.
        // Never force-refresh while editing demographics/clinical controls,
        // otherwise a delayed click refresh can overwrite in-progress Age/YOB/Arrival edits.
        loadSelected({ force: Boolean(selectedCaseRow) && !editingCaseDetails });
        enhanceSexUi();
      }, 100);
    }, true);
    document.addEventListener("change", (event) => {
      if (event.target?.id === "newSex") paintSexSelect(event.target);
      if (event.target?.id === "fDisposition") ensureDischargeConditionUi();
    }, true);
    setInterval(() => {
      ensureUi();
      installBackendPayloadBridge();
      enhanceSexUi();
      mirrorSelectedDisplayIntoInline({ force: false });
      loadSelected();
    }, 1200);
    setTimeout(() => {
      loadSelected({ force: true });
      installBackendPayloadBridge();
      enhanceSexUi();
      mirrorSelectedDisplayIntoInline({ force: true });
    }, 600);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
