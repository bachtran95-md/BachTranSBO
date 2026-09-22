import { openAiApiKey } from "./openai.ts";

// Shared transport only: prompts, model routing and clinical validation stay
// with each caller. Never retry automatically: a timed-out call may be billed.
export async function callResponses(
  request: Record<string, unknown>,
  timeoutMs = 105000,
): Promise<any> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${openAiApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...request, store: false }),
  });
  if (!response.ok) {
    // Upstream bodies can echo input; never expose them to logs or clients.
    await response.body?.cancel();
    throw new Error(`OpenAI request failed (${response.status}). Check model access, quota and API configuration.`);
  }
  const payload = await response.json();
  if (payload.status !== "completed") {
    throw new Error("OpenAI response incomplete. No generated result was accepted.");
  }
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "refusal") {
        throw new Error("OpenAI declined this request. No generated result was accepted.");
      }
    }
  }
  if (!responseText(payload)) {
    throw new Error("OpenAI returned no usable text. No generated result was accepted.");
  }
  return payload;
}

export function responseText(payload: any): string {
  const chunks: string[] = [];
  for (const item of payload?.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
}
