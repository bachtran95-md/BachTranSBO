import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.Deno = { env: { get: () => 'sk-proj-test_abcdefghijklmnopqrstuvwxyz' } };
const { callResponses, responseText } = await import('../supabase/functions/_shared/responses.ts');
const completed = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Ready' }] }] };

test('transport preserves structured output and tools, forces no storage, supplies timeout', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.model, 'configured-model');
      assert.deepEqual(body.text, { format: { type: 'json_schema' } });
      assert.deepEqual(body.tools, [{ type: 'web_search' }]);
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json(completed);
    };
    assert.deepEqual(await callResponses({ model: 'configured-model', store: true,
      text: { format: { type: 'json_schema' } }, tools: [{ type: 'web_search' }] }), completed);
  } finally { globalThis.fetch = original; }
});

for (const payload of [
  { ...completed, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
  { ...completed, status: 'failed' },
  { ...completed, status: 'queued' },
  { status: 'completed', output: [] },
  { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] },
  { status: 'completed', output: [{ type: 'reasoning', content: [{ type: 'output_text', text: 'Hidden' }] }] },
]) {
  test(`rejects unusable result: ${JSON.stringify(payload)}`, async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async () => Response.json(payload);
      await assert.rejects(callResponses({ model: 'test' }));
    } finally { globalThis.fetch = original; }
  });
}

test('does not echo upstream content or retry a rejected request', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return new Response('private patient text', { status: 429 }); };
    await assert.rejects(callResponses({ model: 'test' }), error =>
      error.message.includes('429') && !error.message.includes('private patient text'));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('reads only final message text while preserving multiple text blocks', () => {
  assert.equal(responseText({ output: [
    { type: 'reasoning', content: [{ type: 'output_text', text: 'Hidden' }] },
    ...completed.output,
    { type: 'message', content: [{ type: 'output_text', text: 'Second' }] },
  ] }), 'Ready\nSecond');
});

test('aborts stalled requests without retrying', async () => {
  const original = globalThis.fetch;
  const keepAlive = setTimeout(() => {}, 1000);
  let calls = 0;
  try {
    globalThis.fetch = async (_, options) => {
      calls++;
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
    };
    await assert.rejects(callResponses({ model: 'test' }, 5), { name: 'TimeoutError' });
    assert.equal(calls, 1);
  } finally { clearTimeout(keepAlive); globalThis.fetch = original; }
});
