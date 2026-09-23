(() => {
  "use strict";

  const FINDING_DEBOUNCE_MS = 240;
  let findingTimer = null;
  let templateMode = "abcde";
  let suppressedFindingKeys = new Set();
  let lastPhysicalSource = "";
  let learnedFindingRecords = generatedFindingRecords();
  let learningOverview = { approvedLearning: 0, pendingCandidates: 0 };
  let learningRegistryLoaded = false;
  let learningRegistryPromise = null;
  let activeUnknownPhrase = "";
  let lastLearningId = "";
  let learningMessage = "";
  let activeAiSuggestion = null;
  let activeExistingFindingKey = "";

  const CORE_FINDINGS = [
    { key: "epig-tender", label: "Epigastrialis nyomásérzékenység", target: "abdomen", section: "E5", group: "abdomen" },
    { key: "abdomen-tender", label: "Hasi nyomásérzékenység", target: "abdomen", section: "E5", group: "abdomen" },
    { key: "defense", label: "Defanz", target: "abdomen", section: "E5", group: "abdomen" },
    { key: "no-defense", label: "Defanz nincs", target: "abdomen", section: "E5", group: "abdomen" },
    { key: "dyspnea", label: "Dyspnoe", target: "respiratory", section: "B", group: "respiratory" },
    { key: "no-dyspnea", label: "Dyspnoe nincs", target: "respiratory", section: "B", group: "respiratory" },
    { key: "crackles", label: "Crepitatio", target: "respiratory", section: "B", group: "respiratory" },
    { key: "wheeze", label: "Sípoló légzés", target: "respiratory", section: "B", group: "respiratory" },
    { key: "pulmonary-congestion", label: "Pulmonalis pangás", target: "respiratory", section: "B", group: "respiratory" },
    { key: "edema", label: "Perifériás ödéma", target: "locomotor", section: "E4", group: "locomotor" },
    { key: "no-edema", label: "Ödéma nincs", target: "locomotor", section: "E4", group: "locomotor" },
    { key: "tachyarrhythmia", label: "Tachyarrhythmiás szívritmus", target: "circulation", section: "C", group: "circulation" },
    { key: "systolic-murmur", label: "Systolés zörej", target: "circulation", section: "C", group: "circulation" },
    { key: "irregular", label: "Szabálytalan szívritmus", target: "circulation", section: "C", group: "circulation" },
    { key: "tachycardia", label: "Tachycardia", target: "circulation", section: "C", group: "circulation" },
    { key: "bradycardia", label: "Bradycardia", target: "circulation", section: "C", group: "circulation" },
    { key: "focal", label: "Neurológiai gócjel / paresis", target: "neuro", section: "D", group: "neuro" },
    { key: "no-focal", label: "Neurológiai gócjel nincs", target: "neuro", section: "D", group: "neuro" },
    { key: "gcs", label: "GCS", target: "neuro", section: "D", group: "neuro" }
  ];

  // Physical-status learning taxonomy follows the A-E clinical blocks used by
  // statuszgenerator.hu. ECG/EKG is intentionally excluded here: BachTranSBO
  // keeps it as a separate investigation, not as part of the physical status.
  const CUSTOM_TARGETS = [
    { value: "airway", label: "A – Légút", section: "A", group: "airway" },
    { value: "respiratory", label: "B – Légzés / Mellkas / Pulmo", section: "B", group: "respiratory" },
    { value: "circulation", label: "C – Keringés / Szív", section: "C", group: "circulation" },
    { value: "neuro", label: "D – Neurológia", section: "D", group: "neuro" },
    { value: "general", label: "E1 – Általános állapot", section: "E1", group: "general" },
    { value: "skin", label: "E2 – Bőr / nyálkahártyák", section: "E2", group: "skin" },
    { value: "injury", label: "E3 – Sérülés", section: "E3", group: "injury" },
    { value: "locomotor", label: "E4 – Végtagok / oedema / MVT", section: "E4", group: "locomotor" },
    { value: "abdomen", label: "E5 – Has", section: "E5", group: "abdomen" },
    { value: "urogenital", label: "E6 – Vese / urogenitalis", section: "E6", group: "urogenital" },
    { value: "other", label: "E1 – Egyéb", section: "E1", group: "other" }
  ];

  const STANDARD_BASE = {
    intro: "Kp táplált. Bőr: normoturgor, kp vértelt, icterus, ödéma nem látható. Nyálkahártyák: kp. vérteltek. Conjunctiva: kp. erezett. Garatképletek: békések. Nyirokcsomók: kóros nem tap. Mamma: göb nem tap. Pajzsmirigy: göb nem tap.",
    chest: "Mellkas: részarányos. Rekeszek mko kitérnek.",
    pulmo: "Pulmo: puha sejtes alaplégzés, zörej nem hallható.",
    heart: "Szívhangok: ritmusos, kellően ékelt, tiszta. Carotis zörej: nem hallh. Perif. erek: mko jól tap.",
    abdomen: "Has: puha, betapintható, élénk bélhangok, kóros rezisztencia nem tap, nyomásérzékenységet nem jelez. Hepar elérhető. Lép nem tap. Vesetájak szabadok.",
    locomotor: "Mozgásszervek: alakilag és funkcionálisan épek.",
    neuro: "Pupillák: o, =, centrális. Tudata tiszta, neurológiai gócjel nincs, időben és térben orientált."
  };

  function addBetaBadge() {
    const brand = document.querySelector(".brand");
    if (!brand || brand.querySelector(".beta-build-badge")) return;
    const badge = document.createElement("span");
    badge.className = "beta-build-badge";
    badge.textContent = "BETA";
    brand.appendChild(badge);
  }

  function normalizeText(value) {
    return String(value || "")
      .toLocaleLowerCase("hu-HU")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeLearningPhrase(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("hu-HU")
      .replace(/[‐‑‒–—−]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/[\s.,;:]+$/g, "")
      .trim();
  }

  function generatedFindingRecords() {
    const records = window.BACH_SBO_BETA_FINDING_REGISTRY?.records;
    if (!Array.isArray(records)) return [];

    return records
      .map((record, index) => {
        const sourcePhrase = String(
          record?.sourcePhrase || record?.sample || record?.alias || ""
        ).trim();
        const normalizedPhrase = normalizeLearningPhrase(
          record?.normalizedPhrase || record?.alias || sourcePhrase
        );
        const findingKey = String(record?.findingKey || "").trim();
        if (!normalizedPhrase || !findingKey) return null;

        return {
          id: String(record?.id || `generated-${index + 1}`),
          sourcePhrase,
          normalizedPhrase,
          mappingKind: record?.mappingKind === "new" ? "new" : "existing",
          findingKey,
          canonicalLabel: String(record?.canonicalLabel || "").trim(),
          target: String(record?.target || "").trim(),
          section: String(record?.section || "").trim(),
          outputText: String(record?.outputText || "").trim(),
          conflictText: String(record?.conflictText || "").trim(),
          attributes: record?.attributes && typeof record.attributes === "object"
            ? { ...record.attributes }
            : {},
          createdAt: record?.createdAt || window.BACH_SBO_BETA_FINDING_REGISTRY?.generatedAt || null,
          source: "generated-beta-registry"
        };
      })
      .filter(Boolean);
  }

  function learningRecordSignature(record) {
    return [
      normalizeLearningPhrase(record?.normalizedPhrase || record?.sourcePhrase),
      String(record?.findingKey || "").trim(),
      record?.mappingKind === "new" ? "new" : "existing"
    ].join("::");
  }

  function mergeFindingLearningRecords(...groups) {
    const merged = [];
    const seen = new Set();
    for (const group of groups) {
      for (const record of Array.isArray(group) ? group : []) {
        const signature = learningRecordSignature(record);
        if (!signature || signature.startsWith("::")) continue;
        if (seen.has(signature)) continue;
        seen.add(signature);
        merged.push(record);
      }
    }
    return merged;
  }

  function coreFindingMeta(key) {
    return CORE_FINDINGS.find((item) => item.key === key) || null;
  }

  function targetMeta(value) {
    return CUSTOM_TARGETS.find((item) => item.value === value) || CUSTOM_TARGETS.at(-1);
  }

  function existingFindingChoices() {
    const choices = CORE_FINDINGS.map((item) => ({
      ...item,
      source: "core",
      outputText: "",
      conflictText: "",
      attributes: {}
    }));
    const seen = new Set(choices.map((item) => item.key));

    for (const record of learnedFindingRecords) {
      if (record?.mappingKind !== "new" || !record?.findingKey || seen.has(record.findingKey)) continue;
      const target = targetMeta(record.target);
      choices.push({
        key: record.findingKey,
        label: record.canonicalLabel || record.outputText || record.sourcePhrase || record.findingKey,
        target: record.target || target.value,
        section: record.section || target.section,
        group: target.group,
        source: "learned",
        outputText: record.outputText || record.sourcePhrase || record.canonicalLabel || "",
        conflictText: record.conflictText || "",
        attributes: record.attributes || {}
      });
      seen.add(record.findingKey);
    }

    return choices.sort((a, b) =>
      String(a.section || "E").localeCompare(String(b.section || "E")) ||
      String(a.label || "").localeCompare(String(b.label || ""), "hu-HU")
    );
  }

  function existingFindingChoice(key) {
    return existingFindingChoices().find((item) => item.key === key) || null;
  }

  function existingFindingAttributes(findingKey, phrase) {
    const text = normalizeText(phrase);
    const attributes = {};

    if (["crackles", "wheeze", "pulmonary-congestion"].includes(findingKey)) {
      const bilateral = /\bmko\b|mindk[eé]t\s+oldal|k[eé]toldali/.test(text);
      const right = /\bjobb\b/.test(text);
      const left = /\bbal\b/.test(text);
      const basal = /\bbas(?:al|is|ison|alisan)/.test(text);
      const apical = /\bapic(?:al|is|alisan)/.test(text);

      if (bilateral) attributes.laterality = "bilateral";
      else if (right) attributes.laterality = "right";
      else if (left) attributes.laterality = "left";

      if (bilateral && basal) attributes.location = "mko. basalis";
      else if (right && basal) attributes.location = "jobb basalis";
      else if (left && basal) attributes.location = "bal basalis";
      else if (bilateral && apical) attributes.location = "mko. apicalis";
      else if (right && apical) attributes.location = "jobb apicalis";
      else if (left && apical) attributes.location = "bal apicalis";
      else if (bilateral) attributes.location = "mko.";
      else if (right) attributes.location = "jobb oldalon";
      else if (left) attributes.location = "bal oldalon";
      else if (basal) attributes.location = "basalisan";
      else if (apical) attributes.location = "apicalisan";
    }

    if (findingKey === "systolic-murmur") {
      const grade = text.match(/\b([1-6])\s*\/\s*([1-6])(?:-?(?:es|ös|as|os))?\b/);
      if (grade) attributes.grade = `${grade[1]}/${grade[2]}`;
    }

    if (findingKey === "gcs") {
      const value = text.match(/\bgcs\s*[:=]?\s*(1[0-5]|[3-9])\b/);
      if (value) attributes.value = Number(value[1]);
    }

    return attributes;
  }

  function mergedLearningAttributes(findingKey, phrase) {
    const local = existingFindingAttributes(findingKey, phrase);
    const ai = activeAiSuggestion?.findingKey === findingKey &&
      normalizeLearningPhrase(activeAiSuggestion?.sourcePhrase) === normalizeLearningPhrase(phrase)
      ? (activeAiSuggestion.attributes || {})
      : {};
    return { ...ai, ...local };
  }

  function simpleHash(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.codePointAt(0) || 0;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function learnedFindingFromRecord(record) {
    if (!record?.findingKey) return null;
    if (record.mappingKind === "new") {
      const target = targetMeta(record.target);
      return {
        key: `custom:${record.findingKey}`,
        label: record.canonicalLabel || record.outputText || record.sourcePhrase || record.findingKey,
        group: target.group,
        customRule: {
          findingKey: record.findingKey,
          target: record.target || target.value,
          section: record.section || target.section,
          outputText: record.outputText || record.sourcePhrase || record.canonicalLabel || "",
          conflictText: record.conflictText || ""
        }
      };
    }

    const meta = coreFindingMeta(record.findingKey);
    if (meta) {
      return {
        key: meta.key,
        label: record.canonicalLabel || meta.label,
        group: meta.group,
        ...(record.attributes || {})
      };
    }

    const customBase = learnedFindingRecords.find((item) =>
      item?.mappingKind === "new" && item?.findingKey === record.findingKey
    );
    if (!customBase) return null;
    const target = targetMeta(customBase.target);
    return {
      key: `custom:${customBase.findingKey}`,
      label: record.canonicalLabel || customBase.canonicalLabel || customBase.outputText || customBase.findingKey,
      group: target.group,
      ...(customBase.attributes || {}),
      ...(record.attributes || {}),
      customRule: {
        findingKey: customBase.findingKey,
        target: customBase.target || target.value,
        section: customBase.section || target.section,
        outputText: customBase.outputText || customBase.sourcePhrase || customBase.canonicalLabel || "",
        conflictText: customBase.conflictText || ""
      }
    };
  }

  function parseLearnedFindings(source) {
    const text = normalizeLearningPhrase(source);
    if (!text || !learnedFindingRecords.length) return [];

    const findings = [];
    for (const record of learnedFindingRecords) {
      const alias = normalizeLearningPhrase(record.normalizedPhrase || record.sourcePhrase);
      if (!alias || !text.includes(alias)) continue;
      const finding = learnedFindingFromRecord(record);
      if (finding) addFinding(findings, finding);
    }
    return findings;
  }

  function segmentClinicalText(source) {
    let text = String(source || "").trim();
    if (!text) return [];

    const protectedAbbreviations = [
      ["mko.", "mko§"],
      ["n.v.", "n§v§"],
      ["kb.", "kb§"],
      ["syst.", "syst§"],
      ["sziszt.", "sziszt§"],
      ["diast.", "diast§"],
      ["diaszt.", "diaszt§"],
      ["jobb o.", "jobb o§"],
      ["bal o.", "bal o§"],
      ["st. post", "st§ post"]
    ];
    for (const [raw, token] of protectedAbbreviations) {
      text = text.replaceAll(raw, token);
      text = text.replaceAll(raw.toUpperCase(), token);
      text = text.replaceAll(raw.charAt(0).toUpperCase() + raw.slice(1), token);
    }

    return text
      .split(/(?:\s*[;,\n]+\s*)|(?:[.!?]+\s+)/)
      .map((part) => {
        let restored = part.trim();
        for (const [raw, token] of protectedAbbreviations) {
          restored = restored.replaceAll(token, raw);
        }
        return restored.trim();
      })
      .filter(Boolean);
  }

  function unknownSegments(source) {
    return segmentClinicalText(source).filter((segment) => parseFindings(segment).length === 0);
  }

  async function loadFindingLearningRegistry(force = false) {
    if (learningRegistryLoaded && !force) return;
    if (learningRegistryPromise && !force) return learningRegistryPromise;
    if (typeof window.BachSBOBackend?.findingLearningLoadRegistry !== "function") {
      learningRegistryLoaded = true;
      return;
    }

    learningRegistryPromise = (async () => {
      try {
        const result = await window.BachSBOBackend.findingLearningLoadRegistry();
        learnedFindingRecords = mergeFindingLearningRecords(
          Array.isArray(result?.records) ? result.records : [],
          generatedFindingRecords()
        );
        learningOverview = result?.overview || learningOverview;
        learningRegistryLoaded = true;
        syncComposer();
        document.dispatchEvent(new CustomEvent("bachsbo:finding-learning-changed"));
      } catch (error) {
        console.warn("Finding learning registry unavailable:", error);
      } finally {
        learningRegistryPromise = null;
      }
    })();
    return learningRegistryPromise;
  }

  function clauseAt(text, index) {
    const separators = /[.;,\n]/;
    let start = index;
    let end = index;
    while (start > 0 && !separators.test(text[start - 1])) start -= 1;
    while (end < text.length && !separators.test(text[end])) end += 1;
    return text.slice(start, end);
  }

  function hasNegationNear(text, index) {
    return /\b(nincs|nem|negat[ií]v|n\.v\.)\b/.test(clauseAt(text, index));
  }

  function locationFor(text, index) {
    const windowText = text.slice(Math.max(0, index - 45), Math.min(text.length, index + 45));
    if (/jobb\s+bas/.test(windowText)) return "jobb basalis";
    if (/bal\s+bas/.test(windowText)) return "bal basalis";
    if (/(mko|mindk[eé]t\s+oldal|k[eé]toldali).*bas/.test(windowText)) return "mko. basalis";
    if (/jobb/.test(windowText)) return "jobb oldalon";
    if (/bal/.test(windowText)) return "bal oldalon";
    if (/bas/.test(windowText)) return "basalisan";
    return "";
  }

  function addFinding(findings, finding) {
    if (!findings.some((item) => item.key === finding.key)) findings.push(finding);
  }

  function parseFindings(source) {
    const text = normalizeText(source);
    const findings = [];
    if (!text) return findings;

    const epig = text.search(/epig(?:astr|\.)?[^.;,]{0,28}(nyom|[ée]rz|f[aá]j)/);
    if (epig >= 0 && !hasNegationNear(text, epig)) {
      addFinding(findings, { key: "epig-tender", label: "Epigastrialis nyomásérzékenység", group: "abdomen" });
    }

    const abdomenTender = text.search(/(?:\bhas(?:a|i)?\b|\babd(?:omen)?\b)[^.;,\n]{0,40}(nyom[aá]s?[ée]rz|nyom[ée]rz|[ée]rz[ée]keny|f[aá]jdalmas)/);
    if (abdomenTender >= 0 && !hasNegationNear(text, abdomenTender) && epig < 0) {
      addFinding(findings, { key: "abdomen-tender", label: "Hasi nyomásérzékenység", group: "abdomen" });
    }

    const defense = text.search(/defan[sz]|defense/);
    if (defense >= 0) {
      if (hasNegationNear(text, defense)) {
        addFinding(findings, { key: "no-defense", label: "Defanz nincs", group: "abdomen" });
      } else {
        addFinding(findings, { key: "defense", label: "Defanz", group: "abdomen" });
      }
    }

    const dyspnea = text.search(/dyspn|neh[eé]zl[eé]gz|fullad/);
    if (dyspnea >= 0) {
      if (hasNegationNear(text, dyspnea)) {
        addFinding(findings, { key: "no-dyspnea", label: "Dyspnoe nincs", group: "respiratory" });
      } else {
        addFinding(findings, { key: "dyspnea", label: "Dyspnoe", group: "respiratory" });
      }
    }

    const crackles = text.search(/crep|sz[oö]rty/);
    if (crackles >= 0 && !hasNegationNear(text, crackles)) {
      const location = locationFor(text, crackles);
      addFinding(findings, {
        key: "crackles",
        label: location ? `${location} crepitatio` : "Crepitatio",
        group: "respiratory",
        location
      });
    }

    const wheeze = text.search(/s[ií]pol|wheez|b[uú]g[oó]/);
    if (wheeze >= 0 && !hasNegationNear(text, wheeze)) {
      const location = locationFor(text, wheeze);
      addFinding(findings, {
        key: "wheeze",
        label: location ? `${location} sípoló légzés` : "Sípoló légzés",
        group: "respiratory",
        location
      });
    }

    const congestion = text.search(/pang[aá]s/);
    if (congestion >= 0 && !hasNegationNear(text, congestion)) {
      const pulmonaryWindow = text.slice(Math.max(0, congestion - 60), Math.min(text.length, congestion + 40));
      const location = /\bmko\b\.?\s+(?:tüdő|pulmo)|mindk[eé]t\s+oldal/.test(pulmonaryWindow)
        ? "mko."
        : /\bjobb\b[^.;,\n]{0,35}(?:tüdő|pulmo|pang[aá]s)/.test(pulmonaryWindow)
          ? "jobb oldalon"
          : /\bbal\b[^.;,\n]{0,35}(?:tüdő|pulmo|pang[aá]s)/.test(pulmonaryWindow)
            ? "bal oldalon"
            : "";
      addFinding(findings, {
        key: "pulmonary-congestion",
        label: location ? `${location} tüdő felett pangás` : "Pulmonalis pangás",
        group: "respiratory",
        location
      });
    }

    const edema = text.search(/[oö]d[eé]ma|oedema/);
    if (edema >= 0) {
      if (hasNegationNear(text, edema)) {
        addFinding(findings, { key: "no-edema", label: "Ödéma nincs", group: "circulation" });
      } else {
        addFinding(findings, { key: "edema", label: "Perifériás ödéma", group: "circulation" });
      }
    }

    const tachyarrhythmia = text.search(/tachy\s*arr?itmi|tachy\s*arrhyth/);
    if (tachyarrhythmia >= 0 && !hasNegationNear(text, tachyarrhythmia)) {
      addFinding(findings, { key: "tachyarrhythmia", label: "Tachyarrhythmiás szívritmus", group: "circulation" });
    }

    const murmurMatch = text.match(/(?:([1-6]\s*\/\s*[1-6])(?:-?(?:es|ös|as|os))?\s*)?(?:systol[eé]s|szisztol[eé]s)\s+z[oö]rej/);
    if (murmurMatch) {
      const index = murmurMatch.index ?? text.indexOf(murmurMatch[0]);
      if (!hasNegationNear(text, index)) {
        const grade = String(murmurMatch[1] || "").replace(/\s+/g, "");
        addFinding(findings, {
          key: "systolic-murmur",
          label: grade ? `${grade} systolés zörej` : "Systolés zörej",
          group: "circulation",
          grade
        });
      }
    }

    const irregular = text.search(/arrhyth|arr?itmi|irregular|szab[aá]lytalan/);
    if (tachyarrhythmia < 0 && irregular >= 0 && !hasNegationNear(text, irregular)) {
      addFinding(findings, { key: "irregular", label: "Szabálytalan szívritmus", group: "circulation" });
    }
    const tachy = text.search(/tachycard|tachykard|szapora\s+sz[ií]v/);
    if (tachyarrhythmia < 0 && tachy >= 0 && !hasNegationNear(text, tachy)) {
      addFinding(findings, { key: "tachycardia", label: "Tachycardia", group: "circulation" });
    }
    const brady = text.search(/bradycard|bradykard/);
    if (brady >= 0 && !hasNegationNear(text, brady)) {
      addFinding(findings, { key: "bradycardia", label: "Bradycardia", group: "circulation" });
    }

    const focal = text.search(/hemipar|g[oó]cjel|oldaljel|focal|fok[aá]lis/);
    if (focal >= 0) {
      if (hasNegationNear(text, focal)) {
        addFinding(findings, { key: "no-focal", label: "Neurológiai gócjel nincs", group: "neuro" });
      } else {
        addFinding(findings, { key: "focal", label: "Neurológiai gócjel / paresis", group: "neuro" });
      }
    }

    const gcsMatch = text.match(/gcs\s*[:=]?\s*(1[0-5]|[3-9])\b/);
    if (gcsMatch) {
      addFinding(findings, {
        key: "gcs",
        label: `GCS ${gcsMatch[1]}`,
        group: "neuro",
        value: Number(gcsMatch[1])
      });
    }

    for (const learned of parseLearnedFindings(source)) {
      addFinding(findings, learned);
    }

    return findings;
  }

  function activeFindings(all) {
    return all.filter((finding) => !suppressedFindingKeys.has(finding.key));
  }

  function findingMap(findings) {
    return new Map(findings.map((finding) => [finding.key, finding]));
  }

  function customFindings(findings) {
    return findings.filter((finding) => finding?.customRule?.outputText);
  }

  function ensureSentence(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    return /[.!?]$/.test(text) ? text : text + ".";
  }

  function applyCustomRule(base, rule) {
    let text = String(base || "");
    const conflict = String(rule?.conflictText || "").trim();
    if (conflict) {
      text = text.split(conflict).join("").replace(/\s{2,}/g, " ").trim();
    }
    const output = ensureSentence(rule?.outputText);
    return output ? `${text.trim()} ${output}`.trim() : text.trim();
  }

  function standardStatus(findings) {
    const map = findingMap(findings);
    let intro = STANDARD_BASE.intro;
    if (map.has("edema")) {
      intro = intro.replace("icterus, ödéma nem látható", "icterus nem látható, perifériás ödéma észlelhető");
    }

    let pulmo = STANDARD_BASE.pulmo;
    const respiratory = [];
    if (map.has("dyspnea")) respiratory.push("A beteg dyspnoés.");
    if (map.has("crackles")) {
      const loc = map.get("crackles").location;
      respiratory.push(`${loc ? loc + " " : ""}crepitatio hallható.`);
    }
    if (map.has("wheeze")) {
      const loc = map.get("wheeze").location;
      respiratory.push(`${loc ? loc + " " : ""}sípoló légzési hang hallható.`);
    }
    if (map.has("pulmonary-congestion")) {
      const loc = map.get("pulmonary-congestion").location;
      respiratory.push(`${loc ? loc + " " : ""}tüdő felett pangás hallható.`);
    }
    if (respiratory.length) {
      pulmo = "Pulmo: puha sejtes alaplégzés. " + respiratory.join(" ");
    }

    let heart = STANDARD_BASE.heart;
    if (map.has("tachyarrhythmia")) {
      heart = "Szívhangok: tachyarrhythmiásak.";
    } else {
      if (map.has("irregular")) heart = heart.replace("ritmusos", "arrhythmiás");
      if (map.has("tachycardia")) heart = heart.replace("Szívhangok:", "Szívhangok: tachycard,");
      if (map.has("bradycardia")) heart = heart.replace("Szívhangok:", "Szívhangok: bradycard,");
    }
    if (map.has("systolic-murmur")) {
      const grade = map.get("systolic-murmur").grade;
      heart = heart.replace(/(?:,?\s*tiszta\.?|zörej nem hallható\.?)/g, "").trim();
      heart += ` ${grade ? grade + " " : ""}systolés zörej hallható.`;
    }
    if (map.has("edema")) heart += " Perifériás ödéma észlelhető.";

    let abdomen = STANDARD_BASE.abdomen;
    if (map.has("epig-tender")) {
      abdomen = abdomen.replace("nyomásérzékenységet nem jelez", "epigastriumban nyomásérzékeny");
    } else if (map.has("abdomen-tender")) {
      abdomen = abdomen.replace("nyomásérzékenységet nem jelez", "nyomásérzékeny");
    }
    if (map.has("defense")) abdomen += " Defanz észlelhető.";
    if (map.has("no-defense")) abdomen += " Defanz nincs.";

    let neuro = STANDARD_BASE.neuro;
    if (map.has("focal")) neuro = neuro.replace("neurológiai gócjel nincs", "neurológiai gócjel észlelhető");
    if (map.has("gcs")) neuro += ` GCS: ${map.get("gcs").value}.`;
    let locomotor = STANDARD_BASE.locomotor;

    for (const finding of customFindings(findings)) {
      const rule = finding.customRule;
      switch (rule.target) {
        case "airway":
          intro = applyCustomRule(intro, rule);
          break;
        case "respiratory":
          pulmo = applyCustomRule(pulmo, rule);
          break;
        case "circulation":
          heart = applyCustomRule(heart, rule);
          break;
        case "neuro":
          neuro = applyCustomRule(neuro, rule);
          break;
        case "general":
        case "skin":
        case "injury":
          intro = applyCustomRule(intro, rule);
          break;
        case "locomotor":
          locomotor = applyCustomRule(locomotor, rule);
          break;
        case "abdomen":
        case "urogenital":
        case "other":
        default:
          abdomen = applyCustomRule(abdomen, rule);
          break;
      }
    }

    return [intro, STANDARD_BASE.chest, pulmo, heart, abdomen, locomotor, neuro].join(" ");
  }

  function abcdeStatus(findings) {
    const map = findingMap(findings);

    let bDyspnea = "Nehézlégzés nincs.";
    if (map.has("dyspnea")) bDyspnea = "Nehézlégzés észlelhető.";

    const noises = [];
    if (map.has("crackles")) {
      const loc = map.get("crackles").location;
      noises.push(`${loc ? loc + " " : ""}crepitatio hallható`);
    }
    if (map.has("wheeze")) {
      const loc = map.get("wheeze").location;
      noises.push(`${loc ? loc + " " : ""}sípoló légzési hang hallható`);
    }
    if (map.has("pulmonary-congestion")) {
      const loc = map.get("pulmonary-congestion").location;
      noises.push(`${loc ? loc + " " : ""}tüdő felett pangás hallható`);
    }
    const bNoises = noises.length
      ? `Zörejek: ${noises.join(", ")}.`
      : "Zörejek: nincs.";

    let cHeart = "Szívhangok: ritmusos, tiszta, zörej nem hallható.";
    if (map.has("tachyarrhythmia")) {
      cHeart = "Szívhangok: tachyarrhythmiásak.";
    } else {
      if (map.has("irregular")) {
        cHeart = "Szívhangok: arrhythmiásak, tiszták, zörej nem hallható.";
      }
      if (map.has("tachycardia")) {
        cHeart = cHeart.replace("Szívhangok:", "Szívhangok: tachycard,");
      }
      if (map.has("bradycardia")) {
        cHeart = cHeart.replace("Szívhangok:", "Szívhangok: bradycard,");
      }
    }
    if (map.has("systolic-murmur")) {
      const grade = map.get("systolic-murmur").grade;
      cHeart = cHeart.replace(/(?:,?\s*tiszt[aá]k?\.?|zörej nem hallható\.?)/g, "").trim();
      cHeart += ` ${grade ? grade + " " : ""}systolés zörej hallható.`;
    }

    const gcs = map.has("gcs") ? map.get("gcs").value : 15;
    let dNeuro = "Pupillák kerekek, egyenlőek, fényre jól reagálnak, nystagmus, kettőslátás nincs. Tarkótáji kötöttség, meningealis izgalmi jelek nincsenek. Izomerő megtartott. Szenzoros/motoros oldalkülönbség nincs. Latens paresis nincs.";
    if (map.has("focal")) {
      dNeuro = dNeuro.replace(
        "Izomerő megtartott. Szenzoros/motoros oldalkülönbség nincs. Latens paresis nincs.",
        "Neurológiai gócjel / paresis észlelhető."
      );
    }

    let abdomen = "Has: mellkas szintjében, puha, betapintható. Kóros rezisztencia nincs, nyomásérzékenység nincs, kp. élénk bélhangok. Máj nem tapintható. Lép nem tapintható.";
    if (map.has("epig-tender")) {
      abdomen = abdomen.replace("nyomásérzékenység nincs", "epigastriumban nyomásérzékeny");
    } else if (map.has("abdomen-tender")) {
      abdomen = abdomen.replace("nyomásérzékenység nincs", "nyomásérzékeny");
    }
    if (map.has("defense")) abdomen += " Defanz észlelhető.";
    if (map.has("no-defense")) abdomen += " Defanz nincs.";

    const edema = map.has("edema") ? "ödéma észlelhető" : "ödéma nincs";

    const lines = [
      "A: Légutak átjárhatók. A beteg beszél.",
      `B: ${bDyspnea} Mellkas: részarányos. Rekeszek szimmetrikusan kitérnek. Alaplégzés: érdessejtes. ${bNoises} Oldalkülönbség nincs. Légzési munka normális. Cyanosis nincs.`,
      `C: Jól tapintható perifériás pulzusok. CRT <2 s. ${cHeart} Nyaki vénák nem teltek.`,
      `D: A (Alert). GCS: ${gcs}${gcs === 15 ? " (Sz:4, V:5, M:6)" : ""}. ${dNeuro}`,
      "E1 – Általános állapot: Kp. fejlett, kp. táplált, jó általános állapotú beteg.",
      "E2 – Bőr / nyálkahártyák: Bőrszín normál, turgora megtartott. Nyálkahártyák kp. vérteltek. Nyelv nedves. Sclera fehér.",
      "E3 – Sérülés: Külsérelmi nyom nincs.",
      `E4 – Végtagok / oedema / MVT: Végtagok alakilag és funkcionálisan épek, ${edema}. MVT-re utaló jel nincs. Gerinc alakilag ép, ütögetésre nem érzékeny.`,
      `E5 – Has: ${abdomen}`,
      "E6 – Vese / urogenitalis: Vesetájak ütögetésre nem érzékenyek."
    ];

    for (const finding of customFindings(findings)) {
      const rule = finding.customRule;
      const target = String(rule.target || "");
      const index =
        target === "airway" ? 0 :
        target === "respiratory" ? 1 :
        target === "circulation" ? 2 :
        target === "neuro" ? 3 :
        target === "general" ? 4 :
        target === "skin" ? 5 :
        target === "injury" ? 6 :
        target === "locomotor" ? 7 :
        target === "abdomen" ? 8 :
        target === "urogenital" ? 9 :
        4;
      lines[index] = applyCustomRule(lines[index], rule);
    }

    return lines.join("\n");
  }

  function generatedStatus(findings) {
    return templateMode === "standard" ? standardStatus(findings) : abcdeStatus(findings);
  }

  function updateLearningOverviewUi(composer) {
    const meta = composer?.querySelector("#betaLearningMeta");
    const undo = composer?.querySelector("#betaUndoLearning");
    if (meta) {
      meta.textContent = `${Number(learningOverview.approvedLearning || 0)} tanítás mentve`;
    }
    if (undo) {
      undo.disabled = !lastLearningId;
      undo.classList.toggle("hidden", !lastLearningId);
    }
    const message = composer?.querySelector("#betaLearningMessage");
    if (message) {
      message.textContent = learningMessage;
      message.classList.toggle("hidden", !learningMessage);
    }
  }

  function renderExistingFindingPicker(composer) {
    const list = composer?.querySelector("#betaExistingFindingList");
    const search = composer?.querySelector("#betaExistingFindingSearch");
    const selected = composer?.querySelector("#betaExistingFindingSelection");
    const save = composer?.querySelector("#betaSaveExistingFinding");
    if (!list) return;

    const query = normalizeText(search?.value || "");
    const choices = existingFindingChoices().filter((item) => {
      if (!query) return true;
      return normalizeText(`${item.section} ${item.label} ${item.target} ${item.key}`).includes(query);
    });

    list.innerHTML = "";
    let currentSection = "";
    for (const item of choices) {
      if (item.section !== currentSection) {
        currentSection = item.section;
        const heading = document.createElement("div");
        heading.className = "beta-existing-group";
        heading.textContent = `${item.section} • ${targetMeta(item.target).label.replace(/^.[ ]*[–-][ ]*/, "")}`;
        list.appendChild(heading);
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "beta-existing-choice";
      button.dataset.existingFindingKey = item.key;
      button.classList.toggle("selected", item.key === activeExistingFindingKey);
      const label = document.createElement("span");
      label.textContent = item.label;
      const detail = document.createElement("small");
      detail.textContent = item.source === "learned"
        ? "tanított finding"
        : targetMeta(item.target).label;
      button.append(label, detail);
      list.appendChild(button);
    }

    if (!choices.length) {
      const empty = document.createElement("div");
      empty.className = "beta-existing-empty";
      empty.textContent = "Nincs találat.";
      list.appendChild(empty);
    }

    const choice = existingFindingChoice(activeExistingFindingKey);
    if (selected) {
      selected.textContent = choice
        ? `Kiválasztva: ${choice.section} • ${choice.label}`
        : "Válasszon egy meglévő findingot.";
      selected.classList.toggle("has-selection", Boolean(choice));
    }
    if (save) save.disabled = !choice;
  }

  function fillLearningSelectors(composer) {
    const target = composer?.querySelector("#betaNewFindingTarget");
    if (target && !target.options.length) {
      for (const item of CUSTOM_TARGETS) {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        target.appendChild(option);
      }
    }
    renderExistingFindingPicker(composer);
  }

  function prepareUnknownEditor(composer, phrase) {
    const nextPhrase = String(phrase || "").trim();
    if (normalizeLearningPhrase(nextPhrase) !== normalizeLearningPhrase(activeUnknownPhrase)) {
      activeAiSuggestion = null;
      activeExistingFindingKey = "";
      const search = composer?.querySelector("#betaExistingFindingSearch");
      if (search) search.value = "";
    }
    activeUnknownPhrase = nextPhrase;
    const editor = composer?.querySelector("#betaLearningEditor");
    if (!editor) return;
    editor.classList.toggle("hidden", !activeUnknownPhrase);
    if (!activeUnknownPhrase) return;

    fillLearningSelectors(composer);
    const phraseNode = editor.querySelector("#betaLearningPhrase");
    const label = editor.querySelector("#betaNewFindingLabel");
    const output = editor.querySelector("#betaNewFindingOutput");
    const conflict = editor.querySelector("#betaNewFindingConflict");
    if (phraseNode) phraseNode.textContent = activeUnknownPhrase;
    if (label) label.value = activeUnknownPhrase;
    if (output) output.value = ensureSentence(activeUnknownPhrase);
    if (conflict) conflict.value = "";
    renderExistingFindingPicker(composer);
  }

  function acceptLearningRecord(result) {
    if (!result?.record) return;
    learnedFindingRecords = [
      result.record,
      ...learnedFindingRecords.filter((item) => item.id !== result.record.id)
    ];
    learningOverview = result.overview || learningOverview;
    lastLearningId = result.record.id;
    activeUnknownPhrase = "";
    activeAiSuggestion = null;
    learningMessage = result?.threshold?.built
      ? "Mentve. A küszöb elérve, a jelölt patch automatikusan frissült."
      : "Mentve a learning registrybe.";
    syncComposer();
    document.dispatchEvent(new CustomEvent("bachsbo:finding-learning-changed"));
  }

  async function saveExistingLearning() {
    const composer = document.getElementById("betaFindingComposer");
    const choice = existingFindingChoice(activeExistingFindingKey);
    if (!composer || !activeUnknownPhrase || !choice) return;

    const button = composer.querySelector("#betaSaveExistingFinding");
    if (button) button.disabled = true;
    try {
      const result = await window.BachSBOBackend?.findingLearningConfirmMapping?.({
        sourcePhrase: activeUnknownPhrase,
        mappingKind: "existing",
        findingKey: choice.key,
        canonicalLabel: choice.label,
        target: choice.target,
        section: choice.section,
        outputText: "",
        conflictText: "",
        attributes: {
          ...(choice.attributes || {}),
          ...mergedLearningAttributes(choice.key, activeUnknownPhrase)
        }
      });
      if (!result) throw new Error("Finding learning backend is unavailable.");
      acceptLearningRecord(result);
    } catch (error) {
      learningMessage = `Mentési hiba: ${error?.message || error}`;
      updateLearningOverviewUi(composer);
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  async function saveNewLearning() {
    const composer = document.getElementById("betaFindingComposer");
    if (!composer || !activeUnknownPhrase) return;

    const label = String(composer.querySelector("#betaNewFindingLabel")?.value || "").trim();
    const targetValue = String(composer.querySelector("#betaNewFindingTarget")?.value || "other");
    const target = targetMeta(targetValue);
    const outputText = String(composer.querySelector("#betaNewFindingOutput")?.value || "").trim();
    const conflictText = String(composer.querySelector("#betaNewFindingConflict")?.value || "").trim();
    const findingKey = `custom_${target.value}_${simpleHash(normalizeLearningPhrase(activeUnknownPhrase))}`;
    const button = composer.querySelector("#betaSaveNewFinding");

    if (!label || !outputText) {
      learningMessage = "Az új finding neve és output szövege kötelező.";
      updateLearningOverviewUi(composer);
      return;
    }

    if (button) button.disabled = true;
    try {
      const result = await window.BachSBOBackend?.findingLearningConfirmMapping?.({
        sourcePhrase: activeUnknownPhrase,
        mappingKind: "new",
        findingKey,
        canonicalLabel: label,
        target: target.value,
        section: target.section,
        outputText,
        conflictText,
        attributes: activeAiSuggestion?.mappingKind === "new" &&
          normalizeLearningPhrase(activeAiSuggestion?.sourcePhrase) === normalizeLearningPhrase(activeUnknownPhrase)
          ? (activeAiSuggestion.attributes || {})
          : {}
      });
      if (!result) throw new Error("Finding learning backend is unavailable.");
      acceptLearningRecord(result);
    } catch (error) {
      learningMessage = `Mentési hiba: ${error?.message || error}`;
      updateLearningOverviewUi(composer);
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  async function suggestUnknownFinding(triggerButton = null) {
    let composer = document.getElementById("betaFindingComposer");
    if (!composer || !activeUnknownPhrase) return;

    const requestedPhrase = activeUnknownPhrase;
    const editorButton = composer.querySelector("#betaSuggestFinding");
    const buttons = [editorButton, triggerButton].filter(Boolean);
    buttons.forEach((button) => { button.disabled = true; });
    learningMessage = "AI javaslat készül…";
    updateLearningOverviewUi(composer);

    try {
      const result = await window.BachSBOBackend?.findingLearningSuggest?.(requestedPhrase);
      const suggestion = result?.suggestion;
      if (!suggestion) throw new Error("Finding AI backend is unavailable.");

      // Autosave/render may replace the composer while the request is in flight.
      // Apply the proposal only to the current live editor, and only if the
      // physician is still reviewing the same unknown phrase.
      if (
        normalizeLearningPhrase(activeUnknownPhrase) !==
        normalizeLearningPhrase(requestedPhrase)
      ) {
        return;
      }

      composer = document.getElementById("betaFindingComposer");
      if (!composer) return;
      prepareUnknownEditor(composer, requestedPhrase);

      activeAiSuggestion = {
        ...suggestion,
        sourcePhrase: result.sourcePhrase || requestedPhrase
      };

      if (suggestion.mappingKind === "existing" && coreFindingMeta(suggestion.findingKey)) {
        activeExistingFindingKey = suggestion.findingKey;
        const search = composer.querySelector("#betaExistingFindingSearch");
        if (search) search.value = "";
        renderExistingFindingPicker(composer);
        learningMessage = `AI javaslat: ${suggestion.canonicalLabel || coreFindingMeta(suggestion.findingKey)?.label}. Ellenőrizze, majd nyomja meg a HOZZÁRENDELÉS + TANÍTÁS gombot.`;
      } else {
        const label = composer.querySelector("#betaNewFindingLabel");
        const target = composer.querySelector("#betaNewFindingTarget");
        const output = composer.querySelector("#betaNewFindingOutput");
        const conflict = composer.querySelector("#betaNewFindingConflict");
        if (label) label.value = suggestion.canonicalLabel || requestedPhrase;
        if (target && targetMeta(suggestion.target)) target.value = suggestion.target || "other";
        if (output) output.value = suggestion.outputText || ensureSentence(requestedPhrase);
        if (conflict) conflict.value = suggestion.conflictText || "";
        learningMessage = "AI új findingot javasol. Ellenőrizze a helyet, outputot és conflict részt, majd mentse kézzel.";
      }

      if (suggestion.reason) {
        learningMessage += ` Indok: ${suggestion.reason}`;
      }
      updateLearningOverviewUi(composer);
    } catch (error) {
      activeAiSuggestion = null;
      learningMessage = `AI javaslat hiba: ${error?.message || error}`;
      updateLearningOverviewUi(document.getElementById("betaFindingComposer"));
    } finally {
      const liveComposer = document.getElementById("betaFindingComposer");
      liveComposer?.querySelector("#betaSuggestFinding")?.removeAttribute("disabled");
      if (triggerButton?.isConnected) triggerButton.disabled = false;
      liveComposer?.querySelectorAll("[data-ai-unknown-phrase]").forEach((button) => {
        button.disabled = false;
      });
    }
  }

  async function undoLastLearning() {
    if (!lastLearningId || typeof window.BachSBOBackend?.findingLearningUndo !== "function") return;
    const id = lastLearningId;
    try {
      const result = await window.BachSBOBackend.findingLearningUndo(id);
      learnedFindingRecords = learnedFindingRecords.filter((record) => record.id !== id);
      learningOverview = result?.overview || learningOverview;
      lastLearningId = "";
      activeAiSuggestion = null;
      learningMessage = "Az utolsó tanítás visszavonva.";
      syncComposer();
      document.dispatchEvent(new CustomEvent("bachsbo:finding-learning-changed"));
    } catch (error) {
      learningMessage = `Visszavonási hiba: ${error?.message || error}`;
      updateLearningOverviewUi(document.getElementById("betaFindingComposer"));
    }
  }

  async function buildFindingCandidates() {
    const composer = document.getElementById("betaFindingComposer");
    try {
      const result = await window.BachSBOBackend?.findingLearningBuildCandidates?.();
      if (!result) throw new Error("Finding learning backend is unavailable.");
      learningOverview = result.overview || learningOverview;
      learningMessage = `Jelölt patch frissítve: ${result.patch?.length || 0} rekord.`;
      updateLearningOverviewUi(composer);
    } catch (error) {
      learningMessage = `Jelölt build hiba: ${error?.message || error}`;
      updateLearningOverviewUi(composer);
    }
  }

  async function copyFindingCandidatePatch() {
    const composer = document.getElementById("betaFindingComposer");
    try {
      const result = await window.BachSBOBackend?.findingLearningCandidatePatch?.();
      if (!result) throw new Error("Finding learning backend is unavailable.");
      learningOverview = result.overview || learningOverview;
      const patchText = JSON.stringify({
        generatedAt: result.generatedAt,
        registryPatchVersion: result.registryPatchVersion,
        patch: result.patch || []
      }, null, 2);
      await navigator.clipboard.writeText(patchText);
      learningMessage = `Patch vágólapra másolva: ${result.patch?.length || 0} jelölt.`;
      updateLearningOverviewUi(composer);
    } catch (error) {
      learningMessage = `Patch másolási hiba: ${error?.message || error}`;
      updateLearningOverviewUi(composer);
    }
  }

  function ensureComposer() {
    const physical = document.getElementById("fPhysical");
    const field = physical?.closest('[data-narrative-field="physical"]');
    if (!physical || !field) return null;

    let composer = document.getElementById("betaFindingComposer");
    if (!composer) {
      composer = document.createElement("div");
      composer.id = "betaFindingComposer";
      composer.className = "beta-finding-composer";
      composer.innerHTML = `
        <div class="beta-finding-head">
          <div>
            <strong>Finding preview</strong>
            <span class="beta-finding-count" id="betaFindingCount"></span>
          </div>
          <span class="beta-local-only">POZITÍV FINDING TANULÁS</span>
        </div>
        <div class="beta-finding-chips" id="betaFindingChips"></div>
        <div class="beta-unknown-block hidden" id="betaUnknownBlock">
          <div class="beta-unknown-title">Nem felismert finding — kattintson a tanításhoz</div>
          <div class="beta-unknown-chips" id="betaUnknownChips"></div>
        </div>
        <div class="beta-learning-editor hidden" id="betaLearningEditor">
          <div class="beta-learning-editor-head">
            <div class="beta-learning-phrase" id="betaLearningPhrase"></div>
            <button type="button" class="btn small" id="betaSuggestFinding">AI JAVASLAT</button>
          </div>
          <div class="beta-learning-grid">
            <div class="beta-learning-card">
              <strong>Meglévő findinghez rendelés</strong>
              <label>Keresés
                <input id="betaExistingFindingSearch" type="search" placeholder="pl. zörej, pangás, has…" autocomplete="off" />
              </label>
              <div class="beta-existing-list" id="betaExistingFindingList"></div>
              <div class="beta-existing-selection" id="betaExistingFindingSelection">Válasszon egy meglévő findingot.</div>
              <button type="button" class="btn small" id="betaSaveExistingFinding" disabled>HOZZÁRENDELÉS + TANÍTÁS</button>
            </div>
            <div class="beta-learning-card">
              <strong>Új finding hozzáadása</strong>
              <label>Név<input id="betaNewFindingLabel" type="text" maxlength="180" /></label>
              <label>Hely<select id="betaNewFindingTarget"></select></label>
              <label>Output<input id="betaNewFindingOutput" type="text" maxlength="1000" /></label>
              <label>Eltávolítandó normál rész — opcionális<input id="betaNewFindingConflict" type="text" maxlength="500" /></label>
              <button type="button" class="btn small" id="betaSaveNewFinding">ÚJ FINDING + TANÍTÁS</button>
            </div>
          </div>
        </div>
        <div class="beta-learning-footer">
          <span id="betaLearningMeta">0 tanítás mentve</span>
          <button type="button" class="btn small beta-undo-learning hidden" id="betaUndoLearning" disabled>UTOLSÓ TANÍTÁS VISSZAVONÁSA</button>
        </div>
        <div class="beta-learning-message hidden" id="betaLearningMessage"></div>
        <div class="beta-finding-warning hidden" id="betaFindingWarning"></div>
        <div class="beta-status-toolbar">
          <div class="beta-status-mode" role="group" aria-label="Status sablon">
            <button type="button" data-status-mode="standard">Standard</button>
            <button type="button" data-status-mode="abcde">ABCDE</button>
          </div>
          <button type="button" class="btn small beta-copy-status" id="betaCopyStatus">STATUS MÁSOLÁSA</button>
        </div>
        <textarea class="beta-status-preview" id="betaStatusPreview" readonly aria-label="Generált status előnézet"></textarea>
      `;
      field.appendChild(composer);

      composer.querySelectorAll("[data-status-mode]").forEach((button) => {
        button.addEventListener("click", () => {
          templateMode = button.dataset.statusMode === "standard" ? "standard" : "abcde";
          syncComposer();
        });
      });
      composer.querySelector("#betaCopyStatus")?.addEventListener("click", copyGeneratedStatus);
      composer.querySelector("#betaFindingChips")?.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-finding-key]");
        if (!chip) return;
        const key = chip.dataset.findingKey;
        if (suppressedFindingKeys.has(key)) suppressedFindingKeys.delete(key);
        else suppressedFindingKeys.add(key);
        syncComposer();
      });
      composer.querySelector("#betaUnknownChips")?.addEventListener("click", async (event) => {
        const aiButton = event.target.closest("[data-ai-unknown-phrase]");
        if (aiButton) {
          prepareUnknownEditor(composer, aiButton.dataset.aiUnknownPhrase || "");
          await suggestUnknownFinding(aiButton);
          return;
        }

        const chip = event.target.closest("[data-unknown-phrase]");
        if (!chip) return;
        prepareUnknownEditor(composer, chip.dataset.unknownPhrase || "");
      });
      composer.querySelector("#betaSuggestFinding")?.addEventListener("click", () => suggestUnknownFinding());
      composer.querySelector("#betaExistingFindingSearch")?.addEventListener("input", () => renderExistingFindingPicker(composer));
      composer.querySelector("#betaExistingFindingList")?.addEventListener("click", (event) => {
        const choice = event.target.closest("[data-existing-finding-key]");
        if (!choice) return;
        activeExistingFindingKey = choice.dataset.existingFindingKey || "";
        renderExistingFindingPicker(composer);
      });
      composer.querySelector("#betaSaveExistingFinding")?.addEventListener("click", saveExistingLearning);
      composer.querySelector("#betaSaveNewFinding")?.addEventListener("click", saveNewLearning);
      composer.querySelector("#betaUndoLearning")?.addEventListener("click", undoLastLearning);
      fillLearningSelectors(composer);
      updateLearningOverviewUi(composer);
    }

    if (!physical.dataset.betaFindingBound) {
      physical.dataset.betaFindingBound = "true";
      physical.addEventListener("input", () => {
        clearTimeout(findingTimer);
        findingTimer = window.setTimeout(syncComposer, FINDING_DEBOUNCE_MS);
      });
    }
    return composer;
  }

  function structuredFindingSource() {
    const root = document.getElementById("betaStructuredStatus");
    const fields = root
      ? [...root.querySelectorAll("[data-status-section]")]
      : [];

    if (fields.length) {
      return fields
        .map((field) => {
          const key = String(field.dataset.statusSection || "").trim();
          const value = String(field.value || "").trim();
          return key && value ? `${key}: ${value}` : "";
        })
        .filter(Boolean)
        .join("\n");
    }

    return String(document.getElementById("fPhysical")?.value || "");
  }

  function syncComposer() {
    const composer = ensureComposer();
    if (!composer) return;

    const source = structuredFindingSource();
    if (source !== lastPhysicalSource) {
      lastPhysicalSource = source;
      suppressedFindingKeys = new Set();
      activeUnknownPhrase = "";
      activeAiSuggestion = null;
    }

    const all = parseFindings(source);
    const active = activeFindings(all);
    const unknowns = unknownSegments(source);
    const chips = composer.querySelector("#betaFindingChips");
    const unknownBlock = composer.querySelector("#betaUnknownBlock");
    const unknownChips = composer.querySelector("#betaUnknownChips");
    const count = composer.querySelector("#betaFindingCount");
    const warning = composer.querySelector("#betaFindingWarning");
    const preview = composer.querySelector("#betaStatusPreview");
    const copy = composer.querySelector("#betaCopyStatus");

    composer.querySelectorAll("[data-status-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.statusMode === templateMode);
    });

    chips.innerHTML = "";
    all.forEach((finding) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "beta-finding-chip";
      button.dataset.findingKey = finding.key;
      button.textContent = finding.label;
      button.classList.toggle("suppressed", suppressedFindingKeys.has(finding.key));
      button.title = suppressedFindingKeys.has(finding.key)
        ? "Kattintson a finding visszakapcsolásához"
        : "Kattintson, ha ezt a findingot nem szeretné alkalmazni";
      chips.appendChild(button);
    });

    count.textContent = all.length
      ? `${active.length} felismerve • ${unknowns.length} ismeretlen`
      : `0 felismerve • ${unknowns.length} ismeretlen`;

    if (unknownChips) {
      unknownChips.innerHTML = "";
      for (const phrase of unknowns) {
        const item = document.createElement("div");
        item.className = "beta-unknown-item";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "beta-unknown-chip";
        button.dataset.unknownPhrase = phrase;
        button.textContent = phrase;
        button.title = "Kattintson a finding kézi tanításához";

        const aiButton = document.createElement("button");
        aiButton.type = "button";
        aiButton.className = "beta-unknown-ai";
        aiButton.dataset.aiUnknownPhrase = phrase;
        aiButton.textContent = "AI JAVASLAT";
        aiButton.title = "AI javaslat készítése ehhez az ismeretlen findinghoz";

        item.append(button, aiButton);
        unknownChips.appendChild(item);
      }
    }
    unknownBlock?.classList.toggle("hidden", unknowns.length === 0);

    if (activeUnknownPhrase && !unknowns.includes(activeUnknownPhrase)) {
      activeUnknownPhrase = "";
    }
    prepareUnknownEditor(composer, activeUnknownPhrase);
    updateLearningOverviewUi(composer);

    const hasSource = Boolean(source.trim());
    const safeToGenerate = hasSource && active.length > 0 && unknowns.length === 0;
    warning.classList.toggle("hidden", !hasSource || (safeToGenerate && unknowns.length === 0));
    warning.textContent = !hasSource
      ? ""
      : unknowns.length
        ? `${unknowns.length} nem felismert finding van. Tanítsa meg vagy rendelje meglévő findinghez; a STATUS automatikusan frissül.`
        : !active.length
          ? "Nem ismertem fel biztos findingot. A normál status létrehozása blokkolva van."
          : "";

    preview.value = active.length ? generatedStatus(active) : "";
    preview.classList.toggle("hidden", !active.length);
    copy.disabled = !safeToGenerate;
  }

  async function copyGeneratedStatus() {
    const preview = document.getElementById("betaStatusPreview");
    const button = document.getElementById("betaCopyStatus");
    const text = String(preview?.value || "").trim();
    if (!text || !button) return;

    try {
      await navigator.clipboard.writeText(text);
      const before = button.textContent;
      button.textContent = "MÁSOLVA ✓";
      window.setTimeout(() => {
        if (button.isConnected) button.textContent = before;
      }, 1200);
    } catch {
      preview.focus();
      preview.select();
      document.execCommand("copy");
      preview.setSelectionRange(0, 0);
      button.textContent = "MÁSOLVA ✓";
      window.setTimeout(() => {
        if (button.isConnected) button.textContent = "STATUS MÁSOLÁSA";
      }, 1200);
    }
  }

  window.BachSBOPhysicalStatusEngine = Object.freeze({
    parseFindings: (source) => parseFindings(source),
    unknownSegments: (source) => unknownSegments(source),
    abcdeStatus: (findings) => abcdeStatus(findings),
    activeFindings: (findings) => activeFindings(findings),
    syncComposer: () => syncComposer()
  });

  function refreshBetaFeatures() {
    addBetaBadge();
    syncComposer();
    void loadFindingLearningRegistry();
  }

  document.addEventListener("bachsbo:ui-rendered", () => {
    window.setTimeout(refreshBetaFeatures, 0);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshBetaFeatures, { once: true });
  } else {
    refreshBetaFeatures();
  }
})();
