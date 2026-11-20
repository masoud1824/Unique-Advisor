import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { factsFromModelPayload, factsFromResponse } from "./assistant-diagnostics.ts";

describe("assistant diagnostics", () => {
  it("reads the provider host, model, request id, and usage from a real response body", () => {
    const facts = factsFromResponse(
      { url: "https://api.openai.com/v1/chat/completions", headers: { get: (name) => (name === "x-request-id" ? "req_header" : null) } },
      { id: "chatcmpl-9", model: "gpt-4.1-2025-04-14", choices: [{ message: { content: "Sample Person policy number 123" } }], usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 } },
    );
    assert.equal(facts.provider, "api.openai.com");
    assert.equal(facts.model, "gpt-4.1-2025-04-14");
    assert.equal(facts.requestId, "req_header");
    assert.equal(facts.promptTokens, 11);
    assert.equal(facts.completionTokens, 4);
    assert.equal(facts.totalTokens, 15);
    assert.equal(JSON.stringify(facts).includes("Sample Person"), false);
  });

  it("reads a streamed response and does not invent a model or token count", () => {
    const raw = [
      'data: {"id":"chatcmpl-stream","model":"gpt-4.1-2025-04-14","choices":[{"delta":{"content":"Private draft"}}]}',
      'data: {"id":"chatcmpl-stream","model":"gpt-4.1-2025-04-14","choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}',
      "data: [DONE]",
    ].join("\n");
    const facts = factsFromModelPayload({ url: "https://api.openai.com/v1/chat/completions", raw });
    assert.equal(facts.requestId, "chatcmpl-stream");
    assert.equal(facts.model, "gpt-4.1-2025-04-14");
    assert.equal(facts.totalTokens, 10);
    assert.equal(JSON.stringify(facts).includes("Private draft"), false);
    const empty = factsFromModelPayload({ url: "https://api.openai.com/v1/audio/speech" });
    assert.equal(empty.model, "");
    assert.equal(empty.promptTokens, null);
    assert.equal(empty.provider, "api.openai.com");
  });

  it("drops a value that looks like a key", () => {
    const facts = factsFromModelPayload({ body: { id: "sk-secret", model: "Bearer sk-secret", usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });
    assert.equal(facts.requestId, "");
    assert.equal(facts.model, "");
    assert.equal(facts.totalTokens, 2);
  });
});
