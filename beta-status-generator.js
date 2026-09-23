(() => {
  "use strict";

  if (window.__bachSboStatusGeneratorInstalled) return;
  window.__bachSboStatusGeneratorInstalled = true;

  const VERSION = "2.0";
  const STORAGE_PREFIX = "bachtransbo.status-generator.v2:";
  const SECTIONS = ["A", "B", "C", "D", "E1", "E2", "E3", "E4", "E5", "E6"];
  const PARAMS = ["bloodPressure", "pulse", "temperature", "respiratoryRate", "spo2", "oxygen"];

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
    return normalize(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function ensureSentence(value) {
    let text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    text = text.charAt(0).toLocaleUpperCase("hu-HU") + text.slice(1);
    if (!/[.!?]$/.test(text)) text += ".";
    return text;
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

  function confirmationKey(section, raw) {
    return section + "|" + normalize(raw);
  }

  function confirmedText(section, raw) {
    const item = activeState?.confirmations?.[confirmationKey(section, raw)];
    return item?.text ? String(item.text) : "";
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
    if (/\b(mko\.?|mindket|bilat|bilateralis)\b/.test(n)) return "bilateral";
    if (/\bjobb\b/.test(n)) return "right";
    if (/\bbal\b/.test(n)) return "left";
    return "";
  }

  function locationOf(text) {
    const n = fold(text);
    if (/basal|bazal/.test(n)) return "basal";
    if (/apical/.test(n)) return "apical";
    if (/diffuz/.test(n)) return "diffuse";
    if (/epigastr/.test(n)) return "epigastric";
    if (/periumbil/.test(n)) return "periumbilical";
    if (/\b(jfq|jobb also|jobb alhas|right lower)\b/.test(n)) return "RLQ";
    if (/\b(bfq|bal also|bal alhas|left lower)\b/.test(n)) return "LLQ";
    if (/\b(jaq|jobb felso|right upper)\b/.test(n)) return "RUQ";
    if (/\b(baq|bal felso|left upper)\b/.test(n)) return "LUQ";
    if (/\balhas\b/.test(n)) return "lower_abdomen";
    return "";
  }

  function splitInput(value) {
    return String(value || "")
      .replace(/\r/g, "")
      .split(/[\n;]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function parseA(raw) {
    const n = fold(raw);
    const out = [];
    if (/legut.*atjarhat|airway.*patent/.test(n)) addFinding(out, "A", "airway_patency", "patent", {}, raw, true);
    if (/legut.*(nem atjar|obstruct)/.test(n)) addFinding(out, "A", "airway_patency", "obstructed", {}, raw);
    if (/nem tud beszel/.test(n)) addFinding(out, "A", "speech", "unable", {}, raw);
    else if (/\bbeszel\b/.test(n)) addFinding(out, "A", "speech", "speaks", {}, raw, true);
    if (/szivast igenyel|valadek/.test(n)) addFinding(out, "A", "airway_secretions", "present", {}, raw);
    if (/stridor/.test(n)) addFinding(out, "A", "stridor", "present", {}, raw);
    if (/horkol/.test(n)) addFinding(out, "A", "snoring_respiration", "present", {}, raw);
    if (/gurgul/.test(n)) addFinding(out, "A", "gurgling_respiration", "present", {}, raw);
    if (/idegentest/.test(n)) addFinding(out, "A", "foreign_body", "present", {}, raw);
    if (/tracheost/.test(n)) addFinding(out, "A", "airway_device", "tracheostomy", {}, raw);
    else if (/tubus|intubal/.test(n)) addFinding(out, "A", "airway_device", "ett", {}, raw);
    else if (/airway adjunct|guedel|wendel/.test(n)) addFinding(out, "A", "airway_device", "adjunct", {}, raw);
    return out;
  }

  function parseB(raw) {
    const n = fold(raw);
    const out = [];
    const side = sideOf(raw);
    const location = locationOf(raw);

    if (/tachydyspno/.test(n)) addFinding(out, "B", "respiratory_pattern", "tachydyspnoea", {}, raw);
    else if (/tachypno/.test(n)) addFinding(out, "B", "respiratory_pattern", "tachypnoea", {}, raw);
    else if (/bradypno/.test(n)) addFinding(out, "B", "respiratory_pattern", "bradypnoea", {}, raw);
    else if (/kussmaul/.test(n)) addFinding(out, "B", "respiratory_pattern", "kussmaul", {}, raw);
    else if (/pihego|gasp/.test(n)) addFinding(out, "B", "respiratory_pattern", "gasping", {}, raw);
    else if (/apno/.test(n)) addFinding(out, "B", "respiratory_pattern", "apnoea", {}, raw);
    else if (/dyspno/.test(n)) addFinding(out, "B", "respiratory_pattern", "dyspnoea", {}, raw);
    else if (/eupno/.test(n)) addFinding(out, "B", "respiratory_pattern", "eupnoea", {}, raw, true);

    if (/emphysem/.test(n)) addFinding(out, "B", "chest_shape", "emphysematous", {}, raw);
    if (/hordo alak/.test(n)) addFinding(out, "B", "chest_shape", "barrel", {}, raw);
    if (/mellkas.*aszim|aszimmetrikus mellkas/.test(n)) addFinding(out, "B", "chest_shape", "asymmetric", { side }, raw);
    if (/mellkas.*serul/.test(n)) addFinding(out, "B", "chest_shape", "trauma", { side }, raw);
    if (/mellkas.*deform/.test(n)) addFinding(out, "B", "chest_shape", "deformity", { side }, raw);
    if (/mellkas.*reszaranyos/.test(n)) addFinding(out, "B", "chest_shape", "normal", {}, raw, true);

    let breathType = "";
    if (/legzes.*hianyz|nem hallhato.*legzes/.test(n)) breathType = "absent";
    else if (/gyengult.*legzes|legzes.*gyengult/.test(n)) breathType = "diminished";
    else if (/erdes.*legzes|legzes.*erdes/.test(n)) breathType = "harsh";
    else if (/bronchialis/.test(n)) breathType = "bronchial";
    else if (/pulmo.*tiszta|alaplegzes.*normal|normal.*alaplegzes/.test(n)) breathType = "normal";
    if (breathType) addFinding(out, "B", "breath_sound", breathType, { side, location }, raw, breathType === "normal");

    let extraType = "";
    if (/aproholyagu.*szorty/.test(n)) extraType = "fine_crackles";
    else if (/nagyholyagu.*szorty/.test(n)) extraType = "coarse_crackles";
    else if (/crepitat/.test(n)) extraType = "crepitation";
    else if (/sipol/.test(n)) extraType = "wheeze";
    else if (/bugas|bugo/.test(n)) extraType = "rhonchus";
    else if (/stridor/.test(n)) extraType = "stridor";
    if (extraType) addFinding(out, "B", "adventitious_sound", extraType, { side, location }, raw);

    if (/segedlegzoizm/.test(n)) addFinding(out, "B", "breathing_work", "accessory_muscles", {}, raw);
    if (/intercostalis.*behuz/.test(n)) addFinding(out, "B", "breathing_work", "intercostal_retraction", {}, raw);
    if (/paradox.*legzes/.test(n)) addFinding(out, "B", "breathing_work", "paradoxical", {}, raw);
    if (/legzesi munka.*fokoz|fokozott.*legzesi munka/.test(n)) addFinding(out, "B", "breathing_work", "increased", {}, raw);
    if (/legzesi munka.*normal/.test(n)) addFinding(out, "B", "breathing_work", "normal", {}, raw, true);

    if (/periferias.*cyanos/.test(n)) addFinding(out, "B", "cyanosis", "peripheral", {}, raw);
    else if (/centralis.*cyanos/.test(n)) addFinding(out, "B", "cyanosis", "central", {}, raw);
    else if (/gallercyan/.test(n)) addFinding(out, "B", "cyanosis", "collar", {}, raw);
    else if (/cyanos.*nincs/.test(n)) addFinding(out, "B", "cyanosis", "none", {}, raw, true);

    return out;
  }

  function parseC(raw) {
    const n = fold(raw);
    const out = [];
    const side = sideOf(raw);

    if (/jol tapinthato.*periferias pulzus/.test(n)) addFinding(out, "C", "peripheral_pulse", "normal", {}, raw, true);
    if (/gyengen tapinthato.*periferias pulzus|gyenge.*periferias pulzus/.test(n)) addFinding(out, "C", "peripheral_pulse", "weak", {}, raw);
    if (/periferian.*nem tapinthato.*centralisan.*tapinthato/.test(n)) addFinding(out, "C", "peripheral_pulse", "central_only", {}, raw);
    if (/pulzusaszim/.test(n)) addFinding(out, "C", "peripheral_pulse", "asymmetric", { side }, raw);

    const crtMatch = raw.match(/CRT\s*<?\s*(\d+(?:[.,]\d+)?)\s*s?/i);
    if (crtMatch) {
      const seconds = Number(crtMatch[1].replace(",", "."));
      addFinding(out, "C", "crt", "numeric", { seconds }, raw, seconds < 2);
    }

    if (/huvos.*perifer/.test(n)) addFinding(out, "C", "peripheral_perfusion", "cool", {}, raw);
    if (/verejtezik|verejtekezes/.test(n)) addFinding(out, "C", "peripheral_perfusion", "sweating", {}, raw);
    if (/sapadt/.test(n)) addFinding(out, "C", "peripheral_perfusion", "pallor", {}, raw);
    if (/marvanyoz/.test(n)) addFinding(out, "C", "peripheral_perfusion", "mottled", {}, raw);

    if (/tachyarrhythmi/.test(n)) addFinding(out, "C", "heart_rhythm", "tachyarrhythmic", {}, raw);
    else if (/arrhythmi/.test(n)) addFinding(out, "C", "heart_rhythm", "arrhythmic", {}, raw);
    else if (/ritmusos/.test(n)) addFinding(out, "C", "heart_rhythm", "regular", {}, raw, true);

    if (/tachycard/.test(n)) addFinding(out, "C", "heart_rate_state", "tachycardic", {}, raw);
    if (/bradycard/.test(n)) addFinding(out, "C", "heart_rate_state", "bradycardic", {}, raw);

    if (/zorej.*nem hallhato|szivzorej.*nincs/.test(n)) addFinding(out, "C", "cardiac_murmur", "none", {}, raw, true);
    if (/systoles.*zorej|zorej.*systoles/.test(n)) {
      const grade = raw.match(/([1-6])\s*\/\s*6/);
      addFinding(out, "C", "cardiac_murmur", "systolic", {
        grade: grade ? grade[1] + "/6" : "",
        maximum: /apex/i.test(raw) ? "apex" : "",
        radiation: /axilla/i.test(raw) ? "axilla" : ""
      }, raw);
    }
    if (/diastoles.*zorej|zorej.*diastoles/.test(n)) {
      const grade = raw.match(/([1-6])\s*\/\s*6/);
      addFinding(out, "C", "cardiac_murmur", "diastolic", { grade: grade ? grade[1] + "/6" : "" }, raw);
    }

    if (/nyaki venak.*teltek|jugularis.*telt/.test(n) && !/nem teltek/.test(n)) addFinding(out, "C", "jvp", "distended", {}, raw);
    else if (/nyaki venak.*nem teltek/.test(n)) addFinding(out, "C", "jvp", "normal", {}, raw, true);

    if (/aktiv.*verzes|eros.*verzes/.test(n)) addFinding(out, "C", "active_bleeding", "present", { location: locationOf(raw) }, raw);
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

    if (/terben.*idoben.*sajat szemelyere.*orient/.test(n)) addFinding(out, "D", "orientation", "oriented", {}, raw, true);
    if (/dezorient/.test(n)) addFinding(out, "D", "orientation", "disoriented", {}, raw);
    if (/demencia/.test(n)) addFinding(out, "D", "mental_state", "known_dementia", {}, raw);
    if (/zavart/.test(n)) addFinding(out, "D", "mental_state", "confused", {}, raw);
    if (/agitalt/.test(n)) addFinding(out, "D", "mental_state", "agitated", {}, raw);
    if (/somnol/.test(n)) addFinding(out, "D", "mental_state", "somnolent", {}, raw);

    if (/aphasia.*nincs|aphasia nincs/.test(n)) addFinding(out, "D", "aphasia", "none", {}, raw, true);
    if (/motoros.*aphasia/.test(n)) addFinding(out, "D", "aphasia", "motor", {}, raw);
    if (/sensoros.*aphasia/.test(n)) addFinding(out, "D", "aphasia", "sensory", {}, raw);
    if (/globalis.*aphasia/.test(n)) addFinding(out, "D", "aphasia", "global", {}, raw);

    if (/latens.*paresis/.test(n)) addFinding(out, "D", "paresis", "latent", { side }, raw);
    if (/vegtagparesis|paresis/.test(n) && !/facialis/.test(n) && !/latens/.test(n) && !/nincs/.test(n)) {
      addFinding(out, "D", "paresis", "limb", { side }, raw);
    }
    if (/paresis.*nincs/.test(n) && !/facialis/.test(n)) addFinding(out, "D", "paresis", "none", {}, raw, true);

    if (/facialis paresis.*nincs/.test(n)) addFinding(out, "D", "facial_paresis", "none", {}, raw, true);
    else if (/facialis paresis/.test(n)) addFinding(out, "D", "facial_paresis", "present", { side }, raw);

    if (/anisocor/.test(n)) addFinding(out, "D", "pupil", "anisocoria", { side }, raw);
    if (/myosis/.test(n)) addFinding(out, "D", "pupil", "miosis", { side }, raw);
    if (/mydriasis/.test(n)) addFinding(out, "D", "pupil", "mydriasis", { side }, raw);
    if (/fenymerev|fenyre nem reag/.test(n)) addFinding(out, "D", "pupil", "nonreactive", { side }, raw);
    if (/pupillak.*kerek.*egyenlo.*fenyre reag/.test(n)) addFinding(out, "D", "pupil", "normal", {}, raw, true);

    if (/horizontalis.*nystag/.test(n)) addFinding(out, "D", "nystagmus", "horizontal", { side }, raw);
    else if (/vertikalis.*nystag/.test(n)) addFinding(out, "D", "nystagmus", "vertical", {}, raw);
    else if (/rotatoros.*nystag/.test(n)) addFinding(out, "D", "nystagmus", "rotatory", {}, raw);
    else if (/nystagmus.*nincs/.test(n)) addFinding(out, "D", "nystagmus", "none", {}, raw, true);

    if (/tarkokotott/.test(n)) addFinding(out, "D", "meningeal", "neck_stiffness", {}, raw);
    if (/meningealis.*pozitiv/.test(n)) addFinding(out, "D", "meningeal", "positive", {}, raw);
    if (/meningealis.*nincsenek|meningealis.*nincs/.test(n)) addFinding(out, "D", "meningeal", "none", {}, raw, true);

    if (/sensorium.*szimmetrikusan.*megtartott/.test(n)) addFinding(out, "D", "sensorium", "symmetric", {}, raw, true);
    if (/goc(tunet|jel).*nincs|neurologiai.*goc.*nincs/.test(n)) addFinding(out, "D", "focal_neuro", "none", {}, raw, true);
    if (/goc(tunet|jel).*pozitiv|neurologiai.*goc/.test(n) && !/nincs/.test(n)) addFinding(out, "D", "focal_neuro", "present", { side }, raw);
    return out;
  }

  function parseE1(raw) {
    const n = fold(raw);
    const out = [];
    if (/jo altalanos allapot/.test(n)) addFinding(out, "E1", "general_condition", "good", {}, raw, true);
    if (/kozepes|kp\.? altalanos allapot/.test(n)) addFinding(out, "E1", "general_condition", "medium", {}, raw);
    if (/rossz altalanos allapot|elesett/.test(n)) addFinding(out, "E1", "general_condition", "poor", {}, raw);
    if (/kp\.? fejlett/.test(n)) addFinding(out, "E1", "build", "medium", {}, raw, true);
    if (/kp\.? taplalt/.test(n)) addFinding(out, "E1", "nutrition", "medium", {}, raw, true);
    if (/sovany/.test(n)) addFinding(out, "E1", "nutrition", "thin", {}, raw);
    if (/cachec/.test(n)) addFinding(out, "E1", "nutrition", "cachectic", {}, raw);
    if (/obes|elhiz/.test(n)) addFinding(out, "E1", "nutrition", "obese", {}, raw);
    return out;
  }

  function parseE2(raw) {
    const n = fold(raw);
    const out = [];
    if (/borszin.*normal/.test(n)) addFinding(out, "E2", "skin_color", "normal", {}, raw, true);
    if (/sapadt/.test(n)) addFinding(out, "E2", "skin_color", "pallor", {}, raw);
    if (/icter/.test(n)) addFinding(out, "E2", "skin_color", "jaundice", {}, raw);
    if (/exsic|dehydrat/.test(n)) addFinding(out, "E2", "hydration", "dehydrated", {}, raw);
    if (/csokkent.*turgor/.test(n)) addFinding(out, "E2", "skin_turgor", "reduced", {}, raw);
    if (/turgor.*megtartott/.test(n)) addFinding(out, "E2", "skin_turgor", "normal", {}, raw, true);
    if (/szaraz.*nyalkahartya/.test(n)) addFinding(out, "E2", "mucosa", "dry", {}, raw);
    if (/nyalkahartyak.*kp.*verteltek/.test(n)) addFinding(out, "E2", "mucosa", "normal", {}, raw, true);
    if (/nyelv.*szaraz/.test(n)) addFinding(out, "E2", "tongue", "dry", {}, raw);
    if (/nyelv.*nedves/.test(n)) addFinding(out, "E2", "tongue", "normal", {}, raw, true);
    return out;
  }

  function parseE3(raw) {
    const n = fold(raw);
    const out = [];
    if (/kulserelmi nyom.*nincs|serules.*nincs/.test(n)) addFinding(out, "E3", "injury", "none", {}, raw, true);
    if (/serules|seb|haematoma|hematoma|horzsol|laceratio|zuzodas/.test(n) && !/nincs/.test(n)) {
      addFinding(out, "E3", "injury", "present", { side: sideOf(raw), location: locationOf(raw) }, raw);
    }
    return out;
  }

  function parseE4(raw) {
    const n = fold(raw);
    const out = [];
    const side = sideOf(raw);
    if (/vegtagok.*alakilag.*funkcionalisan.*epek/.test(n)) addFinding(out, "E4", "limb_status", "normal", {}, raw, true);
    if (/oedema|odema/.test(n)) addFinding(out, "E4", "limb_edema", /nincs/.test(n) ? "none" : "present", { side }, raw, /nincs/.test(n));
    if (/aszimmetri/.test(n)) addFinding(out, "E4", "limb_asymmetry", "present", { side }, raw);
    if (/korfogatkulonbseg/.test(n)) addFinding(out, "E4", "circumference_difference", "present", { side }, raw);
    if (/homersekletkulonbseg/.test(n)) addFinding(out, "E4", "temperature_difference", "present", { side }, raw);
    if (/mvt|dvt/.test(n)) addFinding(out, "E4", "dvt_sign", /nincs|negativ/.test(n) ? "none" : "present", { side }, raw, /nincs|negativ/.test(n));
    if (/deformitas/.test(n)) addFinding(out, "E4", "limb_deformity", "present", { side }, raw);
    if (/mozgas.*korlatoz/.test(n)) addFinding(out, "E4", "restricted_movement", "present", { side }, raw);
    return out;
  }

  function parseE5(raw) {
    const n = fold(raw);
    const out = [];
    const location = locationOf(raw);

    if (/mellkas szintjeben.*puha.*betapinthato/.test(n)) addFinding(out, "E5", "abdomen_shape", "normal", {}, raw, true);
    if (/elodomborodo/.test(n)) addFinding(out, "E5", "abdomen_shape", "distended", {}, raw);
    if (/beesett/.test(n)) addFinding(out, "E5", "abdomen_shape", "scaphoid", {}, raw);
    if (/deszkakemeny/.test(n)) addFinding(out, "E5", "abdomen_shape", "board_like", {}, raw);
    else if (/feszes/.test(n)) addFinding(out, "E5", "abdomen_shape", "tense", {}, raw);

    if (/hasi fajdalom|fajdalom/.test(n) && !/nyomaserzekeny/.test(n)) {
      let character = "";
      if (/gorcsos/.test(n)) character = "cramping";
      else if (/ego/.test(n)) character = "burning";
      else if (/szuro/.test(n)) character = "stabbing";
      addFinding(out, "E5", "abdominal_pain", "present", { location, character }, raw);
    }
    if (/nyomaserzekeny/.test(n)) addFinding(out, "E5", "abdominal_tenderness", /nem nyomaserzekeny/.test(n) ? "none" : "present", { location }, raw, /nem nyomaserzekeny/.test(n));
    if (/defanz|defense/.test(n)) addFinding(out, "E5", "guarding", /nincs/.test(n) ? "none" : "present", { location }, raw, /nincs/.test(n));
    if (/resistentia/.test(n)) addFinding(out, "E5", "abdominal_mass", /nincs|nem tap/.test(n) ? "none" : "present", { location }, raw, /nincs|nem tap/.test(n));

    if (/hepar/.test(n)) addFinding(out, "E5", "liver_palpation", /nem tap/.test(n) ? "not_palpable" : "palpable", {}, raw, /nem tap/.test(n));
    if (/lep|lien/.test(n)) addFinding(out, "E5", "spleen_palpation", /nem tap/.test(n) ? "not_palpable" : "palpable", {}, raw, /nem tap/.test(n));

    if (/belhang/.test(n)) {
      let value = "normal";
      if (/elenk/.test(n)) value = "increased";
      else if (/renyhe/.test(n)) value = "decreased";
      else if (/nincs|nem hall/.test(n)) value = "absent";
      addFinding(out, "E5", "bowel_sounds", value, {}, raw, value === "normal");
    }
    return out;
  }

  function parseE6(raw) {
    const n = fold(raw);
    const out = [];
    const side = sideOf(raw);
    if (/vesetajak.*nem erzekeny|vesetaj.*nem erzekeny/.test(n)) {
      addFinding(out, "E6", "renal_angle_tenderness", "none", {}, raw, true);
    } else if (/vesetaj.*erzekeny/.test(n)) {
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

  function parseAll() {
    const findings = [];
    const unknowns = [];

    for (const section of SECTIONS) {
      for (const raw of splitInput(activeState?.inputs?.[section])) {
        const parsed = PARSERS[section](raw);
        if (parsed.length) {
          findings.push(...parsed);
          continue;
        }
        const confirmed = confirmedText(section, raw);
        if (confirmed) {
          addFinding(findings, section, "custom", "confirmed", { text: confirmed }, raw, false, "manual_confirmation");
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
      RLQ: "jobb alhasi / JFQ",
      LLQ: "bal alhasi / BFQ",
      RUQ: "jobb felső hasi / JAQ",
      LUQ: "bal felső hasi / BAQ"
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

  function renderA(findings) {
    const parts = [];
    const airway = firstFinding(findings, "A", "airway_patency");
    const speech = firstFinding(findings, "A", "speech");

    if (airway?.value === "obstructed") parts.push(segment("Légút nem átjárható. ", "modified", "A"));
    else parts.push(segment("Légutak átjárhatók. ", airway?.explicitNormal ? "explicit" : "base", "A"));

    if (speech?.value === "unable") parts.push(segment("A beteg nem tud beszélni. ", "modified", "A"));
    else parts.push(segment("A beteg beszél. ", speech?.explicitNormal ? "explicit" : "base", "A"));

    if (firstFinding(findings, "A", "airway_secretions")) parts.push(segment("Légúti váladék miatt szívást igényel. ", "modified", "A"));
    if (firstFinding(findings, "A", "stridor")) parts.push(segment("Stridor hallható. ", "modified", "A"));
    if (firstFinding(findings, "A", "snoring_respiration")) parts.push(segment("Horkoló légzés észlelhető. ", "modified", "A"));
    if (firstFinding(findings, "A", "gurgling_respiration")) parts.push(segment("Gurgulázó légzés hallható. ", "modified", "A"));
    if (firstFinding(findings, "A", "foreign_body")) parts.push(segment("Légúti idegentest észlelhető. ", "modified", "A"));

    const device = firstFinding(findings, "A", "airway_device");
    if (device?.value === "tracheostomy") parts.push(segment("Tracheostoma van. ", "modified", "A"));
    if (device?.value === "ett") parts.push(segment("Endotrachealis tubus van. ", "modified", "A"));
    if (device?.value === "adjunct") parts.push(segment("Légúti segédeszköz van. ", "modified", "A"));

    for (const item of findingsFor(findings, "A", "custom")) parts.push(segment(ensureSentence(item.attributes.text) + " ", "modified", "A"));
    return parts;
  }

  function renderB(findings) {
    const parts = [];
    const pattern = firstFinding(findings, "B", "respiratory_pattern");
    const patternText = {
      tachypnoea: "Tachypnoés.",
      tachydyspnoea: "Tachydyspnoés.",
      bradypnoea: "Bradypnoés.",
      kussmaul: "Kussmaul-légzés észlelhető.",
      gasping: "Pihegő légzés észlelhető.",
      apnoea: "Apnoe észlelhető.",
      dyspnoea: "Dyspnoés.",
      eupnoea: "Eupnoés."
    }[pattern?.value] || "Eupnoés.";
    parts.push(segment(patternText + " ", pattern && pattern.value !== "eupnoea" ? "modified" : pattern?.explicitNormal ? "explicit" : "base", "B"));

    const chest = firstFinding(findings, "B", "chest_shape");
    let chestText = "Mellkas: részarányos.";
    if (chest?.value === "emphysematous") chestText = "Mellkas: emphysemás.";
    if (chest?.value === "barrel") chestText = "Mellkas: hordó alakú.";
    if (chest?.value === "asymmetric") chestText = "Mellkas: aszimmetrikus.";
    if (chest?.value === "trauma") chestText = "Mellkasi sérülés látható.";
    if (chest?.value === "deformity") chestText = "Mellkasi deformitás látható.";
    parts.push(segment(chestText + " ", chest && chest.value !== "normal" ? "modified" : chest?.explicitNormal ? "explicit" : "base", "B"));
    parts.push(segment("Rekeszek szimmetrikusan kitérnek. ", "base", "B"));

    const breath = firstFinding(findings, "B", "breath_sound");
    if (!breath || breath.value === "normal") {
      parts.push(segment("Alaplégzés normális. Oldalkülönbség nincs. ", breath?.explicitNormal ? "explicit" : "base", "B"));
    } else {
      const s = sideText(breath.attributes.side);
      const l = locationText(breath.attributes.location);
      const typeText = {
        diminished: "gyengült",
        absent: "nem hallható",
        harsh: "érdes",
        bronchial: "bronchialis"
      }[breath.value] || breath.value;
      const prefix = [s, l].filter(Boolean).join(" ");
      parts.push(segment((prefix ? prefix + " " : "") + typeText + " légzés hallható. ", "modified", "B"));
    }

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

    const work = firstFinding(findings, "B", "breathing_work");
    let workText = "Légzési munka normális.";
    if (work?.value === "increased") workText = "Légzési munka fokozott.";
    if (work?.value === "accessory_muscles") workText = "Segédlégzőizmokat használ.";
    if (work?.value === "intercostal_retraction") workText = "Intercostalis behúzódás észlelhető.";
    if (work?.value === "paradoxical") workText = "Paradox légzés észlelhető.";
    parts.push(segment(workText + " ", work && work.value !== "normal" ? "modified" : work?.explicitNormal ? "explicit" : "base", "B"));

    const cyanosis = firstFinding(findings, "B", "cyanosis");
    let cyanosisText = "Cyanosis nincs.";
    if (cyanosis?.value === "peripheral") cyanosisText = "Perifériás cyanosis észlelhető.";
    if (cyanosis?.value === "central") cyanosisText = "Centrális cyanosis észlelhető.";
    if (cyanosis?.value === "collar") cyanosisText = "Gallércyanosis észlelhető.";
    parts.push(segment(cyanosisText + " ", cyanosis && cyanosis.value !== "none" ? "modified" : cyanosis?.explicitNormal ? "explicit" : "base", "B"));

    for (const item of findingsFor(findings, "B", "custom")) parts.push(segment(ensureSentence(item.attributes.text) + " ", "modified", "B"));
    return parts;
  }

  function renderC(findings) {
    const parts = [];
    const pulse = firstFinding(findings, "C", "peripheral_pulse");
    let pulseText = "Jól tapintható perifériás pulzusok.";
    if (pulse?.value === "weak") pulseText = "Gyengén tapintható perifériás pulzusok.";
    if (pulse?.value === "central_only") pulseText = "Periférián pulzus nem tapintható, centrálisan tapintható.";
    if (pulse?.value === "asymmetric") pulseText = "Pulzusaszimmetria észlelhető.";
    parts.push(segment(pulseText + " ", pulse && pulse.value !== "normal" ? "modified" : pulse?.explicitNormal ? "explicit" : "base", "C"));

    const crt = firstFinding(findings, "C", "crt");
    if (crt?.attributes?.seconds != null) {
      parts.push(segment("CRT " + crt.attributes.seconds + " s. ", crt.attributes.seconds >= 2 ? "modified" : crt.explicitNormal ? "explicit" : "base", "C"));
    } else {
      parts.push(segment("CRT <2 s. ", "base", "C"));
    }

    for (const item of findingsFor(findings, "C", "peripheral_perfusion")) {
      const txt = {
        cool: "Hűvös perifériák.",
        sweating: "A beteg verejtékezik.",
        pallor: "A beteg sápadt.",
        mottled: "Márványozott bőr észlelhető."
      }[item.value];
      if (txt) parts.push(segment(txt + " ", "modified", "C"));
    }

    const rhythm = firstFinding(findings, "C", "heart_rhythm");
    let heartText = "Szívhangok ritmusosak, tiszták.";
    if (rhythm?.value === "arrhythmic") heartText = "Szívhangok arrhythmiásak, tiszták.";
    if (rhythm?.value === "tachyarrhythmic") heartText = "Tachyarrhythmiás szívműködés észlelhető.";
    parts.push(segment(heartText + " ", rhythm && rhythm.value !== "regular" ? "modified" : rhythm?.explicitNormal ? "explicit" : "base", "C"));

    const rate = firstFinding(findings, "C", "heart_rate_state");
    if (rate?.value === "tachycardic") parts.push(segment("Tachycardia észlelhető. ", rate.source === "parameter" ? "derived" : "modified", "C", rate.source === "parameter" ? "Pulsus >100/min alapján" : ""));
    if (rate?.value === "bradycardic") parts.push(segment("Bradycardia észlelhető. ", rate.source === "parameter" ? "derived" : "modified", "C", rate.source === "parameter" ? "Pulsus <60/min alapján" : ""));

    const murmur = firstFinding(findings, "C", "cardiac_murmur");
    if (!murmur || murmur.value === "none") {
      parts.push(segment("Zörej nem hallható. ", murmur?.explicitNormal ? "explicit" : "base", "C"));
    } else {
      let txt = "";
      if (murmur.attributes.grade) txt += murmur.attributes.grade + " ";
      txt += murmur.value === "diastolic" ? "diastolés zörej" : "systolés zörej";
      if (murmur.attributes.maximum === "apex") txt += " az apex felett";
      if (murmur.attributes.radiation === "axilla") txt += ", axilla felé vezetődik";
      parts.push(segment(ensureSentence(txt) + " ", "modified", "C"));
    }

    const jvp = firstFinding(findings, "C", "jvp");
    parts.push(segment(
      jvp?.value === "distended" ? "Nyaki vénák teltek. " : "Nyaki vénák nem teltek. ",
      jvp?.value === "distended" ? "modified" : jvp?.explicitNormal ? "explicit" : "base",
      "C"
    ));

    for (const item of findingsFor(findings, "C", "active_bleeding")) {
      parts.push(segment("Aktív vérzés észlelhető. ", "modified", "C"));
    }
    for (const item of findingsFor(findings, "C", "custom")) parts.push(segment(ensureSentence(item.attributes.text) + " ", "modified", "C"));
    return parts;
  }

  function renderD(findings) {
    const parts = [];
    const avpu = firstFinding(findings, "D", "avpu");
    parts.push(segment("AVPU: " + (avpu?.value || "A") + ". ", avpu && avpu.value !== "A" ? "modified" : avpu?.explicitNormal ? "explicit" : "base", "D"));

    const gcs = firstFinding(findings, "D", "gcs");
    if (gcs?.attributes?.eye) {
      const a = gcs.attributes;
      parts.push(segment("GCS " + a.total + " (E" + a.eye + " V" + a.verbal + " M" + a.motor + "). ", a.total !== 15 ? "modified" : gcs.explicitNormal ? "explicit" : "base", "D"));
    } else if (gcs?.attributes?.total) {
      parts.push(segment("GCS " + gcs.attributes.total + ". ", gcs.attributes.total !== 15 ? "modified" : gcs.explicitNormal ? "explicit" : "base", "D"));
    } else {
      parts.push(segment("GCS 15 (E4 V5 M6). ", "base", "D"));
    }

    const orientation = firstFinding(findings, "D", "orientation");
    const mental = firstFinding(findings, "D", "mental_state");
    if (orientation?.value === "disoriented") parts.push(segment("Dezorientált. ", "modified", "D"));
    else parts.push(segment("Térben, időben és saját személyére orientált. ", orientation?.explicitNormal ? "explicit" : "base", "D"));
    if (mental) {
      const txt = {
        known_dementia: "Ismert dementia.",
        confused: "Zavart.",
        agitated: "Agitált.",
        somnolent: "Somnolens."
      }[mental.value];
      if (txt) parts.push(segment(txt + " ", "modified", "D"));
    }

    const aphasia = firstFinding(findings, "D", "aphasia");
    const aphasiaText = {
      motor: "Motoros aphasia észlelhető.",
      sensory: "Sensoros aphasia észlelhető.",
      global: "Globalis aphasia észlelhető."
    }[aphasia?.value] || "Aphasia nincs.";
    parts.push(segment(aphasiaText + " ", aphasia && aphasia.value !== "none" ? "modified" : aphasia?.explicitNormal ? "explicit" : "base", "D"));

    const paresis = firstFinding(findings, "D", "paresis");
    if (!paresis || paresis.value === "none") {
      parts.push(segment("Paresis nem észlelhető. ", paresis?.explicitNormal ? "explicit" : "base", "D"));
    } else {
      const s = sideText(paresis.attributes.side);
      const txt = paresis.value === "latent" ? "latens paresis" : "végtagparesis";
      parts.push(segment((s ? s + " oldali " : "") + txt + " észlelhető. ", "modified", "D"));
    }

    const face = firstFinding(findings, "D", "facial_paresis");
    if (!face || face.value === "none") parts.push(segment("Facialis paresis nincs. ", face?.explicitNormal ? "explicit" : "base", "D"));
    else parts.push(segment((sideText(face.attributes.side) ? sideText(face.attributes.side) + " oldali " : "") + "facialis paresis észlelhető. ", "modified", "D"));

    const pupil = firstFinding(findings, "D", "pupil");
    if (!pupil || pupil.value === "normal") {
      parts.push(segment("Pupillák kerekek, egyenlőek, fényre reagálnak. ", pupil?.explicitNormal ? "explicit" : "base", "D"));
    } else {
      const s = sideText(pupil.attributes.side);
      const txt = {
        anisocoria: "Anisocoria észlelhető.",
        miosis: (s ? s + " oldali " : "") + "myosis észlelhető.",
        mydriasis: (s ? s + " oldali " : "") + "mydriasis észlelhető.",
        nonreactive: (s ? s + " oldali " : "") + "pupilla fényre nem reagál."
      }[pupil.value];
      parts.push(segment(txt + " ", "modified", "D"));
    }

    const nyst = firstFinding(findings, "D", "nystagmus");
    if (!nyst || nyst.value === "none") parts.push(segment("Nystagmus nincs. ", nyst?.explicitNormal ? "explicit" : "base", "D"));
    else parts.push(segment(({ horizontal:"Horizontális", vertical:"Vertikális", rotatory:"Rotatoros" }[nyst.value] || "") + " nystagmus észlelhető. ", "modified", "D"));

    const mening = firstFinding(findings, "D", "meningeal");
    if (!mening || mening.value === "none") parts.push(segment("Meningealis izgalmi jelek nincsenek. ", mening?.explicitNormal ? "explicit" : "base", "D"));
    else parts.push(segment(mening.value === "neck_stiffness" ? "Tarkókötöttség észlelhető. " : "Meningealis jel pozitív. ", "modified", "D"));

    const sensorium = firstFinding(findings, "D", "sensorium");
    parts.push(segment("Sensorium szimmetrikusan megtartott. ", sensorium?.explicitNormal ? "explicit" : "base", "D"));

    const focal = firstFinding(findings, "D", "focal_neuro");
    if (!focal || focal.value === "none") parts.push(segment("Neurológiai góctünet nincs. ", focal?.explicitNormal ? "explicit" : "base", "D"));
    else parts.push(segment((sideText(focal.attributes.side) ? sideText(focal.attributes.side) + " oldali " : "") + "neurológiai góctünet észlelhető. ", "modified", "D"));

    for (const item of findingsFor(findings, "D", "custom")) parts.push(segment(ensureSentence(item.attributes.text) + " ", "modified", "D"));
    return parts;
  }

  function renderE(findings) {
    const parts = [];

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
    for (const item of findingsFor(findings, "E1", "custom")) parts.push(segment(ensureSentence(item.attributes.text) + " ", "modified", "E1"));

    const skin = firstFinding(findings, "E2", "skin_color");
    const turgor = firstFinding(findings, "E2", "skin_turgor");
    const mucosa = firstFinding(findings, "E2", "mucosa");
    const tongue = firstFinding(findings, "E2", "tongue");
    const hydration = firstFinding(findings, "E2", "hydration");

    let skinText = "Bőrszín normális, turgora megtartott.";
    if (skin?.value === "pallor") skinText = "Bőr sápadt, turgora " + (turgor?.value === "reduced" ? "csökkent." : "megtartott.");
    if (skin?.value === "jaundice") skinText = "Bőr icterusos, turgora " + (turgor?.value === "reduced" ? "csökkent." : "megtartott.");
    if (!skin && turgor?.value === "reduced") skinText = "Bőrszín normális, turgora csökkent.";
    parts.push(segment(skinText + " ", (skin && skin.value !== "normal") || turgor?.value === "reduced" ? "modified" : (skin?.explicitNormal || turgor?.explicitNormal) ? "explicit" : "base", "E2"));

    parts.push(segment(
      mucosa?.value === "dry" ? "Nyálkahártyák szárazak. " : "Nyálkahártyák kp. vérteltek. ",
      mucosa?.value === "dry" ? "modified" : mucosa?.explicitNormal ? "explicit" : "base",
      "E2"
    ));
    parts.push(segment(
      tongue?.value === "dry" ? "Nyelv száraz. " : "Nyelv nedves. ",
      tongue?.value === "dry" ? "modified" : tongue?.explicitNormal ? "explicit" : "base",
      "E2"
    ));
    if (hydration?.value === "dehydrated") parts.push(segment("Exsiccosis jelei észlelhetők. ", "modified", "E2"));
    for (const item of findingsFor(findings, "E2", "custom")) parts.push(segment(ensureSentence(item.attributes.text) + " ", "modified", "E2"));

    const injury = firstFinding(findings, "E3", "injury");
    if (!injury || injury.value === "none") parts.push(segment("Külsérelmi nyom nincs. ", injury?.explicitNormal ? "explicit" : "base", "E3"));
    else parts.push(segment(ensureSentence(injury.raw) + " ", "modified", "E3"));
    for (const item of findingsFor(findings, "E3", "custom")) parts.push(segment(ensureSentence(item.attributes.text) + " ", "modified", "E3"));

    const e4Abnormal = findings.filter((item) => item.section === "E4" && !item.explicitNormal && item.value !== "none");
    if (!e4Abnormal.length) {
      const explicit = findings.some((item) => item.section === "E4" && item.explicitNormal);
      parts.push(segment("Végtagok alakilag és funkcionálisan épek. ", explicit ? "explicit" : "base", "E4"));
    } else {
      for (const item of e4Abnormal) {
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
        }[item.concept];
        if (txt) parts.push(segment(txt + " ", "modified", "E4"));
      }
    }
    for (const item of findingsFor(findings, "E4", "custom")) parts.push(segment(ensureSentence(item.attributes.text) + " ", "modified", "E4"));

    const shape = firstFinding(findings, "E5", "abdomen_shape");
    const shapeText = {
      distended: "Has elődomborodó.",
      scaphoid: "Has beesett.",
      tense: "Has feszes.",
      board_like: "Has deszkakemény."
    }[shape?.value] || "Has mellkas szintjében, puha, betapintható.";
    parts.push(segment(shapeText + " ", shape && shape.value !== "normal" ? "modified" : shape?.explicitNormal ? "explicit" : "base", "E5"));

    for (const item of findingsFor(findings, "E5", "abdominal_pain")) {
      const l = locationText(item.attributes.location);
      const ch = { cramping:"görcsös", burning:"égő", stabbing:"szúró" }[item.attributes.character] || "";
      parts.push(segment((l ? l + " " : "") + (ch ? ch + " " : "") + "hasi fájdalmat jelez. ", "modified", "E5"));
    }

    const tenderness = firstFinding(findings, "E5", "abdominal_tenderness");
    if (tenderness?.value === "present") parts.push(segment((locationText(tenderness.attributes.location) ? locationText(tenderness.attributes.location) + " " : "") + "nyomásérzékenység észlelhető. ", "modified", "E5"));

    const guarding = firstFinding(findings, "E5", "guarding");
    if (guarding?.value === "present") parts.push(segment((locationText(guarding.attributes.location) ? locationText(guarding.attributes.location) + " " : "") + "defanz észlelhető. ", "modified", "E5"));

    const mass = firstFinding(findings, "E5", "abdominal_mass");
    parts.push(segment(
      mass?.value === "present" ? "Kóros resistentia tapintható. " : "Kóros resistentia nincs. ",
      mass?.value === "present" ? "modified" : mass?.explicitNormal ? "explicit" : "base",
      "E5"
    ));

    const liver = firstFinding(findings, "E5", "liver_palpation");
    const spleen = firstFinding(findings, "E5", "spleen_palpation");
    if (liver?.value === "palpable") parts.push(segment("Hepar tapintható. ", "modified", "E5"));
    else parts.push(segment("Hepar nem tapintható. ", liver?.explicitNormal ? "explicit" : "base", "E5"));
    if (spleen?.value === "palpable") parts.push(segment("Lép tapintható. ", "modified", "E5"));
    else parts.push(segment("Lép nem tapintható. ", spleen?.explicitNormal ? "explicit" : "base", "E5"));

    const bowel = firstFinding(findings, "E5", "bowel_sounds");
    const bowelText = {
      increased: "Bélhangok élénkek.",
      decreased: "Bélhangok renyhék.",
      absent: "Bélhang nem hallható."
    }[bowel?.value] || "Bélhangok normálisak.";
    parts.push(segment(bowelText + " ", bowel && bowel.value !== "normal" ? "modified" : bowel?.explicitNormal ? "explicit" : "base", "E5"));
    for (const item of findingsFor(findings, "E5", "custom")) parts.push(segment(ensureSentence(item.attributes.text) + " ", "modified", "E5"));

    const renal = firstFinding(findings, "E6", "renal_angle_tenderness");
    if (!renal || renal.value === "none") parts.push(segment("Vesetájak ütögetésre nem érzékenyek. ", renal?.explicitNormal ? "explicit" : "base", "E6"));
    else {
      const s = sideText(renal.attributes.side);
      parts.push(segment((s ? s + " vesetáj" : "Vesetájak") + " ütögetésre érzékeny" + (renal.attributes.side === "bilateral" ? "ek" : "") + ". ", "modified", "E6"));
    }
    for (const item of findingsFor(findings, "E6", "custom")) parts.push(segment(ensureSentence(item.attributes.text) + " ", "modified", "E6"));

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

  function buildRenderModel() {
    const parsed = parseAll();
    const lines = [];
    const params = parameterLine();
    if (params) lines.push({ prefix: "", segments: [segment(params, "base", "")] });
    lines.push({ prefix: "A: ", segments: renderA(parsed.findings) });
    lines.push({ prefix: "B: ", segments: renderB(parsed.findings) });
    lines.push({ prefix: "C: ", segments: renderC(parsed.findings) });
    lines.push({ prefix: "D: ", segments: renderD(parsed.findings) });
    lines.push({ prefix: "E: ", segments: renderE(parsed.findings) });
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
      block.classList.toggle("has-unknown", items.length > 0);
      host.innerHTML = items.map((item, index) =>
        '<div class="beta-status-unknown">' +
          '<div class="beta-status-unknown-title">NEM FELISMERT FINDING</div>' +
          '<div class="beta-status-unknown-raw">' + esc(item.raw) + '</div>' +
          '<div class="beta-status-unknown-editor">' +
            '<input type="text" data-status-confirm-text="' + index + '" value="' + esc(ensureSentence(item.raw)) + '" aria-label="Megerősített finding" />' +
            '<button type="button" class="btn small" data-status-confirm="' + index + '">MEGERŐSÍTÉS</button>' +
          '</div>' +
        '</div>'
      ).join("");
    }
  }

  function syncClinicalPhysical(model, { immediate = false } = {}) {
    if (!activeState || !activeCaseId) return;
    if (!activeState.touched && !activeState.copiedAt) return;

    const text = model.unknowns.length ? "" : modelText(model);
    window.BachSBOClinicalUi?.setStatusPhysicalDraft?.(activeCaseId, text);
    document.dispatchEvent(new CustomEvent("bachsbo:status-generator-updated", {
      detail: {
        caseId: activeCaseId,
        complete: Boolean(text),
        unresolved: model.unknowns.length
      }
    }));

    clearTimeout(clinicalAutosaveTimer);
    if (immediate) {
      void window.BachSBOClinicalUi?.autosaveCurrentCase?.();
      return;
    }

    clinicalAutosaveTimer = window.setTimeout(() => {
      void window.BachSBOClinicalUi?.autosaveCurrentCase?.();
    }, 700);
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
      alert.classList.toggle("hidden", model.unknowns.length === 0);
      alert.textContent = model.unknowns.length
        ? model.unknowns.length + " nem felismert finding vár kézi megerősítésre. A Státusz addig nem másolható."
        : "";
    }
    if (copy) copy.disabled = model.unknowns.length > 0;
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
        const editor = confirm.parentElement?.querySelector('[data-status-confirm-text="' + index + '"]');
        const text = ensureSentence(editor?.value || "");
        if (!section || !item || !text) return;

        activeState.confirmations[confirmationKey(section, item.raw)] = {
          raw: item.raw,
          text,
          confirmedAt: new Date().toISOString()
        };
        activeState.touched = true;
        saveState();
        render();
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
      if (model.unknowns.length) return;
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
      explicitNormalFindings: record.payload.explicit_normal_findings,
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
