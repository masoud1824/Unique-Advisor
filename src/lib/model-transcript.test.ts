import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicAssistantError } from "./assistant-diagnostics.ts";
import { isRevisionAsk, revisionOf } from "./advisor-intent.ts";
import { assistantHistoryMessage } from "./voice-stream.ts";

describe("model transcript", () => {
  it("keeps a role on the assistant tool message that OpenAI rejected", () => {
    const history = [
      { role: "system", content: "rules" },
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
      { role: "assistant", content: "four" },
      { role: "user", content: "five" },
    ];
    const broken = { content: null, tool_calls: [{ id: "call_1", function: { name: "list_clients", arguments: "{}" } }], providerFacts: { provider: "api.openai.com" } };
    const messages = [...history, assistantHistoryMessage(broken)];
    const body = JSON.parse(JSON.stringify(messages));
    assert.equal(body[6].role, "assistant");
    assert.equal("providerFacts" in body[6], false);
    assert.equal(body.every((item) => typeof item.role === "string" && item.role.length > 0), true);
  });

  it("shows a reference to the advisor and keeps the provider detail free of keys", () => {
    const failure = publicAssistantError(422, "messages[6]: missing field role sk-testsecret Bearer sk-testsecret");
    assert.match(failure.error, /Reference A-/);
    assert.equal(failure.status, 422);
    assert.doesNotMatch(failure.error, /missing field|sk-/);
    assert.doesNotMatch(failure.detail, /sk-/);
    assert.match(failure.detail, /missing field role/);
  });

  it("answers a tool-free hello request shape and shortens a welcome draft without sending", () => {
    const hello = "Reply with the word Hello. Do not use any tools.";
    assert.equal(/\bdo not use any tools\b/i.test(hello), true);
    const draft = "Hello and welcome. I am glad you are here and I wanted to introduce the way we will work together over the coming weeks. We can review your goals, gather the documents that are still missing, and agree on a comfortable time to talk. This draft was not sent and it does not book a meeting.";
    const follow = "Shorten this welcome email under 30 words. Do not send it.";
    assert.equal(isRevisionAsk(follow), true);
    const revised = revisionOf(draft, follow);
    const email = revised.split("\n").find((line) => /welcome|Hello|Dear/i.test(line)) || "";
    assert.ok(email.split(/\s+/).filter(Boolean).length <= 30, email);
    assert.match(revised, /not sent|Nothing was searched|was not sent/i);
    assert.doesNotMatch(revised, /booked|scheduled the|sent the email/i);
  });
});
