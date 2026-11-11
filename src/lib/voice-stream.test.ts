import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleModelStream, takeSentences } from "./voice-stream.ts";

describe("voice stream", () => {
  it("splits a reply into sentences and keeps the unfinished tail", () => {
    const pulled = takeSentences("Hello there. The meeting is ready");
    assert.deepEqual(pulled.sentences, ["Hello there."]);
    assert.equal(pulled.rest, "The meeting is ready");
  });

  it("assembles streamed text and a tool call the same way as a full message", () => {
    const raw = [
      'data: {"choices":[{"delta":{"content":"One moment. "}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"book_zoom","arguments":""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"confirm\\":true}"}}]}}]}',
      "data: [DONE]",
    ].join("\n");
    const message = assembleModelStream(raw);
    assert.equal(message.content, "One moment. ");
    assert.equal(message.tool_calls[0]?.function.name, "book_zoom");
    assert.equal(message.tool_calls[0]?.function.arguments, '{"confirm":true}');
  });
});
