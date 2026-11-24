import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { assistantMessage, functionCall, ScriptedModel } from "@openai/agents/testing";
import { decideApproval, startAdvisorTurn, type AgentScope } from "./advisor-agent.ts";
import { fillEquitableDraft } from "./equitable-draft.ts";
import { FileRunStore, type SavePayload } from "./prototype-store.ts";

const SOURCE = readFileSync(new URL("./advisor-agent.ts", import.meta.url), "utf8");

function scope(advisorId: string, extra: Partial<AgentScope> = {}): AgentScope {
  return {
    advisorId,
    dropboxConnected: false,
    notes: {
      "advisor-a": "Avery Example is a fictional staging client. Policy AE-1001.",
      "advisor-b": "Blake Example is a different advisor's fictional client.",
    },
    toolTrace: [],
    ...extra,
  };
}

function store() {
  return new FileRunStore(mkdtempSync(join(tmpdir(), "ua-agent-")));
}

const saveA: SavePayload = {
  advisorId: "advisor-a",
  clientName: "Avery Example",
  formCode: "0671BCF",
  destination: "/Assistant Test/Avery Example/0671BCF.pdf",
};

describe("agent prototype", () => {
  it("has no keyword cascade for the two sample requests", () => {
    assert.doesNotMatch(SOURCE, /input\.request\.(match|includes|test)|beneficiary|Avery Example|Blake Example/);
    assert.match(SOURCE, /read_practice_note/);
    assert.match(SOURCE, /needsApproval: true/);
  });

  it("follows two different model-selected tool sequences and does not upload", async () => {
    const firstModel = new ScriptedModel([
      [functionCall("read_practice_note", { topic: "client" }, { callId: "read-a" })],
      [functionCall("commit_dropbox_save", { clientName: saveA.clientName, formCode: saveA.formCode, destination: saveA.destination }, { callId: "save-a" })],
    ]);
    const firstScope = scope("advisor-a");
    const firstStore = store();
    const first = await startAdvisorTurn({ store: firstStore, scope: firstScope, request: "Look up the practice note, then hold the beneficiary draft for the staging client.", model: firstModel, runId: "run-a" });
    assert.deepEqual(firstScope.toolTrace, ["read_practice_note:client"]);
    assert.equal(firstScope.lastRead, firstScope.notes["advisor-a"]);
    assert.equal(first.status, "pending-approval");
    assert.equal(first.pending?.payload.clientName, "Avery Example");
    assert.equal(first.pending?.payload.advisorId, "advisor-a");

    const secondModel = new ScriptedModel([
      [functionCall("read_practice_note", { topic: "review" }, { callId: "read-b1" })],
      [functionCall("read_practice_note", { topic: "forms" }, { callId: "read-b2" })],
      [functionCall("commit_dropbox_save", { clientName: "Blake Example", formCode: "0671BCF", destination: "/Assistant Test/Blake Example/0671BCF.pdf" }, { callId: "save-b" })],
    ]);
    const secondScope = scope("advisor-a");
    const second = await startAdvisorTurn({ store: firstStore, scope: secondScope, request: "Check the review note and the form note before you ask me to keep a copy.", model: secondModel, runId: "run-b" });
    assert.deepEqual(secondScope.toolTrace, ["read_practice_note:review", "read_practice_note:forms"]);
    assert.equal(second.status, "pending-approval");
    assert.equal(second.pending?.payload.clientName, "Blake Example");
    assert.notDeepEqual(firstScope.toolTrace, secondScope.toolTrace);
    assert.equal(process.env.OPENAI_API_KEY, undefined);
  });

  it("rejects another advisor, a changed payload, a repeated approval, and a denial", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ua-agent-"));
    const saved = new FileRunStore(directory);
    const owner = scope("advisor-a");
    const model = new ScriptedModel([
      [functionCall("read_practice_note", { topic: "client" }, { callId: "read-c" })],
      [functionCall("commit_dropbox_save", saveA, { callId: "save-c" })],
    ]);
    await startAdvisorTurn({ store: saved, scope: owner, request: "Prepare the save after you read the note.", model, runId: "run-c" });
    const other = scope("advisor-b");
    const crossed = await decideApproval({ store: saved, scope: other, runId: "run-c", decision: "approve", payload: { ...saveA, advisorId: "advisor-b" }, model: new ScriptedModel() });
    assert.equal(crossed.code, "wrong-advisor");
    assert.equal(other.toolTrace.length, 0);

    const restarted = new FileRunStore(directory);
    const changed = await decideApproval({ store: restarted, scope: scope("advisor-a"), runId: "run-c", decision: "approve", payload: { ...saveA, clientName: "Someone Else" }, model: new ScriptedModel() });
    assert.equal(changed.code, "changed-payload");
    assert.equal(changed.toolTrace.length, 0);

    const resumeModel = new ScriptedModel([[assistantMessage("Dropbox is not connected. Nothing was uploaded.")]]);
    const resumedScope = scope("advisor-a");
    const approved = await decideApproval({ store: restarted, scope: resumedScope, runId: "run-c", decision: "approve", payload: saveA, model: resumeModel });
    assert.equal(approved.code, "approved");
    assert.match(approved.output, /Nothing was uploaded/);
    assert.doesNotMatch(approved.output, /uploaded to Dropbox/i);
    assert.deepEqual(resumedScope.toolTrace, ["commit_dropbox_save:0671BCF"]);
    const again = await decideApproval({ store: restarted, scope: scope("advisor-a"), runId: "run-c", decision: "approve", payload: saveA, model: new ScriptedModel() });
    assert.equal(again.code, "duplicate");
    assert.match(again.output, /already used/);
  });

  it("resumes a denial without uploading and reports a failed note", async () => {
    const saved = store();
    const model = new ScriptedModel([
      [functionCall("commit_dropbox_save", saveA, { callId: "save-d" })],
    ]);
    const started = await startAdvisorTurn({ store: saved, scope: scope("advisor-a"), request: "Save the draft.", model, runId: "run-d" });
    assert.equal(started.status, "pending-approval");
    const denied = await decideApproval({
      store: saved,
      scope: scope("advisor-a"),
      runId: "run-d",
      decision: "deny",
      payload: saveA,
      model: new ScriptedModel([[assistantMessage("The advisor denied this save. Nothing was uploaded.")]]),
    });
    assert.equal(denied.code, "denied");
    assert.match(denied.output, /Nothing was uploaded/);
    assert.equal(denied.toolTrace.length, 0);
    const late = await decideApproval({ store: saved, scope: scope("advisor-a"), runId: "run-d", decision: "approve", payload: saveA, model: new ScriptedModel() });
    assert.equal(late.code, "denied");

    const failed = await startAdvisorTurn({
      store: saved,
      scope: scope("advisor-a", { failNote: true }),
      request: "Read the note first.",
      model: new ScriptedModel([
        [functionCall("read_practice_note", { topic: "client" }, { callId: "read-fail" })],
        [assistantMessage("The practice note could not be read. Nothing was uploaded.")],
      ]),
      runId: "run-fail",
    });
    assert.equal(failed.status, "finished");
    assert.equal(failed.pending, null);
    assert.match(failed.output, /could not be read/);
    assert.doesNotMatch(failed.output, /uploaded the/);
  });

  it("fills the real Equitable form in memory and does not upload it", { skip: existsSync("/tmp/eq-form/671BCF.pdf") ? false : "The Equitable PDF was not downloaded in this process." }, async () => {
    const bytes = await readFile("/tmp/eq-form/671BCF.pdf");
    const draft = await fillEquitableDraft(bytes, {
      owner: "Avery Example",
      policyNumber: "AE-1001",
      email: "avery.example@example.invalid",
      address: "1 Example Street, Toronto ON",
      phone: "416-555-0101",
    });
    assert.equal(draft.fieldCount, 120);
    assert.equal(draft.policyReadBack, "AE-1001");
    assert.equal(draft.filled.length, 5);
    assert.equal(draft.leftBlank.length, 115);
    assert.equal(draft.uploaded, false);
    assert.ok(draft.bytes > bytes.byteLength);
  });
});
