/** Dropbox birthday file contract. This module does not call Dropbox. */

import type { BirthdayPerson } from "./birthday-job.ts";

export type BirthdayFileRead = { people: BirthdayPerson[] } | { error: string };

export type BirthdayFileReader = (input: { advisorId: number; fileId: string }) => Promise<BirthdayFileRead>;

/** Live Dropbox is not connected. A host may later supply one already-chosen file. */
export function dropboxBirthdayReady() {
  return {
    ready: false as const,
    contactedDropbox: false as const,
    reason: "The Dropbox birthday adapter is not connected. It would read one file the advisor already chose. It does not list a Dropbox account, and this copy will not call Dropbox.",
  };
}

export async function peopleFromBirthdaySource(input: {
  source: "" | "desk" | "dropbox";
  sourceRef: string;
  advisorId: number;
  deskPeople: BirthdayPerson[];
  dropbox?: BirthdayFileReader;
}): Promise<{ people: BirthdayPerson[]; error: string; adapter: "desk" | "dropbox" | "" }> {
  if (input.source === "desk") return { people: input.deskPeople, error: "", adapter: "desk" };
  if (input.source !== "dropbox") return { people: [], error: "", adapter: "" };
  if (!input.dropbox || !input.sourceRef) {
    return { people: [], error: dropboxBirthdayReady().reason, adapter: "dropbox" };
  }
  const read = await input.dropbox({ advisorId: input.advisorId, fileId: input.sourceRef });
  if ("error" in read) return { people: [], error: read.error, adapter: "dropbox" };
  return { people: read.people, error: "", adapter: "dropbox" };
}
