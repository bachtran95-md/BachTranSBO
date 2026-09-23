(function (root) {
  "use strict";
  const fields = ["mainComplaint", "complaint", "history", "physical", "therapy", "course", "diagnoses", "others"];
  const targets = [...fields, "lab", "ekg", "gas", "radiology", "consultation"];

  const physicalStatusParameterKeys = [
    "bloodPressure", "pulse", "temperature", "respiratoryRate", "spo2", "oxygen"
  ];
  const physicalStatusSectionKeys = ["A", "B", "C", "D", "E1", "E2", "E3", "E4", "E5", "E6"];

  function clinicalPhysicalStatus(value) {
    if (!value || typeof value !== "object") return null;

    const parameters = value.parameters && typeof value.parameters === "object"
      ? value.parameters
      : {};
    const sections = value.sections && typeof value.sections === "object"
      ? value.sections
      : {};

    return {
      version: Number(value.version) || 1,
      parameters: Object.fromEntries(
        physicalStatusParameterKeys.map((key) => [key, String(parameters[key] ?? "").trim()])
      ),
      sections: Object.fromEntries(
        physicalStatusSectionKeys.map((key) => [key, String(sections[key] ?? "").trim()])
      )
    };
  }

  function snapshot(p) {
    const out = {};
    for (const k of [
      ...fields,
      "sex", "yob", "triageStatus", "disposition", "dischargeCondition",
      "recommendations", "hospital", "ward", "admissionNote", "otherOutcome",
      "otherDetails", "arrivalMode", "arrivalOther", "tests"
    ]) out[k] = p[k] ?? null;
    out.physicalStatus = clinicalPhysicalStatus(p.physicalStatus);
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

        next.tests ||= { labs: [], ekgs: [], gases: [], radiology: [], consultations: [] };
        const entry = {
          id: uuid(),
          type: item.label || "",
          mode: "waiting",
          text: item.status === "result" ? item.text.trim() : "",
          savedText: item.status === "result" ? item.text.trim() : ""
        };

        const group =
          item.target === "lab"
            ? "labs"
            : item.target === "ekg"
              ? "ekgs"
              : item.target === "gas"
                ? "gases"
                : item.target === "radiology"
                  ? "radiology"
                  : "consultations";
        next.tests[group] ||= [];

        const simpleGroup = ["labs", "ekgs", "gases"].includes(group);
        const empty = next.tests[group].findIndex(
          e => !e.text?.trim() && !e.savedText?.trim() && (simpleGroup || !e.type?.trim())
        );

        if (empty < 0 && next.tests[group].length >= 999) {
          throw new Error("The maximum of 999 entries for this investigation type has been reached.");
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
