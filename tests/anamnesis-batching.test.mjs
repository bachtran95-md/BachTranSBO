import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { splitClinicalText, partitionSources, mergeResults, MAX_BATCH_TEXT_CHARS } =
  require("../anamnesis-batching.js");

test("large discharge note is partitioned losslessly within the request cap", () => {
  const text = ("2026.01.01 - Belgyógyászat\nEpikrízis: jól van.\n\n").repeat(2200);
  const chunks = splitClinicalText(text);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every((part) => part.length <= MAX_BATCH_TEXT_CHARS));
});

test("multiple documents and screenshots stay within limits with source mapping", () => {
  const sources = [
    { id: "pdf", kind: "PDF", text: "a".repeat(33000) },
    { id: "txt", kind: "Szöveg", text: "b".repeat(200) },
    { id: "screenshot", kind: "Képernyőkép", text: "", imageDataUrl: "data:image/png;base64,AA==" }
  ];
  const { batches, originalSourceIds } = partitionSources(sources);
  assert.ok(batches.length >= 4);
  assert.equal(batches.flat().filter((s) => s.imageDataUrl).length, 1);
  for (const batch of batches) {
    assert.ok(batch.length <= 2);
    assert.ok(batch.reduce((n, s) => n + s.text.length, 0) <= MAX_BATCH_TEXT_CHARS);
    if (batch.some((s) => s.imageDataUrl)) assert.equal(batch.length, 1);
  }
  const pdfChunks = batches.flat().filter((s) => originalSourceIds.get(s.id) === "pdf");
  assert.equal(pdfChunks.map((s) => s.text).join(""), sources[0].text);
});

test("independently extracted events retain original references and clinical facts", () => {
  const sourceIds = new Map([["pdf::part1", "pdf"], ["pdf::part2", "pdf"], ["ward", "ward"]]);
  const event = (date, source, text) => ({
    date, place: "Belgyógyászat", source_ids: [source],
    versions: { normal: { text } }
  });
  const results = [
    { events: [event("2025-01-01", "pdf::part1", "PCI 2025.")],
      known_diseases: ["IHD"], medications: [{ name: "ASA", dose: "100 mg" }],
      allergies_cave: "Penicillinallergia.", discrepancies: [] },
    { events: [event("2026-02-01", "pdf::part2", "EF 35%."),
                 event("2026-03-01", "ward", "Kezelés.")],
      known_diseases: ["IHD", "HFrEF"], medications: [{ name: "ASA", dose: "100 mg" }],
      allergies_cave: "Gyógyszerallergia nem ismert.", discrepancies: ["Ellentmondó CAVE."] }
  ];
  const merged = mergeResults(results, sourceIds);
  assert.deepEqual(merged.events.map((x) => x.source_ids[0]), ["pdf", "pdf", "ward"]);
  assert.equal(merged.events.length, 3);
  assert.deepEqual(merged.known_diseases, ["IHD", "HFrEF"]);
  assert.equal(merged.medications.length, 1);
  assert.match(merged.allergies_cave, /Penicillinallergia/);
  assert.match(merged.allergies_cave, /nem ismert/);
  assert.deepEqual(merged.discrepancies, ["Ellentmondó CAVE."]);
});

test("invalid event provenance fails rather than silently dropping an encounter", () => {
  assert.throws(() => mergeResults([{ events: [{ source_ids: ["unrecognized"] }] }], new Map()),
    /forráshoz/);
});
