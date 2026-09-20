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

  function normalized(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function containsFact(container, fact) {
    const existing = normalized(container);
    const proposed = normalized(fact);
    return Boolean(existing && proposed && existing.includes(proposed));
  }

  function entryStatus(entry) {
    if (entry?.mode === "notordered") return "notordered";
    return String(entry?.text || entry?.savedText || "").trim() ? "result" : "waiting";
  }

  function radiologyName(entry) {
    const body = String(entry?.bodyPart || "").trim();
    const modality = String(entry?.modality || "").trim();
    const other = String(entry?.otherTest || "").trim();
    if (modality === "other") return [body, other].filter(Boolean).join(" — ");
    return [body, modality].filter(Boolean).join(" ") || String(entry?.type || "").trim();
  }

  function testName(target, entry, index) {
    if (target === "lab") return String(entry?.type || "").trim() || `Lab ${index + 1}`;
    if (target === "ekg") return "EKG";
    if (target === "gas") return /\bVVG\b/i.test(String(entry?.text || "")) ? "VVG" : "AVG";
    if (target === "radiology") return radiologyName(entry) || `Radiology ${index + 1}`;
    return String(entry?.type || "").trim() || `Consultation ${index + 1}`;
  }

  function testEntries(patient, target) {
    const tests = patient?.tests || {};
    if (target === "ekg" || target === "gas") {
      return tests[target] ? [{ entry: tests[target], index: 0, name: testName(target, tests[target], 0) }] : [];
    }
    const group = target === "lab" ? "labs" : target === "radiology" ? "radiology" : "consultations";
    return (tests[group] || []).map((entry, index) => ({ entry, index, name: testName(target, entry, index) }));
  }

  function comparableTestLabel(value) {
    return normalized(value)
      .replace(/\b(lab|labor|laboratory|radiology|radiologia|imaging|consultation|consult|konzilium|result|eredmeny)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function labelsMatch(left, right) {
    const a = comparableTestLabel(left);
    const b = comparableTestLabel(right);
    if (!a || !b) return false;
    return a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));
  }

  function reconcileNarrative(patient, item) {
    const currentText = String(patient?.[item.target] || "").trim();
    const skipped = Boolean(patient?.[item.target + "Skipped"]);
    if (containsFact(currentText, item.text)) {
      return {
        ...item,
        action: "duplicate",
        currentText,
        currentStatus: "documented",
        reason: "This fact is already documented."
      };
    }
    if (skipped) {
      return {
        ...item,
        action: "update",
        currentText: "",
        currentStatus: "none",
        reason: "This section is marked None. Accepting this update will reopen it and add the newly documented information.",
        mode: "append"
      };
    }
    return {
      ...item,
      action: currentText ? "update" : "add",
      currentText,
      currentStatus: currentText ? "documented" : "empty",
      reason: currentText
        ? "Append the new documented information to the existing section."
        : "Add this documented information to the empty section.",
      mode: "append"
    };
  }

  function reconcileTest(patient, item) {
    const entries = testEntries(patient, item.target);
    const sameResult = entries.find(({ entry }) => containsFact(entry?.text || entry?.savedText, item.text));
    if (sameResult) {
      return {
        ...item,
        action: "duplicate",
        matchId: sameResult.entry.id || "",
        currentText: String(sameResult.entry.text || sameResult.entry.savedText || "").trim(),
        currentStatus: entryStatus(sameResult.entry),
        reason: "The same test information is already documented."
      };
    }

    const named = entries.filter(({ name }) => labelsMatch(name, item.label));
    const waitingNamed = named.filter(({ entry }) => entryStatus(entry) === "waiting");
    const waiting = entries.filter(({ entry }) => entryStatus(entry) === "waiting");
    let match = null;

    if (["ekg", "gas"].includes(item.target) && entries.length === 1) {
      match = entries[0];
    } else if (waitingNamed.length === 1) {
      match = waitingNamed[0];
    } else if (item.target === "lab" && waiting.length === 1) {
      match = waiting[0];
    }

    if (waitingNamed.length > 1 || (item.target === "lab" && !match && waiting.length > 1)) {
      return {
        ...item,
        action: "conflict",
        currentText: "",
        currentStatus: "ambiguous",
        reason: "More than one waiting test could match this update. Select the correct test manually."
      };
    }

    if (match) {
      const status = entryStatus(match.entry);
      if (status === "notordered") {
        return {
          ...item,
          action: "conflict",
          matchId: match.entry.id || "",
          currentText: "",
          currentStatus: status,
          reason: "The matching test is marked Not ordered and cannot be updated automatically."
        };
      }
      if (status === "result") {
        return {
          ...item,
          action: "conflict",
          matchId: match.entry.id || "",
          currentText: String(match.entry.text || match.entry.savedText || "").trim(),
          currentStatus: status,
          reason: "The matching test already has a different result. Review timing and whether this is a repeat test."
        };
      }
      if (item.status === "waiting") {
        return {
          ...item,
          action: "duplicate",
          matchId: match.entry.id || "",
          currentText: "",
          currentStatus: status,
          reason: "The matching test is already waiting for a result."
        };
      }
      return {
        ...item,
        action: "update",
        matchId: match.entry.id || "",
        currentText: "",
        currentStatus: status,
        reason: `Update ${match.name} from waiting to result available.`
      };
    }

    if (named.length === 1 && entryStatus(named[0].entry) === "result") {
      return {
        ...item,
        action: "conflict",
        matchId: named[0].entry.id || "",
        currentText: String(named[0].entry.text || named[0].entry.savedText || "").trim(),
        currentStatus: "result",
        reason: "A matching test already has a different result. Review it as a possible repeat test."
      };
    }

    const labAtCapacity = item.target === "lab" && entries.length >= 3;
    return {
      ...item,
      action: labAtCapacity ? "conflict" : "add",
      currentText: "",
      currentStatus: labAtCapacity ? "capacity" : "missing",
      reason: labAtCapacity
        ? "All three lab cards are occupied. Review the destination manually."
        : "No matching investigation exists; add this as a new test entry."
    };
  }

  function reconcileItems(patient, items) {
    if (!patient || !Array.isArray(items)) throw new Error("Cannot reconcile extraction without the current case.");
    return items.map(item => fields.includes(item.target)
      ? reconcileNarrative(patient, item)
      : reconcileTest(patient, item));
  }

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
        if (["duplicate", "conflict"].includes(item.action)) {
          throw new Error("Duplicate or conflicting facts must be reviewed manually.");
        }
        if (containsFact(next[item.target], item.text)) {
          throw new Error("This fact is already documented.");
        }
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
        if (["duplicate", "conflict"].includes(item.action)) {
          throw new Error("Duplicate or conflicting test updates must be reviewed manually.");
        }
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

        const existingEntries = testEntries(next, item.target);
        const matched = item.matchId
          ? existingEntries.find(({ entry }) => entry.id === item.matchId)
          : null;

        if (item.action === "update") {
          if (!matched) throw new Error("The matched waiting test is no longer available.");
          if (entryStatus(matched.entry) !== "waiting") {
            throw new Error("The matched test changed after extraction. Review it again.");
          }
          if (item.status !== "result") {
            throw new Error("Only a documented result can complete a waiting test.");
          }
          matched.entry.text = item.text.trim();
          matched.entry.savedText = item.text.trim();
          matched.entry.mode = "waiting";
          continue;
        }

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
    reconcileItems,
    applyItems
  };
})(typeof window === "undefined" ? globalThis : window);
