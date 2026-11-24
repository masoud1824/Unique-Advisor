import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type SavePayload = {
  advisorId: string;
  clientName: string;
  formCode: string;
  destination: string;
};

export type PendingApproval = {
  callId: string;
  toolName: string;
  payload: SavePayload;
  hash: string;
};

export type RunSnapshot = {
  runId: string;
  advisorId: string;
  serialized: string;
  pending: PendingApproval | null;
  consumed: string[];
  denied: boolean;
};

export function payloadHash(payload: SavePayload) {
  return createHash("sha256").update(JSON.stringify({
    advisorId: payload.advisorId,
    clientName: payload.clientName,
    formCode: payload.formCode,
    destination: payload.destination,
  })).digest("hex");
}

/** File store for this prototype only. It does not use the hosted database. */
export class FileRunStore {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
  }

  save(snapshot: RunSnapshot) {
    writeFileSync(join(this.directory, `${snapshot.runId}.json`), JSON.stringify(snapshot));
  }

  loadRaw(runId: string): RunSnapshot | null {
    try {
      return JSON.parse(readFileSync(join(this.directory, `${runId}.json`), "utf8")) as RunSnapshot;
    } catch {
      return null;
    }
  }

  load(runId: string, advisorId: string): RunSnapshot | null {
    const snapshot = this.loadRaw(runId);
    if (!snapshot || snapshot.advisorId !== advisorId) return null;
    return snapshot;
  }
}
