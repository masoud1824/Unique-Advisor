import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ASSISTANT, decideAction, decideSend, parseAssistantSettings } from "./assistant-policy.ts";

const own = {
  status: "active",
  plan: "professional",
  settings: DEFAULT_ASSISTANT,
  actorId: 7,
  draftAdvisorId: 7,
  draftStatus: "pending",
};

describe("assistant send gate", () => {
  it("blocks a paused advisor before anything is sent", () => {
    const result = decideSend({ ...own, status: "suspended" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /paused/i);
  });

  it("blocks an advisor from another advisor's draft", () => {
    const result = decideSend({ ...own, draftAdvisorId: 8 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /another advisor/i);
  });

  it("allows the owning advisor to approve their own pending draft", () => {
    assert.deepEqual(decideSend(own), { ok: true });
  });

  it("keeps the AI assistant off the Starter plan", () => {
    const result = decideSend({ ...own, plan: "starter" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Starter/i);
  });

  it("blocks a plan the operator has not included", () => {
    const settings = parseAssistantSettings({ ...DEFAULT_ASSISTANT, plans: ["team"] });
    const result = decideSend({ ...own, settings });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /plan/i);
  });

  it("blocks a draft that was already sent", () => {
    const result = decideSend({ ...own, draftStatus: "sent" });
    assert.equal(result.ok, false);
  });

  it("blocks a paused advisor from booking or saving a file", () => {
    const result = decideAction({ ...own, status: "suspended", actionAdvisorId: 7, actionStatus: "pending", kind: "zoom" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /paused/i);
  });

  it("blocks one advisor from approving another's Zoom request", () => {
    const result = decideAction({ ...own, actionAdvisorId: 9, actionStatus: "pending", kind: "zoom" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /another advisor/i);
  });
});
