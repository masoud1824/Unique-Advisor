import { Agent, RunContext, Runner, RunState, tool, type Model } from "@openai/agents";
import { z } from "zod";
import { FileRunStore, payloadHash, type PendingApproval, type RunSnapshot, type SavePayload } from "./prototype-store.ts";

export type AgentScope = {
  advisorId: string;
  dropboxConnected: boolean;
  notes: Record<string, string>;
  failNote?: boolean;
  toolTrace: string[];
  lastRead?: string;
};

const saveArguments = z.object({
  clientName: z.string().min(1),
  formCode: z.string().min(1),
  destination: z.string().min(1),
});

export function createAdvisorAgent() {
  const readNote = tool({
    name: "read_practice_note",
    description: "Read one short note for the signed-in advisor. This does not read another advisor and does not change anything.",
    parameters: z.object({ topic: z.string().min(1) }),
    execute: async (input, context) => {
      const scope = scopeFrom(context as RunContext<AgentScope> | undefined);
      scope.toolTrace.push(`read_practice_note:${input.topic}`);
      if (scope.failNote) throw new Error("The practice note could not be read.");
      const note = scope.notes[scope.advisorId];
      if (!note) return { found: false, advisorId: scope.advisorId, topic: input.topic };
      scope.lastRead = note;
      return { found: true, advisorId: scope.advisorId, topic: input.topic, note };
    },
    errorFunction: (_context, error) => error instanceof Error ? error.message : "The practice note could not be read.",
  });
  const saveDraft = tool({
    name: "commit_dropbox_save",
    description: "Request approval to save one draft in this advisor's Dropbox. Do not say it was uploaded.",
    parameters: saveArguments,
    needsApproval: true,
    execute: async (input, context) => {
      const scope = scopeFrom(context as RunContext<AgentScope> | undefined);
      scope.toolTrace.push(`commit_dropbox_save:${input.formCode}`);
      if (!scope.dropboxConnected) {
        return { uploaded: false, connected: false, reason: "Dropbox is not connected. Nothing was uploaded." };
      }
      return { uploaded: false, connected: true, reason: "No upload was attempted. Nothing was uploaded." };
    },
  });
  return new Agent<AgentScope>({
    name: "Advisor manager",
    instructions: "You are one advisor's manager. Call a tool when the request needs a record or a save. The server decides which advisor you are. Never claim that a file was uploaded.",
    tools: [readNote, saveDraft],
  });
}

function runnerFor(model: Model) {
  return new Runner({ model, tracingDisabled: true });
}

function scopeFrom(context: RunContext<AgentScope> | undefined) {
  const scope = context?.context;
  if (!scope?.advisorId) throw new Error("Advisor scope is missing.");
  return scope;
}

export type TurnResult = {
  runId: string;
  status: "pending-approval" | "finished" | "failed";
  pending: PendingApproval | null;
  output: string;
  toolTrace: string[];
};

export async function startAdvisorTurn(input: {
  store: FileRunStore;
  scope: AgentScope;
  request: string;
  model: Model;
  runId: string;
}) {
  const agent = createAdvisorAgent();
  const result = await runnerFor(input.model).run(agent, input.request, {
    context: input.scope,
    maxTurns: 6,
  });
  const output = result.interruptions.length ? "" : String(result.finalOutput || "");
  return persistRun(input.store, input.runId, input.scope, result.state, result.interruptions, output);
}

export async function decideApproval(input: {
  store: FileRunStore;
  scope: AgentScope;
  runId: string;
  decision: "approve" | "deny";
  payload: SavePayload;
  model: Model;
}): Promise<TurnResult & { code: "approved" | "denied" | "changed-payload" | "duplicate" | "not-found" | "wrong-advisor" }> {
  const snapshot = input.store.loadRaw(input.runId);
  if (!snapshot) {
    return { runId: input.runId, status: "failed", pending: null, output: "", toolTrace: input.scope.toolTrace, code: "not-found" };
  }
  if (snapshot.advisorId !== input.scope.advisorId) {
    return { runId: input.runId, status: "failed", pending: null, output: "This approval belongs to another advisor.", toolTrace: input.scope.toolTrace, code: "wrong-advisor" };
  }
  if (!snapshot.pending) {
    if (snapshot.denied) {
      return { runId: input.runId, status: "finished", pending: null, output: "This approval was already denied. Nothing was uploaded.", toolTrace: input.scope.toolTrace, code: "denied" };
    }
    if (snapshot.consumed.length) {
      return { runId: input.runId, status: "finished", pending: null, output: "This approval was already used. Nothing was uploaded again.", toolTrace: input.scope.toolTrace, code: "duplicate" };
    }
    return { runId: input.runId, status: "failed", pending: null, output: "Nothing is waiting for approval.", toolTrace: input.scope.toolTrace, code: "not-found" };
  }
  const hash = payloadHash(input.payload);
  if (hash !== snapshot.pending.hash || input.payload.advisorId !== snapshot.advisorId) {
    return { runId: input.runId, status: "pending-approval", pending: snapshot.pending, output: "The approval payload does not match the request that was paused. Nothing was uploaded.", toolTrace: input.scope.toolTrace, code: "changed-payload" };
  }
  if (snapshot.consumed.includes(hash) || snapshot.denied) {
    return { runId: input.runId, status: "finished", pending: null, output: "This approval was already used. Nothing was uploaded again.", toolTrace: input.scope.toolTrace, code: "duplicate" };
  }
  const agent = createAdvisorAgent();
  const state = await RunState.fromStringWithContext(agent, snapshot.serialized, new RunContext(input.scope));
  const interruption = state.getInterruptions()[0];
  if (!interruption) throw new Error("The stored run has no approval to resume.");
  if (input.decision === "deny") {
    state.reject(interruption, { message: "The advisor denied this save. Nothing was uploaded." });
    snapshot.denied = true;
    snapshot.pending = null;
    snapshot.serialized = state.toString();
    input.store.save(snapshot);
    const resumed = await runnerFor(input.model).run(agent, state, { maxTurns: 4 });
    snapshot.serialized = resumed.state.toString();
    input.store.save(snapshot);
    return { runId: input.runId, status: "finished", pending: null, output: String(resumed.finalOutput || "The advisor denied this save. Nothing was uploaded."), toolTrace: input.scope.toolTrace, code: "denied" };
  }
  snapshot.consumed.push(hash);
  snapshot.pending = null;
  state.approve(interruption);
  input.store.save(snapshot);
  const resumed = await runnerFor(input.model).run(agent, state, { maxTurns: 4 });
  snapshot.serialized = resumed.state.toString();
  input.store.save(snapshot);
  return { runId: input.runId, status: resumed.interruptions.length ? "pending-approval" : "finished", pending: null, output: String(resumed.finalOutput || ""), toolTrace: input.scope.toolTrace, code: "approved" };
}

async function persistRun(store: FileRunStore, runId: string, scope: AgentScope, state: RunState<AgentScope, ReturnType<typeof createAdvisorAgent>>, interruptions: { rawItem?: unknown }[], output: string) {
  const pending = interruptions.length ? approvalFrom(interruptions[0], scope.advisorId) : null;
  const snapshot: RunSnapshot = {
    runId,
    advisorId: scope.advisorId,
    serialized: state.toString(),
    pending,
    consumed: [],
    denied: false,
  };
  store.save(snapshot);
  return {
    runId,
    status: pending ? "pending-approval" as const : "finished" as const,
    pending,
    output,
    toolTrace: scope.toolTrace,
  };
}

function approvalFrom(interruption: { rawItem?: unknown }, advisorId: string): PendingApproval {
  const raw = interruption.rawItem as { type?: string; name?: string; callId?: string; arguments?: string } | undefined;
  if (raw?.type !== "function_call" || raw.name !== "commit_dropbox_save" || !raw.callId || !raw.arguments) {
    throw new Error("The paused tool is not a Dropbox save.");
  }
  const parsed = saveArguments.parse(JSON.parse(raw.arguments));
  const payload: SavePayload = { advisorId, ...parsed };
  return { callId: raw.callId, toolName: raw.name, payload, hash: payloadHash(payload) };
}
