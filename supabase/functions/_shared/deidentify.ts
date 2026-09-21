import { openAiApiKey } from "./openai.ts";

export type PiiReport = {
  taj: number;
  dob: number;
  email: number;
  phone: number;
  address: number;
  labelledName: number;
  externalId: number;
  aiPerson: number;
};

export type ClinicalState = {
  shift: any;
  patients: any[];
  references?: any[];
};

const emptyReport = (): PiiReport => ({
  taj: 0,
  dob: 0,
  email: 0,
  phone: 0,
  address: 0,
  labelledName: 0,
  externalId: 0,
  aiPerson: 0
});

function addReports(target: PiiReport, source: Partial<PiiReport>) {
  for (const key of Object.keys(target) as (keyof PiiReport)[]) {
    target[key] += Number(source[key] || 0);
  }
}

function replaceCount(
  input: string,
  regex: RegExp,
  replacement: string,
): { text: string; count: number } {
  let count = 0;
  const text = input.replace(regex, () => {
    count += 1;
    return replacement;
  });
  return { text, count };
}

export function ruleBasedDeidentify(input: unknown): {
  text: string;
  report: PiiReport;
} {
  let text = String(input ?? "");
  const report = emptyReport();

  let r = replaceCount(
    text,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "[EMAIL]",
  );
  text = r.text;
  report.email += r.count;

  r = replaceCount(
    text,
    /\bTAJ(?:\s*(?:sz[aá]m|azonos[ií]t[oó]))?\s*[:#-]?\s*\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/gi,
    "TAJ: [TAJ]",
  );
  text = r.text;
  report.taj += r.count;

  r = replaceCount(
    text,
    /(?<!\d)\d{3}[\s-]\d{3}[\s-]\d{3}(?!\d)/g,
    "[TAJ]",
  );
  text = r.text;
  report.taj += r.count;

  r = replaceCount(
    text,
    /\b(?:sz[uü]l(?:etett|et[eé]si\s*(?:id[oő]|d[aá]tum))?|DOB|date\s+of\s+birth|birth\s+date)[\s:.-]*(?:19|20)\d{2}\s*[.\/-]\s*(?:0?[1-9]|1[0-2])\s*[.\/-]\s*(?:0?[1-9]|[12]\d|3[01])\.?/gi,
    "[DOB]",
  );
  text = r.text;
  report.dob += r.count;

  r = replaceCount(
    text,
    /\b(?:tel(?:efon)?|mobil|phone)\s*[:#-]?\s*(?:\+?\d[\d\s()\/-]{6,}\d)\b/gi,
    "phone: [PHONE]",
  );
  text = r.text;
  report.phone += r.count;

  r = replaceCount(
    text,
    /\b(?:beteg\s+neve|p[aá]ciens\s+neve|patient\s+name|name|n[eé]v)\s*[:#-]\s*[^\n;,]{2,80}/gi,
    "name: [PERSON]",
  );
  text = r.text;
  report.labelledName += r.count;

  r = replaceCount(
    text,
    /\b(?:lakc[ií]m|address|patient\s+address)\s*[:#-]\s*[^\n;]{4,140}/gi,
    "address: [ADDRESS]",
  );
  text = r.text;
  report.address += r.count;

  r = replaceCount(
    text,
    /\b(?:MRN|patient\s*ID|betegazonos[ií]t[oó]|t[oö]rzssz[aá]m|esetsz[aá]m)\s*[:#-]?\s*[A-Z0-9][A-Z0-9._\/-]{3,}\b/gi,
    "[EXTERNAL_ID]",
  );
  text = r.text;
  report.externalId += r.count;

  return { text, report };
}

function responseText(payload: any): string {
  if (typeof payload?.output_text === "string") return payload.output_text;

  const chunks: string[] = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

async function aiScrubItems(
  items: Array<{ key: string; text: string }>,
): Promise<{
  items: Array<{ key: string; text: string }>;
  personCount: number;
}> {
  if (!items.length) return { items, personCount: 0 };

  const apiKey = openAiApiKey();
  const model = Deno.env.get("DEID_MODEL") || "gpt-5.6-luna";

  const prompt = [
    "You are a privacy filter for Hungarian emergency-department clinical text.",
    "The deterministic privacy pass has already removed obvious TAJ, labelled DOB, email, phone, address, and labelled identifiers.",
    "Your job is to remove remaining NATURAL PERSON identifiers in patient-facing narrative text, especially unlabelled patient/family names, and any obvious personal identifier the rules missed.",
    "Replace natural-person names with [PERSON]. Replace TAJ with [TAJ], full date of birth with [DOB], addresses with [ADDRESS], phone with [PHONE], email with [EMAIL], and patient/EHR identifiers with [EXTERNAL_ID].",
    "Preserve diagnoses, symptoms, medications, laboratory values, procedures, hospital/institution/department names, geographic names when clinically relevant, and ordinary encounter dates.",
    "Preserve clinician names and clinician references, especially text prefixed with Dr., dr., Dr, or dr.",
    "Do not rewrite, summarize, translate, correct, or improve the clinical text.",
    "Return ONLY valid JSON in exactly this shape: {\"items\":[{\"key\":\"...\",\"text\":\"...\"}]} and return every input key exactly once.",
    "",
    JSON.stringify({ items }),
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: prompt }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `AI de-identification failed (${response.status}): ${detail.slice(0, 500)}`,
    );
  }

  const payload = await response.json();
  const raw = responseText(payload)
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "");

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI de-identification returned invalid JSON; save aborted.");
  }

  if (!Array.isArray(parsed?.items)) {
    throw new Error("AI de-identification returned an invalid item set; save aborted.");
  }

  const expected = new Set(items.map((x) => x.key));
  const received = new Set(parsed.items.map((x: any) => x?.key));
  if (expected.size !== received.size || [...expected].some((key) => !received.has(key))) {
    throw new Error("AI de-identification changed item keys; save aborted.");
  }

  const inputByKey = new Map(items.map((x) => [x.key, x.text]));
  let personCount = 0;
  const output = parsed.items.map((x: any) => {
    const key = String(x.key);
    const text = String(x.text ?? "");
    const before = (inputByKey.get(key)?.match(/\[PERSON\]/g) || []).length;
    const after = (text.match(/\[PERSON\]/g) || []).length;
    personCount += Math.max(0, after - before);
    return { key, text };
  });

  return { items: output, personCount };
}

async function bestEffortAiScrubItems(items: Array<{ key: string; text: string }>): Promise<{
  items: Array<{ key: string; text: string }>;
  personCount: number;
}> {
  try {
    return await aiScrubItems(items);
  } catch (error) {
    console.error("AI de-identification skipped; rule-based scrub was applied:", error);
    return { items, personCount: 0 };
  }
}

function protectDrPrefixedNames(text: string): {
  text: string;
  protectedNames: Record<string, string>;
} {
  const protectedNames: Record<string, string> = {};
  let index = 0;
  const protectedText = text.replace(
    /\b[Dd]r\.?\s+[A-ZÁÉÍÓÖŐÚÜŰ][\p{L}.'-]+(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][\p{L}.'-]+){0,3}/gu,
    (match) => {
      const token = `[[CLINICIAN_NAME_${index}]]`;
      protectedNames[token] = match;
      index += 1;
      return token;
    },
  );
  return { text: protectedText, protectedNames };
}

function restoreProtectedNames(text: string, protectedNames: Record<string, string>): string {
  let out = text;
  for (const [token, original] of Object.entries(protectedNames)) {
    out = out.split(token).join(original);
  }
  return out;
}

export function clinicalTextItems(patient: any): Array<{ key: string; text: string }> {
  const items: Array<{ key: string; text: string }> = [];
  const add = (key: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) items.push({ key, text: value });
  };

  add("mainComplaint", patient.mainComplaint);
  add("arrivalOther", patient.arrivalOther);
  add("complaint", patient.complaint);
  add("history", patient.history);
  add("physical", patient.physical);
  add("others", patient.others);
  add("therapy", patient.therapy);
  add("course", patient.course);
  add("diagnoses", patient.diagnoses);
  add("dischargeCondition", patient.dischargeCondition);
  add("hospital", patient.hospital);
  add("ward", patient.ward);
  add("physician", patient.physician);
  add("admissionNote", patient.admissionNote);
  add("otherOutcome", patient.otherOutcome);
  add("otherDetails", patient.otherDetails);
  add("summary", patient.summary);
  add("summaryGeneratedText", patient.summaryGeneratedText);
  add("summaryFinalizedText", patient.summaryFinalizedText);

  (patient.recommendations || []).forEach((x: unknown, i: number) => add(`recommendations.${i}`, x));
  (patient.tests?.labs || []).forEach((x: any, i: number) => {
    add(`tests.labs.${i}.text`, x.text);
    add(`tests.labs.${i}.savedText`, x.savedText);
  });
  ["ekg", "gas"].forEach((kind) => {
    const x = patient.tests?.[kind];
    if (!x) return;
    add(`tests.${kind}.text`, x.text);
    add(`tests.${kind}.savedText`, x.savedText);
  });
  (patient.tests?.radiology || []).forEach((x: any, i: number) => {
    add(`tests.radiology.${i}.type`, x.type);
    add(`tests.radiology.${i}.bodyPart`, x.bodyPart);
    add(`tests.radiology.${i}.modality`, x.modality);
    add(`tests.radiology.${i}.otherTest`, x.otherTest);
    add(`tests.radiology.${i}.text`, x.text);
    add(`tests.radiology.${i}.savedText`, x.savedText);
  });
  (patient.tests?.consultations || []).forEach((x: any, i: number) => {
    add(`tests.consultations.${i}.type`, x.type);
    add(`tests.consultations.${i}.text`, x.text);
    add(`tests.consultations.${i}.savedText`, x.savedText);
  });
  return items;
}

function isClinicianNameSafeZone(key: string): boolean {
  return [
    "diagnoses",
    "hospital",
    "ward",
    "physician",
    "admissionNote",
    "otherOutcome",
    "otherDetails",
  ].includes(key) ||
    key.startsWith("recommendations.") ||
    key.startsWith("tests.consultations.");
}

function setPath(root: any, path: string, value: string) {
  const parts = path.split(".");
  let cursor = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
    cursor = cursor[key];
  }
  const last = /^\d+$/.test(parts.at(-1)!) ? Number(parts.at(-1)!) : parts.at(-1)!;
  cursor[last] = value;
}

export async function deidentifyPatient(patientInput: any): Promise<{
  patient: any;
  report: PiiReport;
}> {
  const patient = structuredClone(patientInput);
  const report = emptyReport();

  const items = clinicalTextItems(patient);
  const ruleItems = items.map(({ key, text }) => {
    const result = ruleBasedDeidentify(text);
    addReports(report, result.report);
    return { key, text: result.text };
  });

  const safeZoneItems = ruleItems.filter((item) => isClinicianNameSafeZone(item.key));
  const unsafeItems = ruleItems.filter((item) => !isClinicianNameSafeZone(item.key));
  const protectedByKey = new Map<string, Record<string, string>>();
  const aiCandidateItems = unsafeItems.map((item) => {
    const protectedItem = protectDrPrefixedNames(item.text);
    protectedByKey.set(item.key, protectedItem.protectedNames);
    return { key: item.key, text: protectedItem.text };
  });

  const ai = await bestEffortAiScrubItems(aiCandidateItems);
  report.aiPerson += ai.personCount;

  for (const item of safeZoneItems) setPath(patient, item.key, item.text);
  for (const item of ai.items) {
    setPath(patient, item.key, restoreProtectedNames(item.text, protectedByKey.get(item.key) || {}));
  }

  return { patient, report };
}

export async function deidentifyState(stateInput: ClinicalState): Promise<{
  state: ClinicalState;
  report: PiiReport;
}> {
  const state = structuredClone(stateInput);
  const report = emptyReport();
  const sanitizedPatients = [];

  for (const patient of state.patients || []) {
    const result = await deidentifyPatient(patient);
    sanitizedPatients.push(result.patient);
    addReports(report, result.report);
  }

  state.patients = sanitizedPatients;
  state.references = [];
  return { state, report };
}

export function reportTotal(report: PiiReport): number {
  return Object.values(report).reduce((sum, value) => sum + Number(value || 0), 0);
}


// Assistant requests must fail closed if the AI privacy pass cannot return one
// sanitized payload. This is stricter than normal persistence de-identification.
export async function deidentifyAssistantText(input: string): Promise<string> {
  const ruled = ruleBasedDeidentify(input).text;
  const result = await aiScrubItems([{ key: "assistantInput", text: ruled }]);
  if (
    result.items.length !== 1 ||
    result.items[0].key !== "assistantInput" ||
    !result.items[0].text.trim()
  ) {
    throw new Error("Privacy check failed; analysis aborted.");
  }
  return result.items[0].text;
}
