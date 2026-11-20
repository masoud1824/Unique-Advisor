import { draftWithdrawalUpdate } from "./workspace-policy.ts";

export type FixtureDraft = { id: number; status: string; approval_state: string; body: string };
export type FixtureLetter = { id: number; body: string };

/** Cancel withdraws approval. Saved draft rows and saved letters stay. */
export function applyCancellation(drafts: FixtureDraft[], letters: FixtureLetter[]) {
  const update = draftWithdrawalUpdate();
  const nextDrafts = drafts.map((row) => row.status === "pending"
    ? { ...row, status: update.status, approval_state: update.approval_state }
    : { ...row });
  return {
    drafts: nextDrafts,
    letters: letters.map((row) => ({ ...row })),
    deletedDraftIds: [] as number[],
    deletedLetterIds: [] as number[],
    deletesRows: update.deletesRows,
  };
}

export type DeliveryPacket = {
  recipients: string[];
  body: string;
  attachmentHash: string;
};

export function packetFingerprint(packet: DeliveryPacket) {
  return JSON.stringify({
    recipients: [...packet.recipients].sort(),
    body: packet.body,
    attachmentHash: packet.attachmentHash,
  });
}

export function approvalStillApplies(approved: string, packet: DeliveryPacket) {
  return approved === packetFingerprint(packet);
}

export type RecipientResult = { id: string; ok: boolean; error?: string };

/** Retry only recipients that have not already succeeded. A changed attachment voids the approval. */
export function planPartialRetry(input: {
  approvedFingerprint: string;
  packet: DeliveryPacket;
  prior: RecipientResult[];
}) {
  if (!approvalStillApplies(input.approvedFingerprint, input.packet)) {
    return { ok: false as const, retry: [] as string[], skipped: [] as string[], reason: "Approval no longer applies. Nothing was retried." };
  }
  const done = new Set(input.prior.filter((row) => row.ok).map((row) => row.id));
  const retry = input.packet.recipients.filter((id) => !done.has(id));
  const skipped = input.packet.recipients.filter((id) => done.has(id));
  return { ok: true as const, retry, skipped, reason: retry.length ? "Retrying only the recipients that did not succeed." : "Every recipient already succeeded. Nothing was sent again." };
}

export function runRecipientAttempts(ids: string[], send: (id: string) => RecipientResult, seen: Set<string>) {
  const results: RecipientResult[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      results.push({ id, ok: false, error: "Already sent. I did not send it again." });
      continue;
    }
    const result = send(id);
    results.push(result);
    if (result.ok) seen.add(id);
  }
  return results;
}

export type DripFixture = {
  id: number;
  name: string;
  active: boolean;
  status: "saved" | "paused" | "cancelled";
  steps: string[];
  recipients: Array<{ name: string; email: string; unsubscribed: boolean }>;
};

export function applyDripControl(state: DripFixture, verb: "pause" | "resume" | "cancel" | "unsubscribe", person = ""): { state: DripFixture; reply: string; deleted: false } {
  const next: DripFixture = {
    ...state,
    steps: [...state.steps],
    recipients: state.recipients.map((row) => ({ ...row })),
  };
  if (verb === "pause") {
    next.active = false;
    next.status = "paused";
    return { state: next, deleted: false, reply: `“${next.name}” is paused. The saved steps remain. Nothing was sent.` };
  }
  if (verb === "resume") {
    if (next.status === "cancelled") return { state: next, deleted: false, reply: `“${next.name}” is cancelled. I did not resume it or send anything.` };
    next.active = false;
    next.status = "paused";
    return { state: next, deleted: false, reply: `“${next.name}” stays off in this isolated copy. I did not start it. Nothing was sent.` };
  }
  if (verb === "cancel") {
    next.active = false;
    next.status = "cancelled";
    return { state: next, deleted: false, reply: `“${next.name}” is cancelled and still saved. Nothing was sent.` };
  }
  const target = next.recipients.find((row) => row.name.toLowerCase() === person.toLowerCase());
  if (!target) return { state: next, deleted: false, reply: `${person || "That person"} is not on this campaign. Nothing was changed or sent.` };
  target.unsubscribed = true;
  return { state: next, deleted: false, reply: `${target.name} is unsubscribed from “${next.name}”. The campaign row was not deleted. Nothing was sent.` };
}

export type BusySlot = { start: string; end: string; title: string };

function minutesOf(dayTime: string) {
  const match = dayTime.match(/T(\d{2}):(\d{2})/);
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function overlaps(start: number, end: number, otherStart: number, otherEnd: number, buffer: number) {
  return start < otherEnd + buffer && end + buffer > otherStart;
}

/** First look, then a second look. A new conflict or a closed hour blocks the booking. Nothing is booked here. */
export function reviewProposedSlot(input: {
  start: string;
  minutes: number;
  zone: string;
  expectedZone?: string;
  openMinute: number;
  closeMinute: number;
  bufferMinutes: number;
  firstLook: BusySlot[];
  secondLook: BusySlot[];
}) {
  const start = minutesOf(input.start);
  const end = start + input.minutes;
  if (start < 0) return { ok: false, booked: false, reason: "The start time could not be read. Nothing was booked." };
  if (input.zone !== (input.expectedZone || "America/Toronto")) {
    return { ok: false, booked: false, reason: `The request uses ${input.zone || "no time zone"}, which is not this advisor's configured zone ${input.expectedZone || "America/Toronto"}. A valid zone is not rejected on its own. Nothing was booked.` };
  }
  if (start < input.openMinute || end > input.closeMinute) {
    return { ok: false, booked: false, reason: "That time is outside working hours. Nothing was booked." };
  }
  const blocked = (rows: BusySlot[]) => rows.find((row) => overlaps(start, end, minutesOf(row.start), minutesOf(row.end), input.bufferMinutes));
  const first = blocked(input.firstLook);
  if (first) return { ok: false, booked: false, reason: `The first check conflicts with ${first.title}, including the ${input.bufferMinutes}-minute buffer. Nothing was booked.` };
  const second = blocked(input.secondLook);
  if (second) return { ok: false, booked: false, partial: true, reason: `The second check found ${second.title}. The first check had been clear. Nothing was booked.` };
  return { ok: true, booked: false, reason: "Both checks are clear. This isolated review did not book it." };
}
