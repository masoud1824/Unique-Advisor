import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { configuredModelId } from "./model-config.ts";
import { runWorkflow, sharedAdvisorRunId } from "./v1-workflows.ts";

describe("shared Sol path and v1 workflows", () => {
  it("requests Sol and does not keep a hard-coded GPT-4.1 desk model", () => {
    const chosen = String(process.env.UA_AGENT_MODEL || "").trim();
    const expected = chosen === "gpt-6.2-sol" || chosen.startsWith("gpt-6.2-sol-") ? chosen : "gpt-6.2-sol";
    assert.equal(configuredModelId(), expected);
    const previous = process.env.UA_AGENT_MODEL;
    process.env.UA_AGENT_MODEL = "gpt-4.1";
    assert.equal(configuredModelId(), "gpt-6.2-sol");
    if (previous === undefined) delete process.env.UA_AGENT_MODEL;
    else process.env.UA_AGENT_MODEL = previous;
    const desk = readFileSync(new URL("../assistant.functions.ts", import.meta.url), "utf8");
    assert.equal(desk.includes('= "gpt-4.1"'), false);
    assert.equal(desk.includes("advisorChatModel()"), true);
    assert.equal(desk.includes("rejectedReturnedModel"), true);
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
