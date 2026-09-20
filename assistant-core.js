(function (root) {
  "use strict";
  const fields = ["mainComplaint", "complaint", "history", "physical", "therapy", "course", "diagnoses", "others"];
  const targets = [...fields, "lab", "ekg", "gas", "radiology", "consultation"];

  function snapshot(p) {
    const out = {};
    for (const k of [
      ...fields,
      "sex", "yob", "disposition", "recommendations", "hospital", "ward",
      "admissionNote", "otherOutcome", "otherDetails", "arrivalMode", "arrivalOther", "tests"
    ]) out[k] = p[k] ?? null;
    for (const k of fields) out[k + "Skipped"] = Boolean(p[k + "Skipped"]);
    return out;
  }

  const fingerprint = p => JSON.stringify(snapshot(p));

  function validateProposal(data, source) {
    if (!data || !Array.isArray(data.items) || data.items.length > 40 || !Array.isArray(data.warnings)) {
      throw new Error("Invalid analysis response.");
    }

    const items = data.items.map(item => {
      if (
        !targets.includes(item.target) ||
        !["documented", "result", "waiting", "planned"].includes(item.status) ||
        typeof item.text !== "string" ||
        !item.text.trim() ||
        item.text.length > 12000 ||
        typeof item.evidence !== "string" ||
        !item.evidence.trim() ||
        !source.includes(item.evidence)
      ) throw new Error("An extracted item has no matching source evidence. Please analyze again.");

      if (fields.includes(item.target) && item.status !== "documented") {
        throw new Error("Invalid narrative status.");
      }
      if (!fields.includes(item.target) && !["result", "waiting"].includes(item.status)) {
        throw new Error("Only ordered tests or documented results can populate test cards.");
      }

      return {
        target: item.target,
        text: item.text.trim(),
        evidence: item.evidence,
        status: item.status,
        label: String(item.label || "").slice(0, 160)
      };
    });

    return {
      items,
      warnings: data.warnings.filter(x => typeof x === "string").slice(0, 20)
    };
  }

  function applyItems(patient, items, uuid) {
    const next = structuredClone(patient);

    for (const item of items) {
      if (!targets.includes(item.target) || !String(item.text || "").trim()) {
        throw new Error("Invalid selected item.");
      }

      if (fields.includes(item.target)) {
        if (item.mode !== "append" && item.mode !== "replace") {
          throw new Error("Select append or replace.");
        }
        const before = String(next[item.target] || "").trim();
        next[item.target] =
          item.mode === "append" && before
            ? before + "\n" + item.text.trim()
            : item.text.trim();
        next[item.target + "Skipped"] = false;
      } else {
        if (!["result", "waiting"].includes(item.status)) {
          throw new Error("Invalid test status.");
        }

        next.tests ||= { labs: [], radiology: [], consultations: [] };
        const entry = {
          id: uuid(),
          type: item.label || "",
          mode: "waiting",
          text: item.status === "result" ? item.text.trim() : "",
          savedText: item.status === "result" ? item.text.trim() : ""
        };

        if (["ekg", "gas"].includes(item.target)) {
          const old = next.tests[item.target];
          if (old?.text?.trim() || old?.savedText?.trim()) {
            throw new Error(
              item.target.toUpperCase() +
                " already has a result. Review it manually; it was not overwritten."
            );
          }
          next.tests[item.target] = { ...entry, id: old?.id || entry.id };
        } else {
          const group =
            item.target === "lab"
              ? "labs"
              : item.target === "radiology"
                ? "radiology"
                : "consultations";
          next.tests[group] ||= [];

          const empty = next.tests[group].findIndex(
            e => !e.text?.trim() && !e.savedText?.trim() && !e.type?.trim()
          );

          if (group === "labs" && empty < 0 && next.tests[group].length >= 3) {
            throw new Error("All three lab cards are occupied. Review the result manually.");
          }

          if (group === "radiology") {
            Object.assign(entry, {
              bodyPart: "",
              modality: "other",
              otherTest: item.label || "Imaging"
            });
          }

          if (empty >= 0) {
            entry.id = next.tests[group][empty].id;
            next.tests[group][empty] = entry;
          } else {
            next.tests[group].push(entry);
          }
        }
      }
    }

    return next;
  }

  root.BachAssistantCore = {
    fields,
    targets,
    snapshot,
    fingerprint,
    validateProposal,
    applyItems
  };
})(typeof window === "undefined" ? globalThis : window);
