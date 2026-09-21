let state = defaultState();
let selectedPatientId = null;
let backendReady = false;
let currentUser = null;
let stateDirty = false;
let currentView = "patients";
const patientSaveQueues = new Map();
let caseCounterRefreshPromise = null;
let caseCounterLastCheckedAt = 0;
const MAX_TEST_ENTRIES_PER_TYPE = 999;

const SUMMARY_FIXED_FOOTER = `A beteget tanáccsal elláttuk, kérdéseire választ adtunk, több kérdés nem merült fel.
Hirtelen vagy súlyos állapotromlás esetén haladéktalanul jelentkezzen a területileg illetékes Sürgősségi Betegellátó Osztályon / SBO-n!
Ambuláns lappal minél előbb jelentkezzen háziorvosánál, kezelőorvosánál.

FIGYELMEZTETÉS!
A sürgősségi osztályon, sürgősségi körülmények között keletkezett leletek korlátozott értékűek, nem tekinthetők teljes körűnek, mivel az elvégzett vizsgálatok a sürgősségi jellegű panaszai és tünetei alapján kerülnek meghatározásra és erre fókuszálnak. A cél az életveszélyes, illetve az azonnal kezelendő kórállapotok felfedezése, beazonosítása. A sürgősségi osztályon végzett vizsgálatok nem helyettesítenek egy alapos, átfogó szakorvosi vizsgálatot vagy a háziorvosi gondozást. Kérjük, hogy osztályunkról történő távozást követően a lehető legrövidebb időn belül jelentkezzen háziorvosánál a szükséges további teendők egyeztetése céljából. Amennyiben jelen panaszai/fájdalmai újra fellépnek vagy felerősödnek, késlekedés nélkül forduljon orvoshoz, mivel ennek elmulasztása kedvezőtlenül befolyásolhatja egészségi állapotát.`;

let uiLang = "hu";
const I18N = {
  en: {
    casesNav:"Cases", aiLearningNav:"AI Learning", adminNav:"Admin",
    futureModules:"Future modules", analytics:"Analytics", archive:"Archive",
    integrations:"Integrations", planned:"PLANNED",
    noActiveShift:"No active shift", oneShiftOnly:"Only one shift can be active at a time.",
    startShift:"START SHIFT", importCase:"Import new case",
    autoId:"Case ID automatically starts from 01 in each shift.", sex:"Sex", age:"Age", status:"Status", yob:"Year of birth",
    mainComplaint:"Main complaint", addCase:"ADD CASE", caseRecord:"Case list",
    caseStatusHint:"Status shows unresolved items for each case.",
    selectCasePrompt:"Select a case from the list.", noCaseSelected:"No case selected.",
    reopenCase:"REOPEN CASE", sectionClinical:"1. Clinical", complaint:"Complaint",
    patientHistory:"Medical history", markNone:"NONE", required:"REQUIRED", complete:"COMPLETE", none:"NONE",
    sectionTests:"2. Physical status and investigations",
    testLegend:"Orange = unresolved. Enter a result to turn green, or mark Not ordered to turn grey.",
    physicalExam:"Physical examination — main points / status",
    lab:"Lab", addLab:"+ ADD LAB", ekg:"EKG", bloodGas:"Blood gas (ABG / VBG)",
    radiology:"Radiology", addRadiology:"+ ADD IMAGING",
    consultations:"Consultations", addConsultation:"+ ADD CONSULTATION", others:"Others",
    sectionCourse:"3. Treatment and course", therapy:"Therapy",
    clinicalCourse:"Clinical course / case status change",
    diagnoses:"Diagnoses", diagnosesPrompt:"What might be behind the patient's complaints?", disposition:"Disposition",
    finalDecision:"4. Final decision / disposition",
    finalDecisionInfo:"Disposition records the clinical decision. The case closes only after the Summary is finalized.",
    homePlan:"Recommendation and plan at home", addRecommendation:"+ Add recommendation",
    hospital:"Hospital", ward:"Ward / department", acceptingPhysician:"Accepting physician",
    additionalNote:"Additional note", outcome:"Outcome", details:"Details",
    caseSummary:"5. Case summary",
    summaryInfo:"Generate Summary uses the de-identified case and the active SBO Documentation Skill. Review and edit the draft before finalizing.",
    generateSummary:"GENERATE SUMMARY", summaryEditable:"Summary — editable",
    finalizeSummary:"FINALIZE SUMMARY", saveCase:"SAVE CASE", autosaveHint:"Autosave active",
    diagnosesNote:"Doctor-entered diagnoses only. Summary generation must not infer new diagnoses from test results.",
    learningDesc:"Doctor-approved learning from finalized summaries. Nothing here auto-edits the master Skill.",
    finalizedCorpusReview:"Finalized corpus review",
    corpusReviewDesc:"Approve or exclude finalized revisions from future AI learning. This never edits the clinical record or finalized text.",
    loading:"Loading…",
    refresh:"REFRESH", finalizedCorpus:"Finalized corpus", activeSkill:"Active Skill", activeStyle:"Active style",
    writingStyle:"Writing style", styleDesc:"Generated → Finalized pairs. Candidate requires explicit activation.",
    generateCandidate:"GENERATE CANDIDATE", skillSuggestions:"Skill improvement suggestions",
    skillSuggestionsDesc:"Advisory only. Accepting never modifies Skill versions automatically.",
    analyzeEdits:"ANALYZE EDITS", adminDesc:"Single-owner account security settings.",
    account:"Account", accountDesc:"Only the configured owner account can use this app.",
    changePassword:"Change password", passwordRule:"Minimum 6 characters. No special complexity rule is required by this app.",
    currentPassword:"Current password", newPassword:"New password", confirmPassword:"Confirm new password",
    changePasswordButton:"CHANGE PASSWORD", signOut:"SIGN OUT",
    phMainComplaint:"Chest pain", phManualPaste:"Manual input or paste from clipboard…",
    phDiagnoses:"One diagnosis per line or separated by semicolons. Hungarian or Latin terms.",
    phDischargeCondition:"e.g. symptom-free, good general condition; no recurrent chest pain…",
    phOtherOutcome:"Death, transfer, left against medical advice…",
    phSummary:"Generated summary will appear here. You can edit it before Finalize.",
    phArrivalOther:"Describe arrival…"
  },
  hu: {
    casesNav:"Esetek", aiLearningNav:"AI tanulás", adminNav:"Admin",
    futureModules:"Tervezett modulok", analytics:"Analitika", archive:"Archívum",
    integrations:"Integrációk", planned:"TERVEZETT",
    noActiveShift:"Nincs aktív műszak", oneShiftOnly:"Egyszerre csak egy aktív műszak lehet.",
    startShift:"MŰSZAK INDÍTÁSA", importCase:"Új eset felvétele",
    autoId:"Az esetazonosító minden műszakban 01-től indul.", sex:"Nem", age:"Életkor", status:"Státusz", yob:"Születési év",
    mainComplaint:"Fő panasz", addCase:"ESET HOZZÁADÁSA", caseRecord:"Esetlista",
    caseStatusHint:"A státusz az eset még rendezetlen tételeit mutatja.",
    selectCasePrompt:"Válasszon egy esetet a listából.", noCaseSelected:"Nincs kiválasztott eset.",
    reopenCase:"ESET ÚJRANYITÁSA", sectionClinical:"1. Klinikum", complaint:"Jelen panaszok",
    patientHistory:"Anamnézis", markNone:"NINCS", required:"KÖTELEZŐ", complete:"KÉSZ", none:"NINCS",
    sectionTests:"2. Fizikális státusz és vizsgálatok",
    testLegend:"Narancs = rendezetlen. Eredmény megadásakor zöldre vált; ha nem történt vizsgálat, jelölje „Nem történt” állapotra.",
    physicalExam:"Fizikális vizsgálat — lényeges eltérések / státusz",
    lab:"Labor", addLab:"+ LABOR HOZZÁADÁSA", ekg:"EKG", bloodGas:"Vérgáz (AVG / VVG)",
    radiology:"Képalkotó vizsgálatok", addRadiology:"+ KÉPALKOTÓ HOZZÁADÁSA",
    consultations:"Konzíliumok", addConsultation:"+ KONZÍLIUM HOZZÁADÁSA", others:"Egyéb",
    sectionCourse:"3. Terápia és kórlefolyás", therapy:"Terápia",
    clinicalCourse:"Kórlefolyás / állapotváltozás",
    diagnoses:"Diagnózisok", diagnosesPrompt:"Panaszok hátterében mi állhat?", disposition:"Diszpozíció",
    finalDecision:"4. Döntés",
    finalDecisionInfo:"A diszpozíció a végső ellátási döntést rögzíti. Az eset csak az összefoglaló véglegesítésekor zárul le.",
    homePlan:"Otthoni javaslat és további terv", addRecommendation:"+ Javaslat hozzáadása",
    hospital:"Kórház", ward:"Osztály / részleg", acceptingPhysician:"Átvevő orvos",
    additionalNote:"Kiegészítő megjegyzés", outcome:"Kimenetel", details:"Részletek",
    caseSummary:"5. Összefoglaló",
    summaryInfo:"Az összefoglaló a deidentifikált esetadatokból és az aktív SBO Documentation Skill alapján készül. Véglegesítés előtt ellenőrizze és szükség szerint szerkessze.",
    generateSummary:"ÖSSZEFOGLALÓ GENERÁLÁSA", summaryEditable:"Összefoglaló — szerkeszthető",
    finalizeSummary:"ÖSSZEFOGLALÓ VÉGLEGESÍTÉSE", saveCase:"ESET MENTÉSE", autosaveHint:"Automatikus mentés aktív",
    diagnosesNote:"Csak az orvos által rögzített diagnózisok. Az összefoglaló nem állíthat fel új diagnózist a vizsgálati eredményekből.",
    learningDesc:"Orvos által jóváhagyott tanulás a véglegesített összefoglalókból. A rendszer nem módosítja automatikusan a fő Skill-t.",
    finalizedCorpusReview:"Véglegesített korpusz ellenőrzése",
    corpusReviewDesc:"A véglegesített revíziók jóváhagyhatók vagy kizárhatók a jövőbeli AI-tanulásból. Ez nem módosítja a klinikai dokumentációt vagy a véglegesített szöveget.",
    loading:"Betöltés…",
    refresh:"FRISSÍTÉS", finalizedCorpus:"Véglegesített korpusz", activeSkill:"Aktív Skill", activeStyle:"Aktív stílus",
    writingStyle:"Írási stílus", styleDesc:"Generált → véglegesített párok. A jelölt csak külön jóváhagyással aktiválható.",
    generateCandidate:"JELÖLT GENERÁLÁSA", skillSuggestions:"Skill-fejlesztési javaslatok",
    skillSuggestionsDesc:"Csak javaslat. Az elfogadás nem módosítja automatikusan a Skill-verziókat.",
    analyzeEdits:"SZERKESZTÉSEK ELEMZÉSE", adminDesc:"Egyszemélyes fiók biztonsági beállításai.",
    account:"Fiók", accountDesc:"Az alkalmazást csak a beállított tulajdonosi fiók használhatja.",
    changePassword:"Jelszó módosítása", passwordRule:"Legalább 6 karakter. Az alkalmazás nem ír elő további összetettségi szabályt.",
    currentPassword:"Jelenlegi jelszó", newPassword:"Új jelszó", confirmPassword:"Új jelszó megerősítése",
    changePasswordButton:"JELSZÓ MÓDOSÍTÁSA", signOut:"KIJELENTKEZÉS",
    phMainComplaint:"Mellkasi fájdalom", phManualPaste:"Kézi bevitel vagy szöveg beillesztése…",
    phDiagnoses:"Diagnózisonként egy sor, vagy pontosvesszővel elválasztva. Magyar vagy latin terminológia.",
    phDischargeCondition:"Pl. panaszmentes, jó általános állapotú; mellkasi fájdalma nem jelentkezett…",
    phOtherOutcome:"Halál, áthelyezés, saját felelősségre távozás…",
    phSummary:"A generált összefoglaló itt jelenik meg. Véglegesítés előtt szerkeszthető.",
    phArrivalOther:"Az érkezés módjának részletei…"
  }
};

function t(key) {
  return I18N[uiLang]?.[key] || I18N.en[key] || key;
}

function applyLanguage(lang) {
  uiLang = I18N[lang] ? lang : "hu";
  document.documentElement.lang = uiLang === "hu" ? "hu" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const value = I18N[uiLang][el.dataset.i18n];
    if (value) el.textContent = value;
  });
  const disposition = document.getElementById("fDisposition");
  if (disposition) {
    const labels = uiLang === "hu"
      ? ["Aktív / folyamatban", "Otthonába bocsátva", "Osztályos felvétel / áthelyezés", "Egyéb"]
      : ["Active / in progress", "Discharged", "Admitted / transferred", "Other"];
    [...disposition.options].forEach((option, i) => {
      if (labels[i]) option.textContent = labels[i];
    });
  }
  document.getElementById("langEnBtn")?.classList.toggle("active", uiLang === "en");
  document.getElementById("langHuBtn")?.classList.toggle("active", uiLang === "hu");

  const placeholders = {
    newComplaint: "phMainComplaint",
    fComplaint: "phManualPaste",
    fHistory: "phManualPaste",
    fDiagnoses: "phDiagnoses",
    fDischargeCondition: "phDischargeCondition",
    fOtherOutcome: "phOtherOutcome",
    fSummary: "phSummary",
    iceArrivalOther: "phArrivalOther"
  };
  Object.entries(placeholders).forEach(([id, key]) => {
    const node = document.getElementById(id);
    if (node) node.placeholder = t(key);
  });
}

function defaultState() {
  return { shift: null, patients: [], references: [] };
}

function persist() {
  // Privacy-aware backend writes are intentionally explicit rather than
  // running on every keystroke. This only marks the in-memory state dirty.
  stateDirty = true;
}

function touchPatient(patient) {
  if (!patient) return null;
  patient.updatedAt = nowIso();
  persist();
  return patient;
}

function reconcileEntryArray(liveEntries, savedEntries) {
  const live = Array.isArray(liveEntries) ? liveEntries : [];
  const saved = Array.isArray(savedEntries) ? savedEntries : [];
  const byId = new Map(live.filter(Boolean).map((entry) => [entry.id, entry]));
  const next = saved.map((savedEntry) => {
    const existing = byId.get(savedEntry?.id);
    if (existing) {
      Object.assign(existing, savedEntry);
      return existing;
    }
    return structuredClone(savedEntry);
  });
  live.splice(0, live.length, ...next);
  return live;
}

function mergeSavedPatientIntoLive(livePatient, savedPatient) {
  if (!livePatient || !savedPatient) return livePatient;

  const savedTests = savedPatient.tests || {};
  const liveTests = livePatient.tests || (livePatient.tests = {});

  Object.entries(savedPatient).forEach(([key, value]) => {
    if (key !== "tests") livePatient[key] = value;
  });

  for (const group of ["labs", "ekgs", "gases", "radiology", "consultations"]) {
    liveTests[group] = reconcileEntryArray(liveTests[group], savedTests[group]);
  }

  return livePatient;
}

async function persistNow({
  reloadForm = true,
  silentAutosave = false,
  allowIncompleteWorkflow = false
} = {}) {
  if (!backendReady || !state.shift) return { removed: 0, report: null };

  const livePatient = patientById(selectedPatientId);
  if (!livePatient) {
    stateDirty = false;
    return { removed: 0, report: null };
  }

  const caseId = livePatient.id;
  const shiftId = state.shift.id;
  const snapshot = structuredClone(livePatient);
  const snapshotUpdatedAt = snapshot.updatedAt || "";

  if (!silentAutosave && !allowIncompleteWorkflow) {
    const validationError = persistenceValidationError(snapshot);
    if (validationError) throw validationError;
  }

  const previous = patientSaveQueues.get(caseId) || Promise.resolve();
  const queued = previous
    .catch(() => {})
    .then(async () => {
      const result = await window.BachSBOBackend.savePatient(
        shiftId,
        snapshot
      );

      const current = patientById(caseId);
      const currentIsSameDraft =
        current &&
        String(current.updatedAt || "") === String(snapshotUpdatedAt);

      // Never let an older save response overwrite a newer in-browser draft.
      if (result?.patient?.id === caseId && currentIsSameDraft) {
        // Preserve live object/array identity so already-wired DOM handlers keep
        // mutating the canonical test entries after autosave responses arrive.
        mergeSavedPatientIntoLive(current, result.patient);
        stateDirty = false;

        if (
          reloadForm &&
          currentView === "patients" &&
          selectedPatientId === caseId
        ) {
          loadPatientForm();
        }
      } else if (currentIsSameDraft) {
        stateDirty = false;
      }

      if (result?.removed > 0 && !silentAutosave) {
        flash(
          uiLang === "hu"
            ? `Az adatvédelmi szűrő ${result.removed} azonosítót eltávolított.`
            : `Privacy filter removed ${result.removed} identifier(s).`
        );
      }

      return result;
    });

  patientSaveQueues.set(caseId, queued);
  try {
    return await queued;
  } finally {
    if (patientSaveQueues.get(caseId) === queued) {
      patientSaveQueues.delete(caseId);
    }
  }
}

function handleBackendError(error) {
  console.error(error);
  flash(
    (uiLang === "hu" ? "Backend hiba: " : "Backend error: ") +
    (error?.message || (uiLang === "hu" ? "Ismeretlen hiba" : "Unknown error"))
  );
}

function nowIso() {
  return new Date().toISOString();
}

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

function normalizeYob(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const digits = raw.replace(/[^0-9]/g, "");
  const currentYear = new Date().getFullYear();

  let year = null;
  if (/^\d{4}$/.test(digits)) {
    year = Number(digits);
  } else if (/^\d{2}$/.test(digits)) {
    const shortYear = Number(digits);
    const current2 = currentYear % 100;
    year = shortYear <= current2 ? 2000 + shortYear : 1900 + shortYear;
  }

  if (!Number.isInteger(year) || year < 1900 || year > currentYear) return "";
  return String(year);
}

function ageFromYob(yob) {
  const normalized = normalizeYob(yob);
  if (!normalized) return "";
  return new Date().getFullYear() - Number(normalized);
}

function normalizeSex(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["m", "male", "man", "férfi", "ferfi", "férfibeteg"].includes(raw)) return "M";
  if (["f", "female", "woman", "nő", "no", "nőbeteg", "w"].includes(raw)) return "F";
  if (["o", "other", "egyéb", "egyeb", "x", "nonbinary", "non-binary"].includes(raw)) return "O";
  return "";
}

function normalizeArrivalMode(value) {
  const normalized = String(value ?? "").trim();
  return ["omsz", "esetkocsi", "walk_in", "gp_referral", "other"].includes(normalized)
    ? normalized
    : "";
}

function patientSexLabel(sex) {
  const value = normalizeSex(sex);
  if (value === "F") return uiLang === "hu" ? "Nő" : "Female";
  if (value === "M") return uiLang === "hu" ? "Férfi" : "Male";
  if (value === "O") return uiLang === "hu" ? "Egyéb" : "Other";
  return value || "—";
}

function paintRecordHeaderSex(sex) {
  const header = document.getElementById("recordHeader");
  if (!header) return;

  header.classList.remove("sex-female", "sex-male", "sex-other");
  const value = String(sex || "").trim().toUpperCase();
  if (value === "F") header.classList.add("sex-female");
  else if (value === "M") header.classList.add("sex-male");
  else if (value === "O") header.classList.add("sex-other");
}

function activeShiftPatients() {
  return state.shift ? state.patients.filter((p) => p.shiftId === state.shift.id) : [];
}

function nextPatientId() {
  const counter = Number(state.shift?.nextCaseNumber);
  if (Number.isInteger(counter) && counter > 0) {
    return String(counter).padStart(2, "0");
  }

  // Backward-compatible fallback for old state snapshots that predate
  // the DB-backed per-shift counter.
  const maxId = activeShiftPatients().reduce((max, patient) => {
    const value = Number.parseInt(String(patient.localId || ""), 10);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);

  return String(maxId + 1).padStart(2, "0");
}

async function refreshShiftCaseCounter({ force = false } = {}) {
  if (!backendReady || !state.shift) return null;
  const getter = window.BachSBOBackend?.getShiftCaseCounter;
  if (typeof getter !== "function") return null;

  const now = Date.now();
  if (!force && now - caseCounterLastCheckedAt < 2500) return null;
  if (caseCounterRefreshPromise) return caseCounterRefreshPromise;

  const shiftId = state.shift.id;
  caseCounterRefreshPromise = (async () => {
    try {
      const live = await getter(shiftId);
      if (!state.shift || state.shift.id !== shiftId) return null;

      const nextCaseNumber = Number(live?.nextCaseNumber);
      if (!Number.isInteger(nextCaseNumber) || nextCaseNumber < 1) return null;

      state.shift.nextCaseNumber = nextCaseNumber;
      const preview = document.getElementById("newId");
      if (preview) preview.value = String(nextCaseNumber).padStart(2, "0");
      caseCounterLastCheckedAt = Date.now();
      return nextCaseNumber;
    } catch (error) {
      console.warn("Case counter refresh failed", error);
      return null;
    } finally {
      caseCounterRefreshPromise = null;
    }
  })();

  return caseCounterRefreshPromise;
}

function patientById(id) {
  return state.patients.find((p) => p.id === id);
}

function getPatientSnapshot(caseId = selectedPatientId) {
  const patient = patientById(caseId);
  return patient ? structuredClone(patient) : null;
}

function isCompleted(patient) {
  return Boolean(patient.summaryFinalizedAt);
}

function newEntry(type = "") {
  return {
    id: crypto.randomUUID(),
    type,
    mode: "waiting",
    text: "",
    savedText: ""
  };
}

function radiologyEntry() {
  return {
    ...newEntry(""),
    bodyPart: "",
    modality: "",
    otherTest: ""
  };
}

function normalizeRadiologyEntry(entry) {
  if (!entry) return radiologyEntry();
  if (entry.bodyPart === undefined) entry.bodyPart = "";
  if (entry.modality === undefined) entry.modality = "";
  if (entry.otherTest === undefined) entry.otherTest = "";

  const genericRadiologyLabels = new Set(["radiology", "radiológia"]);
  const legacyType = String(entry.type || "").trim();
  const legacyTypeIsGeneric = genericRadiologyLabels.has(legacyType.toLowerCase());

  const legacyModality = String(entry.modality || "").trim().toLowerCase();
  if (["ultrahang", "uh", "ultrasound"].includes(legacyModality)) {
    entry.modality = "US";
  }
  if (["ct", "native ct", "natív ct"].includes(legacyModality)) {
    entry.modality = "Native CT";
  }
  if (["kontrasztos ct", "contrast ct", "ct contrast"].includes(legacyModality)) {
    entry.modality = "Contrast CT";
  }

  // Older autosaves could persist the display fallback "Radiology" as if it
  // were a user-entered custom modality. Repair that state instead of showing
  // a phantom "Other / Radiology" input on the next render.
  const otherIsGeneric = genericRadiologyLabels.has(
    String(entry.otherTest || "").trim().toLowerCase()
  );
  if (
    !String(entry.bodyPart || "").trim() &&
    String(entry.modality || "").trim().toLowerCase() === "other" &&
    otherIsGeneric
  ) {
    entry.modality = "";
    entry.otherTest = "";
    entry.type = "";
  }

  if (!entry.bodyPart && !entry.modality && !entry.otherTest && legacyType && !legacyTypeIsGeneric) {
    entry.modality = "other";
    entry.otherTest = legacyType;
  } else if (!entry.bodyPart && !entry.modality && !entry.otherTest && legacyTypeIsGeneric) {
    entry.type = "";
  }
  return entry;
}

function radiologyType(entry) {
  normalizeRadiologyEntry(entry);
  const body = (entry.bodyPart || "").trim();
  const modality = (entry.modality || "").trim();
  const other = (entry.otherTest || "").trim();
  if (modality === "other") return [body, other].filter(Boolean).join(" — ") || "Radiology";
  return [body, modality].filter(Boolean).join(" ").trim() || "Radiology";
}

function entryStatus(entry) {
  if (entry.mode === "notordered") return "notordered";
  if ((entry.text || "").trim()) return "result";
  return "waiting";
}

const NARRATIVE_FIELDS = {
  complaint: {
    inputId: "fComplaint",
    valueProp: "complaint",
    skipProp: "complaintSkipped",
    labelKey: "complaint"
  },
  history: {
    inputId: "fHistory",
    valueProp: "history",
    skipProp: "historySkipped",
    labelKey: "patientHistory"
  },
  physical: {
    inputId: "fPhysical",
    valueProp: "physical",
    skipProp: "physicalSkipped",
    labelKey: "physicalExam"
  },
  therapy: {
    inputId: "fTherapy",
    valueProp: "therapy",
    skipProp: "therapySkipped",
    labelKey: "therapy"
  },
  course: {
    inputId: "fCourse",
    valueProp: "course",
    skipProp: "courseSkipped",
    labelKey: "clinicalCourse"
  },
  diagnoses: {
    inputId: "fDiagnoses",
    valueProp: "diagnoses",
    skipProp: "diagnosesSkipped",
    labelKey: "diagnoses"
  }
};

function narrativeStatus(patient, key) {
  const config = NARRATIVE_FIELDS[key];
  if (!config || !patient) return "waiting";
  if (patient[config.skipProp]) return "none";
  if (String(patient[config.valueProp] || "").trim()) return "result";
  return "waiting";
}

function narrativeWaitingLabels(patient) {
  return Object.entries(NARRATIVE_FIELDS)
    .filter(([key]) => narrativeStatus(patient, key) === "waiting")
    .map(([, config]) => t(config.labelKey));
}

function dischargeConditionWaitingLabels(patient) {
  if (
    patient?.disposition === "discharged" &&
    !String(patient.dischargeCondition || "").trim()
  ) {
    return [
      uiLang === "hu"
        ? "Milyen állapotban, panasz?"
        : "Condition / symptoms at discharge"
    ];
  }
  return [];
}

function workflowBlockers(patient) {
  return [
    ...narrativeWaitingLabels(patient),
    ...waitingLabels(patient),
    ...dischargeConditionWaitingLabels(patient)
  ];
}

function persistenceValidationError(patient) {
  if (
    patient?.disposition === "discharged" &&
    !String(patient.dischargeCondition || "").trim()
  ) {
    return new Error(
      uiLang === "hu"
        ? "Otthonába bocsátás esetén kötelező: Milyen állapotban, panasz?"
        : "Discharge condition / symptoms is required."
    );
  }
  return null;
}

function refreshNarrativeField(patient, key) {
  const config = NARRATIVE_FIELDS[key];
  if (!config || !patient) return;

  const wrapper = document.querySelector(`[data-narrative-field="${key}"]`);
  const input = document.getElementById(config.inputId);
  const stateEl = document.querySelector(`[data-field-state="${key}"]`);
  const noneButton = document.querySelector(`[data-none-toggle="${key}"]`);
  if (!wrapper || !input || !stateEl || !noneButton) return;

  const status = narrativeStatus(patient, key);
  wrapper.classList.remove("waiting", "result", "none");
  wrapper.classList.add(status);

  stateEl.className = `field-state ${status}`;
  stateEl.textContent = status === "result"
    ? t("complete")
    : status === "none"
    ? t("none")
    : t("required");

  noneButton.classList.toggle("active", status === "none");
  input.disabled = status === "none" || isCompleted(patient);
  noneButton.disabled = isCompleted(patient);
}

function refreshNarrativeFields(patient) {
  Object.keys(NARRATIVE_FIELDS).forEach((key) => refreshNarrativeField(patient, key));
}

function wireNarrativeFields(patient) {
  Object.entries(NARRATIVE_FIELDS).forEach(([key, config]) => {
    const input = document.getElementById(config.inputId);
    const noneButton = document.querySelector(`[data-none-toggle="${key}"]`);
    if (!input || !noneButton) return;

    input.oninput = () => {
      patient[config.valueProp] = input.value;
      if (input.value.trim()) patient[config.skipProp] = false;
      persist();
      refreshNarrativeField(patient, key);
      updateStatusCell(patient);
      refreshSummaryControls(patient);
    };

    noneButton.onclick = () => {
      if (isCompleted(patient)) return;

      const turningOn = !patient[config.skipProp];
      if (turningOn && String(patient[config.valueProp] || "").trim()) {
        flash(uiLang === "hu"
          ? "A NINCS állapot előtt törölje a mező tartalmát."
          : "Clear the field before marking it None.");
        return;
      }

      patient[config.skipProp] = turningOn;
      if (turningOn) {
        patient[config.valueProp] = "";
        input.value = "";
      }
      persist();
      refreshNarrativeField(patient, key);
      updateStatusCell(patient);
      refreshSummaryControls(patient);
    };
  });
}

function patientTestEntries(patient) {
  if (!patient?.tests) return [];
  return [
    ...(patient.tests.labs || []),
    ...(patient.tests.ekgs || []),
    ...(patient.tests.gases || []),
    ...(patient.tests.radiology || []),
    ...(patient.tests.consultations || [])
  ].filter(Boolean);
}

function commitFilledTestResults(patient) {
  let changed = false;
  patientTestEntries(patient).forEach((entry) => {
    if (
      entry.mode !== "notordered" &&
      (entry.text || "").trim() &&
      entry.savedText !== entry.text
    ) {
      entry.savedText = entry.text;
      changed = true;
    }
  });
  if (changed) touchPatient(patient);
}

function cockpitInvestigationItems(patient) {
  const tests = patient?.tests || {};
  const radiologyName = (entry, index) => {
    const body = String(entry?.bodyPart || "").trim();
    const modality = String(entry?.modality || "").trim();
    const other = String(entry?.otherTest || "").trim();
    const detail = modality === "other"
      ? [body, other].filter(Boolean).join(" — ")
      : [body, modality].filter(Boolean).join(" ");
    const base = uiLang === "hu" ? "Radiológia" : "Radiology";
    return detail ? `${base} · ${detail}` : `${base} ${index + 1}`;
  };

  const consultationName = (entry, index) => {
    const specialty = String(entry?.type || "").trim();
    const base = uiLang === "hu" ? "Konzílium" : "Consultation";
    return specialty ? `${base} · ${specialty}` : `${base} ${index + 1}`;
  };

  return [
    ...(tests.labs || []).map((entry, index) => ({
      name: `Lab ${index + 1}`,
      status: entryStatus(entry)
    })),
    ...(tests.ekgs || []).map((entry, index) => ({
      name: `EKG ${index + 1}`,
      status: entryStatus(entry)
    })),
    ...(tests.gases || []).map((entry, index) => ({
      name: `${/\bVVG\b/i.test(String(entry?.text || "")) ? "VVG" : "AVG"} ${index + 1}`,
      status: entryStatus(entry)
    })),
    ...(tests.radiology || []).map((entry, index) => ({
      name: radiologyName(entry, index),
      status: entryStatus(entry)
    })),
    ...(tests.consultations || []).map((entry, index) => ({
      name: consultationName(entry, index),
      status: entryStatus(entry)
    }))
  ];
}

function patientProgress(patient) {
  if (!patient) return null;

  const clinicalDefinitions = [
    ["complaint", "complaintSkipped", uiLang === "hu" ? "Panasz" : "Complaint"],
    ["history", "historySkipped", uiLang === "hu" ? "Anamnézis" : "History"],
    ["physical", "physicalSkipped", uiLang === "hu" ? "Fizikális vizsgálat" : "Physical examination"],
    ["therapy", "therapySkipped", uiLang === "hu" ? "Terápia" : "Therapy"],
    ["course", "courseSkipped", uiLang === "hu" ? "Klinikai lefolyás" : "Clinical course"]
  ];
  const clinical = clinicalDefinitions.map(([valueKey, skippedKey, name]) => ({
    name,
    complete: Boolean(patient[skippedKey] || String(patient[valueKey] || "").trim())
  }));
  const tests = cockpitInvestigationItems(patient);

  return {
    clinical,
    tests,
    completeClinical: clinical.filter((item) => item.complete),
    incompleteClinical: clinical.filter((item) => !item.complete),
    completeTests: tests.filter((item) => item.status !== "waiting"),
    waitingTests: tests.filter((item) => item.status === "waiting")
  };
}

function getPatientProgress(caseId = selectedPatientId) {
  const progress = patientProgress(patientById(caseId));
  return progress ? structuredClone(progress) : null;
}

function refreshSummaryControls(patient) {
  const generate = document.getElementById("generateSummaryBtn");
  const finalize = document.getElementById("finalizeSummaryBtn");
  const gate = document.getElementById("summaryGate");
  if (!generate || !finalize || !gate || !patient) return;

  const blockers = workflowBlockers(patient);
  const blocked = blockers.length > 0;
  const completed = isCompleted(patient);
  const message = completed
    ? (uiLang === "hu"
      ? "Az eset lezárt. Az összefoglaló véglegesítve."
      : "Case closed. Summary finalized.")
    : blocked
    ? (uiLang === "hu"
      ? `Az összefoglaló nem készíthető el. Rendezendő: ${blockers.join(", ")}. Töltse ki a mezőt, vagy jelölje NINCS / NEM TÖRTÉNT állapotra.`
      : `Summary locked. Resolve: ${blockers.join(", ")}. Fill the field, or mark it None / Not ordered.`)
    : (uiLang === "hu"
      ? "Minden kötelező mező és vizsgálat rendezett. Az összefoglaló elkészíthető."
      : "All required fields and tests are resolved. Summary can be generated.");

  gate.textContent = message;
  gate.className = `summary-gate ${completed || !blocked ? "ready" : "blocked"}`;

  if (generate.dataset.busy !== "true") {
    generate.disabled = blocked || completed;
  }
  if (finalize.dataset.busy !== "true") {
    finalize.disabled = blocked || completed;
  }

  const title = blocked ? message : "";
  generate.title = title;
  finalize.title = title;
}

function waitingLabels(patient) {
  const out = [];

  patient.tests.labs.forEach((entry, i) => {
    if (entryStatus(entry) === "waiting") out.push(`Lab ${i + 1}`);
  });

  (patient.tests.ekgs || []).forEach((entry, i) => {
    if (entryStatus(entry) === "waiting") out.push(`EKG ${i + 1}`);
  });

  (patient.tests.gases || []).forEach((entry, i) => {
    if (entryStatus(entry) === "waiting") {
      const base = /\bVVG\b/i.test(entry.text || "") ? "VVG" : "AVG";
      out.push(`${base} ${i + 1}`);
    }
  });

  patient.tests.radiology.forEach((entry, i) => {
    if (entryStatus(entry) === "waiting") {
      out.push(radiologyType(entry) || `${t("radiology")} ${i + 1}`);
    }
  });

  patient.tests.consultations.forEach((entry, i) => {
    if (entryStatus(entry) === "waiting") {
      out.push(entry.type?.trim() || `${uiLang === "hu" ? "Konzílium" : "Consultation"} ${i + 1}`);
    }
  });

  return out;
}

function renderHeader() {
  const meta = document.getElementById("shiftMeta");
  const actions = document.getElementById("topActions");
  meta.innerHTML = "";
  actions.innerHTML = "";

  const hu = uiLang === "hu";
  if (!state.shift) {
    meta.innerHTML = `<span class="metric">${hu ? "Nincs aktív műszak" : "No active shift"}</span>`;
    actions.innerHTML = `<button class="btn" id="signOutBtn">${hu ? "KIJELENTKEZÉS" : "SIGN OUT"}</button>`;
    document.getElementById("signOutBtn").onclick = signOut;
    return;
  }

  const pts = activeShiftPatients();
  const completed = pts.filter(isCompleted).length;
  const active = pts.length - completed;

  meta.innerHTML = `
    <span class="shift-pill"><span class="dot"></span> ${hu ? "AKTÍV MŰSZAK" : "SHIFT ACTIVE"} • ${hu ? "Kezdés" : "Started"} ${fmtTime(state.shift.startedAt)}</span>
    <span class="metric">${hu ? "Esetek" : "Cases"} <b>${pts.length}</b></span>
    <span class="metric">${hu ? "Aktív" : "Active"} <b>${active}</b></span>
    <span class="metric">${hu ? "Lezárt" : "Completed"} <b>${completed}</b></span>
  `;

  actions.innerHTML =
    `<button class="btn danger" id="endShiftBtn">${hu ? "MŰSZAK LEZÁRÁSA" : "END SHIFT"}</button>` +
    `<button class="btn" id="signOutBtn">${hu ? "KIJELENTKEZÉS" : "SIGN OUT"}</button>`;
  document.getElementById("endShiftBtn").onclick = endShiftStep1;
  document.getElementById("signOutBtn").onclick = signOut;
}

function renderApp() {
  renderHeader();

  const learning = currentView === "learning";
  const admin = currentView === "admin";
  const patients = currentView === "patients";

  document.getElementById("patientsNav").classList.toggle("active", patients);
  document.getElementById("aiLearningNav").classList.toggle("active", learning);
  document.getElementById("adminNav").classList.toggle("active", admin);

  document.getElementById("aiLearningView").classList.toggle("hidden", !learning);
  document.getElementById("adminView").classList.toggle("hidden", !admin);

  if (learning || admin) {
    document.getElementById("noShiftView").classList.add("hidden");
    document.getElementById("patientsView").classList.add("hidden");
    if (admin) renderAdminView();
    return;
  }

  document.getElementById("noShiftView").classList.toggle("hidden", Boolean(state.shift));
  document.getElementById("patientsView").classList.toggle("hidden", !state.shift);

  if (state.shift) renderPatients();
}

function setView(view) {
  currentView = view;
  renderApp();

  if (view === "patients") {
    void refreshShiftCaseCounter({ force: true });
  }

  if (view === "learning") {
    renderLearningDashboard().catch(handleBackendError);
  }
}

function renderAdminView() {
  const email = window.BACH_SBO_CONFIG?.adminEmail || currentUser?.email || "";
  document.getElementById("adminEmailDisplay").value = email;
}

async function changeAdminPassword() {
  const currentPassword = document.getElementById("currentAdminPassword").value;
  const newPassword = document.getElementById("newAdminPassword").value;
  const confirmPassword = document.getElementById("confirmAdminPassword").value;
  const button = document.getElementById("changeAdminPasswordBtn");
  const message = document.getElementById("adminPasswordMessage");

  message.textContent = "";

  if (!currentPassword) {
    message.textContent = uiLang === "hu" ? "Adja meg a jelenlegi jelszavát." : "Enter your current password.";
    return;
  }
  if (newPassword.length < 6) {
    message.textContent = uiLang === "hu" ? "Az új jelszónak legalább 6 karakterből kell állnia." : "New password must contain at least 6 characters.";
    return;
  }
  if (newPassword !== confirmPassword) {
    message.textContent = uiLang === "hu" ? "Az új jelszavak nem egyeznek." : "New passwords do not match.";
    return;
  }
  if (newPassword === currentPassword) {
    message.textContent = uiLang === "hu" ? "Az új jelszónak különböznie kell a jelenlegi jelszótól." : "New password must be different from the current password.";
    return;
  }

  button.disabled = true;
  button.textContent = uiLang === "hu" ? "MÓDOSÍTÁS…" : "CHANGING…";

  try {
    await window.BachSBOBackend.changeAdminPassword(
      currentPassword,
      newPassword
    );
    document.getElementById("currentAdminPassword").value = "";
    document.getElementById("newAdminPassword").value = "";
    document.getElementById("confirmAdminPassword").value = "";
    message.textContent = uiLang === "hu" ? "A jelszó sikeresen módosítva." : "Password changed successfully.";
  } catch (error) {
    message.textContent = error?.message || (uiLang === "hu" ? "A jelszó módosítása sikertelen." : "Could not change password.");
  } finally {
    button.disabled = false;
    button.textContent = uiLang === "hu" ? "JELSZÓ MÓDOSÍTÁSA" : "CHANGE PASSWORD";
  }
}

function patientListStatusHtml(patient) {
  const completed = isCompleted(patient);
  const blockers = workflowBlockers(patient);
  const hook = window.BachSBOUiHooks?.patientListStatusHtml;

  if (typeof hook === "function") {
    try {
      const custom = hook(patient, { completed, blockers: blockers.slice() });
      if (typeof custom === "string" && custom) return custom;
    } catch (error) {
      console.error("Patient-list UI hook failed; using stable renderer.", error);
    }
  }

  if (completed) {
    return `<span class="badge done">${uiLang === "hu" ? "LEZÁRT" : "COMPLETED"}</span>`;
  }
  if (blockers.length) {
    return `<div class="wait-stack">${blockers
      .map((x) => `<span class="wait-chip">${esc(x)}</span>`)
      .join("")}</div>`;
  }
  return `<span class="wait-none">${uiLang === "hu" ? "KÉSZ" : "READY"}</span>`;
}

function renderPatients() {
  document.getElementById("newId").value = nextPatientId();
  void refreshShiftCaseCounter();

  const tbody = document.getElementById("patientTbody");
  tbody.innerHTML = "";

  const orderedPatients = activeShiftPatients()
    .slice()
    .sort((a, b) => {
      const completionOrder = Number(isCompleted(a)) - Number(isCompleted(b));
      if (completionOrder !== 0) return completionOrder;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });

  orderedPatients.forEach((patient) => {
    const statusHtml = patientListStatusHtml(patient);

    const tr = document.createElement("tr");
    tr.dataset.id = patient.id;

    if (patient.id === selectedPatientId) tr.classList.add("selected");
    if (isCompleted(patient)) tr.classList.add("completed");

    tr.innerHTML = `
      <td>${patient.localId}</td>
      <td>${patient.sex}</td>
      <td>${ageFromYob(patient.yob)}</td>
      <td>${esc(patient.mainComplaint)}</td>
      <td data-status-cell="${patient.id}">${statusHtml}</td>
    `;

    tr.onclick = () => {
      const nextPatientId = patient.id;
      if (nextPatientId === selectedPatientId) return;

      const previousPatientId = selectedPatientId;

      // First copy every visible field/test into the old patient's in-memory
      // draft. persistNow snapshots that draft synchronously before its first
      // await, so the UI can switch immediately while the network write runs.
      if (previousPatientId) {
        const currentDraft = commitCurrentDraft();
        if (currentDraft) {
          void persistNow({ reloadForm: false, silentAutosave: true }).catch((error) => {
            console.warn("Background save during patient switch failed", error);
          });
        }
      }

      selectedPatientId = nextPatientId;
      renderPatients();
    };

    tbody.appendChild(tr);
  });

  if (selectedPatientId) {
    loadPatientForm();
  } else {
    document.getElementById("patientForm").classList.add("hidden");
    document.getElementById("noPatientSelected").classList.remove("hidden");
    document.getElementById("recordTitle").textContent = uiLang === "hu" ? "Eset részletei" : "Case detail";
    document.getElementById("recordSubtitle").textContent = t("selectCasePrompt");
    document.getElementById("patientStatusBadge").innerHTML = "";
    paintRecordHeaderSex("");
  }
}

function syncPatientRowFromState(patient) {
  if (!patient) return;
  const row = document.querySelector(`#patientTbody tr[data-id="${patient.id}"]`);
  if (!row) return;
  const cells = row.querySelectorAll(":scope > td");
  if (cells[0]) cells[0].textContent = patient.localId || "";
  if (cells[1]) cells[1].textContent = patient.sex || "";
  if (cells[2]) cells[2].textContent = ageFromYob(patient.yob);
  if (cells[3]) cells[3].textContent = patient.mainComplaint || "";
  if (cells[4]) cells[4].innerHTML = patientListStatusHtml(patient);
}

function caseMetadataFromPatient(patient) {
  if (!patient) return null;
  const sex = normalizeSex(patient.sex);
  const yob = normalizeYob(patient.yob);
  const arrivalMode = normalizeArrivalMode(patient.arrivalMode);
  return {
    id: patient.id,
    sex: sex || null,
    year_of_birth: yob ? Number(yob) : null,
    main_complaint: patient.mainComplaint || "",
    arrival_mode: arrivalMode,
    arrival_other: arrivalMode === "other" ? patient.arrivalOther || "" : "",
    disposition: patient.disposition || "",
    discharge_condition: patient.dischargeCondition || "",
    other_details: patient.otherDetails || ""
  };
}

function getCaseMetadata(caseId = selectedPatientId) {
  return caseMetadataFromPatient(patientById(caseId));
}

async function saveCaseMetadata(caseId, metadata = {}) {
  const patient = patientById(caseId);
  if (!patient) throw new Error("Selected case was not found.");

  const result = await window.BachSBOBackend.updateCaseMetadata(caseId, metadata);
  const authoritative = result?.metadata || {};
  applyCaseMetadata(caseId, authoritative);

  if (selectedPatientId === caseId) {
    const age = ageFromYob(patient.yob);
    const subtitle = document.getElementById("recordSubtitle");
    if (subtitle) {
      subtitle.textContent = `${patient.sex || "—"} • ${age || "—"} y • ${patient.mainComplaint || ""}`;
    }
  }

  return result;
}

function applyCaseMetadata(caseId, metadata = {}) {
  const patient = patientById(caseId);
  if (!patient) return null;

  if (Object.prototype.hasOwnProperty.call(metadata, "sex")) {
    patient.sex = normalizeSex(metadata.sex);
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "year_of_birth")) {
    patient.yob = normalizeYob(metadata.year_of_birth);
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "main_complaint")) {
    patient.mainComplaint = metadata.main_complaint || "";
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "arrival_mode")) {
    patient.arrivalMode = normalizeArrivalMode(metadata.arrival_mode);
    if (patient.arrivalMode !== "other") patient.arrivalOther = "";
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "arrival_other")) {
    patient.arrivalOther = patient.arrivalMode === "other" ? metadata.arrival_other || "" : "";
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "disposition")) {
    patient.disposition = metadata.disposition || "";
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "discharge_condition")) {
    patient.dischargeCondition = metadata.discharge_condition || "";
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "other_details")) {
    patient.otherDetails = metadata.other_details || "";
  }
  patient.updatedAt = nowIso();
  syncPatientRowFromState(patient);
  return structuredClone(patient);
}

function updateStatusCell(patient) {
  if (!patient) return;
  const cell = document.querySelector(`[data-status-cell="${patient.id}"]`);
  if (!cell) return;

  cell.innerHTML = patientListStatusHtml(patient);
}

async function addPatient() {
  if (!state.shift) return;

  const sex = normalizeSex(document.getElementById("newSex").value);
  const yob = normalizeYob(document.getElementById("newYob").value);
  const mainComplaint = document.getElementById("newComplaint").value.trim();

  if (!sex || !yob || !mainComplaint) {
    alert(uiLang === "hu"
      ? "Adja meg a nemet, a születési évet és a fő panaszt."
      : "Please enter Sex, Year of birth and Main complaint.");
    return;
  }

  const currentYear = new Date().getFullYear();
  if (!/^\d{4}$/.test(yob) || Number(yob) < 1900 || Number(yob) > currentYear) {
    alert(uiLang === "hu"
      ? "A születési év 4 számjegyű legyen, vagy használható 2 számjegyű rövidítés, pl. 55 = 1955."
      : "Year of birth must be 4 digits or a 2-digit shorthand, e.g. 55 = 1955.");
    return;
  }
  document.getElementById("newYob").value = yob;

  let allocation;
  try {
    allocation = await window.BachSBOBackend.allocateCaseLocalId(state.shift.id);
  } catch (error) {
    handleBackendError(error);
    return;
  }

  const allocatedLocalId = String(allocation?.localId || "").trim();
  const allocatedCaseNumber = Number(allocation?.caseNumber);
  if (!allocatedLocalId || !Number.isInteger(allocatedCaseNumber) || allocatedCaseNumber < 1) {
    handleBackendError(new Error("Invalid case ID allocation response."));
    return;
  }

  state.shift.nextCaseNumber = Number(allocation.nextCaseNumber || allocatedCaseNumber + 1);

  const patient = {
    id: crypto.randomUUID(),
    shiftId: state.shift.id,
    localId: allocatedLocalId,
    sex,
    yob,
    mainComplaint,
    arrivalMode: "",
    arrivalOther: "",
    complaint: "",
    complaintSkipped: false,
    history: "",
    historySkipped: false,
    physical: "",
    physicalSkipped: false,
    tests: {
      labs: [newEntry()],
      ekgs: [newEntry()],
      gases: [newEntry()],
      radiology: [radiologyEntry()],
      consultations: [newEntry("")]
    },
    others: "",
    therapy: "",
    therapySkipped: false,
    course: "",
    courseSkipped: false,
    diagnoses: "",
    diagnosesSkipped: false,
    disposition: "",
    dischargeCondition: "",
    recommendations: ["", "", "", "", ""],
    hospital: "",
    ward: "",
    physician: "",
    admissionNote: "",
    otherOutcome: "",
    otherDetails: "",
    summary: "",
    summaryGeneratedText: "",
    summaryGeneratedAt: null,
    summaryFinalizedText: "",
    summaryFinalizedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  state.patients.push(patient);
  persist();

  selectedPatientId = patient.id;

  document.getElementById("newSex").value = "";
  document.getElementById("newYob").value = "";
  document.getElementById("newComplaint").value = "";

  try {
    await persistNow();
  } catch (error) {
    handleBackendError(error);
  }

  renderApp();
}

function loadPatientForm() {
  const patient = patientById(selectedPatientId);
  if (!patient) return;

  document.getElementById("patientForm").classList.remove("hidden");
  document.getElementById("noPatientSelected").classList.add("hidden");

  document.getElementById("recordTitle").textContent =
    `${uiLang === "hu" ? "Eset" : "Case"} ${patient.localId}`;
  document.getElementById("recordSubtitle").textContent =
    `${patientSexLabel(patient.sex)} • ${ageFromYob(patient.yob)} ${uiLang === "hu" ? "év" : "y"} • ${patient.mainComplaint}`;
  paintRecordHeaderSex(patient.sex);

  const statusLabel = isCompleted(patient)
    ? (uiLang === "hu" ? "LEZÁRT" : "COMPLETED / CLOSED")
    : (uiLang === "hu" ? "AKTÍV / FOLYAMATBAN" : "ACTIVE / IN PROGRESS");
  document.getElementById("patientStatusBadge").innerHTML =
    `<span class="badge ${isCompleted(patient) ? "done" : "active"}">${statusLabel}</span>`;

  const values = {
    iceSex: patient.sex,
    iceYob: patient.yob,
    iceAge: ageFromYob(patient.yob),
    iceArrival: patient.arrivalMode,
    iceArrivalOther: patient.arrivalOther,
    fMainComplaint: patient.mainComplaint,
    fComplaint: patient.complaint,
    fHistory: patient.history,
    fPhysical: patient.physical,
    fOthers: patient.others,
    fTherapy: patient.therapy,
    fCourse: patient.course,
    fDiagnoses: patient.diagnoses || "",
    fDisposition: patient.disposition,
    fDischargeCondition: patient.dischargeCondition || "",
    fHospital: patient.hospital,
    fWard: patient.ward,
    fPhysician: patient.physician,
    fAdmissionNote: patient.admissionNote,
    fOtherOutcome: patient.otherOutcome,
    fOtherDetails: patient.otherDetails,
    fSummary: patient.summary
  };

  Object.entries(values).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value || "";
  });
  document.getElementById("iceArrivalOtherWrap")?.classList.toggle(
    "hidden",
    patient.arrivalMode !== "other"
  );

  renderAllTests(patient);
  renderRecommendations(patient);
  updateDispositionVisibility();
  wireNarrativeFields(patient);
  refreshNarrativeFields(patient);
  renderSummaryStatus(patient);
  renderCaseEditState(patient);
}

function renderCaseEditState(patient) {
  const completed = isCompleted(patient);
  const form = document.getElementById("patientForm");
  const reopenButton = document.getElementById("reopenCaseBtn");

  reopenButton.classList.toggle("hidden", !completed);
  reopenButton.disabled = false;
  form.classList.toggle("case-readonly", completed);

  form.querySelectorAll("input, textarea, select, button").forEach((control) => {
    if (completed) {
      if (!control.disabled) {
        control.disabled = true;
        control.dataset.closedDisabled = "true";
      }
    } else if (control.dataset.closedDisabled === "true") {
      control.disabled = false;
      delete control.dataset.closedDisabled;
    }
  });
}

async function reopenCase() {
  const patient = patientById(selectedPatientId);
  if (!patient || !isCompleted(patient) || !state.shift) return;

  const confirmed = confirm(
    uiLang === "hu"
      ? "Újranyitja ezt a lezárt esetet? A korábbi véglegesített verzió megmarad az előzményekben."
      : "Reopen this completed case? The previous finalized revision will remain in history."
  );
  if (!confirmed) return;

  const button = document.getElementById("reopenCaseBtn");
  const oldLabel = button.textContent;
  button.disabled = true;
  button.textContent = uiLang === "hu" ? "ÚJRANYITÁS…" : "REOPENING…";

  try {
    const result = await window.BachSBOBackend.reopenCase(state.shift.id, patient.id);
    patient.summaryFinalizedAt = null;
    patient.updatedAt = result?.reopenedAt || nowIso();
    renderApp();
    flash(uiLang === "hu" ? "Eset újranyitva." : "Case reopened.");
  } catch (error) {
    handleBackendError(error);
    button.disabled = false;
    button.textContent = oldLabel;
  }
}

function renderAllTests(patient) {
  renderGroupCards("labCards", patient.tests.labs, () => "Lab", "lab");
  renderGroupCards("ekgCard", patient.tests.ekgs || [], () => "EKG", "ekg");
  renderGroupCards(
    "gasCard",
    patient.tests.gases || [],
    (entry) => /\bVVG\b/i.test(entry.text || "") ? "VVG" : "AVG",
    "gas",
    { gas: true }
  );
  renderRadiologyCards(patient);
  renderDynamicCards(
    "consultCards",
    patient.tests.consultations,
    uiLang === "hu" ? "Konzílium" : "Consultation",
    "consultations",
    uiLang === "hu" ? "Szakterület, pl. Kardiológia, Neurológia" : "Type e.g. Cardiology, Neurology"
  );
  refreshSummaryControls(patient);
}

function applyTestCardUiHook(card, context = {}) {
  const hook = window.BachSBOUiHooks?.decorateTestCard;
  if (typeof hook !== "function" || !card) return;
  try {
    hook(card, context);
  } catch (error) {
    console.error("Test-card UI hook failed; using stable card renderer.", error);
  }
}

function modeDots(entry) {
  const status = entryStatus(entry);
  const waiting = uiLang === "hu" ? "Eredményre vár" : "Waiting for result";
  const notOrdered = uiLang === "hu" ? "Nem történt" : "Not ordered";
  const result = uiLang === "hu" ? "Eredmény rendelkezésre áll" : "Result available";
  return `<div class="mode-dots" data-mode-dots>
    <button type="button" class="mode-dot-btn waiting ${status === "waiting" ? "active" : ""}" data-mode-choice="waiting" title="${waiting}" aria-label="${waiting}"></button>
    <button type="button" class="mode-dot-btn notordered ${status === "notordered" ? "active" : ""}" data-mode-choice="notordered" title="${notOrdered}" aria-label="${notOrdered}"></button>
    <span class="mode-dot-btn result ${status === "result" ? "active" : ""}" title="${result}" aria-label="${result}"></span>
  </div>`;
}

function statusBadge(status) {
  const result = uiLang === "hu" ? "EREDMÉNY KÉSZ" : "RESULT AVAILABLE";
  const notOrdered = uiLang === "hu" ? "NEM TÖRTÉNT" : "NOT ORDERED";
  const waiting = uiLang === "hu" ? "EREDMÉNYRE VÁR" : "WAITING FOR RESULT";
  return `<span class="test-status ${status}">${status === "result"
    ? result
    : status === "notordered"
    ? notOrdered
    : waiting}</span>`;
}

function simpleTestGroup(patient, prefix) {
  if (prefix === "lab") return patient?.tests?.labs || [];
  if (prefix === "ekg") return patient?.tests?.ekgs || [];
  if (prefix === "gas") return patient?.tests?.gases || [];
  return [];
}

function renderGroupCards(hostId, entries, labelForEntry, prefix, options = {}) {
  const host = document.getElementById(hostId);
  host.innerHTML = "";

  entries.forEach((entry, i) => {
    const baseLabel = typeof labelForEntry === "function"
      ? labelForEntry(entry, i)
      : String(labelForEntry || "");
    const displayLabel = entries.length > 1 ? `${baseLabel} ${i + 1}` : baseLabel;
    host.appendChild(makeSimpleCard(displayLabel, entry, `${prefix}-${i}`, Boolean(options.gas)));
  });

  if (prefix === "lab") {
    document.getElementById("addLabBtn").disabled = entries.length >= MAX_TEST_ENTRIES_PER_TYPE;
  }
}

function makeSimpleCard(label, entry, key, isGas = false) {
  const status = entryStatus(entry);
  const card = document.createElement("div");
  const prefix = String(key).split("-")[0];
  const group = simpleTestGroup(patientById(selectedPatientId), prefix);
  const canDelete = group.length > 1;

  card.className =
    `test-card ${status === "result" ? "result" : status === "notordered" ? "notordered" : ""}`;
  card.dataset.card = key;

  card.innerHTML = `
    <div class="test-head">
      <div class="test-name-wrap">
        <span class="test-name">${label}</span>
        ${isGas ? `<span class="gas-type">${label}</span>` : ""}
      </div>
      <div class="card-head-actions">
        ${modeDots(entry)}
        ${canDelete ? '<button class="btn small delete-test" type="button" data-delete-test>DELETE</button>' : ""}
      </div>
    </div>

    <div class="test-grid">

      <textarea data-text="${key}" ${entry.mode === "notordered" ? "disabled" : ""} placeholder="${uiLang === "hu" ? `${label} eredménye…` : `${label} result…`}">${esc(entry.text || "")}</textarea>

      <button type="button" class="btn small primary test-save" data-save="${key}"
        ${!entry.text.trim() || entry.mode === "notordered" || status === "result" ? "disabled" : ""}>
        ${uiLang === "hu" ? "EREDMÉNY MENTÉSE" : "SAVE RESULT"}
      </button>
    </div>
  `;

  applyTestCardUiHook(card, { kind: "simple", key, entry });

  const deleteButton = card.querySelector("[data-delete-test]");
  if (deleteButton) {
    deleteButton.onclick = () => {
      const patient = patientById(selectedPatientId);
      if (!patient) return;
      const [prefix, rawIndex] = key.split("-");
      const index = Number(rawIndex);
      const group = simpleTestGroup(patient, prefix);
      if (group.length > 1) group.splice(index, 1);
      touchPatient(patient);
      renderAllTests(patient);
      updateStatusCell(patient);
    };
  }

  wireCard(card, entry, key);

  return card;
}

function renderDynamicCards(hostId, entries, label, prefix, placeholder) {
  const host = document.getElementById(hostId);
  host.innerHTML = "";

  entries.forEach((entry, i) => {
    const key = `${prefix}-${i}`;
    const status = entryStatus(entry);
    const card = document.createElement("div");

    card.className =
      `test-card ${status === "result" ? "result" : status === "notordered" ? "notordered" : ""}`;

    card.dataset.card = key;

    card.innerHTML = `
      <div class="test-head">
        <div class="test-name-wrap"><span class="test-name">${label} ${i + 1}</span></div>
        <div class="card-head-actions">
          ${modeDots(entry)}
          ${entries.length > 1 ? '<button class="btn small delete-test" type="button" data-delete-test>DELETE</button>' : ""}
        </div>
      </div>

      <div class="dynamic-grid">
        <input data-type="${key}" value="${attr(entry.type || "")}" placeholder="${placeholder}" />

        <textarea data-text="${key}" ${entry.mode === "notordered" ? "disabled" : ""} placeholder="${uiLang === "hu" ? "Eredmény / megjegyzés…" : "Result / note…"}">${esc(entry.text || "")}</textarea>

        <button type="button" class="btn small primary test-save" data-save="${key}"
          ${!entry.text.trim() || entry.mode === "notordered" || status === "result" ? "disabled" : ""}>
          ${uiLang === "hu" ? "EREDMÉNY MENTÉSE" : "SAVE RESULT"}
        </button>
      </div>
    `;

    applyTestCardUiHook(card, { kind: "dynamic", key, entry });

    host.appendChild(card);

    const typeInput = card.querySelector(`[data-type="${key}"]`);
    typeInput.oninput = () => {
      entry.type = typeInput.value;
      const patient = patientById(selectedPatientId);
      touchPatient(patient);
      updateStatusCell(patient);
    };

    const deleteButton = card.querySelector("[data-delete-test]");
    if (deleteButton) {
      deleteButton.onclick = () => {
        entries.splice(i, 1);
        const patient = patientById(selectedPatientId);
        touchPatient(patient);
        renderAllTests(patient);
        updateStatusCell(patient);
      };
    }

    wireCard(card, entry, key);
  });
}

function renderRadiologyCards(patient) {
  const host = document.getElementById("radiologyCards");
  host.innerHTML = "";
  patient.tests.radiology.forEach((entry, i) => {
    normalizeRadiologyEntry(entry);
    const key = `radiology-${i}`;
    const status = entryStatus(entry);
    const card = document.createElement("div");
    const bodyParts = ["", "koponya", "mellkas", "has", "mellkas és has", "has és kismedence"];
    const bodyLabels = uiLang === "hu"
      ? {
          "": "— válasszon —",
          "koponya": "Koponya",
          "mellkas": "Mellkas",
          "has": "Has",
          "mellkas és has": "Mellkas és has",
          "has és kismedence": "Has és kismedence"
        }
      : {
          "": "— select —",
          "koponya": "Head",
          "mellkas": "Chest",
          "has": "Abdomen",
          "mellkas és has": "Chest + abdomen",
          "has és kismedence": "Abdomen + pelvis"
        };
    const modalities = ["", "RTG", "US", "Native CT", "Contrast CT", "MR", "other"];
    const modalityLabels = {
      "": uiLang === "hu" ? "— válasszon —" : "— select —",
      "other": uiLang === "hu" ? "Egyéb / specifikus" : "Other / specific"
    };
    const options = (items, current, labels = {}) => items.map((value) =>
      `<option value="${attr(value)}"${value === current ? " selected" : ""}>${labels[value] || value || "—"}</option>`
    ).join("");

    card.className = `test-card ${status === "result" ? "result" : status === "notordered" ? "notordered" : ""}`;
    card.dataset.card = key;
    card.innerHTML = `
      <div class="test-head">
        <div class="test-name-wrap"><span class="test-name">Radiology ${i + 1}</span><span class="subtle" data-rad-label>${esc(radiologyType(entry))}</span></div>
        <div class="card-head-actions">
          ${modeDots(entry)}
          ${patient.tests.radiology.length > 1 ? '<button class="btn small delete-test" type="button" data-delete-test>DELETE</button>' : ""}
        </div>
      </div>
      <div class="radiology-grid${entry.modality === "other" ? " has-other" : ""}">
        <select data-body>${options(bodyParts, entry.bodyPart, bodyLabels)}</select>
        <select data-modality>${options(modalities, entry.modality, modalityLabels)}</select>
        <input data-other class="${entry.modality === "other" ? "" : "hidden"}" value="${attr(entry.otherTest || "")}" placeholder="${uiLang === "hu" ? "Specifikus vizsgálat, pl. CT angiográfia" : "Specific test, e.g. CT angiography"}" />
        <textarea data-text="${key}" ${entry.mode === "notordered" ? "disabled" : ""} placeholder="${uiLang === "hu" ? "Radiológiai eredmény…" : "Radiology result…"}">${esc(entry.text || "")}</textarea>
        <button type="button" class="btn small primary test-save" data-save="${key}" ${!entry.text.trim() || entry.mode === "notordered" || status === "result" ? "disabled" : ""}>${uiLang === "hu" ? "EREDMÉNY MENTÉSE" : "SAVE RESULT"}</button>
      </div>`;

    const body = card.querySelector("[data-body]");
    const modality = card.querySelector("[data-modality]");
    const other = card.querySelector("[data-other]");
    const updateType = () => {
      entry.bodyPart = body.value;
      entry.modality = modality.value;
      entry.otherTest = other.value;
      entry.type =
        entry.bodyPart || entry.modality || entry.otherTest
          ? radiologyType(entry)
          : "";
      other.classList.toggle("hidden", entry.modality !== "other");
      card.querySelector(".radiology-grid").classList.toggle("has-other", entry.modality === "other");
      card.querySelector("[data-rad-label]").textContent = entry.type;
      touchPatient(patient);
      updateStatusCell(patient);
    };
    body.onchange = updateType;
    modality.onchange = updateType;
    other.oninput = updateType;

    const deleteButton = card.querySelector("[data-delete-test]");
    if (deleteButton) {
      deleteButton.onclick = () => {
        patient.tests.radiology.splice(i, 1);
        touchPatient(patient);
        renderRadiologyCards(patient);
        updateStatusCell(patient);
        refreshSummaryControls(patient);
      };
    }
    applyTestCardUiHook(card, { kind: "radiology", key, entry });
    host.appendChild(card);
    wireCard(card, entry, key);
  });
}

function wireCard(card, entry, key) {
  const modeButtons = [...card.querySelectorAll("[data-mode-choice]")];
  const text = card.querySelector(`[data-text="${key}"]`);
  const save = card.querySelector(`[data-save="${key}"]`);

  function refreshVisual() {
    const status = entryStatus(entry);

    // Preserve UI-extension classes such as Beta's cockpit-test-row while
    // updating only state classes. Resetting className caused layout flicker.
    card.classList.toggle("result", status === "result");
    card.classList.toggle("notordered", status === "notordered");

    const statusEl = card.querySelector(".test-status");
    if (statusEl) statusEl.outerHTML = statusBadge(status);
    card.querySelectorAll("[data-mode-choice]").forEach((button) => {
      button.classList.toggle("active", button.dataset.modeChoice === status);
    });
    card.querySelector(".mode-dot-btn.result")?.classList.toggle("active", status === "result");
    text.disabled = entry.mode === "notordered";
    const resultAlreadySaved =
      Boolean((entry.savedText || "").trim()) &&
      (entry.savedText || "").trim() === (entry.text || "").trim();
    save.disabled =
      !entry.text.trim() || entry.mode === "notordered" || resultAlreadySaved;

    const patient = patientById(selectedPatientId);
    updateStatusCell(patient);
    refreshSummaryControls(patient);
  }

  modeButtons.forEach((button) => {
    button.onclick = () => {
      const nextMode = button.dataset.modeChoice === "notordered"
        ? "notordered"
        : "waiting";

      if (nextMode === "notordered" && (entry.text || "").trim()) {
        flash(uiLang === "hu"
          ? "Törölje az eredményt, mielőtt „Nem történt” állapotra állítja."
          : "Clear the result before marking this test Not ordered.");
        return;
      }

      entry.mode = nextMode;
      if (nextMode === "notordered") entry.savedText = "";
      touchPatient(patientById(selectedPatientId));
      refreshVisual();
    };
  });

  text.oninput = () => {
    entry.text = text.value;
    touchPatient(patientById(selectedPatientId));
    refreshVisual();

    if (key.startsWith("gas-")) {
      const base = /\bVVG\b/i.test(entry.text || "") ? "VVG" : "AVG";
      const index = Number(key.split("-")[1] || 0);
      const count = patientById(selectedPatientId)?.tests?.gases?.length || 1;
      const label = count > 1 ? `${base} ${index + 1}` : base;
      card.querySelector(".test-name").textContent = label;
      card.querySelector(".gas-type").textContent = label;
    }
  };

  text.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      entry.text = text.value;
      if (entry.mode !== "notordered" && entry.text.trim()) save.click();
    }
  });

  save.onclick = async () => {
    if (!entry.text.trim()) return;

    entry.savedText = entry.text;
    entry.mode = "waiting";
    touchPatient(patientById(selectedPatientId));
    refreshVisual();

    try {
      await persistNow();
      flash(uiLang === "hu" ? "Eredmény mentve." : "Result saved.");
    } catch (error) {
      handleBackendError(error);
    }
  };
}

function addInvestigation(kind, options = {}) {
  const patient = patientById(selectedPatientId);
  if (!patient || isCompleted(patient)) return false;

  if (kind === "lab") {
    if (patient.tests.labs.length >= MAX_TEST_ENTRIES_PER_TYPE) return false;
    patient.tests.labs.push(newEntry());
  } else if (kind === "ekg") {
    patient.tests.ekgs ||= [];
    if (patient.tests.ekgs.length >= MAX_TEST_ENTRIES_PER_TYPE) return false;
    patient.tests.ekgs.push(newEntry());
  } else if (kind === "gas") {
    patient.tests.gases ||= [];
    if (patient.tests.gases.length >= MAX_TEST_ENTRIES_PER_TYPE) return false;
    patient.tests.gases.push(newEntry());
  } else if (kind === "imaging") {
    if (patient.tests.radiology.length >= MAX_TEST_ENTRIES_PER_TYPE) return false;
    patient.tests.radiology.push(radiologyEntry());
  } else if (kind === "consultation" || kind === "other") {
    if (patient.tests.consultations.length >= MAX_TEST_ENTRIES_PER_TYPE) return false;
    const entry = newEntry("");
    if (kind === "other") entry.type = String(options.name || "").trim() || (uiLang === "hu" ? "Egyéb" : "Other");
    patient.tests.consultations.push(entry);
  } else {
    return false;
  }

  touchPatient(patient);
  renderAllTests(patient);
  updateStatusCell(patient);
  refreshSummaryControls(patient);
  return true;
}

function collectForm() {
  const patient = patientById(selectedPatientId);
  if (!patient) return null;

  // Test entries are canonical in patient.tests. Each rendered control updates
  // its entry synchronously; collectForm must not scrape a second copy from DOM.

  // Demographics/arrival are canonical in patient state. case-ui.js updates
  // them through applyCaseMetadata(); never scrape a second copy back from DOM.

  patient.mainComplaint = document.getElementById("fMainComplaint").value;
  patient.complaint = document.getElementById("fComplaint").value;
  patient.history = document.getElementById("fHistory").value;
  patient.physical = document.getElementById("fPhysical").value;
  patient.others = document.getElementById("fOthers").value;
  patient.therapy = document.getElementById("fTherapy").value;
  patient.course = document.getElementById("fCourse").value;

  if (patient.complaint.trim()) patient.complaintSkipped = false;
  if (patient.history.trim()) patient.historySkipped = false;
  if (patient.physical.trim()) patient.physicalSkipped = false;
  if (patient.therapy.trim()) patient.therapySkipped = false;
  if (patient.course.trim()) patient.courseSkipped = false;

  patient.diagnoses = document.getElementById("fDiagnoses").value;
  if (patient.diagnoses.trim()) patient.diagnosesSkipped = false;
  patient.disposition = document.getElementById("fDisposition").value;
  patient.dischargeCondition = document.getElementById("fDischargeCondition")?.value || "";
  patient.hospital = document.getElementById("fHospital").value;
  patient.ward = document.getElementById("fWard").value;
  patient.physician = document.getElementById("fPhysician").value;
  patient.admissionNote = document.getElementById("fAdmissionNote").value;
  patient.otherOutcome = document.getElementById("fOtherOutcome").value;
  patient.otherDetails = document.getElementById("fOtherDetails").value;
  patient.summary = document.getElementById("fSummary").value;
  patient.recommendations = [...document.querySelectorAll("[data-rec]")].map(
    (x) => x.value
  );

  // Döntés is mutually exclusive. Never keep hidden data from another branch.
  if (patient.disposition !== "discharged") {
    patient.dischargeCondition = "";
    patient.recommendations = [];
  }
  if (patient.disposition !== "admitted") {
    patient.hospital = "";
    patient.ward = "";
    patient.physician = "";
    patient.admissionNote = "";
  }
  if (patient.disposition !== "other") {
    patient.otherOutcome = "";
    patient.otherDetails = "";
  }
  patient.updatedAt = nowIso();

  return patient;
}

function commitCurrentDraft() {
  const patient = collectForm();
  if (!patient || isCompleted(patient)) return null;
  stateDirty = true;
  return patient;
}

async function autosaveCurrentCase() {
  const patient = commitCurrentDraft();
  if (!patient) return { skipped: true };

  return persistNow({ reloadForm: false, silentAutosave: true });
}

async function savePatient() {
  const patient = collectForm();
  if (!patient) return;

  if (isCompleted(patient)) {
    flash(uiLang === "hu"
      ? "A lezárt eset szerkesztéséhez előbb nyissa újra."
      : "Reopen the completed case before editing.");
    return;
  }

  try {
    await persistNow();
    renderApp();
    flash(uiLang === "hu" ? "Eset mentve." : "Case saved.");
  } catch (error) {
    handleBackendError(error);
  }
}

function updateDispositionVisibility() {
  const value = document.getElementById("fDisposition").value;

  // Clear inactive decision branches immediately, not just visually hide them.
  if (value !== "discharged") {
    const dischargeCondition = document.getElementById("fDischargeCondition");
    if (dischargeCondition) dischargeCondition.value = "";
    document.querySelectorAll("[data-rec]").forEach((input) => {
      input.value = "";
    });
  }
  if (value !== "admitted") {
    ["fHospital", "fWard", "fPhysician", "fAdmissionNote"].forEach((id) => {
      const field = document.getElementById(id);
      if (field) field.value = "";
    });
  }
  if (value !== "other") {
    ["fOtherOutcome", "fOtherDetails"].forEach((id) => {
      const field = document.getElementById(id);
      if (field) field.value = "";
    });
  }

  document
    .getElementById("dischargedFields")
    .classList.toggle("hidden", value !== "discharged");

  document
    .getElementById("admittedFields")
    .classList.toggle("hidden", value !== "admitted");

  document
    .getElementById("otherFields")
    .classList.toggle("hidden", value !== "other");

  document
    .getElementById("fixedSummaryFooterField")
    ?.classList.toggle("hidden", value !== "discharged");
}

function renderRecommendations(patient) {
  const recList = document.getElementById("recList");
  recList.innerHTML = "";

  const entries = patient.recommendations?.length
    ? [...patient.recommendations]
    : [];

  while (entries.length < 5) entries.push("");

  entries.forEach((text, i) => {
    const row = document.createElement("div");
    row.className = "rec-row";

    row.innerHTML = `
      <div class="n">${i + 1}.</div>
      <input data-rec value="${attr(text)}" placeholder="${uiLang === "hu" ? "Javaslat " + (i + 1) : "Recommendation " + (i + 1)}" />
      ${i >= 5 ? `<button type="button" class="btn small" data-del-rec="${i}">×</button>` : '<span></span>'}
    `;

    recList.appendChild(row);
  });

  recList.querySelectorAll("[data-del-rec]").forEach((btn) => {
    btn.onclick = () => {
      collectForm();

      const patient = patientById(selectedPatientId);
      patient.recommendations.splice(Number(btn.dataset.delRec), 1);

      if (!patient.recommendations.length) patient.recommendations = [""];

      persist();
      renderRecommendations(patient);
    };
  });
}

function addRecommendation() {
  collectForm();

  const patient = patientById(selectedPatientId);
  patient.recommendations.push("");

  persist();
  renderRecommendations(patient);
}

function syncFixedSummaryFooter() {
  const field = document.getElementById("summaryFixedFooter");
  if (field) field.value = SUMMARY_FIXED_FOOTER;
}

function summaryWithFixedFooter(summaryText, disposition = "") {
  const main = String(summaryText || "").trim();
  if (String(disposition || "").trim() !== "discharged") return main;

  const footer = SUMMARY_FIXED_FOOTER.trim();
  if (!main) return footer;
  if (main.endsWith(footer)) return main;

  // Two completely blank lines between the editable summary and the fixed footer.
  return `${main}\n\n\n${footer}`;
}

async function generateSummary() {
  const patient = collectForm();
  if (!patient) return;

  const blockers = workflowBlockers(patient);
  if (blockers.length) {
    refreshSummaryControls(patient);
    alert(
      (uiLang === "hu" ? "Az összefoglaló nem készíthető el. Rendezendő: " : "Summary cannot be generated. Resolve: ") +
      blockers.join(", ")
    );
    return;
  }

  commitFilledTestResults(patient);

  const button = document.getElementById("generateSummaryBtn");
  const buttonLabel = document.getElementById("generateSummaryLabel");
  const oldLabel = buttonLabel?.textContent || "";
  button.dataset.busy = "true";
  button.disabled = true;
  if (buttonLabel) buttonLabel.textContent = uiLang === "hu" ? "GENERÁLÁS…" : "GENERATING…";

  try {
    // Persist first so the AI only sees the de-identified database copy.
    await persistNow();

    const result = await window.BachSBOBackend.generateSummary(patient.id);

    patient.summary = result.summary || "";
    patient.summaryGeneratedText = patient.summary;
    patient.summaryGeneratedAt = result.generatedAt || nowIso();
    patient.summaryModel = result.model || "";
    patient.summarySkillVersion = result.skillVersion || "";

    document.getElementById("fSummary").value = patient.summary;
    renderSummaryStatus(patient);

    const skillSuffix = result.skillVersion
      ? ` • Skill v${result.skillVersion}`
      : "";
    const retrievalCount = Array.isArray(result.similarCasesUsed)
      ? result.similarCasesUsed.length
      : 0;
    const retrievalSuffix = retrievalCount
      ? ` • ${retrievalCount} similar case(s)`
      : "";
    flash(uiLang === "hu"
      ? `Összefoglaló elkészült${skillSuffix}${retrievalSuffix}.`
      : `Summary generated${skillSuffix}${retrievalSuffix}.`);
  } catch (error) {
    handleBackendError(error);
  } finally {
    button.dataset.busy = "false";
    if (buttonLabel) buttonLabel.textContent = oldLabel;
    refreshSummaryControls(patient);
  }
}

async function finalizeSummary() {
  const patient = collectForm();
  if (!patient) return;

  const blockers = workflowBlockers(patient);
  if (blockers.length) {
    refreshSummaryControls(patient);
    alert(
      (uiLang === "hu" ? "Az eset nem zárható le. Rendezendő: " : "Case cannot be finalized. Resolve: ") +
      blockers.join(", ")
    );
    return;
  }

  commitFilledTestResults(patient);

  const text = patient.summary.trim();

  if (!text) {
    alert(uiLang === "hu" ? "Az összefoglaló üres." : "Summary is empty.");
    return;
  }

  patient.summaryFinalizedText = text;
  patient.summaryFinalizedAt = nowIso();
  patient.updatedAt = nowIso();

  try {
    const revisionResult = await window.BachSBOBackend.finalizePatient(
      state.shift?.id,
      patient
    );
    stateDirty = false;

    if (revisionResult?.patient?.id === patient.id) {
      Object.assign(patient, revisionResult.patient);
      document.getElementById("fSummary").value =
        patient.summaryFinalizedText || patient.summary || "";
    }

    if (revisionResult?.removed > 0) {
      flash(
        `Privacy filter removed ${revisionResult.removed} identifier(s) from finalized corpus.`
      );
    }
    if (revisionResult?.embeddingWarning) {
      flash("Summary saved; similar-case embedding will need retry.");
    }
  } catch (error) {
    handleBackendError(error);
    return;
  }

  const clipboardText = summaryWithFixedFooter(
    patient.summaryFinalizedText || patient.summary || text,
    patient.disposition
  );

  try {
    await navigator.clipboard.writeText(clipboardText);
    flash(uiLang === "hu"
      ? "Összefoglaló véglegesítve és a vágólapra másolva."
      : "Summary finalized and copied to clipboard.");
  } catch {
    flash(uiLang === "hu"
      ? "Összefoglaló véglegesítve. A vágólap nem érhető el."
      : "Summary finalized. Clipboard unavailable.");
  }

  renderApp();
}

function renderSummaryStatus(patient) {
  const summaryStatus = document.getElementById("summaryStatus");
  const summaryText = document.getElementById("fSummary").value || "";

  if (!patient.summaryFinalizedAt) {
    summaryStatus.innerHTML = uiLang === "hu"
      ? '<span class="badge active">NINCS VÉGLEGESÍTVE</span><span class="subtle">Az eset aktív.</span>'
      : '<span class="badge active">NOT FINALIZED</span><span class="subtle">Case is active.</span>';
    return;
  }

  const changed =
    summaryText.trim() !== patient.summaryFinalizedText.trim();

  if (changed) {
    summaryStatus.innerHTML = uiLang === "hu"
      ? '<span class="badge active">VÉGLEGESÍTÉS UTÁN SZERKESZTVE</span><span class="subtle">Az új verzió mentéséhez véglegesítse ismét.</span>'
      : '<span class="badge active">EDITED AFTER FINALIZE</span><span class="subtle">Finalize again to save a new revision.</span>';
  } else {
    summaryStatus.innerHTML = uiLang === "hu"
      ? `<span class="badge done">VÉGLEGESÍTVE</span><span class="subtle">Mentve: ${fmtTime(patient.summaryFinalizedAt)}</span>`
      : `<span class="badge done">FINALIZED</span><span class="subtle">Saved ${fmtTime(patient.summaryFinalizedAt)}</span>`;
  }
}

async function startShift() {
  if (state.shift) return;

  try {
    state.shift = await window.BachSBOBackend.startShift();
    selectedPatientId = null;
    renderApp();
  } catch (error) {
    handleBackendError(error);
  }
}

function endShiftStep1() {
  const pts = activeShiftPatients();
  const active = pts.filter((p) => !isCompleted(p)).length;

  modal(uiLang === "hu" ? `
    <h3>Lezárja az aktuális műszakot?</h3>
    <p>Esetek: <b>${pts.length}</b><br>Még aktív / folyamatban: <b>${active}</b></p>
    <p>Ez lezárja az aktuális munkaterületet.</p>
    <div class="modal-actions">
      <button class="btn" data-close>MÉGSE</button>
      <button class="btn danger" id="endContinue">FOLYTATÁS</button>
    </div>
  ` : `
    <h3>End current shift?</h3>
    <p>Cases: <b>${pts.length}</b><br>Still active / in progress: <b>${active}</b></p>
    <p>This will close the current workspace.</p>
    <div class="modal-actions">
      <button class="btn" data-close>CANCEL</button>
      <button class="btn danger" id="endContinue">CONTINUE</button>
    </div>
  `);

  document.getElementById("endContinue").onclick = endShiftStep2;
}

function endShiftStep2() {
  modal(uiLang === "hu" ? `
    <h3>Műszak lezárásának megerősítése</h3>
    <p>A megerősítéshez írja be: <b>END</b>.</p>
    <input id="endInput" autocomplete="off" placeholder="END" />
    <div class="modal-actions">
      <button class="btn" data-close>MÉGSE</button>
      <button class="btn danger" id="endFinal" disabled>MŰSZAK LEZÁRÁSA</button>
    </div>
  ` : `
    <h3>Confirm end shift</h3>
    <p>Type <b>END</b> to confirm.</p>
    <input id="endInput" autocomplete="off" placeholder="END" />
    <div class="modal-actions">
      <button class="btn" data-close>CANCEL</button>
      <button class="btn danger" id="endFinal" disabled>END SHIFT</button>
    </div>
  `);

  const input = document.getElementById("endInput");
  const endFinal = document.getElementById("endFinal");

  input.oninput = () => {
    endFinal.disabled = input.value !== "END";
  };

  endFinal.onclick = async () => {
    const closingShiftId = state.shift?.id;
    if (!closingShiftId) return;

    endFinal.disabled = true;

    try {
      await persistNow();
      await window.BachSBOBackend.closeShift(closingShiftId);
      state = defaultState();
      selectedPatientId = null;
      closeModal();
      renderApp();
    } catch (error) {
      endFinal.disabled = false;
      handleBackendError(error);
    }
  };
}

function modal(inner) {
  const host = document.getElementById("modalHost");

  host.innerHTML =
    `<div class="modal-wrap"><div class="modal">${inner}</div></div>`;

  document.querySelectorAll("[data-close]").forEach((x) => {
    x.onclick = closeModal;
  });
}

function closeModal() {
  document.getElementById("modalHost").innerHTML = "";
}

function learningMessage(message, isError = false) {
  const el = document.getElementById("learningMessage");
  if (!message) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }

  el.textContent = message;
  el.classList.remove("hidden");
  el.style.borderColor = isError ? "#fecaca" : "";
  el.style.background = isError ? "#fef2f2" : "";
  el.style.color = isError ? "#991b1b" : "";
}

function renderCorpusRevisions(revisions) {
  const host = document.getElementById("corpusReviewList");
  if (!host) return;

  if (!revisions.length) {
    host.innerHTML = `<div class="subtle">${uiLang === "hu" ? "Még nincs véglegesített revízió." : "No finalized revisions yet."}</div>`;
    return;
  }

  host.innerHTML = revisions.map((item) => {
    const status = item.learning_status || "approved";
    const reviewed = item.learning_reviewed_at
      ? new Date(item.learning_reviewed_at).toLocaleString()
      : "";
    const finalized = item.finalized_at
      ? new Date(item.finalized_at).toLocaleString()
      : "";
    return `
      <div class="learning-item corpus-review-item">
        <div class="learning-item-head">
          <div>
            <b>${uiLang === "hu" ? "Véglegesített revízió" : "Finalized revision"}</b>
            <div class="subtle">${esc(finalized)}${item.model ? ` • ${esc(item.model)}` : ""}</div>
          </div>
          <span class="badge ${status === "approved" ? "done" : "rejected"}">
            ${esc(status.toUpperCase())}
          </span>
        </div>
        <div class="learning-text corpus-finalized-text">${esc(item.finalized_text || "")}</div>
        ${item.learning_note ? `<div class="footer-note">${uiLang === "hu" ? "Ellenőrzési megjegyzés" : "Review note"}: ${esc(item.learning_note)}</div>` : ""}
        ${reviewed ? `<div class="footer-note">${uiLang === "hu" ? "Ellenőrizve" : "Reviewed"}: ${esc(reviewed)}</div>` : ""}
        <div class="learning-actions">
          <button class="btn success small" data-corpus-review="${item.id}" data-decision="approved">
            ${uiLang === "hu" ? "JÓVÁHAGYÁS" : "APPROVE"}
          </button>
          <button class="btn small" data-corpus-review="${item.id}" data-decision="excluded">
            ${uiLang === "hu" ? "KIZÁRÁS" : "EXCLUDE"}
          </button>
        </div>
      </div>
    `;
  }).join("");

  host.querySelectorAll("[data-corpus-review]").forEach((button) => {
    button.onclick = async () => {
      const decision = button.dataset.decision;
      const revisionId = button.dataset.corpusReview;
      const verb = decision === "approved" ? "approve" : "exclude";
      if (!window.confirm(
        uiLang === "hu"
          ? `Megerősíti ezt a döntést az AI-tanuláshoz? (${verb})`
          : `Confirm ${verb} for AI learning?`
      )) return;

      let note = "";
      if (decision === "excluded") {
        note = window.prompt(uiLang === "hu" ? "A kizárás oka (opcionális):" : "Optional reason for exclusion:", "") || "";
      }

      host.querySelectorAll(`[data-corpus-review="${revisionId}"]`).forEach((x) => {
        x.disabled = true;
      });

      try {
        await window.BachSBOBackend.reviewCorpusRevision(
          revisionId,
          decision,
          note
        );
        learningMessage(
          decision === "approved"
            ? (uiLang === "hu" ? "A revízió jóváhagyva az AI-tanuláshoz." : "Revision approved for AI learning.")
            : (uiLang === "hu" ? "A revízió kizárva az AI-tanulásból." : "Revision excluded from AI learning.")
        );
        await renderLearningDashboard();
      } catch (error) {
        learningMessage(error?.message || (uiLang === "hu" ? "A korpusz ellenőrzése sikertelen." : "Corpus review failed."), true);
      }
    };
  });
}

function renderStyleProfiles(profiles, coachRuns = []) {
  const host = document.getElementById("styleProfilesList");
  if (!profiles.length) {
    host.innerHTML =
      `<div class="subtle">${uiLang === "hu"
        ? "Még nincs stílusprofil. Véglegesítsen legalább 5 jóváhagyott, különböző esetet, majd generáljon jelöltet."
        : "No style profile yet. Finalize at least 5 approved distinct cases, then generate a candidate."}</div>`;
    return;
  }

  const coachByProfile = new Map(
    coachRuns
      .filter((run) => run?.candidate_profile_id)
      .map((run) => [run.candidate_profile_id, run])
  );

  host.innerHTML = profiles.map((profile) => {
    const coach = coachByProfile.get(profile.id) || null;
    const reviewStatus = profile.is_active
      ? "accepted"
      : coach?.status || "legacy_candidate";
    const badgeLabel = profile.is_active
      ? "ACTIVE"
      : reviewStatus === "rejected"
      ? "REJECTED"
      : reviewStatus === "accepted"
      ? "REVIEWED"
      : "CANDIDATE";
    const badgeClass = profile.is_active
      ? "done"
      : reviewStatus === "rejected"
      ? "rejected"
      : "pending";
    const coachMeta = coach
      ? `<div class="subtle">
          Style Coach: ${esc(coach.corpus_maturity || "unknown")} corpus
          • ${Number(coach.official_rule_count || 0)} official rules
          ${coach.generated_at ? ` • ${esc(new Date(coach.generated_at).toLocaleString())}` : ""}
        </div>`
      : '<div class="subtle">Legacy candidate — no Style Coach audit record.</div>';
    const coachAnalysis = coach?.analysis_text
      ? `<details class="mt16">
          <summary>STYLE COACH ANALYSIS</summary>
          <div class="learning-text">${esc(coach.analysis_text)}</div>
        </details>`
      : "";
    const canReview = !profile.is_active && reviewStatus !== "rejected" && reviewStatus !== "accepted";
    const rejectButton = canReview && coach?.status === "pending"
      ? `<button class="btn small" data-reject-style="${profile.id}" data-style-version="${esc(profile.version)}">REJECT</button>`
      : "";

    return `
      <div class="learning-item" data-style-profile="${profile.id}">
        <div class="learning-item-head">
          <b>Style v${esc(profile.version)}</b>
          <span class="badge ${badgeClass}">${badgeLabel}</span>
        </div>
        <div class="subtle">
          ${profile.source_revision_count || 0} finalized pairs
          ${profile.model ? ` • ${esc(profile.model)}` : ""}
        </div>
        ${coachMeta}
        <div class="learning-text">${esc(profile.profile_text || "")}</div>
        ${coachAnalysis}
        ${
          canReview
            ? `<div class="learning-actions">
                <button class="btn success small" data-activate-style="${profile.id}" data-style-version="${esc(profile.version)}">
                  ACTIVATE
                </button>
                ${rejectButton}
              </div>
              <div class="footer-note">Activation changes future generated summaries only. It does not rewrite existing clinical records or finalized summaries.</div>`
            : ""
        }
      </div>
    `;
  }).join("");

  host.querySelectorAll("[data-activate-style]").forEach((button) => {
    button.onclick = async () => {
      const version = button.dataset.styleVersion || "?";
      const confirmed = window.confirm(
        `Activate Style v${version} for future summary generation? Existing clinical records and finalized summaries will not be changed.`
      );
      if (!confirmed) return;

      button.disabled = true;
      try {
        await window.BachSBOBackend.activateStyle(
          button.dataset.activateStyle
        );
        learningMessage(`Writing Style v${version} activated after explicit approval.`);
        await renderLearningDashboard();
      } catch (error) {
        learningMessage(error?.message || "Style activation failed.", true);
      } finally {
        button.disabled = false;
      }
    };
  });

  host.querySelectorAll("[data-reject-style]").forEach((button) => {
    button.onclick = async () => {
      const version = button.dataset.styleVersion || "?";
      if (!window.confirm(`Reject Style v${version}? It will remain inactive and will not be used for future summaries.`)) {
        return;
      }

      button.disabled = true;
      try {
        await window.BachSBOBackend.rejectStyle(button.dataset.rejectStyle);
        learningMessage(`Style v${version} rejected and left inactive.`);
        await renderLearningDashboard();
      } catch (error) {
        learningMessage(error?.message || "Style rejection failed.", true);
      } finally {
        button.disabled = false;
      }
    };
  });
}

function renderSkillSuggestions(suggestions) {
  const host = document.getElementById("skillSuggestionsList");
  if (!suggestions.length) {
    host.innerHTML =
      `<div class="subtle">${uiLang === "hu"
        ? "Még nincs Skill-javaslat. Legalább 10 Generált → Véglegesített pár szükséges."
        : "No Skill suggestions yet. At least 10 Generated → Finalized pairs are required."}</div>`;
    return;
  }

  host.innerHTML = suggestions.map((item) => `
    <div class="learning-item">
      <div class="learning-item-head">
        <b>Based on Skill v${esc(item.base_skill_version)}</b>
        <span class="badge ${esc(item.status)}">${esc(String(item.status).toUpperCase())}</span>
      </div>
      <div class="subtle">
        ${item.source_revision_count || 0} finalized pairs
        ${item.model ? ` • ${esc(item.model)}` : ""}
      </div>
      <div class="learning-text">${esc(item.suggestion_text || "")}</div>
      ${
        item.status === "pending"
          ? `<div class="learning-actions">
              <button class="btn success small" data-skill-review="${item.id}" data-decision="accepted">
                ACCEPT FOR FOLLOW-UP
              </button>
              <button class="btn small" data-skill-review="${item.id}" data-decision="rejected">
                REJECT
              </button>
            </div>
            <div class="footer-note">Accepting does not change the master Skill automatically.</div>`
          : ""
      }
    </div>
  `).join("");

  host.querySelectorAll("[data-skill-review]").forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        const result = await window.BachSBOBackend.reviewSkillSuggestion(
          button.dataset.skillReview,
          button.dataset.decision
        );
        learningMessage(result?.note || (uiLang === "hu" ? "A javaslat ellenőrizve." : "Suggestion reviewed."));
        await renderLearningDashboard();
      } catch (error) {
        learningMessage(error?.message || (uiLang === "hu" ? "A javaslat ellenőrzése sikertelen." : "Suggestion review failed."), true);
      } finally {
        button.disabled = false;
      }
    };
  });
}

async function renderLearningDashboard() {
  if (!backendReady) return;

  learningMessage("");
  const overview = await window.BachSBOBackend.getLearningOverview();

  document.getElementById("learningFinalizedCount").textContent =
    String(overview.finalizedCount || 0);

  document.getElementById("learningActiveSkill").textContent =
    overview.activeSkill
      ? `${overview.activeSkill.name || "SBO Skill"} v${overview.activeSkill.version}`
      : (uiLang === "hu" ? "Nincs beállítva" : "Not configured");

  const activeStyle = (overview.styleProfiles || []).find((x) => x.is_active);
  document.getElementById("learningActiveStyle").textContent =
    activeStyle ? `v${activeStyle.version}` : (uiLang === "hu" ? "Nincs" : "None");

  renderCorpusRevisions(overview.corpusRevisions || []);
  renderStyleProfiles(overview.styleProfiles || [], overview.styleCoachRuns || []);
  renderSkillSuggestions(overview.skillSuggestions || []);

  const styleButton = document.getElementById("generateStyleBtn");
  const skillButton = document.getElementById("generateSkillSuggestionBtn");

  styleButton.disabled = (overview.finalizedCount || 0) < 5;
  skillButton.disabled = (overview.finalizedCount || 0) < 10;
}

async function generateStyleCandidate() {
  const button = document.getElementById("generateStyleBtn");
  button.disabled = true;
  const old = button.textContent;
  button.textContent = uiLang === "hu" ? "ELEMZÉS…" : "ANALYZING…";

  try {
    const result = await window.BachSBOBackend.analyzeStyle();
    const maturity = result?.coach?.corpus_maturity
      ? ` Corpus maturity: ${result.coach.corpus_maturity}.`
      : "";
    const warning = result?.coachWarning ? ` ${result.coachWarning}` : "";
    learningMessage(
      uiLang === "hu"
        ? `Stílusjelölt v${result?.candidate?.version || "?"} létrehozva. Aktiválás előtt ellenőrizze.${maturity}${warning}`
        : `Style candidate v${result?.candidate?.version || "?"} created. Review it before activation.${maturity}${warning}`
    );
    await renderLearningDashboard();
  } catch (error) {
    learningMessage(error?.message || (uiLang === "hu" ? "A stíluselemzés sikertelen." : "Style analysis failed."), true);
  } finally {
    button.textContent = old;
  }
}

async function generateSkillSuggestion() {
  const button = document.getElementById("generateSkillSuggestionBtn");
  button.disabled = true;
  const old = button.textContent;
  button.textContent = uiLang === "hu" ? "ELEMZÉS…" : "ANALYZING…";

  try {
    await window.BachSBOBackend.analyzeSkill();
    learningMessage(
      uiLang === "hu"
        ? "Függő Skill-javaslat létrehozva. Ez nem módosítja az aktív Skill-t."
        : "Pending Skill suggestion created. It will not change the active Skill."
    );
    await renderLearningDashboard();
  } catch (error) {
    learningMessage(error?.message || (uiLang === "hu" ? "A Skill elemzése sikertelen." : "Skill analysis failed."), true);
  } finally {
    button.textContent = old;
  }
}

async function signOut() {
  try {
    await window.BachSBOBackend.signOut();
    state = defaultState();
    selectedPatientId = null;
    backendReady = false;
    window.location.reload();
  } catch (error) {
    handleBackendError(error);
  }
}

function showSetupRequired() {
  modal(`
    <h3>Backend setup required</h3>
    <p>This branch uses Supabase instead of browser clinical-data storage.</p>
    <p>Configure <code>config.js</code>, apply both Supabase migrations, deploy <code>clinical-store</code>, and set its AI privacy secret.</p>
    <p class="subtle">See docs/BACKEND_SETUP.md and docs/PRIVACY.md.</p>
  `);
}

function showSignIn() {
  const adminEmail = window.BACH_SBO_CONFIG?.adminEmail || "";

  modal(uiLang === "hu" ? `
    <h3>Admin bejelentkezés</h3>
    <p class="subtle">${esc(adminEmail)}</p>
    <div class="field">
      <label>Jelszó</label>
      <input id="authPassword" type="password" autocomplete="current-password"
        minlength="6" placeholder="Admin jelszó" />
    </div>
    <div class="modal-actions">
      <button class="btn primary" id="passwordSignIn">BEJELENTKEZÉS</button>
    </div>
    <div id="authMessage" class="subtle"></div>
  ` : `
    <h3>Admin sign in</h3>
    <p class="subtle">${esc(adminEmail)}</p>
    <div class="field">
      <label>Password</label>
      <input id="authPassword" type="password" autocomplete="current-password"
        minlength="6" placeholder="Admin password" />
    </div>
    <div class="modal-actions">
      <button class="btn primary" id="passwordSignIn">SIGN IN</button>
    </div>
    <div id="authMessage" class="subtle"></div>
  `);

  const password = document.getElementById("authPassword");
  const button = document.getElementById("passwordSignIn");
  const message = document.getElementById("authMessage");

  const submit = async () => {
    if (password.value.length < 6) {
      message.textContent = uiLang === "hu" ? "A jelszónak legalább 6 karakterből kell állnia." : "Password must contain at least 6 characters.";
      return;
    }

    button.disabled = true;
    message.textContent = uiLang === "hu" ? "Bejelentkezés…" : "Signing in…";

    try {
      const session =
        await window.BachSBOBackend.signInWithPassword(password.value);
      currentUser = session.user;
      state = await window.BachSBOBackend.loadState();
      backendReady = true;
      password.value = "";
      closeModal();
      renderApp();
    } catch (error) {
      message.textContent = error?.message || "Sign in failed.";
      password.value = "";
      password.focus();
      button.disabled = false;
    }
  };

  button.onclick = submit;
  password.onkeydown = (event) => {
    if (event.key === "Enter") submit();
  };
  password.focus();
}

async function bootstrap() {
  try {
    const result = await window.BachSBOBackend.init();

    if (!result.configured) {
      showSetupRequired();
      return;
    }

    if (!result.session) {
      showSignIn();
      return;
    }

    currentUser = result.session.user;
    state = await window.BachSBOBackend.loadState();
    backendReady = true;
    closeModal();
    renderApp();
    void refreshShiftCaseCounter({ force: true });
  } catch (error) {
    console.error(error);
    modal(`
      <h3>Backend initialization failed</h3>
      <p>${esc(error?.message || "Unknown error")}</p>
      <p class="subtle">Check Supabase configuration and database migration.</p>
    `);
  }
}

async function applyAcceptedExtraction(caseId, items) {
  if (!caseId || caseId !== selectedPatientId) {
    throw new Error("The selected case changed. Review the extraction again.");
  }
  if (!backendReady || !state.shift) {
    throw new Error("Clinical backend is not ready.");
  }
  if (!window.BachAssistantCore?.applyItems) {
    throw new Error("Assistant apply core is unavailable.");
  }
  if (!Array.isArray(items) || !items.length) {
    throw new Error("No accepted extracted facts to apply.");
  }

  const current = collectForm();
  if (!current || current.id !== caseId) {
    throw new Error("The selected case changed. Review the extraction again.");
  }
  if (isCompleted(current)) {
    throw new Error("Reopen the completed case before applying extracted facts.");
  }

  const index = state.patients.findIndex((patient) => patient.id === caseId);
  if (index < 0) throw new Error("Selected case was not found.");

  // Capture the doctor's exact current draft, including unsaved form edits, before
  // any AI-derived change. This snapshot is restored if persistence fails.
  const doctorDraft = structuredClone(current);
  const applied = window.BachAssistantCore.applyItems(
    doctorDraft,
    items,
    () => crypto.randomUUID()
  );
  applied.updatedAt = nowIso();

  state.patients[index] = applied;
  stateDirty = true;

  try {
    // AI-assisted entry may update a still-incomplete active case. Persist the
    // accepted facts without requiring unrelated final-disposition fields; the
    // normal Save/Generate/Finalize workflow gates remain unchanged.
    const result = await persistNow({ allowIncompleteWorkflow: true });
    renderApp();
    return {
      patient: structuredClone(state.patients[index]),
      removed: Number(result?.removed || 0)
    };
  } catch (error) {
    // Fail closed: restore the doctor's draft rather than leaving partially
    // applied AI content in local state or on screen.
    state.patients[index] = doctorDraft;
    stateDirty = true;
    if (selectedPatientId === caseId) loadPatientForm();
    throw error;
  }
}

window.BachSBOClinicalUi = Object.freeze({
  applyAcceptedExtraction,
  applyCaseMetadata,
  autosaveCurrentCase,
  commitCurrentDraft,
  addInvestigation,
  getCaseMetadata,
  saveCaseMetadata,
  normalizeYob,
  ageFromYob,
  normalizeSex,
  normalizeArrivalMode,
  testEntryStatus: entryStatus,
  getPatientSnapshot,
  getPatientProgress
});

function flash(message) {
  const el = document.createElement("div");

  el.textContent = message;
  el.style.cssText =
    "position:fixed;right:20px;bottom:20px;background:#111827;color:#fff;padding:11px 14px;border-radius:9px;z-index:200;box-shadow:0 10px 30px rgba(0,0,0,.2)";

  document.body.appendChild(el);

  setTimeout(() => el.remove(), 1800);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[c]);
}

function attr(value) {
  return esc(value).replace(/`/g, "&#096;");
}

document.getElementById("patientForm").addEventListener("submit", (event) => {
  event.preventDefault();
});

document.getElementById("langEnBtn").onclick = () => { applyLanguage("en"); renderApp(); };
document.getElementById("langHuBtn").onclick = () => { applyLanguage("hu"); renderApp(); };
document.getElementById("patientsNav").onclick = () => setView("patients");
document.getElementById("aiLearningNav").onclick = () => setView("learning");
document.getElementById("adminNav").onclick = () => setView("admin");
document.getElementById("changeAdminPasswordBtn").onclick = changeAdminPassword;
document.getElementById("adminSignOutBtn").onclick = signOut;
document.getElementById("refreshLearningBtn").onclick = () =>
  renderLearningDashboard().catch(handleBackendError);
document.getElementById("generateStyleBtn").onclick = generateStyleCandidate;
document.getElementById("generateSkillSuggestionBtn").onclick =
  generateSkillSuggestion;

document.getElementById("startShiftBtn").onclick = startShift;
document.getElementById("addPatientBtn").onclick = addPatient;
["newSex", "newYob", "newComplaint"].forEach((id) => {
  document.getElementById(id).addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addPatient();
    }
  });
});
document.getElementById("savePatientBtn").onclick = savePatient;
document.getElementById("reopenCaseBtn").onclick = reopenCase;
document.getElementById("fDisposition").onchange = updateDispositionVisibility;
document.getElementById("addRecBtn").onclick = addRecommendation;
document.getElementById("addLabBtn").onclick = () => addInvestigation("lab");
document.getElementById("addRadiologyBtn").onclick = () => addInvestigation("imaging");
document.getElementById("addConsultBtn").onclick = () => addInvestigation("consultation");
document.getElementById("generateSummaryBtn").onclick = generateSummary;
document.getElementById("finalizeSummaryBtn").onclick = finalizeSummary;

document.getElementById("fSummary").addEventListener("input", () => {
  const patient = patientById(selectedPatientId);
  if (patient) {
    renderSummaryStatus(patient);
    refreshSummaryControls(patient);
  }
});

window.addEventListener("focus", () => {
  void refreshShiftCaseCounter({ force: true });
});
window.addEventListener("pageshow", () => {
  void refreshShiftCaseCounter({ force: true });
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void refreshShiftCaseCounter({ force: true });
  }
});

applyLanguage(uiLang);
syncFixedSummaryFooter();
bootstrap();
