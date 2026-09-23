(() => {
  "use strict";

  // Fast hotfix lane for Státusz vocabulary. Keep this file lexical only:
  // aliases, laterality/location terms, and general negation grammar.
  // Do not put workflow, rendering, persistence, or patient-state logic here.
  const VERSION = "1.0";

  const aliases = Object.freeze([
    // Canonicalize exact clinical synonyms to tokens already understood by the engine.
    // Add narrow aliases here rather than broad fuzzy matches.
    Object.freeze({ pattern: "\\blegszomj\\b", replacement: "dyspnoe" })
  ]);

  const sidePatterns = Object.freeze([
    Object.freeze({ value: "bilateral", pattern: "\\b(mko\\.?|m\\.k\\.o\\.?|mindket|ketoldali|bilat|bilateralis|bilateral)\\b" }),
    Object.freeze({ value: "right", pattern: "\\b(jobb|jobb oldali|j\\.o\\.?)\\b" }),
    Object.freeze({ value: "left", pattern: "\\b(bal|bal oldali|b\\.o\\.?)\\b" })
  ]);

  // Order matters: specific quadrants must be checked before generic lower abdomen.
  const locationPatterns = Object.freeze([
    Object.freeze({ value: "basal", pattern: "basal|bazal|basis|tudobazis" }),
    Object.freeze({ value: "apical", pattern: "apical|csucsi" }),
    Object.freeze({ value: "diffuse", pattern: "diffuz|diffuse" }),
    Object.freeze({ value: "epigastric", pattern: "epigastr|epigasztr|gyomorszaj" }),
    Object.freeze({ value: "periumbilical", pattern: "periumbil|koldok korul|koldoktaj" }),
    Object.freeze({ value: "RLQ", pattern: "\\b(?:jaq|j\\s*\\.?\\s*a\\s*\\.?\\s*q|jobb also|jobb alhas|jobb csipoarok|jobb iliac|right lower)\\b" }),
    Object.freeze({ value: "LLQ", pattern: "\\b(?:baq|b\\s*\\.?\\s*a\\s*\\.?\\s*q|bal also|bal alhas|bal csipoarok|bal iliac|left lower)\\b" }),
    Object.freeze({ value: "RUQ", pattern: "\\b(?:jfq|j\\s*\\.?\\s*f\\s*\\.?\\s*q|jobb felso|jobb bordaiv(?:\\s+alatt(?:i)?)?|jobb hypochondr|jobb subcost|right upper)\\b" }),
    Object.freeze({ value: "LUQ", pattern: "\\b(?:bfq|b\\s*\\.?\\s*f\\s*\\.?\\s*q|bal felso|bal bordaiv(?:\\s+alatt(?:i)?)?|bal hypochondr|bal subcost|left upper)\\b" }),
    Object.freeze({ value: "lower_abdomen", pattern: "\\balhas\\b" })
  ]);

  const negationSource =
    "(?:nincs|nincsenek|nem\\s+(?:eszlelheto|lathato|hallhato|tapinthato|jelez|all\\s+fenn|igazolhato|van)|negativ)";

  function canonicalizeFolded(value) {
    let text = String(value || "");
    for (const item of aliases) {
      text = text.replace(new RegExp(item.pattern, "g"), item.replacement);
    }
    return text;
  }

  window.BachSBOStatusVocabulary = Object.freeze({
    version: VERSION,
    aliases,
    sidePatterns,
    locationPatterns,
    negationSource,
    canonicalizeFolded
  });
})();
