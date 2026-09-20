import {
  clinicalTextItems,
  ruleBasedDeidentify,
} from "./deidentify.ts";

Deno.test("redacts labelled TAJ", () => {
  const result = ruleBasedDeidentify("TAJ: 123 456 789");
  if (!result.text.includes("[TAJ]")) throw new Error(result.text);
  if (result.report.taj !== 1) throw new Error("TAJ count mismatch");
});

Deno.test("redacts labelled full date of birth", () => {
  const result = ruleBasedDeidentify("szül.: 1956. 03. 14.");
  if (!result.text.includes("[DOB]")) throw new Error(result.text);
  if (result.report.dob !== 1) throw new Error("DOB count mismatch");
});

Deno.test("preserves ordinary clinical encounter dates", () => {
  const input = "2026.09.19-én jelentkezett mellkasi fájdalom miatt.";
  const result = ruleBasedDeidentify(input);
  if (result.text !== input) throw new Error(result.text);
});

Deno.test("does not redact unlabelled clinical numbers as phone", () => {
  const input = "Na 139 mmol/l, K 4.1 mmol/l, hs-TnT 1234 ng/l.";
  const result = ruleBasedDeidentify(input);
  if (result.text !== input) throw new Error(result.text);
});

Deno.test("redacts labelled phone and email", () => {
  const input = "Telefon: +36 20 123 4567, email: patient@example.test";
  const result = ruleBasedDeidentify(input);
  if (!result.text.includes("[PHONE]")) throw new Error(result.text);
  if (!result.text.includes("[EMAIL]")) throw new Error(result.text);
});

Deno.test("redacts explicitly labelled person name", () => {
  const input = "Beteg neve: Kovács János, hasi fájdalom.";
  const result = ruleBasedDeidentify(input);
  if (!result.text.includes("[PERSON]")) throw new Error(result.text);
  if (result.text.includes("Kovács János")) throw new Error(result.text);
});


Deno.test("clinical text inventory includes diagnoses and structured radiology free text", () => {
  const items = clinicalTextItems({
    diagnoses: "Név: Kovács János",
    tests: {
      radiology: [{
        type: "has CT",
        bodyPart: "has",
        modality: "other",
        otherTest: "Név: Kovács János",
        text: "lelet",
        savedText: "lelet",
      }],
    },
  });

  const keys = new Set(items.map((item) => item.key));
  for (const key of [
    "diagnoses",
    "tests.radiology.0.type",
    "tests.radiology.0.bodyPart",
    "tests.radiology.0.modality",
    "tests.radiology.0.otherTest",
    "tests.radiology.0.text",
    "tests.radiology.0.savedText",
  ]) {
    if (!keys.has(key)) throw new Error(`Missing clinical text key: ${key}`);
  }
});


Deno.test("clinical text inventory includes free-text arrival details", () => {
  const items = clinicalTextItems({
    arrivalOther: "Név: Kovács János, saját autóval",
  });
  const item = items.find((entry) => entry.key === "arrivalOther");
  if (!item) throw new Error("Missing arrivalOther in clinical text inventory");
  const scrubbed = ruleBasedDeidentify(item.text);
  if (!scrubbed.text.includes("[PERSON]")) throw new Error(scrubbed.text);
});
