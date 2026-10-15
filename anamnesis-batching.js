// Bounded, per-request Anamnézis extraction. Pure helpers; no clinical text is persisted.
(() => {
  "use strict";

  const MAX_BATCH_TEXT_CHARS = 16000;
  const MAX_BATCH_SOURCES = 2;

  function splitClinicalText(value, maxChars = MAX_BATCH_TEXT_CHARS) {
    const text = String(value || "");
    if (!text) return [];
    const chunks = [];
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + maxChars);
      if (end < text.length) {
        const lower = start + Math.floor(maxChars * 0.6);
        for (const separator of ["\n- ", "\n\n", "\n", ". ", "; "]) {
          const position = text.lastIndexOf(separator, end - 1);
          if (position >= lower) {
            end = position + separator.length;
            break;
          }
        }
      }
      if (end <= start) throw new Error("Anamnézis text partition failed.");
      chunks.push(text.slice(start, end));
      start = end;
    }
    return chunks;
  }

  function partitionSources(sources) {
    if (!Array.isArray(sources) || !sources.length) {
      throw new Error("Nincs feldolgozható anamnézis forrás.");
    }
    const pieces = [];
    const originalSourceIds = new Map();

    for (const source of sources) {
      const text = String(source.text || "");
      const hasImage = Boolean(source.imageDataUrl);
      const segments = hasImage || text.length <= MAX_BATCH_TEXT_CHARS
        ? [text]
        : splitClinicalText(text);
      for (let i = 0; i < segments.length; i += 1) {
        const id = segments.length === 1 ? source.id : source.id + "::part" + (i + 1);
        const piece = { ...source, id, text: segments[i] };
        pieces.push(piece);
        originalSourceIds.set(id, source.id);
      }
    }

    const batches = [];
    let current = [];
    let textChars = 0;
    for (const piece of pieces) {
      const pieceChars = String(piece.text || "").length;
      const isImage = Boolean(piece.imageDataUrl);
      if (current.length && (
        current.length >= MAX_BATCH_SOURCES ||
        textChars + pieceChars > MAX_BATCH_TEXT_CHARS ||
        isImage ||
        current.some((item) => Boolean(item.imageDataUrl))
      )) {
        batches.push(current);
        current = [];
        textChars = 0;
      }
      current.push(piece);
      textChars += pieceChars;
      if (isImage) {
        batches.push(current);
        current = [];
        textChars = 0;
      }
    }
    if (current.length) batches.push(current);
    if (!batches.length) throw new Error("Nincs feldolgozható anamnézis forrás.");
    return { batches, originalSourceIds };
  }

  function distinctStrings(values) {
    const seen = new Set();
    return values.filter((value) => {
      const text = String(value || "").trim();
      const key = text.toLocaleLowerCase("hu");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((value) => String(value).trim());
  }

  function mergeResults(results, originalSourceIds) {
    const events = [];
    const knownDiseases = [];
    const medications = [];
    const allergies = [];
    const discrepancies = [];
    const eventKeys = new Set();
    const medicationKeys = new Set();

    for (const result of results) {
      if (!result || !Array.isArray(result.events)) {
        throw new Error("A részleges AI válasz érvénytelen. A korábbi eredmény megmaradt.");
      }
      for (const event of result.events) {
        const originalIds = distinctStrings(
          (Array.isArray(event.source_ids) ? event.source_ids : [])
            .map((id) => originalSourceIds.get(String(id)))
            .filter(Boolean)
        );
        if (!originalIds.length) {
          throw new Error("Az AI esemény nem rendelhető az eredeti forráshoz.");
        }
        const mappedEvent = { ...event, source_ids: originalIds };
        const fingerprint = JSON.stringify([
          mappedEvent.date, mappedEvent.place,
          mappedEvent.versions?.normal?.text,
          originalIds
        ]);
        if (eventKeys.has(fingerprint)) continue;
        eventKeys.add(fingerprint);
        events.push(mappedEvent);
      }
      if (Array.isArray(result.known_diseases)) knownDiseases.push(...result.known_diseases);
      if (Array.isArray(result.medications)) {
        for (const medication of result.medications) {
          if (!String(medication?.name || "").trim()) continue;
          const key = [medication.name, medication.dose || ""].join("|").toLocaleLowerCase("hu");
          if (medicationKeys.has(key)) continue;
          medicationKeys.add(key);
          medications.push(medication);
        }
      }
      if (String(result.allergies_cave || "").trim()) allergies.push(result.allergies_cave);
      if (Array.isArray(result.discrepancies)) discrepancies.push(...result.discrepancies);
    }

    return {
      events,
      known_diseases: distinctStrings(knownDiseases),
      medications,
      // Keep conflicting CAVE statements visible for clinical review rather than guessing.
      allergies_cave: distinctStrings(allergies).join("\n"),
      discrepancies: distinctStrings(discrepancies)
    };
  }

  const api = { splitClinicalText, partitionSources, mergeResults, MAX_BATCH_TEXT_CHARS };
  if (typeof window !== "undefined") window.BachSBOAnamnesisBatches = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
