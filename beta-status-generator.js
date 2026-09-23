(() => {
  "use strict";

  if (window.__bachSboStatusGeneratorInstalled) return;
  window.__bachSboStatusGeneratorInstalled = true;

  const VERSION = "2.0";
  const STORAGE_PREFIX = "bachtransbo.status-generator.v2:";
  const SECTIONS = ["A", "B", "C", "D", "E1", "E2", "E3", "E4", "E5", "E6"];
  const PARAMS = ["bloodPressure", "pulse", "temperature", "respiratoryRate", "spo2", "oxygen"];
  const STATUS_LEARNING_ENABLED = false;
  const STATUS_VOCAB = window.BachSBOStatusVocabulary || null;

  const SUBSECTION_OPTIONS = {
    A: [
      ["A1", "A1. Légút átjárhatóság"],
      ["A2", "A2. Beszéd"],
      ["A3", "A3. Váladék / szívás"],
      ["A4", "A4. Légúti hang"],
      ["A5", "A5. Idegentest"],
      ["A6", "A6. Airway device / tubus / tracheostoma"]
    ],
    B: [
      ["B1", "B1. Légzéstípus"],
      ["B2", "B2. Mellkas"],
      ["B3", "B3. Légzési hang"],
      ["B4", "B4. Mellékzörejek"],
      ["B5", "B5. Légzési munka"],
      ["B6", "B6. Cyanosis"]
    ],
    C: [
      ["C1", "C1. Pulzus / perfúzió"],
      ["C2", "C2. CRT"],
      ["C3", "C3. Perifériás perfúzió"],
      ["C4", "C4. Szívritmus"],
      ["C5", "C5. Szívzörej"],
      ["C6", "C6. Nyaki vénák"],
      ["C7", "C7. Vérzés"]
    ],
    D: [
      ["D1", "D1. Tudat — AVPU"],
      ["D2", "D2. GCS"],
      ["D3", "D3. Orientáció / mentális státusz"],
      ["D4", "D4. Beszéd / aphasia"],
      ["D5", "D5. Paresis"],
      ["D6", "D6. Facialis paresis"],
      ["D7", "D7. Pupilla"],
      ["D8", "D8. Nystagmus"],
      ["D9", "D9. Meningealis jelek"],
      ["D10", "D10. Sensorium / góctünet"]
    ],
    E1: [
      ["E1.1", "E1.1. Testalkat"],
      ["E1.2", "E1.2. Tápláltság"],
      ["E1.3", "E1.3. Általános állapot"],
      ["E1.4", "E1.4. Aktivitás / mozgás"]
    ],
    E2: [
      ["E2.1", "E2.1. Bőrszín"],
      ["E2.2", "E2.2. Turgor / hydration"],
      ["E2.3", "E2.3. Nyálkahártyák"],
      ["E2.4", "E2.4. Nyelv"]
    ],
    E3: [
      ["E3.1", "E3.1. Sérülés / külsérelmi nyom"]
    ],
    E4: [
      ["E4.1", "E4.1. Oedema"],
      ["E4.2", "E4.2. Aszimmetria"],
      ["E4.3", "E4.3. Körfogatkülönbség"],
      ["E4.4", "E4.4. Hőmérsékletkülönbség"],
      ["E4.5", "E4.5. MVT / DVT jelek"],
      ["E4.6", "E4.6. Deformitás"],
      ["E4.7", "E4.7. Mozgáskorlátozottság"]
    ],
    E5: [
      ["E5.1", "E5.1. Has alak / betapintás"],
      ["E5.2", "E5.2. Fájdalom"],
      ["E5.3", "E5.3. Nyomásérzékenység"],
      ["E5.4", "E5.4. Defanz"],
      ["E5.5", "E5.5. Resistentia"],
      ["E5.6", "E5.6. Hepar"],
      ["E5.7", "E5.7. Lien"],
      ["E5.8", "E5.8. Bélhang"]
    ],
    E6: [
      ["E6.1", "E6.1. Vesetáj"],
      ["E6.2", "E6.2. Urogenitalis"]
    ]
  };

  let activeCaseId = "";
  let activeShiftId = "";
  let activeState = null;
  let refreshTimer = null;
  let clinicalAutosaveTimer = null;

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalize(value) {
    return String(value || "")
      .toLocaleLowerCase("hu-HU")
      .replace(/\s+/g, " ")
      .trim();
  }

  function fold(value) {
    const folded = normalize(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return STATUS_VOCAB?.canonicalizeFolded?.(folded) || folded;
  }

  function ensureSentence(value) {
    let text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    text = text.charAt(0).toLocaleUpperCase("hu-HU") + text.slice(1);
    if (!/[.!?]$/.test(text)) text += ".";
    return text;
  }

  function manualFindingKey(section, target, raw) {
    const base = fold(section + "-" + target)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "status";
    let hash = 2166136261;
    for (const ch of normalize(raw)) {
      hash ^= ch.codePointAt(0) || 0;
      hash = Math.imul(hash, 16777619);
    }
    return ("manual-" + base + "-" + (hash >>> 0).toString(16)).slice(0, 64);
  }

  async function queueLearningFeedback(section, raw, text, target) {
    if (!STATUS_LEARNING_ENABLED) return { disabled: true };
    const api = window.BachSBOBackend;
    if (!api?.findingLearningConfirmMapping) return null;
    return api.findingLearningConfirmMapping({
      sourcePhrase: raw,
      mappingKind: target === "__append" ? "new" : "existing",
      findingKey: manualFindingKey(section, target, raw),
      canonicalLabel: text.replace(/[.!?]+$/g, ""),
      target,
      section,
      outputText: text,
      conflictText: "",
      attributes: {}
    });
  }

  function selectedCaseId() {
    return document.querySelector("#patientTbody tr.selected[data-id]")?.dataset.id || "";
  }

  function patientSnapshot(caseId) {
    return caseId ? window.BachSBOClinicalUi?.getPatientSnapshot?.(caseId) || null : null;
  }

  function blankState(shiftId, caseId) {
    return {
      version: VERSION,
      shiftId: shiftId || "",
      caseId: caseId || "",
      parameters: Object.fromEntries(PARAMS.map((key) => [key, ""])),
      inputs: Object.fromEntries(SECTIONS.map((key) => [key, ""])),
      confirmations: {},
      copiedAt: null,
      touched: false,
      updatedAt: new Date().toISOString()
    };
  }

  function storageKey(shiftId, caseId) {
    return STORAGE_PREFIX + String(shiftId || "") + ":" + String(caseId || "");
  }

  function normalizeState(value, shiftId, caseId) {
    const next = blankState(shiftId, caseId);
    if (!value || typeof value !== "object") return next;
    for (const key of PARAMS) next.parameters[key] = String(value.parameters?.[key] || "");
    for (const key of SECTIONS) next.inputs[key] = String(value.inputs?.[key] || "");
    next.confirmations = value.confirmations && typeof value.confirmations === "object"
      ? value.confirmations
      : {};
    next.copiedAt = value.copiedAt ? String(value.copiedAt) : null;
    next.touched = Boolean(value.touched);
    next.updatedAt = value.updatedAt ? String(value.updatedAt) : next.updatedAt;
    return next;
  }

  function loadState(shiftId, caseId) {
    try {
      const raw = window.localStorage.getItem(storageKey(shiftId, caseId));
      return normalizeState(raw ? JSON.parse(raw) : null, shiftId, caseId);
    } catch {
      return blankState(shiftId, caseId);
    }
  }

  function saveState() {
    if (!activeState || !activeShiftId || !activeCaseId) return;
    activeState.updatedAt = new Date().toISOString();
    try {
      window.localStorage.setItem(
        storageKey(activeShiftId, activeCaseId),
        JSON.stringify(activeState)
      );
    } catch {
      // Cache failure must not break the clinical form.
    }
  }

  function scheduleClinicalAutosave({ immediate = false } = {}) {
    clearTimeout(clinicalAutosaveTimer);
    if (immediate) {
      void window.BachSBOClinicalUi?.autosaveCurrentCase?.();
      return;
    }
    clinicalAutosaveTimer = window.setTimeout(() => {
      void window.BachSBOClinicalUi?.autosaveCurrentCase?.();
    }, 700);
  }

  function vitalsFromState() {
    return {
      version: 1,
      ...Object.fromEntries(PARAMS.map((key) => [key, String(activeState?.parameters?.[key] || "").trim()]))
    };
  }

  function syncClinicalVitals({ immediate = false } = {}) {
    if (!activeState || !activeCaseId) return;
    const patient = patientSnapshot(activeCaseId);
    const next = vitalsFromState();
    const current = patient?.vitals && Number(patient.vitals.version) === 1
      ? patient.vitals
      : null;
    const changed = !current || PARAMS.some(
      (key) => String(current?.[key] || "").trim() !== next[key]
    );
    if (!changed) return;

    window.BachSBOClinicalUi?.setVitalsData?.(activeCaseId, next);
    scheduleClinicalAutosave({ immediate });
  }

  function hydrateCanonicalVitals(patient) {
    if (!activeState) return;
    const canonical = patient?.vitals && Number(patient.vitals.version) === 1
      ? patient.vitals
      : null;

    if (canonical) {
      let changed = false;
      for (const key of PARAMS) {
        const value = String(canonical[key] || "");
        if (activeState.parameters[key] !== value) {
          activeState.parameters[key] = value;
          changed = true;
        }
      }
      if (changed) saveState();
      return;
    }

    // Pre-vitals-release cases may still have parameters only in the local cache.
    // Migrate them once into canonical patient state; afterwards DB wins, even when empty.
    if (PARAMS.some((key) => String(activeState.parameters?.[key] || "").trim())) {
      syncClinicalVitals();
    }
  }

  function confirmationKey(section, raw) {
    return section + "|" + normalize(raw);
  }

  function confirmedFinding(section, raw) {
    const item = activeState?.confirmations?.[confirmationKey(section, raw)];
    if (!item?.text) return null;
    return {
      text: String(item.text),
      target: String(item.target || "__append")
    };
  }

  function addFinding(list, section, concept, value, attrs, raw, explicitNormal, source) {
    list.push({
      section,
      concept,
      value: value || "",
      attributes: attrs || {},
      raw: String(raw || ""),
      explicitNormal: Boolean(explicitNormal),
      source: source || "input"
    });
  }

  function sideOf(text) {
    const n = fold(text);
    const patterns = STATUS_VOCAB?.sidePatterns || [
      { value: "bilateral", pattern: "\\b(mko\\.?|m\\.k\\.o\\.?|mindket|ketoldali|bilat|bilateralis|bilateral)\\b" },
      { value: "right", pattern: "\\b(jobb|jobb oldali|j\\.o\\.?)\\b" },
      { value: "left", pattern: "\\b(bal|bal oldali|b\\.o\\.?)\\b" }
    ];
    return patterns.find((item) => new RegExp(item.pattern).test(n))?.value || "";
  }

  function locationOf(text) {
    const n = fold(text);
    const patterns = STATUS_VOCAB?.locationPatterns || [
      { value: "basal", pattern: "basal|bazal|basis|tudobazis" },
      { value: "apical", pattern: "apical|csucsi" },
      { value: "diffuse", pattern: "diffuz|diffuse" },
      { value: "epigastric", pattern: "epigastr|epigasztr|gyomorszaj" },
      { value: "periumbilical", pattern: "periumbil|koldok korul|koldoktaj" },
      { value: "RLQ", pattern: "\\b(?:jaq|j\\s*\\.?\\s*a\\s*\\.?\\s*q|jobb also|jobb alhas|jobb csipoarok|jobb iliac|right lower)\\b" },
      { value: "LLQ", pattern: "\\b(?:baq|b\\s*\\.?\\s*a\\s*\\.?\\s*q|bal also|bal alhas|bal csipoarok|bal iliac|left lower)\\b" },
      { value: "RUQ", pattern: "\\b(?:jfq|j\\s*\\.?\\s*f\\s*\\.?\\s*q|jobb felso|jobb bordaiv(?:\\s+alatt(?:i)?)?|jobb hypochondr|jobb subcost|right upper)\\b" },
      { value: "LUQ", pattern: "\\b(?:bfq|b\\s*\\.?\\s*f\\s*\\.?\\s*q|bal felso|bal bordaiv(?:\\s+alatt(?:i)?)?|bal hypochondr|bal subcost|left upper)\\b" },
      { value: "lower_abdomen", pattern: "\\balhas\\b" }
    ];
    return patterns.find((item) => new RegExp(item.pattern).test(n))?.value || "";
  }

  function splitInput(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .split(/[\n;]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function conceptIsNegated(text, conceptSource) {
    const n = fold(text);
    const negation = STATUS_VOCAB?.negationSource ||
      "(?:nincs|nincsenek|nem\\s+(?:eszlelheto|lathato|hallhato|tapinthato|jelez|all\\s+fenn|igazolhato|van)|negativ)";
    return new RegExp(
      "(?:" + conceptSource + ").{0,36}(?:" + negation + ")|" +
      "(?:" + negation + ").{0,36}(?:" + conceptSource + ")|" +
      "\\bnem\\s+(?:" + conceptSource + ")"
    ).test(n);
  }

  function addExplicitNormalNote(list, section, text, raw, target = "") {
    addFinding(
      list,
      section,
      "explicit_normal_note",
      "none",
      { text: ensureSentence(text), target },
      raw,
      true,
      "input"
    );
  }

  function parseA(raw) {
    const n = fold(raw);
    const out = [];

    if (/legut.*(atjarhat|szabad)|szabad legut|airway.*patent/.test(n)) addFinding(out, "A", "airway_patency", "patent", {}, raw, true);
    if (/legut.*(nem atjar|obstruct|elzart)|airway.*obstruct/.test(n)) addFinding(out, "A", "airway_patency", "obstructed", {}, raw);

    if (/nem tud beszel/.test(n)) addFinding(out, "A", "speech", "unable", {}, raw);
    else if (/\bbeszel\b/.test(n)) addFinding(out, "A", "speech", "speaks", {}, raw, true);

    if (conceptIsNegated(n, "valadek|szivas|suction")) {
      addExplicitNormalNote(out, "A", "Légúti váladék nincs.", raw, "A3");
    } else if (/szivast igenyel|szivas szukseges|suction|valadek|valadekos/.test(n)) {
      addFinding(out, "A", "airway_secretions", "present", {}, raw);
    }

    if (conceptIsNegated(n, "stridor")) addExplicitNormalNote(out, "A", "Stridor nincs.", raw, "A4");
    else if (/stridor/.test(n)) addFinding(out, "A", "stridor", "present", {}, raw);

    if (conceptIsNegated(n, "horkol")) addExplicitNormalNote(out, "A", "Horkoló légzés nincs.", raw, "A4");
    else if (/horkol/.test(n)) addFinding(out, "A", "snoring_respiration", "present", {}, raw);

    if (conceptIsNegated(n, "gurgul")) addExplicitNormalNote(out, "A", "Gurgulázó légzés nincs.", raw, "A4");
    else if (/gurgul/.test(n)) addFinding(out, "A", "gurgling_respiration", "present", {}, raw);

    if (conceptIsNegated(n, "idegentest")) addExplicitNormalNote(out, "A", "Légúti idegentest nincs.", raw, "A5");
    else if (/idegentest/.test(n)) addFinding(out, "A", "foreign_body", "present", {}, raw);

    const deviceNegated = conceptIsNegated(n, "tracheost|tubus|intubal|airway adjunct|guedel|wendel");
    if (deviceNegated) {
      addExplicitNormalNote(out, "A", "Légúti segédeszköz nincs.", raw, "A6");
    } else if (/tracheost|tracheostoma|tracheostomia/.test(n)) {
      addFinding(out, "A", "airway_device", "tracheostomy", {}, raw);
    } else if (/ett\b|et tubus|endotrache|tubus|intubal/.test(n)) {
      addFinding(out, "A", "airway_device", "ett", {}, raw);
    } else if (/airway adjunct|guedel|wendel|nasopharyngealis tubus|oropharyngealis tubus/.test(n)) {
      addFinding(out, "A", "airway_device", "adjunct", {}, raw);
    }

    return out;
  }

  function parseB(raw) {
    const n = fold(raw);
    const out = [];
    const side = sideOf(raw);
    const location = locationOf(raw);

    const respiratoryNegatives = [
      ["tachydyspno", "Tachydyspnoe nincs."],
      ["tachypno", "Tachypnoe nincs."],
      ["bradypno", "Bradypnoe nincs."],
      ["kussmaul", "Kussmaul-légzés nincs."],
      ["pihego|gasp", "Pihegő légzés nincs."],
      ["apno", "Apnoe nincs."],
      ["dyspno|nehezlegzes|fulladas", "Dyspnoe nincs."]
    ];
    let respiratoryNegated = false;
    for (const [pattern, text] of respiratoryNegatives) {
      if (conceptIsNegated(n, pattern)) {
        addExplicitNormalNote(out, "B", text, raw, "B1");
        respiratoryNegated = true;
        break;
      }
    }

    if (!respiratoryNegated) {
      if (/tachydyspno/.test(n)) addFinding(out, "B", "respiratory_pattern", "tachydyspnoea", {}, raw);
      else if (/tachypno/.test(n)) addFinding(out, "B", "respiratory_pattern", "tachypnoea", {}, raw);
      else if (/bradypno/.test(n)) addFinding(out, "B", "respiratory_pattern", "bradypnoea", {}, raw);
      else if (/kussmaul/.test(n)) addFinding(out, "B", "respiratory_pattern", "kussmaul", {}, raw);
      else if (/pihego|gasp/.test(n)) addFinding(out, "B", "respiratory_pattern", "gasping", {}, raw);
      else if (/apno/.test(n)) addFinding(out, "B", "respiratory_pattern", "apnoea", {}, raw);
      else if (/dyspno/.test(n)) addFinding(out, "B", "respiratory_pattern", "dyspnoea", {}, raw);
      else if (/eupno/.test(n)) addFinding(out, "B", "respiratory_pattern", "eupnoea", {}, raw, true);
    }

    if (conceptIsNegated(n, "mellkas.*aszim|aszimmetri|deform|serul")) {
      addExplicitNormalNote(out, "B", "Mellkasi aszimmetria, deformitás vagy sérülés nincs.", raw, "B2");
    } else {
      if (/emphysem/.test(n)) addFinding(out, "B", "chest_shape", "emphysematous", {}, raw);
      if (/hordo alak|hordomellkas/.test(n)) addFinding(out, "B", "chest_shape", "barrel", {}, raw);
      if (/mellkas.*aszim|aszimmetrikus mellkas/.test(n)) addFinding(out, "B", "chest_shape", "asymmetric", { side }, raw);
      if (/mellkas.*serul/.test(n)) addFinding(out, "B", "chest_shape", "trauma", { side }, raw);
      if (/mellkas.*deform/.test(n)) addFinding(out, "B", "chest_shape", "deformity", { side }, raw);
      if (/mellkas.*reszaranyos/.test(n)) addFinding(out, "B", "chest_shape", "normal", {}, raw, true);
    }

    let breathType = "";
    if (/legzes.*hianyz|nem hallhato.*legzes|legzes.*nem hallhato|silent lung/.test(n)) breathType = "absent";
    else if (/gyengult.*legzes|legzes.*gyengult|halkabb.*legzes|csokkent.*legzes/.test(n)) breathType = "diminished";
    else if (/erdes.*legzes|legzes.*erdes|durva.*legzes/.test(n)) breathType = "harsh";
    else if (/bronchialis|bronchial breathing/.test(n)) breathType = "bronchial";
    else if (/pulmo.*tiszta|tiszta.*pulmo|tiszta legzes|alaplegzes.*normal|normal.*alaplegzes|sejtes alaplegzes|vesicularis/.test(n)) breathType = "normal";
    if (breathType) addFinding(out, "B", "breath_sound", breathType, { side, location }, raw, breathType === "normal");

    const extraSounds = [
      ["aproholyagu.*szorty|finom.*(?:crep|szorty)|fine crackles", "fine_crackles", "Apróhólyagú szörtyzörej nincs."],
      ["nagyholyagu.*szorty|durva.*szorty|coarse crackles", "coarse_crackles", "Nagyhólyagú szörtyzörej nincs."],
      ["crepitat|crep\\b|crackles|ropogas", "crepitation", "Crepitatio nincs."],
      ["sipol|wheez|sibil", "wheeze", "Sípolás nincs."],
      ["bugas|bugo|rhonch", "rhonchus", "Búgás nincs."],
      ["stridor", "stridor", "Stridor nincs."]
    ];
    for (const [pattern, value, normalText] of extraSounds) {
      if (conceptIsNegated(n, pattern)) {
        addExplicitNormalNote(out, "B", normalText, raw, "B4");
      } else if (new RegExp(pattern).test(n)) {
        addFinding(out, "B", "adventitious_sound", value, { side, location }, raw);
      }
    }

    const workNegated = conceptIsNegated(n, "segedlegzoizm|intercostalis.*behuz|bordakozi.*behuz|retractio|paradox.*legzes|fokozott.*legzesi munka");
    if (workNegated) {
      addFinding(out, "B", "breathing_work", "normal", {}, raw, true);
    } else {
      if (/segedlegzoizm|accessory muscle/.test(n)) addFinding(out, "B", "breathing_work", "accessory_muscles", {}, raw);
      if (/intercostalis.*behuz|bordakozi.*behuz|retractio/.test(n)) addFinding(out, "B", "breathing_work", "intercostal_retraction", {}, raw);
      if (/paradox.*legzes/.test(n)) addFinding(out, "B", "breathing_work", "paradoxical", {}, raw);
      if (/legzesi munka.*fokoz|fokozott.*legzesi munka/.test(n)) addFinding(out, "B", "breathing_work", "increased", {}, raw);
      if (/legzesi munka.*normal/.test(n)) addFinding(out, "B", "breathing_work", "normal", {}, raw, true);
    }

    if (conceptIsNegated(n, "cyanos|cianoz")) {
      addFinding(out, "B", "cyanosis", "none", {}, raw, true);
    } else if (/periferias.*(?:cyanos|cianoz)/.test(n)) {
      addFinding(out, "B", "cyanosis", "peripheral", {}, raw);
    } else if (/centralis.*(?:cyanos|cianoz)/.test(n)) {
      addFinding(out, "B", "cyanosis", "central", {}, raw);
    } else if (/galler.*(?:cyanos|cianoz)/.test(n)) {
      addFinding(out, "B", "cyanosis", "collar", {}, raw);
    }

    return out;
  }

  function parseC(raw) {
    const n = fold(raw);
    const out = [];
    const side = sideOf(raw);

    if (conceptIsNegated(n, "pulzusaszim")) {
      addFinding(out, "C", "peripheral_pulse", "normal", {}, raw, true);
    } else {
      if (/jol tapinthato.*periferias pulzus|periferias pulzus.*jol tapinthato|perif.*pulzus.*jo/.test(n)) addFinding(out, "C", "peripheral_pulse", "normal", {}, raw, true);
      if (/gyengen tapinthato.*periferias pulzus|gyenge.*periferias pulzus|filiformis.*pulzus|perif.*pulzus.*gyenge/.test(n)) addFinding(out, "C", "peripheral_pulse", "weak", {}, raw);
      if (/periferian.*nem tapinthato.*centralisan.*tapinthato/.test(n)) addFinding(out, "C", "peripheral_pulse", "central_only", {}, raw);
      if (/pulzusaszim/.test(n)) addFinding(out, "C", "peripheral_pulse", "asymmetric", { side }, raw);
    }

    const crtMatch = raw.match(/CRT\s*<?\s*(\d+(?:[.,]\d+)?)\s*s?/i);
    if (crtMatch) {
      const seconds = Number(crtMatch[1].replace(",", "."));
      addFinding(out, "C", "crt", "numeric", { seconds }, raw, seconds < 2);
    }

    const perfusionTerms = [
      ["huvos.*perifer|hideg.*perifer|hideg acr", "cool", "Hűvös perifériák nincsenek."],
      ["verejtezik|verejtekezes|diaphoresis", "sweating", "Verejtékezés nincs."],
      ["sapadt|pallor", "pallor", "Sápadtság nincs."],
      ["marvanyoz", "mottled", "Márványozottság nincs."]
    ];
    for (const [pattern, value, normalText] of perfusionTerms) {
      if (conceptIsNegated(n, pattern)) {
        addExplicitNormalNote(out, "C", normalText, raw, "C3");
      } else if (new RegExp(pattern).test(n)) {
        addFinding(out, "C", "peripheral_perfusion", value, {}, raw);
      }
    }

    if (conceptIsNegated(n, "arrhythmi|aritmi|irregular|szabalytalan")) {
      addFinding(out, "C", "heart_rhythm", "regular", {}, raw, true);
    } else if (/tachyarrhythmi|tachyarritmi/.test(n)) {
      addFinding(out, "C", "heart_rhythm", "tachyarrhythmic", {}, raw);
    } else if (/arrhythmi|aritmi|irregularis|irregular|irreg\.?|szabalytalan/.test(n)) {
      addFinding(out, "C", "heart_rhythm", "arrhythmic", {}, raw);
    } else if (/ritmusos|regularis|regular\b|reg\.?(?:\s|$)|szabalyos/.test(n)) {
      addFinding(out, "C", "heart_rhythm", "regular", {}, raw, true);
    }

    if (conceptIsNegated(n, "tachycard")) addExplicitNormalNote(out, "C", "Tachycardia nincs.", raw, "C4");
    else if (/tachycard/.test(n)) addFinding(out, "C", "heart_rate_state", "tachycardic", {}, raw);

    if (conceptIsNegated(n, "bradycard")) addExplicitNormalNote(out, "C", "Bradycardia nincs.", raw, "C4");
    else if (/bradycard/.test(n)) addFinding(out, "C", "heart_rate_state", "bradycardic", {}, raw);

    const noMurmur = conceptIsNegated(n, "zorej|szivzorej") || /zorejmentes/.test(n);
    if (noMurmur) {
      addFinding(out, "C", "cardiac_murmur", "none", {}, raw, true);
    } else {
      if (/systoles.*zorej|zorej.*systoles|syst\.?\s*zorej/.test(n)) {
        const grade = raw.match(/([1-6])\s*\/\s*6/);
        addFinding(out, "C", "cardiac_murmur", "systolic", {
          grade: grade ? grade[1] + "/6" : "",
          maximum: /apex/i.test(raw) ? "apex" : "",
          radiation: /axilla/i.test(raw) ? "axilla" : ""
        }, raw);
      }
      if (/diastoles.*zorej|zorej.*diastoles|diast\.?\s*zorej/.test(n)) {
        const grade = raw.match(/([1-6])\s*\/\s*6/);
        addFinding(out, "C", "cardiac_murmur", "diastolic", { grade: grade ? grade[1] + "/6" : "" }, raw);
      }
    }

    if (conceptIsNegated(n, "nyaki venak.*telt|jugularis.*telt|jvp.*emelkedett")) {
      addFinding(out, "C", "jvp", "normal", {}, raw, true);
    } else if (/nyaki venak.*teltek|jugularis.*(?:telt|tagult)|jvp.*emelkedett/.test(n)) {
      addFinding(out, "C", "jvp", "distended", {}, raw);
    } else if (/nyaki venak.*nem teltek|jugularis.*nem telt|jvp.*normal/.test(n)) {
      addFinding(out, "C", "jvp", "normal", {}, raw, true);
    }

    if (conceptIsNegated(n, "aktiv.*verzes|eros.*verzes|verzes")) {
      addFinding(out, "C", "active_bleeding", "none", {}, raw, true);
    } else if (/aktiv.*verzes|eros.*verzes/.test(n)) {
      addFinding(out, "C", "active_bleeding", "present", { location: locationOf(raw) }, raw);
    }
    return out;
  }

  function parseD(raw) {
    const n = fold(raw);
    const out = [];
    const side = sideOf(raw);

    const avpu = raw.match(/\bAVPU\s*[:=-]?\s*([AVPU])\b/i);
    if (avpu) addFinding(out, "D", "avpu", avpu[1].toUpperCase(), {}, raw, avpu[1].toUpperCase() === "A");
    else if (/\balert\b/.test(n)) addFinding(out, "D", "avpu", "A", {}, raw, true);

    const gcsComponents = raw.match(/GCS\s*(\d{1,2})?\s*\(?\s*E\s*(\d)\s*V\s*(\d)\s*M\s*(\d)\s*\)?/i);
    if (gcsComponents) {
      const eye = Number(gcsComponents[2]);
      const verbal = Number(gcsComponents[3]);
      const motor = Number(gcsComponents[4]);
      addFinding(out, "D", "gcs", "components", { eye, verbal, motor, total: eye + verbal + motor }, raw, eye + verbal + motor === 15);
    } else {
      const gcsTotal = raw.match(/GCS\s*[:=-]?\s*(\d{1,2})/i);
      if (gcsTotal) addFinding(out, "D", "gcs", "total", { total: Number(gcsTotal[1]) }, raw, Number(gcsTotal[1]) === 15);
    }

    if (conceptIsNegated(n, "dezorient")) addFinding(out, "D", "orientation", "oriented", {}, raw, true);
    else if (/terben.*idoben.*sajat szemelyere.*orient/.test(n)) addFinding(out, "D", "orientation", "oriented", {}, raw, true);
    else if (/dezorient/.test(n)) addFinding(out, "D", "orientation", "disoriented", {}, raw);

    const mentalTerms = [
      ["zavart|confus", "confused", "Zavartság nincs."],
      ["agitalt|agitat", "agitated", "Agitáltság nincs."],
      ["somnol", "somnolent", "Somnolentia nincs."],
      ["sopor", "soporous", "Sopor nincs."],
      ["comat|coma\\b", "comatose", "Coma nincs."]
    ];
    if (/demencia/.test(n) && !conceptIsNegated(n, "demencia")) addFinding(out, "D", "mental_state", "known_dementia", {}, raw);
    for (const [pattern, value, normalText] of mentalTerms) {
      if (conceptIsNegated(n, pattern)) addExplicitNormalNote(out, "D", normalText, raw, "D3");
      else if (new RegExp(pattern).test(n)) addFinding(out, "D", "mental_state", value, {}, raw);
    }

    if (conceptIsNegated(n, "aphasia")) {
      addFinding(out, "D", "aphasia", "none", {}, raw, true);
    } else if (/motoros.*aphasia/.test(n)) {
      addFinding(out, "D", "aphasia", "motor", {}, raw);
    } else if (/sensoros.*aphasia/.test(n)) {
      addFinding(out, "D", "aphasia", "sensory", {}, raw);
    } else if (/globalis.*aphasia/.test(n)) {
      addFinding(out, "D", "aphasia", "global", {}, raw);
    }

    if (conceptIsNegated(n, "paresis|hemiparesis|monoparesis|paraparesis|tetraparesis")) {
      addFinding(out, "D", "paresis", "none", {}, raw, true);
    } else if (/latens.*paresis/.test(n)) {
      addFinding(out, "D", "paresis", "latent", { side }, raw);
    } else if (/hemiparesis/.test(n)) {
      addFinding(out, "D", "paresis", "hemiparesis", { side }, raw);
    } else if (/monoparesis/.test(n)) {
      addFinding(out, "D", "paresis", "monoparesis", { side }, raw);
    } else if (/paraparesis/.test(n)) {
      addFinding(out, "D", "paresis", "paraparesis", { side }, raw);
    } else if (/tetraparesis/.test(n)) {
      addFinding(out, "D", "paresis", "tetraparesis", { side }, raw);
    } else if (/vegtagparesis|paresis/.test(n) && !/facialis/.test(n) && !/latens/.test(n)) {
      addFinding(out, "D", "paresis", "limb", { side }, raw);
    }

    if (conceptIsNegated(n, "facialis paresis")) addFinding(out, "D", "facial_paresis", "none", {}, raw, true);
    else if (/facialis paresis/.test(n)) addFinding(out, "D", "facial_paresis", "present", { side }, raw);

    const pupilNegatives = [
      ["anisocor", "Anisocoria nincs."],
      ["myosis", "Myosis nincs."],
      ["mydriasis", "Mydriasis nincs."]
    ];
    let pupilSpecificNegation = false;
    for (const [pattern, normalText] of pupilNegatives) {
      if (conceptIsNegated(n, pattern)) {
        addExplicitNormalNote(out, "D", normalText, raw, "D7");
        pupilSpecificNegation = true;
      }
    }
    if (!pupilSpecificNegation) {
      if (/anisocor/.test(n)) addFinding(out, "D", "pupil", "anisocoria", { side }, raw);
      if (/myosis/.test(n)) addFinding(out, "D", "pupil", "miosis", { side }, raw);
      if (/mydriasis/.test(n)) addFinding(out, "D", "pupil", "mydriasis", { side }, raw);
    }
    if (/fenymerev|fenyre nem reag/.test(n)) addFinding(out, "D", "pupil", "nonreactive", { side }, raw);
    if (/pupillak.*kerek.*egyenlo.*fenyre reag|pupillak.*isocor.*fotoreag|isocor.*fenyreakcio.*megtartott/.test(n)) addFinding(out, "D", "pupil", "normal", {}, raw, true);

    if (conceptIsNegated(n, "nystagmus")) {
      addFinding(out, "D", "nystagmus", "none", {}, raw, true);
    } else if (/horizontalis.*nystag/.test(n)) {
      addFinding(out, "D", "nystagmus", "horizontal", { side }, raw);
    } else if (/vertikalis.*nystag/.test(n)) {
      addFinding(out, "D", "nystagmus", "vertical", {}, raw);
    } else if (/rotatoros.*nystag/.test(n)) {
      addFinding(out, "D", "nystagmus", "rotatory", {}, raw);
    }

    if (conceptIsNegated(n, "meningealis|tarkokotott")) {
      addFinding(out, "D", "meningeal", "none", {}, raw, true);
    } else if (/tarkokotott/.test(n)) {
      addFinding(out, "D", "meningeal", "neck_stiffness", {}, raw);
    } else if (/meningealis.*pozitiv/.test(n)) {
      addFinding(out, "D", "meningeal", "positive", {}, raw);
    } else if (/tarko.*szabad/.test(n)) {
      addFinding(out, "D", "meningeal", "none", {}, raw, true);
    }

    if (/sensorium.*szimmetrikusan.*megtartott/.test(n)) addFinding(out, "D", "sensorium", "symmetric", {}, raw, true);

    if (conceptIsNegated(n, "goc(?:tunet|jel)|neurologiai.*goc|focalis.*neurologiai")) {
      addFinding(out, "D", "focal_neuro", "none", {}, raw, true);
    } else if (/goc(?:tunet|jel).*pozitiv|neurologiai.*goc|focalis.*neurologiai.*deficit/.test(n)) {
      addFinding(out, "D", "focal_neuro", "present", { side }, raw);
    }
    return out;
  }

  function parseE1(raw) {
    const n = fold(raw);
    const out = [];
    if (/jo altalanos allapot/.test(n)) addFinding(out, "E1", "general_condition", "good", {}, raw, true);
    if (conceptIsNegated(n, "elesett|rossz altalanos allapot|sulyos altalanos allapot")) {
      addExplicitNormalNote(out, "E1", "Elesettség nincs.", raw, "E1.3");
    } else {
      if (/kozepes|kp\.? altalanos allapot|kozepsulyos altalanos allapot/.test(n)) addFinding(out, "E1", "general_condition", "medium", {}, raw);
      if (/rossz altalanos allapot|elesett|sulyos altalanos allapot/.test(n)) addFinding(out, "E1", "general_condition", "poor", {}, raw);
    }
    if (/kp\.? fejlett/.test(n)) addFinding(out, "E1", "build", "medium", {}, raw, true);
    if (/kp\.? taplalt/.test(n)) addFinding(out, "E1", "nutrition", "medium", {}, raw, true);
    if (!conceptIsNegated(n, "sovany") && /sovany/.test(n)) addFinding(out, "E1", "nutrition", "thin", {}, raw);
    if (!conceptIsNegated(n, "cachec") && /cachec/.test(n)) addFinding(out, "E1", "nutrition", "cachectic", {}, raw);
    if (!conceptIsNegated(n, "obes|elhiz") && /obes|elhiz/.test(n)) addFinding(out, "E1", "nutrition", "obese", {}, raw);
    return out;
  }

  function parseE2(raw) {
    const n = fold(raw);
    const out = [];
    if (/borszin.*normal/.test(n)) addFinding(out, "E2", "skin_color", "normal", {}, raw, true);

    if (conceptIsNegated(n, "sapadt|pallor")) addExplicitNormalNote(out, "E2", "Sápadtság nincs.", raw, "E2.1");
    else if (/sapadt|pallor/.test(n)) addFinding(out, "E2", "skin_color", "pallor", {}, raw);

    if (conceptIsNegated(n, "icter|subicter")) addExplicitNormalNote(out, "E2", "Icterus nincs.", raw, "E2.1");
    else if (/icter|subicter/.test(n)) addFinding(out, "E2", "skin_color", "jaundice", {}, raw);

    if (conceptIsNegated(n, "exsic|dehydrat")) addExplicitNormalNote(out, "E2", "Exsiccosis nincs.", raw, "E2.2");
    else if (/exsic|dehydrat/.test(n)) addFinding(out, "E2", "hydration", "dehydrated", {}, raw);

    if (conceptIsNegated(n, "csokkent.*turgor")) addFinding(out, "E2", "skin_turgor", "normal", {}, raw, true);
    else if (/csokkent.*turgor/.test(n)) addFinding(out, "E2", "skin_turgor", "reduced", {}, raw);
    if (/turgor.*megtartott/.test(n)) addFinding(out, "E2", "skin_turgor", "normal", {}, raw, true);

    if (conceptIsNegated(n, "szaraz.*nyalkahartya")) addFinding(out, "E2", "mucosa", "normal", {}, raw, true);
    else if (/szaraz.*nyalkahartya/.test(n)) addFinding(out, "E2", "mucosa", "dry", {}, raw);
    if (/nyalkahartyak.*kp.*verteltek/.test(n)) addFinding(out, "E2", "mucosa", "normal", {}, raw, true);

    if (conceptIsNegated(n, "nyelv.*szaraz|szaraz.*nyelv")) addFinding(out, "E2", "tongue", "normal", {}, raw, true);
    else if (/nyelv.*szaraz/.test(n)) addFinding(out, "E2", "tongue", "dry", {}, raw);
    if (/nyelv.*nedves/.test(n)) addFinding(out, "E2", "tongue", "normal", {}, raw, true);
    return out;
  }

  function parseE3(raw) {
    const n = fold(raw);
    const out = [];
    const injuryPattern = "serules|seb|haematoma|hematoma|horzsol|laceratio|zuzodas|contusio|vagas|szurt seb|harapott seb|kulserelmi nyom";
    if (conceptIsNegated(n, injuryPattern)) {
      addFinding(out, "E3", "injury", "none", {}, raw, true);
    } else if (new RegExp(injuryPattern).test(n)) {
      addFinding(out, "E3", "injury", "present", { side: sideOf(raw), location: locationOf(raw) }, raw);
    }
    return out;
  }

  function parseE4(raw) {
    const n = fold(raw);
    const out = [];
    const side = sideOf(raw);
    if (/vegtagok.*alakilag.*funkcionalisan.*epek/.test(n)) addFinding(out, "E4", "limb_status", "normal", {}, raw, true);

    const limbTerms = [
      ["oedema|odema|vizeny|vizenyos|pitting", "limb_edema", "Oedema nincs.", "E4.1"],
      ["aszimmetri", "limb_asymmetry", "Végtagaszimmetria nincs.", "E4.2"],
      ["korfogatkulonbseg", "circumference_difference", "Körfogatkülönbség nincs.", "E4.3"],
      ["homersekletkulonbseg", "temperature_difference", "Hőmérsékletkülönbség nincs.", "E4.4"],
      ["mvt|dvt|homans", "dvt_sign", "MVT/DVT jelek nincsenek.", "E4.5"],
      ["deformitas", "limb_deformity", "Végtagi deformitás nincs.", "E4.6"],
      ["mozgas.*korlatoz", "restricted_movement", "Mozgáskorlátozottság nincs.", "E4.7"]
    ];

    for (const [pattern, concept, normalText, target] of limbTerms) {
      if (conceptIsNegated(n, pattern)) {
        addExplicitNormalNote(out, "E4", normalText, raw, target);
      } else if (new RegExp(pattern).test(n)) {
        addFinding(out, "E4", concept, "present", { side }, raw);
      }
    }
    return out;
  }

  function parseE5(raw) {
    const n = fold(raw);
    const out = [];
    const location = locationOf(raw);

    if (/mellkas szintjeben.*puha.*betapinthato|has.*puha.*betapinthato|puha.*has/.test(n)) addFinding(out, "E5", "abdomen_shape", "normal", {}, raw, true);
    if (!conceptIsNegated(n, "elodomborodo") && /elodomborodo/.test(n)) addFinding(out, "E5", "abdomen_shape", "distended", {}, raw);
    if (!conceptIsNegated(n, "beesett") && /beesett/.test(n)) addFinding(out, "E5", "abdomen_shape", "scaphoid", {}, raw);
    if (!conceptIsNegated(n, "deszkakemeny") && /deszkakemeny/.test(n)) addFinding(out, "E5", "abdomen_shape", "board_like", {}, raw);
    else if (!conceptIsNegated(n, "feszes") && /feszes/.test(n)) addFinding(out, "E5", "abdomen_shape", "tense", {}, raw);

    if (conceptIsNegated(n, "hasi fajdalom|fajdalom")) {
      addExplicitNormalNote(out, "E5", "Hasi fájdalom nincs.", raw, "E5.2");
    } else if (/hasi fajdalom|fajdalom/.test(n) && !/nyomaserzekeny/.test(n)) {
      let character = "";
      if (/gorcsos/.test(n)) character = "cramping";
      else if (/ego/.test(n)) character = "burning";
      else if (/szuro/.test(n)) character = "stabbing";
      addFinding(out, "E5", "abdominal_pain", "present", { location, character }, raw);
    }

    const tendernessPattern = "nyomaserzekeny|ny\\.?\\s*erz|nyom\\.?\\s*erz|\\berzekeny(?:seg)?\\b";
    if (conceptIsNegated(n, tendernessPattern)) {
      addExplicitNormalNote(out, "E5", "Nyomásérzékenység nincs.", raw, "E5.3");
    } else if (new RegExp(tendernessPattern).test(n)) {
      addFinding(out, "E5", "abdominal_tenderness", "present", { location }, raw);
    }

    const guardingPattern = "defanz|defense|muscularis vedekezes";
    if (conceptIsNegated(n, guardingPattern)) {
      addFinding(out, "E5", "guarding", "none", { location }, raw, true);
    } else if (new RegExp(guardingPattern).test(n)) {
      addFinding(out, "E5", "guarding", "present", { location }, raw);
    }

    if (/resistentia/.test(n)) {
      addFinding(out, "E5", "abdominal_mass", conceptIsNegated(n, "resistentia") ? "none" : "present", { location }, raw, conceptIsNegated(n, "resistentia"));
    }

    if (/hepar/.test(n)) addFinding(out, "E5", "liver_palpation", /nem tap/.test(n) ? "not_palpable" : "palpable", {}, raw, /nem tap/.test(n));
    if (/lep|lien/.test(n)) addFinding(out, "E5", "spleen_palpation", /nem tap/.test(n) ? "not_palpable" : "palpable", {}, raw, /nem tap/.test(n));

    // "Bélhang nincs" remains abnormal by definition, so this concept intentionally
    // does NOT use the general negation-to-normal rule.
    if (/belhang/.test(n)) {
      let value = "";
      if (/nincs|nem\s+hall|silent/.test(n)) value = "absent";
      else if (/elenk(?:ebb)?|fokozott|hyperactiv|hangosabb/.test(n)) value = "increased";
      else if (/renyhe|csokkent|halk(?:abb)?|gyer|ritka|hypoactiv/.test(n)) value = "decreased";
      else if (/normal|megtartott|szabalyos|hallhato|hallhatok/.test(n)) value = "normal";

      // Never silently convert an unfamiliar bowel-sound description to normal.
      // If no supported intensity/state is found, leave it unresolved so the
      // physician review UI can classify it explicitly.
      if (value) {
        addFinding(out, "E5", "bowel_sounds", value, {}, raw, value === "normal");
      }
    }
    return out;
  }

  function parseE6(raw) {
    const n = fold(raw);
    const out = [];
    const side = sideOf(raw);
    if (/vesetaj.*nem erzekeny|vesetajak.*nem erzekeny|giordano.*negativ|veseutes.*negativ/.test(n) ||
        conceptIsNegated(n, "giordano.*pozitiv|veseutes.*pozitiv")) {
      addFinding(out, "E6", "renal_angle_tenderness", "none", {}, raw, true);
    } else if (/vesetaj.*erzekeny|giordano.*pozitiv|veseutes.*pozitiv/.test(n)) {
      addFinding(out, "E6", "renal_angle_tenderness", "present", { side }, raw);
    }
    return out;
  }

  const PARSERS = {
    A: parseA,
    B: parseB,
    C: parseC,
    D: parseD,
    E1: parseE1,
    E2: parseE2,
    E3: parseE3,
    E4: parseE4,
    E5: parseE5,
    E6: parseE6
  };

  function isFindingContinuation(section, text) {
    const n = fold(text);
    if (section === "C" && /^(axilla|nyak|carotis|hat|hati|bal axilla|jobb axilla).*(fele|iranyaba).*(vezet|sugar)/.test(n)) {
      return true;
    }
    if (section === "C" && /^(punctum maximum|pm)\b/.test(n)) return true;
    if (section === "D" && /^(e\d|v\d|m\d)\b/.test(n)) return true;
    return false;
  }

  function splitRecognizedDelimited(section, chunk, separator, joiner) {
    const parser = PARSERS[section];
    const pieces = String(chunk || "").split(separator).map((part) => part.trim()).filter(Boolean);
    if (pieces.length < 2) return [chunk];

    const recognized = pieces.map((part) => parser(part).length > 0);
    if (!recognized.some(Boolean)) return [chunk];

    const grouped = [];
    for (let i = 0; i < pieces.length; i += 1) {
      const part = pieces[i];
      if (!recognized[i] && isFindingContinuation(section, part) && grouped.length) {
        grouped[grouped.length - 1] += joiner + part;
      } else {
        grouped.push(part);
      }
    }
    return grouped;
  }

  function smartSplitInput(section, value) {
    const hardChunks = splitInput(value);
    const output = [];

    for (const chunk of hardChunks) {
      let pieces = splitRecognizedDelimited(section, chunk, /,\s*/, ", ");
      const expanded = [];
      for (const piece of pieces) {
        expanded.push(...splitRecognizedDelimited(section, piece, /\s+és\s+/i, " és "));
      }
      pieces = expanded;

      for (const piece of pieces) {
        const plusParts = splitRecognizedDelimited(section, piece, /\s+\+\s+/, " + ");
        output.push(...plusParts);
      }
    }

    return output.map((part) => part.trim()).filter(Boolean);
  }

  function parseAll() {
    const findings = [];
    const unknowns = [];

    for (const section of SECTIONS) {
      for (const raw of smartSplitInput(section, activeState?.inputs?.[section])) {
        const parsed = PARSERS[section](raw);
        if (parsed.length) {
          findings.push(...parsed);
          continue;
        }
        const confirmed = confirmedFinding(section, raw);
        if (confirmed) {
          addFinding(
            findings,
            section,
            "custom",
            "confirmed",
            { text: confirmed.text, target: confirmed.target || "__append" },
            raw,
            false,
            "manual_confirmation"
          );
        } else {
          unknowns.push({ section, raw });
        }
      }
    }

    const pulse = Number(String(activeState?.parameters?.pulse || "").replace(",", ".").match(/-?\d+(?:\.\d+)?/)?.[0] || NaN);
    if (Number.isFinite(pulse)) {
      const hasExplicitRate = findings.some((item) => item.section === "C" && item.concept === "heart_rate_state");
      if (!hasExplicitRate && pulse > 100) {
        addFinding(findings, "C", "heart_rate_state", "tachycardic", { pulse }, "Pulsus " + pulse, false, "parameter");
      } else if (!hasExplicitRate && pulse < 60) {
        addFinding(findings, "C", "heart_rate_state", "bradycardic", { pulse }, "Pulsus " + pulse, false, "parameter");
      }
    }

    return { findings, unknowns };
  }

  function firstFinding(findings, section, concept) {
    return findings.find((item) => item.section === section && item.concept === concept) || null;
  }

  function findingsFor(findings, section, concept) {
    return findings.filter((item) => item.section === section && item.concept === concept);
  }

  function sideText(side) {
    if (side === "right") return "Jobb";
    if (side === "left") return "Bal";
    if (side === "bilateral") return "Mko.";
    return "";
  }

  function locationText(location) {
    const map = {
      basal: "basalis",
      apical: "apicalis",
      diffuse: "diffúzan",
      epigastric: "epigastrialis",
      periumbilical: "periumbilicalis",
      lower_abdomen: "alhasi",
      RLQ: "jobb alhasi / JAQ",
      LLQ: "bal alhasi / BAQ",
      RUQ: "jobb felső hasi / JFQ",
      LUQ: "bal felső hasi / BFQ"
    };
    return map[location] || "";
  }

  function segment(text, kind, source, title) {
    return {
      text: String(text || ""),
      kind: kind || "base",
      source: source || "",
      title: title || ""
    };
  }

  function customTargetItems(findings, section, target) {
    return findings.filter((item) =>
      item.section === section &&
      item.concept === "custom" &&
      item.source === "manual_confirmation" &&
      String(item.attributes?.target || "__append") === target
    );
  }

  function customTargetText(findings, section, target) {
    return customTargetItems(findings, section, target)
      .map((item) => ensureSentence(item.attributes?.text || ""))
      .filter(Boolean)
      .join(" ");
  }

  function pushTargetOverride(parts, findings, section, target) {
    const text = customTargetText(findings, section, target);
    if (!text) return false;
    parts.push(segment(text + " ", "modified", section));
    return true;
  }

  function appendExplicitNormalNotes(parts, findings, section) {
    for (const item of findingsFor(findings, section, "explicit_normal_note")) {
      const text = ensureSentence(item.attributes?.text || "");
      if (!text) continue;
      parts.push(segment(text + " ", "explicit", section));
    }
  }

  function appendNewCustoms(parts, findings, section) {
    for (const item of findingsFor(findings, section, "custom")) {
      if (item.source !== "manual_confirmation") continue;
      if (String(item.attributes?.target || "__append") !== "__append") continue;
      parts.push(segment(ensureSentence(item.attributes?.text || "") + " ", "modified", section));
    }
  }

  function renderA(findings) {
    const parts = [];
    const airway = firstFinding(findings, "A", "airway_patency");
    const speech = firstFinding(findings, "A", "speech");

    if (!pushTargetOverride(parts, findings, "A", "A1")) {
      if (airway?.value === "obstructed") parts.push(segment("Légút nem átjárható. ", "modified", "A"));
      else parts.push(segment("Légutak átjárhatók. ", airway?.explicitNormal ? "explicit" : "base", "A"));
    }

    if (!pushTargetOverride(parts, findings, "A", "A2")) {
      if (speech?.value === "unable") parts.push(segment("A beteg nem tud beszélni. ", "modified", "A"));
      else parts.push(segment("A beteg beszél. ", speech?.explicitNormal ? "explicit" : "base", "A"));
    }

    if (!pushTargetOverride(parts, findings, "A", "A3") && firstFinding(findings, "A", "airway_secretions")) {
      parts.push(segment("Légúti váladék miatt szívást igényel. ", "modified", "A"));
    }

    if (!pushTargetOverride(parts, findings, "A", "A4")) {
      if (firstFinding(findings, "A", "stridor")) parts.push(segment("Stridor hallható. ", "modified", "A"));
      if (firstFinding(findings, "A", "snoring_respiration")) parts.push(segment("Horkoló légzés észlelhető. ", "modified", "A"));
      if (firstFinding(findings, "A", "gurgling_respiration")) parts.push(segment("Gurgulázó légzés hallható. ", "modified", "A"));
    }

    if (!pushTargetOverride(parts, findings, "A", "A5") && firstFinding(findings, "A", "foreign_body")) {
      parts.push(segment("Légúti idegentest észlelhető. ", "modified", "A"));
    }

    if (!pushTargetOverride(parts, findings, "A", "A6")) {
      const device = firstFinding(findings, "A", "airway_device");
      if (device?.value === "tracheostomy") parts.push(segment("Tracheostoma van. ", "modified", "A"));
      if (device?.value === "ett") parts.push(segment("Endotrachealis tubus van. ", "modified", "A"));
      if (device?.value === "adjunct") parts.push(segment("Légúti segédeszköz van. ", "modified", "A"));
    }

    appendExplicitNormalNotes(parts, findings, "A");
    appendNewCustoms(parts, findings, "A");
    return parts;
  }

  function renderB(findings) {
    const parts = [];

    if (!pushTargetOverride(parts, findings, "B", "B1")) {
      const pattern = firstFinding(findings, "B", "respiratory_pattern");
      const patternText = {
        tachypnoea: "Tachypnoés.",
        tachydyspnoea: "Tachydyspnoés.",
        bradypnoea: "Bradypnoés.",
        kussmaul: "Kussmaul-légzés észlelhető.",
        gasping: "Pihegő légzés észlelhető.",
        apnoea: "Apnoe észlelhető.",
        dyspnoea: "Dyspnoés.",
        dyspnoea_absent: "Dyspnoe nincs.",
        eupnoea: "Eupnoés."
      }[pattern?.value] || "Eupnoés.";
      const patternKind = pattern?.value === "dyspnoea_absent"
        ? "explicit"
        : pattern && pattern.value !== "eupnoea"
        ? "modified"
        : pattern?.explicitNormal
        ? "explicit"
        : "base";
      parts.push(segment(patternText + " ", patternKind, "B"));
    }

    if (!pushTargetOverride(parts, findings, "B", "B2")) {
      const chest = firstFinding(findings, "B", "chest_shape");
      let chestText = "Mellkas: részarányos.";
      if (chest?.value === "emphysematous") chestText = "Mellkas: emphysemás.";
      if (chest?.value === "barrel") chestText = "Mellkas: hordó alakú.";
      if (chest?.value === "asymmetric") chestText = "Mellkas: aszimmetrikus.";
      if (chest?.value === "trauma") chestText = "Mellkasi sérülés látható.";
      if (chest?.value === "deformity") chestText = "Mellkasi deformitás látható.";
      parts.push(segment(chestText + " ", chest && chest.value !== "normal" ? "modified" : chest?.explicitNormal ? "explicit" : "base", "B"));
      parts.push(segment("Rekeszek szimmetrikusan kitérnek. ", "base", "B"));
    }

    if (!pushTargetOverride(parts, findings, "B", "B3")) {
      const breathSounds = findingsFor(findings, "B", "breath_sound");
      const abnormalBreathSounds = breathSounds.filter((item) => item.value !== "normal");
      if (!abnormalBreathSounds.length) {
        const explicitNormalBreath = breathSounds.find((item) => item.explicitNormal);
        parts.push(segment("Alaplégzés normális. Oldalkülönbség nincs. ", explicitNormalBreath ? "explicit" : "base", "B"));
      } else {
        for (const breath of abnormalBreathSounds) {
          const s = sideText(breath.attributes.side);
          const l = locationText(breath.attributes.location);
          const typeText = {
            diminished: "gyengült",
            absent: "nem hallható",
            harsh: "érdes",
            bronchial: "bronchialis"
          }[breath.value] || breath.value;
          const prefix = [s, l].filter(Boolean).join(" ");
          const sentence = breath.value === "absent"
            ? (prefix ? prefix + " " : "") + "légzés nem hallható. "
            : (prefix ? prefix + " " : "") + typeText + " légzés hallható. ";
          parts.push(segment(sentence, "modified", "B"));
        }
      }
    }

    if (!pushTargetOverride(parts, findings, "B", "B4")) {
      for (const item of findingsFor(findings, "B", "adventitious_sound")) {
        const s = sideText(item.attributes.side);
        const l = locationText(item.attributes.location);
        const typeText = {
          crepitation: "crepitatio",
          fine_crackles: "apróhólyagú szörtyzörej",
          coarse_crackles: "nagyhólyagú szörtyzörej",
          wheeze: "sípolás",
          rhonchus: "búgás",
          stridor: "stridor"
        }[item.value] || item.value;
        const prefix = [s, l].filter(Boolean).join(" ");
        parts.push(segment((prefix ? prefix + " " : "") + typeText + " hallható. ", "modified", "B"));
      }
    }

    if (!pushTargetOverride(parts, findings, "B", "B5")) {
      const work = firstFinding(findings, "B", "breathing_work");
      let workText = "Légzési munka normális.";
      if (work?.value === "increased") workText = "Légzési munka fokozott.";
      if (work?.value === "accessory_muscles") workText = "Segédlégzőizmokat használ.";
      if (work?.value === "intercostal_retraction") workText = "Intercostalis behúzódás észlelhető.";
      if (work?.value === "paradoxical") workText = "Paradox légzés észlelhető.";
      parts.push(segment(workText + " ", work && work.value !== "normal" ? "modified" : work?.explicitNormal ? "explicit" : "base", "B"));
    }

    if (!pushTargetOverride(parts, findings, "B", "B6")) {
      const cyanosis = firstFinding(findings, "B", "cyanosis");
      let cyanosisText = "Cyanosis nincs.";
      if (cyanosis?.value === "peripheral") cyanosisText = "Perifériás cyanosis észlelhető.";
      if (cyanosis?.value === "central") cyanosisText = "Centrális cyanosis észlelhető.";
      if (cyanosis?.value === "collar") cyanosisText = "Gallércyanosis észlelhető.";
      parts.push(segment(cyanosisText + " ", cyanosis && cyanosis.value !== "none" ? "modified" : cyanosis?.explicitNormal ? "explicit" : "base", "B"));
    }

    appendExplicitNormalNotes(parts, findings, "B");
    appendNewCustoms(parts, findings, "B");
    return parts;
  }

  function renderC(findings) {
    const parts = [];

    if (!pushTargetOverride(parts, findings, "C", "C1")) {
      const pulse = firstFinding(findings, "C", "peripheral_pulse");
      let pulseText = "Jól tapintható perifériás pulzusok.";
      if (pulse?.value === "weak") pulseText = "Gyengén tapintható perifériás pulzusok.";
      if (pulse?.value === "central_only") pulseText = "Periférián pulzus nem tapintható, centrálisan tapintható.";
      if (pulse?.value === "asymmetric") pulseText = "Pulzusaszimmetria észlelhető.";
      parts.push(segment(pulseText + " ", pulse && pulse.value !== "normal" ? "modified" : pulse?.explicitNormal ? "explicit" : "base", "C"));
    }

    if (!pushTargetOverride(parts, findings, "C", "C2")) {
      const crt = firstFinding(findings, "C", "crt");
      if (crt?.attributes?.seconds != null) {
        parts.push(segment("CRT " + crt.attributes.seconds + " s. ", crt.attributes.seconds >= 2 ? "modified" : crt.explicitNormal ? "explicit" : "base", "C"));
      } else {
        parts.push(segment("CRT <2 s. ", "base", "C"));
      }
    }

    if (!pushTargetOverride(parts, findings, "C", "C3")) {
      for (const item of findingsFor(findings, "C", "peripheral_perfusion")) {
        const txt = {
          cool: "Hűvös perifériák.",
          sweating: "A beteg verejtékezik.",
          pallor: "A beteg sápadt.",
          mottled: "Márványozott bőr észlelhető."
        }[item.value];
        if (txt) parts.push(segment(txt + " ", "modified", "C"));
      }
    }

    if (!pushTargetOverride(parts, findings, "C", "C4")) {
      const rhythm = firstFinding(findings, "C", "heart_rhythm");
      let heartText = "Szívhangok ritmusosak, tiszták.";
      if (rhythm?.value === "arrhythmic") heartText = "Szívhangok arrhythmiásak, tiszták.";
      if (rhythm?.value === "tachyarrhythmic") heartText = "Tachyarrhythmiás szívműködés észlelhető.";
      parts.push(segment(heartText + " ", rhythm && rhythm.value !== "regular" ? "modified" : rhythm?.explicitNormal ? "explicit" : "base", "C"));

      const rate = firstFinding(findings, "C", "heart_rate_state");
      if (rate?.value === "tachycardic") parts.push(segment("Tachycardia észlelhető. ", rate.source === "parameter" ? "derived" : "modified", "C", rate.source === "parameter" ? "Pulsus >100/min alapján" : ""));
      if (rate?.value === "bradycardic") parts.push(segment("Bradycardia észlelhető. ", rate.source === "parameter" ? "derived" : "modified", "C", rate.source === "parameter" ? "Pulsus <60/min alapján" : ""));
    }

    if (!pushTargetOverride(parts, findings, "C", "C5")) {
      const murmurs = findingsFor(findings, "C", "cardiac_murmur");
      const abnormalMurmurs = murmurs.filter((item) => item.value !== "none");
      if (!abnormalMurmurs.length) {
        const explicitNoMurmur = murmurs.find((item) => item.explicitNormal);
        parts.push(segment("Zörej nem hallható. ", explicitNoMurmur ? "explicit" : "base", "C"));
      } else {
        for (const murmur of abnormalMurmurs) {
          let txt = "";
          if (murmur.attributes.grade) txt += murmur.attributes.grade + " ";
          txt += murmur.value === "diastolic" ? "diastolés zörej" : "systolés zörej";
          if (murmur.attributes.maximum === "apex") txt += " az apex felett";
          if (murmur.attributes.radiation === "axilla") txt += ", axilla felé vezetődik";
          parts.push(segment(ensureSentence(txt) + " ", "modified", "C"));
        }
      }
    }

    if (!pushTargetOverride(parts, findings, "C", "C6")) {
      const jvp = firstFinding(findings, "C", "jvp");
      parts.push(segment(
        jvp?.value === "distended" ? "Nyaki vénák teltek. " : "Nyaki vénák nem teltek. ",
        jvp?.value === "distended" ? "modified" : jvp?.explicitNormal ? "explicit" : "base",
        "C"
      ));
    }

    if (!pushTargetOverride(parts, findings, "C", "C7")) {
      for (const item of findingsFor(findings, "C", "active_bleeding")) {
        if (item.value === "none") parts.push(segment("Aktív vérzés nincs. ", "explicit", "C"));
        else parts.push(segment("Aktív vérzés észlelhető. ", "modified", "C"));
      }
    }

    appendExplicitNormalNotes(parts, findings, "C");
    appendNewCustoms(parts, findings, "C");
    return parts;
  }

  function renderD(findings) {
    const parts = [];

    if (!pushTargetOverride(parts, findings, "D", "D1")) {
      const avpu = firstFinding(findings, "D", "avpu");
      parts.push(segment("AVPU: " + (avpu?.value || "A") + ". ", avpu && avpu.value !== "A" ? "modified" : avpu?.explicitNormal ? "explicit" : "base", "D"));
    }

    if (!pushTargetOverride(parts, findings, "D", "D2")) {
      const gcs = firstFinding(findings, "D", "gcs");
      if (gcs?.attributes?.eye) {
        const a = gcs.attributes;
        parts.push(segment("GCS " + a.total + " (E" + a.eye + " V" + a.verbal + " M" + a.motor + "). ", a.total !== 15 ? "modified" : gcs.explicitNormal ? "explicit" : "base", "D"));
      } else if (gcs?.attributes?.total) {
        parts.push(segment("GCS " + gcs.attributes.total + ". ", gcs.attributes.total !== 15 ? "modified" : gcs.explicitNormal ? "explicit" : "base", "D"));
      } else {
        parts.push(segment("GCS 15 (E4 V5 M6). ", "base", "D"));
      }
    }

    if (!pushTargetOverride(parts, findings, "D", "D3")) {
      const orientation = firstFinding(findings, "D", "orientation");
      const mentalStates = findingsFor(findings, "D", "mental_state");
      if (orientation?.value === "disoriented") parts.push(segment("Dezorientált. ", "modified", "D"));
      else parts.push(segment("Térben, időben és saját személyére orientált. ", orientation?.explicitNormal ? "explicit" : "base", "D"));
      for (const mental of mentalStates) {
        const txt = {
          known_dementia: "Ismert dementia.",
          confused: "Zavart.",
          agitated: "Agitált.",
          somnolent: "Somnolens.",
          soporous: "Soporosus.",
          comatose: "Comatosus."
        }[mental.value];
        if (txt) parts.push(segment(txt + " ", "modified", "D"));
      }
    }

    if (!pushTargetOverride(parts, findings, "D", "D4")) {
      const aphasia = firstFinding(findings, "D", "aphasia");
      const aphasiaText = {
        motor: "Motoros aphasia észlelhető.",
        sensory: "Sensoros aphasia észlelhető.",
        global: "Globalis aphasia észlelhető."
      }[aphasia?.value] || "Aphasia nincs.";
      parts.push(segment(aphasiaText + " ", aphasia && aphasia.value !== "none" ? "modified" : aphasia?.explicitNormal ? "explicit" : "base", "D"));
    }

    if (!pushTargetOverride(parts, findings, "D", "D5")) {
      const pareses = findingsFor(findings, "D", "paresis");
      const abnormalPareses = pareses.filter((item) => item.value !== "none");
      if (!abnormalPareses.length) {
        const explicitNoParesis = pareses.find((item) => item.explicitNormal);
        parts.push(segment("Paresis nem észlelhető. ", explicitNoParesis ? "explicit" : "base", "D"));
      } else {
        for (const paresis of abnormalPareses) {
          const s = sideText(paresis.attributes.side);
          const txt = {
            latent: "latens paresis",
            hemiparesis: "hemiparesis",
            monoparesis: "monoparesis",
            paraparesis: "paraparesis",
            tetraparesis: "tetraparesis",
            limb: "végtagparesis"
          }[paresis.value] || "végtagparesis";
          parts.push(segment((s ? s + " oldali " : "") + txt + " észlelhető. ", "modified", "D"));
        }
      }
    }

    if (!pushTargetOverride(parts, findings, "D", "D6")) {
      const face = firstFinding(findings, "D", "facial_paresis");
      if (!face || face.value === "none") parts.push(segment("Facialis paresis nincs. ", face?.explicitNormal ? "explicit" : "base", "D"));
      else parts.push(segment((sideText(face.attributes.side) ? sideText(face.attributes.side) + " oldali " : "") + "facialis paresis észlelhető. ", "modified", "D"));
    }

    if (!pushTargetOverride(parts, findings, "D", "D7")) {
      const pupils = findingsFor(findings, "D", "pupil");
      const abnormalPupils = pupils.filter((item) => item.value !== "normal");
      if (!abnormalPupils.length) {
        const explicitNormalPupil = pupils.find((item) => item.explicitNormal);
        parts.push(segment("Pupillák kerekek, egyenlőek, fényre reagálnak. ", explicitNormalPupil ? "explicit" : "base", "D"));
      } else {
        for (const pupil of abnormalPupils) {
          const s = sideText(pupil.attributes.side);
          const txt = {
            anisocoria: "Anisocoria észlelhető.",
            miosis: (s ? s + " oldali " : "") + "myosis észlelhető.",
            mydriasis: (s ? s + " oldali " : "") + "mydriasis észlelhető.",
            nonreactive: (s ? s + " oldali " : "") + "pupilla fényre nem reagál."
          }[pupil.value];
          if (txt) parts.push(segment(txt + " ", "modified", "D"));
        }
      }
    }

    if (!pushTargetOverride(parts, findings, "D", "D8")) {
      const nyst = firstFinding(findings, "D", "nystagmus");
      if (!nyst || nyst.value === "none") parts.push(segment("Nystagmus nincs. ", nyst?.explicitNormal ? "explicit" : "base", "D"));
      else parts.push(segment(({ horizontal:"Horizontális", vertical:"Vertikális", rotatory:"Rotatoros" }[nyst.value] || "") + " nystagmus észlelhető. ", "modified", "D"));
    }

    if (!pushTargetOverride(parts, findings, "D", "D9")) {
      const mening = firstFinding(findings, "D", "meningeal");
      if (!mening || mening.value === "none") parts.push(segment("Meningealis izgalmi jelek nincsenek. ", mening?.explicitNormal ? "explicit" : "base", "D"));
      else parts.push(segment(mening.value === "neck_stiffness" ? "Tarkókötöttség észlelhető. " : "Meningealis jel pozitív. ", "modified", "D"));
    }

    if (!pushTargetOverride(parts, findings, "D", "D10")) {
      const sensorium = firstFinding(findings, "D", "sensorium");
      parts.push(segment("Sensorium szimmetrikusan megtartott. ", sensorium?.explicitNormal ? "explicit" : "base", "D"));

      const focal = firstFinding(findings, "D", "focal_neuro");
      if (!focal || focal.value === "none") parts.push(segment("Neurológiai góctünet nincs. ", focal?.explicitNormal ? "explicit" : "base", "D"));
      else parts.push(segment((sideText(focal.attributes.side) ? sideText(focal.attributes.side) + " oldali " : "") + "neurológiai góctünet észlelhető. ", "modified", "D"));
    }

    appendExplicitNormalNotes(parts, findings, "D");
    appendNewCustoms(parts, findings, "D");
    return parts;
  }

  function renderE(findings) {
    const parts = [];

    const e1CoreTargets = ["E1.1", "E1.2", "E1.3"];
    const hasE1CoreOverride = e1CoreTargets.some((target) => customTargetText(findings, "E1", target));
    if (hasE1CoreOverride) {
      for (const target of e1CoreTargets) pushTargetOverride(parts, findings, "E1", target);
    } else {
      const condition = firstFinding(findings, "E1", "general_condition");
      const nutrition = firstFinding(findings, "E1", "nutrition");
      let e1 = "Kp. fejlett, kp. táplált, jó általános állapotú beteg.";
      if (condition?.value === "medium") e1 = "Kp. fejlett, kp. táplált, közepes általános állapotú beteg.";
      if (condition?.value === "poor") e1 = "Kp. fejlett, kp. táplált, rossz általános állapotú beteg.";
      if (nutrition?.value === "thin") e1 = e1.replace("kp. táplált", "sovány");
      if (nutrition?.value === "cachectic") e1 = e1.replace("kp. táplált", "cachecticus");
      if (nutrition?.value === "obese") e1 = e1.replace("kp. táplált", "obes");
      const e1Modified = Boolean(
        (condition && condition.value !== "good") ||
        (nutrition && nutrition.value !== "medium")
      );
      parts.push(segment(e1 + " ", e1Modified ? "modified" : (condition?.explicitNormal || nutrition?.explicitNormal) ? "explicit" : "base", "E1"));
    }
    pushTargetOverride(parts, findings, "E1", "E1.4");
    appendExplicitNormalNotes(parts, findings, "E1");
    appendNewCustoms(parts, findings, "E1");

    const hasE2SkinOverride = customTargetText(findings, "E2", "E2.1") || customTargetText(findings, "E2", "E2.2");
    if (hasE2SkinOverride) {
      pushTargetOverride(parts, findings, "E2", "E2.1");
      pushTargetOverride(parts, findings, "E2", "E2.2");
    } else {
      const skin = firstFinding(findings, "E2", "skin_color");
      const turgor = firstFinding(findings, "E2", "skin_turgor");
      const hydration = firstFinding(findings, "E2", "hydration");
      let skinText = "Bőrszín normális, turgora megtartott.";
      if (skin?.value === "pallor") skinText = "Bőr sápadt, turgora " + (turgor?.value === "reduced" ? "csökkent." : "megtartott.");
      if (skin?.value === "jaundice") skinText = "Bőr icterusos, turgora " + (turgor?.value === "reduced" ? "csökkent." : "megtartott.");
      if (!skin && turgor?.value === "reduced") skinText = "Bőrszín normális, turgora csökkent.";
      parts.push(segment(skinText + " ", (skin && skin.value !== "normal") || turgor?.value === "reduced" ? "modified" : (skin?.explicitNormal || turgor?.explicitNormal) ? "explicit" : "base", "E2"));
      if (hydration?.value === "dehydrated") parts.push(segment("Exsiccosis jelei észlelhetők. ", "modified", "E2"));
    }

    if (!pushTargetOverride(parts, findings, "E2", "E2.3")) {
      const mucosa = firstFinding(findings, "E2", "mucosa");
      parts.push(segment(
        mucosa?.value === "dry" ? "Nyálkahártyák szárazak. " : "Nyálkahártyák kp. vérteltek. ",
        mucosa?.value === "dry" ? "modified" : mucosa?.explicitNormal ? "explicit" : "base",
        "E2"
      ));
    }

    if (!pushTargetOverride(parts, findings, "E2", "E2.4")) {
      const tongue = firstFinding(findings, "E2", "tongue");
      parts.push(segment(
        tongue?.value === "dry" ? "Nyelv száraz. " : "Nyelv nedves. ",
        tongue?.value === "dry" ? "modified" : tongue?.explicitNormal ? "explicit" : "base",
        "E2"
      ));
    }
    appendExplicitNormalNotes(parts, findings, "E2");
    appendNewCustoms(parts, findings, "E2");

    if (!pushTargetOverride(parts, findings, "E3", "E3.1")) {
      const injuries = findingsFor(findings, "E3", "injury");
      const abnormalInjuries = injuries.filter((item) => item.value !== "none");
      if (!abnormalInjuries.length) {
        const explicitNoInjury = injuries.find((item) => item.explicitNormal);
        parts.push(segment("Külsérelmi nyom nincs. ", explicitNoInjury ? "explicit" : "base", "E3"));
      } else {
        for (const injury of abnormalInjuries) {
          parts.push(segment(ensureSentence(injury.raw) + " ", "modified", "E3"));
        }
      }
    }
    appendExplicitNormalNotes(parts, findings, "E3");
    appendNewCustoms(parts, findings, "E3");

    const e4TargetConcept = {
      "E4.1": "limb_edema",
      "E4.2": "limb_asymmetry",
      "E4.3": "circumference_difference",
      "E4.4": "temperature_difference",
      "E4.5": "dvt_sign",
      "E4.6": "limb_deformity",
      "E4.7": "restricted_movement"
    };
    const hasE4Custom = Object.keys(e4TargetConcept).some((target) => customTargetText(findings, "E4", target));
    const e4KnownAbnormal = findings.filter((item) => item.section === "E4" && item.concept !== "custom" && !item.explicitNormal && item.value !== "none");
    if (!hasE4Custom && !e4KnownAbnormal.length) {
      const explicit = findings.some((item) => item.section === "E4" && item.explicitNormal);
      parts.push(segment("Végtagok alakilag és funkcionálisan épek. ", explicit ? "explicit" : "base", "E4"));
    } else {
      for (const [target, concept] of Object.entries(e4TargetConcept)) {
        if (pushTargetOverride(parts, findings, "E4", target)) continue;
        for (const item of findingsFor(findings, "E4", concept).filter((entry) => !entry.explicitNormal && entry.value !== "none")) {
          const s = sideText(item.attributes.side);
          const prefix = s ? s + " oldali " : "";
          const txt = {
            limb_edema: prefix + "végtagi oedema észlelhető.",
            limb_asymmetry: "Végtagaszimmetria észlelhető.",
            circumference_difference: "Végtagi körfogatkülönbség észlelhető.",
            temperature_difference: "Végtagi hőmérsékletkülönbség észlelhető.",
            dvt_sign: prefix + "MVT/DVT jelek észlelhetők.",
            limb_deformity: prefix + "végtagi deformitás észlelhető.",
            restricted_movement: prefix + "mozgáskorlátozottság észlelhető."
          }[concept];
          if (txt) parts.push(segment(txt + " ", "modified", "E4"));
        }
      }
    }
    appendExplicitNormalNotes(parts, findings, "E4");
    appendNewCustoms(parts, findings, "E4");

    if (!pushTargetOverride(parts, findings, "E5", "E5.1")) {
      const shape = firstFinding(findings, "E5", "abdomen_shape");
      const shapeText = {
        distended: "Has elődomborodó.",
        scaphoid: "Has beesett.",
        tense: "Has feszes.",
        board_like: "Has deszkakemény."
      }[shape?.value] || "Has mellkas szintjében, puha, betapintható.";
      parts.push(segment(shapeText + " ", shape && shape.value !== "normal" ? "modified" : shape?.explicitNormal ? "explicit" : "base", "E5"));
    }

    if (!pushTargetOverride(parts, findings, "E5", "E5.2")) {
      for (const item of findingsFor(findings, "E5", "abdominal_pain")) {
        const l = locationText(item.attributes.location);
        const ch = { cramping:"görcsös", burning:"égő", stabbing:"szúró" }[item.attributes.character] || "";
        parts.push(segment((l ? l + " " : "") + (ch ? ch + " " : "") + "hasi fájdalmat jelez. ", "modified", "E5"));
      }
    }

    if (!pushTargetOverride(parts, findings, "E5", "E5.3")) {
      for (const tenderness of findingsFor(findings, "E5", "abdominal_tenderness")) {
        if (tenderness.value === "present") parts.push(segment((locationText(tenderness.attributes.location) ? locationText(tenderness.attributes.location) + " " : "") + "nyomásérzékenység észlelhető. ", "modified", "E5"));
      }
    }

    if (!pushTargetOverride(parts, findings, "E5", "E5.4")) {
      for (const guarding of findingsFor(findings, "E5", "guarding")) {
        if (guarding.value === "present") {
          parts.push(segment((locationText(guarding.attributes.location) ? locationText(guarding.attributes.location) + " " : "") + "defanz észlelhető. ", "modified", "E5"));
        } else if (guarding.value === "none") {
          parts.push(segment((locationText(guarding.attributes.location) ? locationText(guarding.attributes.location) + " " : "") + "defanz nincs. ", "explicit", "E5"));
        }
      }
    }

    if (!pushTargetOverride(parts, findings, "E5", "E5.5")) {
      const mass = firstFinding(findings, "E5", "abdominal_mass");
      parts.push(segment(
        mass?.value === "present" ? "Kóros resistentia tapintható. " : "Kóros resistentia nincs. ",
        mass?.value === "present" ? "modified" : mass?.explicitNormal ? "explicit" : "base",
        "E5"
      ));
    }

    if (!pushTargetOverride(parts, findings, "E5", "E5.6")) {
      const liver = firstFinding(findings, "E5", "liver_palpation");
      if (liver?.value === "palpable") parts.push(segment("Hepar tapintható. ", "modified", "E5"));
      else parts.push(segment("Hepar nem tapintható. ", liver?.explicitNormal ? "explicit" : "base", "E5"));
    }

    if (!pushTargetOverride(parts, findings, "E5", "E5.7")) {
      const spleen = firstFinding(findings, "E5", "spleen_palpation");
      if (spleen?.value === "palpable") parts.push(segment("Lép tapintható. ", "modified", "E5"));
      else parts.push(segment("Lép nem tapintható. ", spleen?.explicitNormal ? "explicit" : "base", "E5"));
    }

    if (!pushTargetOverride(parts, findings, "E5", "E5.8")) {
      const bowel = firstFinding(findings, "E5", "bowel_sounds");
      const bowelText = {
        increased: "Bélhangok élénkek.",
        decreased: "Bélhangok renyhék.",
        absent: "Bélhang nem hallható."
      }[bowel?.value] || "Bélhangok normálisak.";
      parts.push(segment(bowelText + " ", bowel && bowel.value !== "normal" ? "modified" : bowel?.explicitNormal ? "explicit" : "base", "E5"));
    }
    appendExplicitNormalNotes(parts, findings, "E5");
    appendNewCustoms(parts, findings, "E5");

    if (!pushTargetOverride(parts, findings, "E6", "E6.1")) {
      const renalFindings = findingsFor(findings, "E6", "renal_angle_tenderness");
      const abnormalRenal = renalFindings.filter((item) => item.value !== "none");
      if (!abnormalRenal.length) {
        const explicitNormalRenal = renalFindings.find((item) => item.explicitNormal);
        parts.push(segment("Vesetájak ütögetésre nem érzékenyek. ", explicitNormalRenal ? "explicit" : "base", "E6"));
      } else {
        for (const renal of abnormalRenal) {
          const s = sideText(renal.attributes.side);
          parts.push(segment((s ? s + " vesetáj" : "Vesetájak") + " ütögetésre érzékeny" + (renal.attributes.side === "bilateral" ? "ek" : "") + ". ", "modified", "E6"));
        }
      }
    }
    pushTargetOverride(parts, findings, "E6", "E6.2");
    appendExplicitNormalNotes(parts, findings, "E6");
    appendNewCustoms(parts, findings, "E6");

    return parts;
  }

  function parameterLine() {
    const p = activeState?.parameters || {};
    const parts = [];

    function withUnit(value, unit) {
      const text = String(value || "").trim();
      if (!text) return "";
      if (fold(text).includes(fold(unit))) return text;
      return text + " " + unit;
    }

    if (p.bloodPressure.trim()) parts.push("RR: " + withUnit(p.bloodPressure, "Hgmm"));
    if (p.pulse.trim()) parts.push("P: " + withUnit(p.pulse, "/min"));
    if (p.temperature.trim()) parts.push("T: " + withUnit(p.temperature, "°C"));
    if (p.respiratoryRate.trim()) parts.push("Lsz: " + withUnit(p.respiratoryRate, "/min"));
    if (p.spo2.trim()) parts.push("SpO₂: " + withUnit(p.spo2, "%"));
    if (p.oxygen.trim()) parts.push(String(p.oxygen).trim());
    return parts.length ? parts.join(", ") + "." : "";
  }

  function unresolvedSegments(unknowns, sections) {
    const allowed = new Set(Array.isArray(sections) ? sections : [sections]);
    return (unknowns || [])
      .filter((item) => allowed.has(item.section))
      .map((item) => segment(
        ensureSentence(item.raw) + " ",
        "unresolved",
        item.section,
        "Nem felismert finding — nyers szöveg változatlanul megtartva."
      ));
  }

  function buildRenderModel() {
    const parsed = parseAll();
    const lines = [];
    const params = parameterLine();
    if (params) lines.push({ prefix: "", segments: [segment(params, "base", "")] });

    lines.push({
      prefix: "A: ",
      segments: [...renderA(parsed.findings), ...unresolvedSegments(parsed.unknowns, "A")]
    });
    lines.push({
      prefix: "B: ",
      segments: [...renderB(parsed.findings), ...unresolvedSegments(parsed.unknowns, "B")]
    });
    lines.push({
      prefix: "C: ",
      segments: [...renderC(parsed.findings), ...unresolvedSegments(parsed.unknowns, "C")]
    });
    lines.push({
      prefix: "D: ",
      segments: [...renderD(parsed.findings), ...unresolvedSegments(parsed.unknowns, "D")]
    });
    lines.push({
      prefix: "E: ",
      segments: [
        ...renderE(parsed.findings),
        ...unresolvedSegments(parsed.unknowns, ["E1", "E2", "E3", "E4", "E5", "E6"])
      ]
    });
    return { ...parsed, lines };
  }

  function modelText(model) {
    return model.lines
      .map((line) => line.prefix + line.segments.map((item) => item.text).join("").trim())
      .join("\n");
  }

  function modelHtml(model) {
    return model.lines.map((line) => {
      const spans = line.segments.map((item) => {
        const cls = item.kind === "modified"
          ? "status-modified"
          : item.kind === "explicit"
          ? "status-explicit"
          : item.kind === "derived"
          ? "status-derived"
          : item.kind === "unresolved"
          ? "status-unresolved"
          : "";
        const attrs = [];
        if (item.source) attrs.push('data-status-source="' + esc(item.source) + '"');
        if (item.title) attrs.push('title="' + esc(item.title) + '"');
        return '<span class="' + cls + '" ' + attrs.join(" ") + '>' + esc(item.text) + '</span>';
      }).join("");
      return '<span class="status-line"><span class="status-prefix">' + esc(line.prefix) + '</span>' + spans + '</span>';
    }).join("");
  }

  function unknownsBySection(model) {
    return Object.fromEntries(SECTIONS.map((section) => [
      section,
      model.unknowns.filter((item) => item.section === section)
    ]));
  }

  function renderUnknowns(model) {
    const grouped = unknownsBySection(model);
    for (const section of SECTIONS) {
      const host = document.querySelector('[data-status-unknown-host="' + section + '"]');
      const block = host?.closest(".beta-status-input-block");
      if (!host || !block) continue;
      const items = grouped[section];
      const options = [
        '<option value="">— Válassza ki, hova tartozik —</option>',
        ...(SUBSECTION_OPTIONS[section] || []).map(([value, label]) =>
          '<option value="' + esc(value) + '">' + esc(label) + '</option>'
        ),
        '<option value="__append">Egyéb / új finding — hozzáadás a végére</option>'
      ].join("");
      block.classList.toggle("has-unknown", items.length > 0);
      host.innerHTML = items.map((item, index) =>
        '<div class="beta-status-unknown">' +
          '<div class="beta-status-unknown-title">NEM FELISMERT FINDING</div>' +
          '<div class="beta-status-unknown-raw">' + esc(item.raw) + '</div>' +
          '<label class="beta-status-unknown-target-label">Hova tartozik?</label>' +
          '<select class="beta-status-unknown-target" data-status-confirm-target="' + index + '">' + options + '</select>' +
          '<div class="beta-status-unknown-editor">' +
            '<input type="text" data-status-confirm-text="' + index + '" value="" placeholder="Teljes, standard magyar mondat…" aria-label="Megerősített finding" />' +
            '<button type="button" class="btn small" data-status-confirm="' + index + '">MEGERŐSÍTÉS</button>' +
          '</div>' +
        '</div>'
      ).join("");
    }
  }

  function syncClinicalPhysical(model, { immediate = false } = {}) {
    if (!activeState || !activeCaseId) return;
    if (!activeState.touched && !activeState.copiedAt) return;

    const text = modelText(model);
    const explicitNormals = model.findings
      .filter((item) => item.explicitNormal)
      .map((item) => ({
        section: item.section,
        concept: item.concept,
        value: item.value,
        attributes: item.attributes || {}
      }));

    const patient = patientSnapshot(activeCaseId);
    const changed =
      String(patient?.physical || "") !== text ||
      JSON.stringify(patient?.statusExplicitNormals || []) !== JSON.stringify(explicitNormals);

    if (!changed) return;

    window.BachSBOClinicalUi?.setStatusPhysicalDraft?.(
      activeCaseId,
      text,
      explicitNormals
    );
    document.dispatchEvent(new CustomEvent("bachsbo:status-generator-updated", {
      detail: {
        caseId: activeCaseId,
        complete: Boolean(text),
        unresolved: model.unknowns.length
      }
    }));

    scheduleClinicalAutosave({ immediate });
  }

  function render() {
    const root = document.getElementById("betaStatusGenerator");
    if (!root || !activeState) return;

    const model = buildRenderModel();
    const preview = document.getElementById("betaStatusFinalPreview");
    const alert = document.getElementById("betaStatusGeneratorAlert");
    const copy = document.getElementById("betaStatusCopyBtn");

    if (preview) preview.innerHTML = modelHtml(model);
    renderUnknowns(model);

    if (alert) {
      const learningErrors = Object.values(activeState.confirmations || {})
        .filter((item) => item?.learningError).length;
      alert.classList.toggle("hidden", model.unknowns.length === 0 && learningErrors === 0);
      alert.textContent = model.unknowns.length
        ? model.unknowns.length + " nem felismert finding maradt. A nyers szöveg bekerül a Státuszba; másolás és lezárás továbbra is engedélyezett."
        : learningErrors
        ? learningErrors + " megerősítés helyben mentve, de az AI tanulási Pending sorba mentés sikertelen."
        : "";
    }
    if (copy) copy.disabled = false;
    syncClinicalVitals();
    syncClinicalPhysical(model);
  }

  function populate() {
    const root = document.getElementById("betaStatusGenerator");
    if (!root || !activeState) return;
    for (const key of PARAMS) {
      const input = root.querySelector('[data-status-param="' + key + '"]');
      if (input) input.value = activeState.parameters[key] || "";
    }
    for (const key of SECTIONS) {
      const textarea = root.querySelector('[data-status-section="' + key + '"]');
      if (textarea) textarea.value = activeState.inputs[key] || "";
    }
    render();
  }

  function scheduleRender() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(render, 120);
  }

  function bindRoot() {
    const root = document.getElementById("betaStatusGenerator");
    if (!root || root.dataset.bound === "true") return;
    root.dataset.bound = "true";

    root.addEventListener("input", (event) => {
      const param = event.target.closest?.("[data-status-param]");
      const section = event.target.closest?.("[data-status-section]");
      if (!activeState) return;

      if (param) {
        activeState.parameters[param.dataset.statusParam] = param.value;
        activeState.touched = true;
        saveState();
        syncClinicalVitals();
        scheduleRender();
      }
      if (section) {
        activeState.inputs[section.dataset.statusSection] = section.value;
        activeState.touched = true;
        saveState();
        scheduleRender();
      }
    });

    root.addEventListener("click", async (event) => {
      const confirm = event.target.closest?.("[data-status-confirm]");
      if (confirm && activeState) {
        const section = confirm.closest("[data-status-unknown-host]")?.dataset.statusUnknownHost;
        const index = Number(confirm.dataset.statusConfirm);
        const model = buildRenderModel();
        const item = model.unknowns.filter((x) => x.section === section)[index];
        const card = confirm.closest(".beta-status-unknown");
        const editor = card?.querySelector('[data-status-confirm-text="' + index + '"]');
        const targetSelect = card?.querySelector('[data-status-confirm-target="' + index + '"]');
        const text = ensureSentence(editor?.value || "");
        const target = String(targetSelect?.value || "");
        if (!section || !item || !text || !target) {
          if (!target) targetSelect?.focus();
          else editor?.focus();
          return;
        }

        const key = confirmationKey(section, item.raw);
        activeState.confirmations[key] = {
          raw: item.raw,
          text,
          target,
          confirmedAt: new Date().toISOString(),
          learningStatus: STATUS_LEARNING_ENABLED ? "saving" : "disabled",
          learningError: ""
        };
        activeState.touched = true;
        saveState();

        if (!STATUS_LEARNING_ENABLED) {
          render();
          return;
        }

        confirm.disabled = true;
        const previousLabel = confirm.textContent;
        confirm.textContent = "MENTÉS…";
        try {
          const result = await queueLearningFeedback(section, item.raw, text, target);
          if (activeState?.confirmations?.[key]) {
            activeState.confirmations[key].learningId = result?.record?.id || "";
            activeState.confirmations[key].learningStatus = result?.record?.status || "pending";
            activeState.confirmations[key].learningError = "";
          }
        } catch (error) {
          if (activeState?.confirmations?.[key]) {
            activeState.confirmations[key].learningStatus = "local_only";
            activeState.confirmations[key].learningError =
              String(error?.message || "AI learning save failed.");
          }
        } finally {
          saveState();
          if (confirm.isConnected) {
            confirm.disabled = false;
            confirm.textContent = previousLabel;
          }
          render();
        }
        return;
      }

      const highlighted = event.target.closest?.("[data-status-source]");
      if (highlighted) {
        const section = highlighted.dataset.statusSource;
        const input = root.querySelector('[data-status-section="' + section + '"]');
        input?.focus({ preventScroll: false });
      }
    });

    document.getElementById("betaStatusCopyBtn")?.addEventListener("click", async (event) => {
      if (!activeState) return;
      const model = buildRenderModel();
      const text = modelText(model);
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const tmp = document.createElement("textarea");
        tmp.value = text;
        tmp.style.position = "fixed";
        tmp.style.opacity = "0";
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand("copy");
        tmp.remove();
      }
      activeState.copiedAt = new Date().toISOString();
      activeState.touched = true;
      saveState();
      syncClinicalPhysical(model, { immediate: true });

      const button = event.currentTarget;
      const before = button.textContent;
      button.textContent = "MÁSOLVA ✓";
      window.setTimeout(() => {
        if (button.isConnected) button.textContent = before;
      }, 1200);
    });
  }

  function refresh() {
    bindRoot();
    const caseId = selectedCaseId();
    const patient = patientSnapshot(caseId);
    const shiftId = patient?.shiftId || "";

    if (!caseId || !shiftId) {
      activeCaseId = "";
      activeShiftId = "";
      activeState = null;
      return;
    }

    if (caseId !== activeCaseId || shiftId !== activeShiftId || !activeState) {
      activeCaseId = caseId;
      activeShiftId = shiftId;
      activeState = loadState(shiftId, caseId);
      hydrateCanonicalVitals(patient);
      populate();
    } else {
      render();
    }
  }

  function stateHasData(state) {
    if (!state) return false;
    if (state.touched || state.copiedAt) return true;
    return PARAMS.some((key) => String(state.parameters?.[key] || "").trim()) ||
      SECTIONS.some((key) => String(state.inputs?.[key] || "").trim());
  }

  function buildRecordFromState(state) {
    const previousState = activeState;
    activeState = state;
    const model = buildRenderModel();
    activeState = previousState;

    const explicitNormals = model.findings.filter((item) => item.explicitNormal);
    const confirmedCustom = model.findings.filter((item) => item.source === "manual_confirmation");
    const canonical = model.findings.filter((item) => item.concept !== "custom");

    return {
      caseId: state.caseId,
      shiftId: state.shiftId,
      payload: {
        generator_version: VERSION,
        parameters: state.parameters,
        section_inputs: state.inputs,
        canonical_findings: canonical,
        explicit_normal_findings: explicitNormals,
        confirmed_custom_findings: confirmedCustom,
        renderer_output: modelText(model),
        final_status: modelText(model),
        copied_at: state.copiedAt,
        finalized_at: new Date().toISOString()
      },
      unresolved: model.unknowns
    };
  }

  async function finalizeShift(shiftId, patients) {
    if (!shiftId) return { saved: 0 };
    const records = [];
    const unresolved = [];
    const patientIds = new Set((patients || []).map((patient) => String(patient.id || "")));

    for (const caseId of patientIds) {
      if (!caseId) continue;
      const state = loadState(shiftId, caseId);
      if (!stateHasData(state)) continue;
      const record = buildRecordFromState(state);
      if (record.unresolved.length) {
        unresolved.push({
          caseId,
          localId: (patients || []).find((patient) => String(patient.id) === caseId)?.localId || "",
          count: record.unresolved.length
        });
        continue;
      }
      records.push({
        caseId: record.caseId,
        shiftId: record.shiftId,
        payload: record.payload
      });
    }

    if (unresolved.length) {
      const details = unresolved
        .map((item) => "Eset " + (item.localId || item.caseId) + ": " + item.count + " finding")
        .join(", ");
      throw new Error("A műszak nem zárható le: a Státusz modulban nem megerősített finding maradt. " + details);
    }

    if (records.length) {
      for (const record of records) {
        const explicitNormals = (record.payload.explicit_normal_findings || []).map((item) => ({
          section: item.section,
          concept: item.concept,
          value: item.value,
          attributes: item.attributes || {}
        }));
        window.BachSBOClinicalUi?.setVitalsData?.(record.caseId, {
          version: 1,
          ...Object.fromEntries(PARAMS.map((key) => [
            key,
            String(record.payload.parameters?.[key] || "").trim()
          ]))
        });
        const updatedPatient = window.BachSBOClinicalUi?.setStatusPhysicalDraft?.(
          record.caseId,
          record.payload.final_status,
          explicitNormals
        );
        if (updatedPatient && window.BachSBOBackend?.savePatient) {
          await window.BachSBOBackend.savePatient(shiftId, updatedPatient);
        }
      }

      if (!window.BachSBOBackend?.saveStatusGeneratorRecords) {
        throw new Error("A Státusz végleges mentési funkció nem érhető el.");
      }
      await window.BachSBOBackend.saveStatusGeneratorRecords(records);
    }

    return { saved: records.length };
  }

  function clearShiftCache(shiftId) {
    if (!shiftId) return;
    try {
      const prefix = STORAGE_PREFIX + String(shiftId) + ":";
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key?.startsWith(prefix)) keys.push(key);
      }
      keys.forEach((key) => window.localStorage.removeItem(key));
    } catch {
      // Cache cleanup failure is non-fatal after the shift is already closed.
    }
    if (activeShiftId === shiftId) {
      activeCaseId = "";
      activeShiftId = "";
      activeState = null;
    }
  }

  function getSummaryContext(caseId) {
    const patient = patientSnapshot(caseId);
    const shiftId = patient?.shiftId || "";
    if (!caseId || !shiftId) return null;
    const state = caseId === activeCaseId && activeState
      ? activeState
      : loadState(shiftId, caseId);
    if (!stateHasData(state)) return null;
    const record = buildRecordFromState(state);
    return {
      explicitNormalFindings: record.payload.explicit_normal_findings.map((item) => ({
        section: item.section,
        concept: item.concept,
        value: item.value,
        attributes: item.attributes || {}
      })),
      finalStatusDraft: record.payload.final_status,
      unresolved: record.unresolved
    };
  }

  window.BachSBOStatusGenerator = Object.freeze({
    refresh,
    finalizeShift,
    clearShiftCache,
    getSummaryContext
  });

  document.addEventListener("bachsbo:ui-rendered", () => window.setTimeout(refresh, 0));
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh, { once: true });
  } else {
    refresh();
  }
})();
