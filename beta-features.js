(() => {
  "use strict";

  const FINDING_DEBOUNCE_MS = 240;
  let findingTimer = null;
  let templateMode = "abcde";
  let suppressedFindingKeys = new Set();
  let lastPhysicalSource = "";
  let learnedFindingRecords = [];
  let learningOverview = { approvedLearning: 0, pendingCandidates: 0 };
  let learningRegistryLoaded = false;
  let learningRegistryPromise = null;
  let activeUnknownPhrase = "";
  let lastLearningId = "";
  let learningMessage = "";

  const CORE_FINDINGS = [
    { key: "epig-tender", label: "Epigastrialis nyomásérzékenység", target: "abdomen", section: "E", group: "abdomen" },
    { key: "abdomen-tender", label: "Hasi nyomásérzékenység", target: "abdomen", section: "E", group: "abdomen" },
    { key: "defense", label: "Defanz", target: "abdomen", section: "E", group: "abdomen" },
    { key: "no-defense", label: "Defanz nincs", target: "abdomen", section: "E", group: "abdomen" },
    { key: "dyspnea", label: "Dyspnoe", target: "respiratory", section: "B", group: "respiratory" },
    { key: "no-dyspnea", label: "Dyspnoe nincs", target: "respiratory", section: "B", group: "respiratory" },
    { key: "crackles", label: "Crepitatio", target: "respiratory", section: "B", group: "respiratory" },
    { key: "wheeze", label: "Sípoló légzés", target: "respiratory", section: "B", group: "respiratory" },
    { key: "pulmonary-congestion", label: "Pulmonalis pangás", target: "respiratory", section: "B", group: "respiratory" },
    { key: "edema", label: "Perifériás ödéma", target: "circulation", section: "C", group: "circulation" },
    { key: "no-edema", label: "Ödéma nincs", target: "circulation", section: "C", group: "circulation" },
    { key: "tachyarrhythmia", label: "Tachyarrhythmiás szívritmus", target: "circulation", section: "C", group: "circulation" },
    { key: "systolic-murmur", label: "Systolés zörej", target: "circulation", section: "C", group: "circulation" },
    { key: "irregular", label: "Szabálytalan szívritmus", target: "circulation", section: "C", group: "circulation" },
    { key: "tachycardia", label: "Tachycardia", target: "circulation", section: "C", group: "circulation" },
    { key: "bradycardia", label: "Bradycardia", target: "circulation", section: "C", group: "circulation" },
    { key: "focal", label: "Neurológiai gócjel / paresis", target: "neuro", section: "D", group: "neuro" },
    { key: "no-focal", label: "Neurológiai gócjel nincs", target: "neuro", section: "D", group: "neuro" },
    { key: "gcs", label: "GCS", target: "neuro", section: "D", group: "neuro" }
  ];

  const CUSTOM_TARGETS = [
    { value: "respiratory", label: "B – Pulmo", section: "B", group: "respiratory" },
    { value: "circulation", label: "C – Szív / keringés", section: "C", group: "circulation" },
    { value: "neuro", label: "D – Neurológia", section: "D", group: "neuro" },
    { value: "abdomen", label: "E – Has", section: "E", group: "abdomen" },
    { value: "skin", label: "E – Bőr / általános", section: "E", group: "skin" },
    { value: "locomotor", label: "E – Végtag / mozgásszerv", section: "E", group: "locomotor" },
    { value: "urogenital", label: "E – Vese / húgy-ivarszerv", section: "E", group: "urogenital" },
    { value: "other", label: "E – Egyéb", section: "E", group: "other" }
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

  function coreFindingMeta(key) {
    return CORE_FINDINGS.find((item) => item.key === key) || null;
  }

  function targetMeta(value) {
    return CUSTOM_TARGETS.find((item) => item.value === value) || CUSTOM_TARGETS.at(-1);
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
    if (!meta) return null;
    return {
      key: meta.key,
      label: record.canonicalLabel || meta.label,
      group: meta.group,
      ...(record.attributes || {})
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
      ["jobb o.", "jobb o§"],
      ["bal o.", "bal o§"],
      ["st. post", "st§ post"]
    ];
    for (const [raw, token] of protectedAbbreviations) {
      text = text.replaceAll(raw, token);
      text = text.replaceAll(raw.toUpperCase(), token);
    }

    return text
      .split(/(?:\s*[;,]\s*)|(?:[.!?]+\s+)/)
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
        learnedFindingRecords = Array.isArray(result?.records) ? result.records : [];
        learningOverview = result?.overview || learningOverview;
        learningRegistryLoaded = true;
        syncComposer();
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
        case "respiratory":
          pulmo = applyCustomRule(pulmo, rule);
          break;
        case "circulation":
          heart = applyCustomRule(heart, rule);
          break;
        case "neuro":
          neuro = applyCustomRule(neuro, rule);
          break;
        case "skin":
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
    const bNoises = noises.length ? `Zörejek: ${noises.join(", ")}.` : "Zörejek: nincs.";

    let cHeart = "Szívhangok: ritmusos, tiszta, zörej nem hallható.";
    if (map.has("tachyarrhythmia")) {
      cHeart = "Szívhangok: tachyarrhythmiásak.";
    } else {
      if (map.has("irregular")) cHeart = "Szívhangok: arrhythmiásak, tiszták, zörej nem hallható.";
      if (map.has("tachycardia")) cHeart = cHeart.replace("Szívhangok:", "Szívhangok: tachycard,");
      if (map.has("bradycardia")) cHeart = cHeart.replace("Szívhangok:", "Szívhangok: bradycard,");
    }
    if (map.has("systolic-murmur")) {
      const grade = map.get("systolic-murmur").grade;
      cHeart = cHeart.replace(/(?:,?\s*tiszt[aá]k?\.?|zörej nem hallható\.?)/g, "").trim();
      cHeart += ` ${grade ? grade + " " : ""}systolés zörej hallható.`;
    }
    const cEdema = map.has("edema") ? " Perifériás ödéma észlelhető." : "";

    const gcs = map.has("gcs") ? map.get("gcs").value : 15;
    let dNeuro = "Pupillák kerekek, egyenlőek, fényre jól reagálnak, nystagmus, kettőslátás nincs. Tarkótáji kötöttség, meningealis izgalmi jelek nincsenek. Izomerő megtartott. Szenzoros/Motoros oldalkülönbség: nincs. Latens paresis nincs. Romberg: megáll. Dix-Hallpike: n.v. Célkísérletek pontosak.";
    if (map.has("focal")) {
      dNeuro = dNeuro.replace("Izomerő megtartott. Szenzoros/Motoros oldalkülönbség: nincs. Latens paresis nincs.", "Neurológiai gócjel / paresis észlelhető.");
    }

    let abdomen = "Has: mellkas szintjében, puha, betapintható. Máj: nem tapintható. Lép: nem tapintható. Kóros rezisztencia nincs, nyomásérzékenység nincs, kp. élénk bélhangok.";
    if (map.has("epig-tender")) {
      abdomen = abdomen.replace("nyomásérzékenység nincs", "epigastriumban nyomásérzékeny");
    } else if (map.has("abdomen-tender")) {
      abdomen = abdomen.replace("nyomásérzékenység nincs", "nyomásérzékeny");
    }
    if (map.has("defense")) abdomen += " Defanz észlelhető.";
    if (map.has("no-defense")) abdomen += " Defanz nincs.";

    const edema = map.has("edema") ? "ödéma észlelhető" : "ödéma nincs";

    const lines = [
      "A: Légutak átjárhatók.",
      `B: ${bDyspnea} Mellkas alakja: emphysaemás. Rekeszek: szimmetrikusan kitérnek. Alaplégzés: érdessejtes. ${bNoises} Oldalkülönbség: nincs.`,
      `C: ${cHeart} Nyaki vénák nem teltek.${cEdema}`,
      `D: GCS: ${gcs}${gcs === 15 ? " (Sz:4, V:5, M:6)" : ""}. ${dNeuro}`,
      `E: Kp. fejlett, kp. táplált, jó általános állapotú beteg. Bőrszín: normál, turgora megtartott. Nyálkahártyák: kp. vértelt. Nyelv: nedves. Sclera: fehér. ${abdomen} Húgy és ivarszervek: Vesetájak ütögetésre nem érzékenyek. Végtagok: alakilag és funkcionálisan épek, ${edema}. MVT-re utaló jel nincs. Gerinc: alakilag ép, ütögetésre nem érzékeny. Külsérelmi nyoma: nincs.`
    ];

    const lineIndex = { A: 0, B: 1, C: 2, D: 3, E: 4 };
    for (const finding of customFindings(findings)) {
      const rule = finding.customRule;
      const index = lineIndex[String(rule.section || "E").toUpperCase()] ?? 4;
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
      meta.textContent = `${Number(learningOverview.approvedLearning || 0)} tanítás • ${Number(learningOverview.pendingCandidates || 0)} jelölt`;
    }
    if (undo) undo.disabled = !lastLearningId;
    const message = composer?.querySelector("#betaLearningMessage");
    if (message) {
      message.textContent = learningMessage;
      message.classList.toggle("hidden", !learningMessage);
    }
  }

  function fillLearningSelectors(composer) {
    const existing = composer?.querySelector("#betaExistingFinding");
    const target = composer?.querySelector("#betaNewFindingTarget");
    if (existing && !existing.options.length) {
      for (const item of CORE_FINDINGS) {
        const option = document.createElement("option");
        option.value = item.key;
        option.textContent = `${item.section} • ${item.label}`;
        existing.appendChild(option);
      }
    }
    if (target && !target.options.length) {
      for (const item of CUSTOM_TARGETS) {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        target.appendChild(option);
      }
    }
  }

  function prepareUnknownEditor(composer, phrase) {
    activeUnknownPhrase = String(phrase || "").trim();
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
    learningMessage = result?.threshold?.built
      ? "Mentve. A küszöb elérve, a jelölt patch automatikusan frissült."
      : "Mentve a learning registrybe.";
    syncComposer();
  }

  async function saveExistingLearning() {
    const composer = document.getElementById("betaFindingComposer");
    const select = composer?.querySelector("#betaExistingFinding");
    const meta = coreFindingMeta(select?.value);
    if (!composer || !activeUnknownPhrase || !meta) return;

    const button = composer.querySelector("#betaSaveExistingFinding");
    if (button) button.disabled = true;
    try {
      const result = await window.BachSBOBackend?.findingLearningConfirmMapping?.({
        sourcePhrase: activeUnknownPhrase,
        mappingKind: "existing",
        findingKey: meta.key,
        canonicalLabel: meta.label,
        target: meta.target,
        section: meta.section,
        attributes: {}
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
        attributes: {}
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

  async function undoLastLearning() {
    if (!lastLearningId || typeof window.BachSBOBackend?.findingLearningUndo !== "function") return;
    const id = lastLearningId;
    try {
      const result = await window.BachSBOBackend.findingLearningUndo(id);
      learnedFindingRecords = learnedFindingRecords.filter((record) => record.id !== id);
      learningOverview = result?.overview || learningOverview;
      lastLearningId = "";
      learningMessage = "Az utolsó tanítás visszavonva.";
      syncComposer();
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
          <span class="beta-local-only">STATUS NEM MENTŐDIK • TANÍTÁS KÜLÖN</span>
        </div>
        <div class="beta-finding-chips" id="betaFindingChips"></div>
        <div class="beta-unknown-block hidden" id="betaUnknownBlock">
          <div class="beta-unknown-title">Nem felismert finding — kattintson a tanításhoz</div>
          <div class="beta-unknown-chips" id="betaUnknownChips"></div>
        </div>
        <div class="beta-learning-editor hidden" id="betaLearningEditor">
          <div class="beta-learning-phrase" id="betaLearningPhrase"></div>
          <div class="beta-learning-grid">
            <div class="beta-learning-card">
              <strong>Meglévő findinghez rendelés</strong>
              <select id="betaExistingFinding"></select>
              <button type="button" class="btn small" id="betaSaveExistingFinding">HOZZÁRENDELÉS + TANÍTÁS</button>
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
        <div class="beta-learning-toolbar">
          <span id="betaLearningMeta">0 tanítás • 0 jelölt</span>
          <div>
            <button type="button" class="btn small" id="betaUndoLearning" disabled>UNDO TANÍTÁS</button>
            <button type="button" class="btn small" id="betaBuildCandidates">JELÖLTEK FRISSÍTÉSE</button>
            <button type="button" class="btn small" id="betaCopyCandidatePatch">PATCH MÁSOLÁSA</button>
          </div>
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
      composer.querySelector("#betaUnknownChips")?.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-unknown-phrase]");
        if (!chip) return;
        prepareUnknownEditor(composer, chip.dataset.unknownPhrase || "");
      });
      composer.querySelector("#betaSaveExistingFinding")?.addEventListener("click", saveExistingLearning);
      composer.querySelector("#betaSaveNewFinding")?.addEventListener("click", saveNewLearning);
      composer.querySelector("#betaUndoLearning")?.addEventListener("click", undoLastLearning);
      composer.querySelector("#betaBuildCandidates")?.addEventListener("click", buildFindingCandidates);
      composer.querySelector("#betaCopyCandidatePatch")?.addEventListener("click", copyFindingCandidatePatch);
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

  function syncComposer() {
    const composer = ensureComposer();
    const physical = document.getElementById("fPhysical");
    if (!composer || !physical) return;

    const source = physical.value || "";
    if (source !== lastPhysicalSource) {
      lastPhysicalSource = source;
      suppressedFindingKeys = new Set();
      activeUnknownPhrase = "";
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
        const button = document.createElement("button");
        button.type = "button";
        button.className = "beta-unknown-chip";
        button.dataset.unknownPhrase = phrase;
        button.textContent = phrase;
        button.title = "Kattintson a finding tanításához";
        unknownChips.appendChild(button);
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
        ? `${unknowns.length} nem felismert finding van. Tanítsa meg vagy rendelje meglévő findinghez a STATUS MÁSOLÁSA előtt.`
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
