import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { configuredModelId } from "./model-config.ts";
import { runWorkflow, sharedAdvisorRunId } from "./v1-workflows.ts";

describe("shared Grok path and v1 workflows", () => {
  it("requests Grok and does not fall back to OpenAI or GPT-4.1", () => {
    const chosen = String(process.env.UA_AGENT_MODEL || "").trim();
    const expected = chosen === "grok-4.5" || chosen.startsWith("grok-4.5-") ? chosen : "grok-4.5";
    assert.equal(configuredModelId(), expected);
    const previous = process.env.UA_AGENT_MODEL;
    process.env.UA_AGENT_MODEL = "gpt-6.2-sol";
    assert.equal(configuredModelId(), "grok-4.5");
    process.env.UA_AGENT_MODEL = "gpt-4.1";
    assert.equal(configuredModelId(), "grok-4.5");
    if (previous === undefined) delete process.env.UA_AGENT_MODEL;
    else process.env.UA_AGENT_MODEL = previous;
    const desk = readFileSync(new URL("../assistant.functions.ts", import.meta.url), "utf8");
    const modelConfig = readFileSync(new URL("./model-config.ts", import.meta.url), "utf8");
    assert.equal(desk.includes('= "gpt-4.1"'), false);
    assert.equal(desk.includes("advisorChatModel()"), true);
    assert.equal(desk.includes("rejectedReturnedModel"), true);
    assert.equal(desk.includes("XAI_BASE"), true);
    assert.equal(desk.includes("api.openai.com/v1/chat/completions"), false);
    assert.equal(modelConfig.includes("https://api.x.ai/v1"), true);
    assert.equal(modelConfig.includes("grok-4.5"), true);
    const modelFn = desk.slice(desk.indexOf("async function runModel("), desk.indexOf("export const loadAssistantDiagnostics"));
    assert.equal(modelFn.includes("runDeskAgentTurn"), true);
    assert.equal(modelFn.includes("chat/completions"), false);
  });

  it("uses one run id for the desk and the assistant", () => {
    assert.equal(sharedAdvisorRunId(7), "advisor:7");
    assert.equal(sharedAdvisorRunId("7"), sharedAdvisorRunId(7));
  });

  it("stops a workflow when the connection is missing and never sends", () => {
    const missing = runWorkflow("email", { mailbox: false, dropbox: false, calendar: false, zoom: false });
    assert.equal(missing.live, false);
    assert.equal(missing.connection, "missing");
    assert.equal(missing.sent, false);
    assert.equal(missing.performed, false);
    const connected = runWorkflow("scheduling", { mailbox: false, dropbox: false, calendar: false, zoom: true });
    assert.equal(connected.connection, "connected");
    assert.equal(connected.live, false);
    assert.equal(connected.booked, false);
    assert.match(connected.notice, /does not read, send, book, or upload/);
    const morning = runWorkflow("morning", { mailbox: true, dropbox: false, calendar: false, zoom: false });
    assert.equal(morning.connection, "missing");
    assert.match(morning.notice, /Calendar or Zoom/);
    assert.equal(morning.performed, false);
  });
});
