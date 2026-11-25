import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { assistantMessage, functionCall, ScriptedModel } from "@openai/agents/testing";
import { decideTranscript } from "../transcript-guard.ts";
import { beginPlayback, browserFallbackAllowed, emptyPlayback, shouldResumeAfterSpeech, stopPlayback } from "../voice-desk.ts";
import { decideDraft, MemoryDraftStore, runDraftTurn, type DraftScope } from "./draft-agent.ts";
import { fillMappedDraft } from "./equitable-draft.ts";
import { ASSISTANT_CAPABILITIES, ASSISTANT_NAME } from "./assistant-capabilities.ts";
import { acceptSuppliedFacts, missingQuestions, providerMapping, SIGNATURE_FIELDS } from "./equitable-fields.ts";
import { bareApprovalSpeech, echoesAssistantReply, explicitReplayRunsTools, phaseAfterStop, sameTurnGuard, speechAuthorizesAction } from "./voice-bridge.ts";

const SOURCE = readFileSync(new URL("./draft-agent.ts", import.meta.url), "utf8");
const SERVER = readFileSync(new URL("./preview-server.ts", import.meta.url), "utf8");

function scope(advisorId: string, slug: string, extra: Partial<Omit<DraftScope, "record" | "userText">> = {}): Omit<DraftScope, "record" | "userText"> {
  return {
    advisorId,
    slug,
    dropboxConnected: false,
    loadForm: async () => ({ ok: false, notice: "Saved Useful Link: Equitable Life Forms\nhttps://advisor.equitable.ca/advisor/en/individual-insurance/forms" }),
    searchWeb: async () => "Web search was not run.",
    ...extra,
  };
}

const stated = "For Avery Example, the named beneficiary is Riley Example, relationship sibling, share 100 percent, and there is no trustee.";

describe("equitable draft agent", () => {
  it("does not route the user's sentence to a tool by phrase", () => {
    assert.doesNotMatch(SOURCE, /request\.includes|userText\.includes\(|if \(request/);
    assert.match(SOURCE, /needsApproval:/);
    assert.match(SERVER, /advisor_id = \$1|advisor_id = \$2/);
    assert.doesNotMatch(SERVER, /update contacts|insert into contacts|sendMail|UA_OUTBOUND_BLOCK\s*=/);
  });

  it("follows two different model-selected tool sequences and does not upload", async () => {
    const first = await runDraftTurn({
      store: new MemoryDraftStore(),
      scope: scope("7", "staging-practice"),
      request: "Find the Equitable beneficiary change form and open a draft for Avery Example.",
      source: "typed",
      runId: "run-1",
      model: new ScriptedModel([
        [functionCall("inspect_form", { query: "Equitable beneficiary change" }, { callId: "f1" })],
        [functionCall("load_client", { clientName: "Avery Example" }, { callId: "c1" })],
        [assistantMessage("What is the beneficiary's full legal name?")],
      ]),
    });
    assert.deepEqual(first.toolTrace, ["inspect_form:Equitable beneficiary change", "load_client:Avery Example"]);
    assert.equal(first.dropbox.uploaded, false);
    assert.ok(first.missing.length >= 4);
    assert.equal(first.calledModel, true);

    const second = await runDraftTurn({
      store: new MemoryDraftStore(),
      scope: scope("7", "staging-practice"),
      request: "Please prepare form 671BCF. The client is Avery Example. I will give the beneficiary next.",
      source: "voice",
      runId: "run-2",
      model: new ScriptedModel([
        [functionCall("load_client", { clientName: "Avery Example" }, { callId: "c2" })],
        [functionCall("inspect_form", { query: "671BCF beneficiary" }, { callId: "f2" })],
        [assistantMessage("What is the beneficiary's full legal name?")],
      ]),
    });
    assert.deepEqual(second.toolTrace, ["load_client:Avery Example", "inspect_form:671BCF beneficiary"]);
    assert.notDeepEqual(first.toolTrace, second.toolTrace);
    assert.equal(second.dropbox.uploaded, false);
    assert.equal(process.env.OPENAI_API_KEY, undefined);
  });

  it("rejects invented, ambiguous, and negated facts", () => {
    const rejected = acceptSuppliedFacts({}, { beneficiaryName: "Quinn Example" }, "The beneficiary is Riley Example.");
    assert.equal(rejected.accepted.includes("beneficiaryName"), false);
    const ambiguous = acceptSuppliedFacts({}, { sharePercent: "60" }, "Should the share be 60 percent or 100 percent?");
    assert.match(ambiguous.rejected.map((item) => item.reason).join(" "), /Which share/);
    const negated = acceptSuppliedFacts({}, { beneficiaryName: "Riley Example" }, "The beneficiary is not Riley Example.");
    assert.equal(negated.accepted.includes("beneficiaryName"), false);
    const accepted = acceptSuppliedFacts({}, {
      beneficiaryName: "Riley Example",
      relationship: "sibling",
      sharePercent: "100",
      designation: "named",
      trustee: "none",
    }, stated);
    assert.deepEqual(accepted.accepted.sort(), ["beneficiaryName", "designation", "relationship", "sharePercent", "trustee"]);
    assert.deepEqual(missingQuestions(accepted.facts), []);
  });

  it("updates the real PDF on correction, leaves signatures blank, and invalidates the old approval", async () => {
    assert.equal(existsSync("/tmp/eq-form/671BCF.pdf"), true);
    const bytes = new Uint8Array(await readFile("/tmp/eq-form/671BCF.pdf"));
    const store = new MemoryDraftStore();
    const base = scope("7", "staging-practice", {
      loadForm: async () => ({ ok: true, title: "Beneficiary Change Request Form (671BCF)", href: "https://advisor.equitable.ca/advisor/getattachment/671BCF.pdf", bytes, notice: "Beneficiary Change Request Form (671BCF)" }),
    });
    const opened = await runDraftTurn({
      store,
      scope: base,
      request: stated,
      source: "typed",
      runId: "pdf",
      model: new ScriptedModel([
        [functionCall("load_client", { clientName: "Avery Example" }, { callId: "c" })],
        [functionCall("inspect_form", { query: "Equitable beneficiary" }, { callId: "i" })],
        [functionCall("record_facts", { beneficiaryName: "Riley Example", relationship: "sibling", sharePercent: "100", designation: "named", trustee: "none" }, { callId: "r" })],
        [functionCall("propose_dropbox_save", { destination: "/Assistant Test/Avery Example/671BCF.pdf" }, { callId: "s" })],
      ]),
    });
    assert.equal(opened.approval?.payload.clientName, "Avery Example");
    assert.equal(opened.readBack["Share Row1"], "100");
    assert.equal(opened.readBack["Name first middle lastRow1"], "Riley Example");
    assert.equal(opened.dropbox.uploaded, false);
    assert.equal(opened.unsigned, true);
    const old = opened.approval;
    assert.ok(old);
    const corrected = await runDraftTurn({
      store,
      scope: base,
      request: "Change the share to 60 percent.",
      source: "typed",
      runId: "pdf",
      model: new ScriptedModel([
        [functionCall("record_facts", { sharePercent: "60" }, { callId: "fix" })],
        [assistantMessage("The share is now 60 percent. The earlier approval is no longer valid.")],
      ]),
    });
    assert.equal(corrected.readBack["Share Row1"], "60");
    assert.equal(corrected.approval, null);
    assert.equal(corrected.approvalStatus, "invalidated");
    const stale = await decideDraft({
      store,
      scope: base,
      runId: "pdf",
      decision: "approve",
      payload: old.payload,
      model: new ScriptedModel([[assistantMessage("This must not run.")]]),
    });
    assert.equal(stale.code, "changed-payload");
    assert.match(stale.reply, /Nothing was uploaded/);
    const filled = await fillMappedDraft(bytes, { owner: "Avery Example", policyNumber: "AE-1001", beneficiaryName: "Riley Example", sharePercent: "60", designation: "named" });
    for (const name of SIGNATURE_FIELDS) assert.equal(filled.signatures[name], "");
  });

  it("rejects another advisor, a tampered payload, a repeated approval, and a denial", async () => {
    const bytes = new Uint8Array(await readFile("/tmp/eq-form/671BCF.pdf"));
    const store = new MemoryDraftStore();
    const owner = scope("7", "staging-practice", {
      loadForm: async () => ({ ok: true, title: "Beneficiary Change Request Form (671BCF)", href: "https://advisor.equitable.ca/671BCF.pdf", bytes, notice: "671BCF" }),
    });
    const opened = await runDraftTurn({
      store,
      scope: owner,
      request: stated,
      source: "typed",
      runId: "save",
      model: new ScriptedModel([
        [functionCall("inspect_form", { query: "Equitable 671BCF" }, { callId: "i" })],
        [functionCall("load_client", { clientName: "Avery Example" }, { callId: "c" })],
        [functionCall("record_facts", { beneficiaryName: "Riley Example", relationship: "sibling", sharePercent: "100", designation: "named", trustee: "none" }, { callId: "r" })],
        [functionCall("propose_dropbox_save", { destination: "/Assistant Test/Avery Example/671BCF.pdf" }, { callId: "s" })],
      ]),
    });
    const payload = opened.approval?.payload;
    assert.ok(payload);
    const other = await decideDraft({
      store,
      scope: scope("8", "staging-other"),
      runId: "save",
      decision: "approve",
      payload,
      model: new ScriptedModel([[assistantMessage("no")]]),
    });
    assert.equal(other.code, "wrong-advisor");
    assert.equal(other.readBack["Policy Number"], undefined);
    const tampered = await decideDraft({
      store,
      scope: owner,
      runId: "save",
      decision: "approve",
      payload: { ...payload, destination: "/somewhere-else.pdf" },
      model: new ScriptedModel([[assistantMessage("no")]]),
    });
    assert.equal(tampered.code, "changed-payload");
    const approved = await decideDraft({
      store,
      scope: owner,
      runId: "save",
      decision: "approve",
      payload,
      model: new ScriptedModel([[assistantMessage("The save was approved. Nothing was uploaded.")]]),
    });
    assert.equal(approved.code, "approved");
    assert.match(approved.reply, /Nothing was uploaded/);
    assert.equal(approved.dropbox.uploaded, false);
    const again = await decideDraft({
      store,
      scope: owner,
      runId: "save",
      decision: "approve",
      payload,
      model: new ScriptedModel([[assistantMessage("no")]]),
    });
    assert.equal(again.code, "duplicate");
  });

  it("denies a save, resumes after a new store instance, and does not call the model for a spoken yes", async () => {
    const bytes = new Uint8Array(await readFile("/tmp/eq-form/671BCF.pdf"));
    const first = new MemoryDraftStore();
    const owner = scope("7", "staging-practice", {
      loadForm: async () => ({ ok: true, title: "Beneficiary Change Request Form (671BCF)", href: "https://advisor.equitable.ca/671BCF.pdf", bytes, notice: "671BCF" }),
    });
    const opened = await runDraftTurn({
      store: first,
      scope: owner,
      request: stated,
      source: "voice",
      runId: "resume",
      model: new ScriptedModel([
        [functionCall("inspect_form", { query: "Equitable 671BCF" }, { callId: "i" })],
        [functionCall("load_client", { clientName: "Avery Example" }, { callId: "c" })],
        [functionCall("record_facts", { beneficiaryName: "Riley Example", relationship: "sibling", sharePercent: "100", designation: "named", trustee: "none" }, { callId: "r" })],
        [functionCall("propose_dropbox_save", { destination: "/Assistant Test/Avery Example/671BCF.pdf" }, { callId: "s" })],
      ]),
    });
    const restarted = new MemoryDraftStore();
    const saved = first.loadRaw("resume");
    assert.ok(saved);
    restarted.save(saved);
    const yes = await runDraftTurn({
      store: restarted,
      scope: owner,
      request: "yes",
      source: "voice",
      runId: "resume",
      model: new ScriptedModel([[assistantMessage("The model must not see a bare yes.")]]),
    });
    assert.equal(yes.calledModel, false);
    assert.equal(yes.code, "speech-not-approval");
    assert.equal(restarted.loadRaw("resume")?.pending?.hash, opened.approval?.hash);
    const denied = await decideDraft({
      store: restarted,
      scope: owner,
      runId: "resume",
      decision: "deny",
      payload: opened.approval!.payload,
      model: new ScriptedModel([[assistantMessage("The advisor denied this save. Nothing was uploaded.")]]),
    });
    assert.equal(denied.code, "denied");
    assert.match(denied.reply, /Nothing was uploaded/);
  });

  it("names the assistant and keeps other advisor tasks unavailable", async () => {
    assert.equal(ASSISTANT_NAME, "Unique Advisor AI Assistant");
    assert.equal(providerMapping("Beneficiary Change Request Form (671BCF)", "https://advisor.equitable.ca/671BCF.pdf"), "671BCF");
    assert.equal(providerMapping("Canada Life change form", "https://www.canadalife.com/form.pdf"), "");
    assert.ok(ASSISTANT_CAPABILITIES.some((item) => item.id === "newsletters" && item.status === "not-available"));
    assert.ok(ASSISTANT_CAPABILITIES.some((item) => item.id === "scheduling" && item.status === "not-available"));
    assert.ok(ASSISTANT_CAPABILITIES.some((item) => item.id === "client-reviews" && item.status === "not-available"));
    assert.match(SOURCE, /Unique Advisor AI Assistant/);
    assert.doesNotMatch(SOURCE, /name: "Equitable draft manager"/);
    const unmapped = await runDraftTurn({
      store: new MemoryDraftStore(),
      scope: scope("7", "staging-practice", {
        loadForm: async () => ({ ok: true, title: "Canada Life change form", href: "https://www.canadalife.com/form.pdf", bytes: new Uint8Array([1, 2, 3]), notice: "Canada Life change form" }),
      }),
      request: "Find the Canada Life form.",
      source: "typed",
      runId: "other-form",
      model: new ScriptedModel([
        [functionCall("inspect_form", { query: "Canada Life" }, { callId: "other" })],
        [assistantMessage("I found the form. A field mapping is not available, so nothing was filled.")],
      ]),
    });
    assert.equal(unmapped.preview, false);
    assert.equal(unmapped.formHref, "https://www.canadalife.com/form.pdf");
    assert.deepEqual(unmapped.readBack, {});
  });

  it("reports a tool failure instead of a successful save", async () => {
    const failed = await runDraftTurn({
      store: new MemoryDraftStore(),
      scope: scope("7", "staging-practice", { loadForm: async () => { throw new Error("The form library did not open."); } }),
      request: "Find the Equitable form.",
      source: "typed",
      runId: "fail",
      model: new ScriptedModel([
        [functionCall("inspect_form", { query: "Equitable beneficiary" }, { callId: "bad" })],
        [assistantMessage("The form library did not open.")],
      ]),
    });
    assert.match(`${failed.reply} ${failed.toolTrace.join(" ")}`, /form library did not open|inspect_form/);
    assert.equal(failed.dropbox.uploaded, false);
  });
});

describe("agent voice bridge", () => {
  it("keeps speech from authorizing, duplicating, or restarting playback", () => {
    assert.equal(speechAuthorizesAction(), false);
    assert.equal(explicitReplayRunsTools(), false);
    assert.equal(bareApprovalSpeech("yes"), true);
    assert.equal(bareApprovalSpeech("yes, change the share to 60 percent"), false);
    assert.equal(phaseAfterStop(), "idle");
    assert.equal(shouldResumeAfterSpeech(), false);
    assert.equal(echoesAssistantReply("What is the beneficiary's full legal name?", "What is the beneficiary's full legal name?"), true);
    assert.equal(sameTurnGuard({ busy: true, previous: "hello", text: "hello", elapsedMs: 100 }).reason, "busy");
    assert.equal(sameTurnGuard({ busy: false, previous: "hello there", text: "hello there", elapsedMs: 500 }).reason, "duplicate");
    const started = beginPlayback(emptyPlayback(), { replyKey: "The share is 60 percent." });
    const stopped = stopPlayback(started.state);
    assert.equal(beginPlayback(stopped, { replyKey: "The share is 60 percent." }).accept, false);
    assert.equal(beginPlayback(stopped, { replyKey: "The share is 60 percent.", manual: true }).accept, true);
    assert.equal(browserFallbackAllowed({ owner: stopped.owner, activeOwner: stopped.owner, serverStarted: true }), false);
    const silence = decideTranscript({ audioBytes: 40, prompt: "Financial advisor. Contact names: Avery Example.", names: ["Avery Example"] });
    assert.equal(silence.post, false);
    const denied = decideTranscript({ audioBytes: 0, prompt: "", permissionDenied: true });
    assert.equal(denied.post, false);
    assert.match(denied.post ? "" : denied.message, /permission/i);
  });
});
