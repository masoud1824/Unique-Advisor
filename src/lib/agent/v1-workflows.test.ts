import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { configuredModelId } from "./model-config.ts";
import { runWorkflow, sharedAdvisorRunId } from "./v1-workflows.ts";

describe("shared Sol path and v1 workflows", () => {
  it("requests Sol and does not keep a hard-coded GPT-4.1 desk model", () => {
    assert.equal(configuredModelId(), process.env.UA_AGENT_MODEL || "gpt-6.2-sol");
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

  it("distinguishes a built workflow from a missing connection", () => {
    const missing = runWorkflow("email", { mailbox: false, dropbox: false, calendar: false, zoom: false });
    assert.equal(missing.implemented, true);
    assert.equal(missing.connection, "missing");
    assert.equal(missing.sent, false);
    const connected = runWorkflow("scheduling", { mailbox: false, dropbox: false, calendar: false, zoom: true });
    assert.equal(connected.connection, "connected");
    assert.equal(connected.booked, false);
    const morning = runWorkflow("morning", { mailbox: true, dropbox: false, calendar: false, zoom: false });
    assert.equal(morning.connection, "missing");
    assert.match(morning.notice, /Calendar or Zoom/);
    assert.equal(morning.performed, false);
  });
});
