import { approvalFingerprint, approvalStillValid, contactDeliveryBlock, type DeliveryPacket } from "./desk-workflows.ts";
import { applyCancellation, applyDripControl, reviewProposedSlot, type BusySlot, type DripFixture, type FixtureDraft, type FixtureLetter } from "./delivery-safeguards.ts";
import { noticesToCreate, planReplyNotices, type ThreadMessage } from "./document-mail.ts";
import { ISOLATED_EXTERNAL_BLOCK } from "./isolated-test-desk.ts";

export type CancelStore = {
  listDrafts(): Promise<FixtureDraft[]>;
  listLetters(): Promise<FixtureLetter[]>;
  writeDraft(row: FixtureDraft): Promise<void>;
  listActions(): Promise<Array<{ id: number; status: string; kind: string }>>;
  writeAction(row: { id: number; status: string; kind: string }): Promise<void>;
};

/** The cancel path used by the desk. It updates status and never removes a saved row. */
export async function runDeskCancellation(store: CancelStore, actionStatus = "discarded") {
  const drafts = await store.listDrafts();
  const letters = await store.listLetters();
  const letterSnapshot = JSON.stringify(letters);
  const decision = applyCancellation(drafts, letters);
  if (decision.deletesRows || decision.deletedDraftIds.length || decision.deletedLetterIds.length) {
    return { ok: false as const, error: "Refusing to delete saved rows.", drafts, letters };
  }
  for (const row of decision.drafts) await store.writeDraft(row);
  const actions = await store.listActions();
  for (const action of actions) {
    if (action.status === "pending") await store.writeAction({ ...action, status: actionStatus });
  }
  const afterLetters = await store.listLetters();
  const afterDrafts = await store.listDrafts();
  if (JSON.stringify(afterLetters) !== letterSnapshot) {
    return { ok: false as const, error: "Saved letters changed during cancellation.", drafts: afterDrafts, letters: afterLetters };
  }
  if (afterDrafts.length !== drafts.length || afterLetters.length !== letters.length) {
    return { ok: false as const, error: "A saved row was removed during cancellation.", drafts: afterDrafts, letters: afterLetters };
  }
  return { ok: true as const, drafts: afterDrafts, letters: afterLetters, actionStatus };
}

export type MailPerson = { id?: number; name: string; email: string };

/** Newsletter, card, letter, and campaign sends call this once per recipient. */
export async function deliverApproved(input: {
  approved: DeliveryPacket;
  current: DeliveryPacket;
  isolated: boolean;
  outcomes: Record<string, "sent" | "failed" | "unknown">;
  saveOutcome: (email: string, outcome: "sent" | "failed" | "unknown") => Promise<void>;
  sendOne: (person: MailPerson) => Promise<{ ok: boolean; unknown?: boolean; error?: string }>;
}) {
  const sent: string[] = [];
  const skipped: string[] = [];
  const failed: Array<{ email: string; error?: string }> = [];
  const unknown: string[] = [];
  if (!approvalStillValid(approvalFingerprint(input.approved), input.current)) {
    return {
      ok: false as const,
      reason: "Approval no longer applies because the content, attachment, or recipients changed. Nothing was sent.",
      sent, skipped, failed, unknown, calls: 0,
    };
  }
  let calls = 0;
  for (const person of input.current.recipients) {
    const email = String(person.email || "");
    const prior = input.outcomes[email.toLowerCase()];
    if (prior === "sent") {
      skipped.push(email);
      continue;
    }
    if (prior === "unknown") {
      unknown.push(email);
      continue;
    }
    if (input.isolated) continue;
    await input.saveOutcome(email, "unknown");
    input.outcomes[email.toLowerCase()] = "unknown";
    calls += 1;
    try {
      const result = await input.sendOne(person as MailPerson);
      if (result.unknown) {
        unknown.push(email);
        continue;
      }
      if (result.ok) {
        await input.saveOutcome(email, "sent");
        input.outcomes[email.toLowerCase()] = "sent";
        sent.push(email);
      } else {
        await input.saveOutcome(email, "failed");
        input.outcomes[email.toLowerCase()] = "failed";
        failed.push({ email, error: result.error });
      }
    } catch {
      unknown.push(email);
    }
  }
  if (input.isolated) {
    return { ok: false as const, reason: ISOLATED_EXTERNAL_BLOCK, sent, skipped, failed, unknown, calls: 0 };
  }
  const reason = unknown.length
    ? "Some recipients have an unknown delivery result. They were not sent again."
    : failed.length
      ? "Some recipients were not accepted. Successful recipients will not be sent again."
      : skipped.length && sent.length === 0
        ? "Every recipient already succeeded. Nothing was sent again."
        : "Accepted one recipient at a time by the injected provider.";
  return { ok: failed.length === 0 && unknown.length === 0 && sent.length + skipped.length > 0, reason, sent, skipped, failed, unknown, calls };
}

export type DripContact = { id: number; full_name: string; email: string; tags: string };

/** sendDripStep calls this. Isolation returns before the mail callback. */
export async function dispatchDripStep(input: {
  isolated: boolean;
  contacts: DripContact[];
  chosenIds: number[];
  tag: string;
  priorSent: string[];
  send: (contact: DripContact) => Promise<{ ok: boolean; error?: string }>;
}) {
  const chosen = new Set(input.chosenIds);
  const tag = input.tag.trim().toLowerCase();
  const scope = input.contacts.filter((contact) => {
    if (chosen.size > 0) return chosen.has(Number(contact.id));
    return Boolean(tag) && contact.tags.split(",").some((item) => item.trim().toLowerCase() === tag);
  });
  const blocked = scope.flatMap((contact) => {
    const reason = contactDeliveryBlock(contact.tags, contact.email);
    return reason ? [{ name: contact.full_name, email: contact.email, reason }] : [];
  });
  const eligible = scope.filter((contact) => !contactDeliveryBlock(contact.tags, contact.email));
  const prior = new Set(input.priorSent.map((email) => email.toLowerCase()));
  const retry = eligible.filter((contact) => !prior.has(contact.email.toLowerCase()));
  const skipped = eligible.filter((contact) => prior.has(contact.email.toLowerCase())).map((contact) => contact.email);
  if (input.isolated) {
    return { ok: false as const, error: ISOLATED_EXTERNAL_BLOCK, sent: [] as string[], skipped, blocked, calls: 0 };
  }
  const sent: string[] = [];
  const failed: Array<{ email: string; error?: string }> = [];
  for (const contact of retry) {
    const result = await input.send(contact);
    if (result.ok) sent.push(contact.email);
    else failed.push({ email: contact.email, error: result.error });
  }
  return {
    ok: failed.length === 0 && sent.length > 0,
    error: failed.length ? "Some recipients were not accepted. Successful recipients will not be sent again." : "",
    sent,
    skipped,
    blocked,
    failed,
    calls: retry.length,
  };
}

export function controlSavedDrip(state: DripFixture, verb: "pause" | "resume" | "cancel" | "unsubscribe" | "status", person = "") {
  if (verb === "status") {
    return {
      state,
      deleted: false as const,
      started: false as const,
      reply: `“${state.name}” is saved and ${state.active ? "active" : "not active"}. Nothing was started or sent.`,
    };
  }
  const result = applyDripControl(state, verb, person);
  return { ...result, started: false as const };
}

export async function ingestDocumentReplies(input: {
  conversationId: string;
  sentMessageId: string;
  sender: string;
  seenIds: string[];
  messages: ThreadMessage[];
  remember: (notice: { messageId: string; body: string }) => Promise<boolean>;
}) {
  const planned = planReplyNotices({
    conversationId: input.conversationId,
    sentMessageId: input.sentMessageId,
    sender: input.sender,
    seen: input.seenIds,
    messages: input.messages,
  });
  const created = noticesToCreate(planned, input.seenIds);
  let stored = 0;
  for (const notice of created) {
    if (await input.remember(notice)) stored += 1;
  }
  return { stored, created };
}

/** placePending calls this before any Zoom or Outlook token is read. */
export async function reviewAndBook(input: {
  start: string;
  minutes: number;
  zone: string;
  officeZone: string;
  openMinute?: number;
  closeMinute?: number;
  bufferMinutes?: number;
  hoursSource?: string;
  isolated: boolean;
  loadEvents: () => Promise<BusySlot[]>;
  commit: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const firstLook = await input.loadEvents();
  const secondLook = await input.loadEvents();
  const hoursSource = input.hoursSource || "fixed default 09:00-17:00 with a 15-minute buffer; not a saved advisor setting";
  const reviewed = reviewProposedSlot({
    start: input.start,
    minutes: input.minutes,
    zone: input.zone,
    expectedZone: input.officeZone,
    openMinute: input.openMinute ?? 9 * 60,
    closeMinute: input.closeMinute ?? 17 * 60,
    bufferMinutes: input.bufferMinutes ?? 15,
    firstLook,
    secondLook,
  });
  if (!reviewed.ok) return { ...reviewed, commitCalled: false, hoursSource };
  if (input.isolated) return { ok: false as const, booked: false as const, reason: ISOLATED_EXTERNAL_BLOCK, commitCalled: false, hoursSource };
  const committed = await input.commit();
  return {
    ok: committed.ok,
    booked: committed.ok,
    reason: committed.ok ? "The injected calendar provider accepted the booking." : (committed.error || "The booking was not completed."),
    commitCalled: true,
    hoursSource,
  };
}
