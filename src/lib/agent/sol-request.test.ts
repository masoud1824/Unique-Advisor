import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { solAwareFetch, solChatCompletionBody, solResponsesBody } from "./sol-request.ts";

describe("gpt-6.2-sol request shape", () => {
  it("renames max_tokens on Chat Completions and drops unsupported sampling fields", () => {
    const body = solChatCompletionBody({
      model: "gpt-6.2-sol",
      temperature: 0,
      top_p: 1,
      logprobs: true,
      max_tokens: 800,
      messages: [{ role: "user", content: "read my email" }],
    });
    assert.equal(body.max_completion_tokens, 800);
    assert.equal("max_tokens" in body, false);
    assert.equal("temperature" in body, false);
    assert.equal("top_p" in body, false);
    assert.equal("logprobs" in body, false);
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.model, "gpt-6.2-sol");
  });

  it("does not rename the Responses token limit or apply the chat parameter", () => {
    const body = solResponsesBody({
      model: "gpt-6.2-sol",
      temperature: 0.2,
      max_tokens: 50,
      max_output_tokens: 2048,
      reasoning: { effort: "none" },
    });
    assert.equal(body.max_output_tokens, 2048);
    assert.equal("max_completion_tokens" in body, false);
    assert.equal("max_tokens" in body, false);
    assert.equal("temperature" in body, false);
    assert.deepEqual(body.reasoning, { effort: "low" });
  });

  it("leaves a different model unchanged", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen.push(String(init?.body || ""));
      return new Response("{}", { status: 200 });
    };
    await solAwareFetch(fetchImpl)("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-4.1", max_tokens: 20, temperature: 0 }),
    });
    const sent = JSON.parse(seen[0]);
    assert.equal(sent.max_tokens, 20);
    assert.equal(sent.temperature, 0);
    assert.equal("max_completion_tokens" in sent, false);
  });
});
