import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assistantMessage, ScriptedModel } from "@openai/agents/testing";
import { MemoryDraftStore, runDraftTurn } from "./draft-agent.ts";
import { configuredModelId, rejectedModelReason } from "./model-config.ts";
import { runWorkflow, sharedAdvisorRunId } from "./v1-workflows.ts";

describe("shared Sol path and v1 workflows", () => {
  it("requests Sol and keeps the desk tools on that model", () => {
    assert.equal(configuredModelId(), process.env.UA_AGENT_MODEL || "gpt-6.2-sol");
    assert.equal(rejectedModelReason("gpt-6.2-sol", "gpt-6.2-sol-2026-01-01"), "");
    assert.match(rejectedModelReason("gpt-6.2-sol", "gpt-4.1"), /not used/);
    assert.match(rejectedModelReason("gpt-6.2-sol", ""), /no model id/);
    const desk = readFileSync(new URL("../assistant.functions.ts", import.meta.url), "utf8");
    assert.equal(desk.includes('= "gpt-4.1"'), false);
    assert.equal(desk.includes("advisorChatModel()"), true);
    assert.equal(desk.includes("shareDeskTurn"), true);
    assert.equal(desk.includes("list_clients"), true);
    assert.equal(desk.includes("draft_email"), true);
    assert.equal(desk.includes("propose_newsletter"), true);
    assert.equal(desk.includes("rejectedReturnedModel"), true);
    const modelFn = desk.slice(desk.indexOf("async function runModel("), desk.indexOf("export const loadAssistantDiagnostics"));
    assert.equal(modelFn.includes("chat/completions"), true);
    assert.equal(modelFn.includes("advisorChatModel()"), true);
    assert.equal(modelFn.includes("runDeskAgentTurn"), false);
  });

  it("uses one run id for the desk and the assistant", () => {
    assert.equal(sharedAdvisorRunId(7), "advisor:7");
    assert.equal(sharedAdvisorRunId("7"), sharedAdvisorRunId(7));
    const server = readFileSync(new URL("./preview-server.ts", import.meta.url), "utf8");
    assert.equal(server.includes("recordSharedExchange"), true);
    assert.equal(server.includes("sharedAdvisorRunId"), true);
  });

  it("does not use a reply when the returned model is not the requested one", async () => {
    const turn = await runDraftTurn({
      store: new MemoryDraftStore(),
      scope: {
        advisorId: "7",
        slug: "staging-practice",
        dropboxConnected: false,
        formFillEnabled: false,
        loadForm: async () => ({ ok: false, notice: "not used" }),
        searchWeb: async () => "not used",
      },
      request: "Say which model you are.",
      source: "typed",
      requestedModel: "gpt-6.2-sol",
      runId: "model-gate",
      model: new ScriptedModel([[assistantMessage("I am using a different model.")]]),
    });
    assert.equal(turn.ok, false);
    assert.equal(turn.code, "wrong-model");
    assert.match(turn.reply, /no model id/);
    assert.doesNotMatch(turn.reply, /different model/);
  });

  it("distinguishes a missing connection from a live action", () => {
    const missing = runWorkflow("email", { mailbox: false, dropbox: false, calendar: false, zoom: false });
    assert.equal(missing.live, false);
    assert.equal(missing.connection, "missing");
    assert.equal(missing.sent, false);
    assert.match(missing.notice, /not implemented/);
    assert.doesNotMatch(missing.notice, /workflow is implemented/);
    const connected = runWorkflow("scheduling", { mailbox: false, dropbox: false, calendar: false, zoom: true });
    assert.equal(connected.connection, "connected");
    assert.equal(connected.booked, false);
    assert.equal(connected.performed, false);
    assert.match(connected.notice, /does not read, send, book, or upload/);
    const morning = runWorkflow("morning", { mailbox: true, dropbox: false, calendar: false, zoom: false });
    assert.equal(morning.connection, "missing");
    assert.match(morning.notice, /Calendar or Zoom/);
    assert.equal(morning.performed, false);
  });
});
