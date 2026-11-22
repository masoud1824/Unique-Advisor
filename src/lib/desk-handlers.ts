import { type DeliveryPacket } from "./desk-workflows.ts";
import { asksCampaignControl, campaignControlVerb, namedPeople } from "./delivery-audience.ts";
import { ISOLATED_EXTERNAL_BLOCK } from "./isolated-test-desk.ts";
import { controlSavedDrip, deliverApproved, ingestDocumentReplies, reviewAndBook, runDeskCancellation, type CancelStore } from "./workflow-entry.ts";
import type { ThreadMessage } from "./document-mail.ts";
import type { BusySlot, DripFixture } from "./delivery-safeguards.ts";

export type RecipientOutcome = "sent" | "failed" | "unknown";

export type DisposableContact = { id: number; full_name: string; email: string; tags: string };

export type DeliveryIo = {
  isolated: boolean;
  practiceDatabase?: false;
  recipients: (ids: number[]) => Promise<DisposableContact[]>;
  outcomes: Record<string, RecipientOutcome>;
  saveOutcome: (email: string, outcome: RecipientOutcome) => Promise<void>;
  sendOne: (person: { id?: number; name: string; email: string }) => Promise<{ ok: boolean; unknown?: boolean; error?: string }>;
  allowStart?: boolean;
};

const FIXED_HOURS = "fixed default 09:00-17:00 with a 15-minute buffer; not a saved advisor setting";

function readPayload(payload: unknown) {
  if (payload && typeof payload === "object") return payload as Record<string, unknown>;
  try {
    return JSON.parse(String(payload || "{}")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asPacket(value: unknown): DeliveryPacket | null {
  if (!value || typeof value !== "object") return null;
  const row = value as DeliveryPacket;
  if (!row.kind || !Array.isArray(row.recipients)) return null;
  return row;
}

export async function sendProposedNewsletter(input: { payload: unknown }, io: DeliveryIo) {
  const parsed = readPayload(input.payload);
  const articles = Array.isArray(parsed.articles) ? parsed.articles : [];
  const title = String(parsed.title || "");
  if (!title || articles.length === 0) return { ok: false as const, error: "That newsletter could not be read." };
  const ids = (Array.isArray(parsed.contactIds) ? parsed.contactIds : []).map(Number).filter((id) => id > 0);
  if (ids.length === 0) return { ok: false as const, error: "That newsletter has no recipients." };
  const rows = await io.recipients(ids);
  const current: DeliveryPacket = {
    kind: "newsletter",
    recipients: rows.map((row) => ({ id: row.id, name: row.full_name, email: row.email })),
    subject: title,
    design: String(parsed.design || ""),
    body: JSON.stringify(articles),
    attachments: parsed.attachmentHash ? [String(parsed.attachmentHash)] : [],
  };
  const approved = asPacket(parsed.approvedSnapshot) || current;
  const outcome = await deliverApproved({ approved, current, isolated: io.isolated, outcomes: io.outcomes, saveOutcome: io.saveOutcome, sendOne: io.sendOne });
  if (!outcome.ok) return { ...outcome, ok: false as const, error: outcome.reason };
  return { ...outcome, ok: true as const, detail: `${title} was handed to the provider one recipient at a time.` };
}

export async function sendQueuedCard(input: { payload: unknown }, io: DeliveryIo) {
  const parsed = readPayload(input.payload);
  const title = String(parsed.title || "").trim();
  const ids = (Array.isArray(parsed.contactIds) ? parsed.contactIds : []).map(Number).filter((id) => id > 0);
  if (!title || ids.length === 0) return { ok: false as const, error: "That e-card could not be sent." };
  const rows = await io.recipients(ids);
  const current: DeliveryPacket = {
    kind: "card",
    recipients: rows.map((row) => ({ id: row.id, name: row.full_name, email: row.email })),
    subject: title,
    design: title,
    body: String(parsed.message || ""),
    attachments: parsed.image ? [String(parsed.image)] : [],
  };
  const approved = asPacket(parsed.approvedSnapshot) || current;
  const outcome = await deliverApproved({ approved, current, isolated: io.isolated, outcomes: io.outcomes, saveOutcome: io.saveOutcome, sendOne: io.sendOne });
  if (!outcome.ok) return { ...outcome, ok: false as const, error: outcome.reason };
  return { ...outcome, ok: true as const, detail: `${title} was handed to the provider one recipient at a time.` };
}

export async function sendQueuedEletter(input: { payload: unknown }, io: DeliveryIo) {
  const parsed = readPayload(input.payload);
  const title = String(parsed.title || "").trim();
  const body = String(parsed.body || "").trim();
  const ids = (Array.isArray(parsed.contactIds) ? parsed.contactIds : []).map(Number).filter((id) => id > 0);
  if (!title || body.length < 2 || ids.length === 0) return { ok: false as const, error: "That e-letter could not be sent." };
  const rows = await io.recipients(ids);
  const current: DeliveryPacket = {
    kind: "letter",
    recipients: rows.map((row) => ({ id: row.id, name: row.full_name, email: row.email })),
    subject: title,
    design: String(parsed.design || ""),
    body,
    attachments: parsed.attachmentHash ? [String(parsed.attachmentHash)] : [],
  };
  const approved = asPacket(parsed.approvedSnapshot) || current;
  const outcome = await deliverApproved({ approved, current, isolated: io.isolated, outcomes: io.outcomes, saveOutcome: io.saveOutcome, sendOne: io.sendOne });
  if (!outcome.ok) return { ...outcome, ok: false as const, error: outcome.reason };
  return { ...outcome, ok: true as const, detail: `${title} was handed to the provider one recipient at a time.` };
}

export async function runQueuedCampaign(input: { payload: unknown }, io: DeliveryIo) {
  const parsed = readPayload(input.payload);
  const ids = (Array.isArray(parsed.contactIds) ? parsed.contactIds : []).map(Number).filter((id) => id > 0);
  const rows = await io.recipients(ids);
  const current: DeliveryPacket = {
    kind: "campaign",
    recipients: rows.map((row) => ({ id: row.id, name: row.full_name, email: row.email })),
    subject: String(parsed.name || "Campaign"),
    design: String(parsed.design || ""),
    body: JSON.stringify(parsed.steps || []),
    attachments: [String(parsed.everyDays || "")],
  };
  const approved = asPacket(parsed.approvedSnapshot) || current;
  const started = io.allowStart === true && !io.isolated;
  const outcome = await deliverApproved({
    approved,
    current,
    isolated: io.isolated || !started,
    outcomes: io.outcomes,
    saveOutcome: io.saveOutcome,
    sendOne: io.sendOne,
  });
  return {
    ...outcome,
    ok: outcome.ok,
    error: outcome.ok ? "" : outcome.reason,
    started: false as const,
    practiceCampaignStarted: false as const,
  };
}

export async function sendDripStep(row: { name?: string; steps?: string; tag?: string; contact_ids?: string }, index: number, io: {
  isolated: boolean;
  contacts: DisposableContact[];
  outcomes: Record<string, RecipientOutcome>;
  saveOutcome: (email: string, outcome: RecipientOutcome) => Promise<void>;
  send: (contact: DisposableContact, step?: { title: string; body: string }) => Promise<{ ok: boolean; unknown?: boolean; error?: string }>;
}) {
  let steps: Array<{ title?: string; body?: string }> = [];
  try { steps = JSON.parse(String(row.steps || "[]")); } catch { steps = []; }
  const step = steps[index];
  if (!step || (!String(step.title || "").trim() && !String(step.body || "").trim())) {
    return { ok: false as const, error: "This article is still blank, so it was not emailed.", calls: 0, sent: [] as string[], unknown: [] as string[] };
  }
  const chosen = (() => {
    try {
      const list = JSON.parse(String(row.contact_ids || "[]"));
      return Array.isArray(list) ? list.map(Number) : [];
    } catch { return []; }
  })();
  const tag = String(row.tag || "").trim().toLowerCase();
  const scope = io.contacts.filter((contact) => {
    if (chosen.length > 0) return chosen.includes(Number(contact.id));
    return Boolean(tag) && contact.tags.split(",").some((item) => item.trim().toLowerCase() === tag);
  });
  const blocked = scope.filter((contact) => /unsubscribed/i.test(contact.tags) || !String(contact.email || "").trim());
  const eligible = scope.filter((contact) => !blocked.includes(contact));
  if (io.isolated) {
    return { ok: false as const, error: ISOLATED_EXTERNAL_BLOCK, calls: 0, sent: [] as string[], unknown: [] as string[], blocked: blocked.map((item) => item.full_name) };
  }
  const sent: string[] = [];
  const unknown: string[] = [];
  const failed: string[] = [];
  let calls = 0;
  for (const contact of eligible) {
    const prior = io.outcomes[contact.email.toLowerCase()];
    if (prior === "sent" || prior === "unknown") {
      if (prior === "unknown") unknown.push(contact.email);
      continue;
    }
    await io.saveOutcome(contact.email, "unknown");
    io.outcomes[contact.email.toLowerCase()] = "unknown";
    calls += 1;
    try {
      const result = await io.send(contact, { title: String(step.title || ""), body: String(step.body || "") });
      if (result.unknown) {
        unknown.push(contact.email);
        continue;
      }
      if (result.ok) {
        await io.saveOutcome(contact.email, "sent");
        io.outcomes[contact.email.toLowerCase()] = "sent";
        sent.push(contact.email);
      } else {
        await io.saveOutcome(contact.email, "failed");
        io.outcomes[contact.email.toLowerCase()] = "failed";
        failed.push(contact.email);
      }
    } catch {
      unknown.push(contact.email);
    }
  }
  return { ok: failed.length === 0 && unknown.length === 0 && sent.length > 0, calls, sent, unknown, failed, blocked: blocked.map((item) => item.full_name) };
}

function fold(value: string) {
  return String(value || "").toLowerCase().replace(/[—–-]/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export async function holdCampaign(text: string, store: {
  practiceDatabase?: false;
  campaigns: Array<{ id: number; name: string; steps: string; active: boolean; every_days?: number }>;
  contacts: DisposableContact[];
}) {
  const names = store.campaigns.map((row) => row.name);
  const asked = fold(text);
  const match = names.filter((name) => asked.includes(fold(name))).sort((left, right) => right.length - left.length)[0] || "";
  if (!asksCampaignControl(text) || !match) {
    return { ok: false as const, reply: "Which saved campaign should I check? Nothing was started or sent.", changedContactIds: [] as number[], deleted: false as const, started: false as const };
  }
  const campaign = store.campaigns.find((row) => row.name === match)!;
  const verb = campaignControlVerb(text);
  const person = store.contacts.find((row) => asked.includes(fold(row.full_name)))?.full_name || namedPeople(text)[0] || "";
  let steps: Array<{ title?: string }> = [];
  try { steps = JSON.parse(campaign.steps || "[]"); } catch { steps = []; }
  const fixture: DripFixture = {
    id: campaign.id,
    name: campaign.name,
    active: campaign.active,
    status: campaign.active ? "saved" : "paused",
    steps: steps.map((step) => String(step.title || "Article")),
    recipients: store.contacts.map((contact) => ({ name: contact.full_name, email: contact.email, unsubscribed: /unsubscribed/i.test(contact.tags) })),
  };
  const decision = controlSavedDrip(fixture, verb, person);
  campaign.active = false;
  const changedContactIds: number[] = [];
  if (verb === "unsubscribe" && person) {
    const contact = store.contacts.find((row) => row.full_name.toLowerCase() === person.toLowerCase());
    if (contact && !/unsubscribed/i.test(contact.tags)) {
      contact.tags = `${contact.tags}, Unsubscribed`;
      changedContactIds.push(contact.id);
    }
  }
  return {
    ok: true as const,
    reply: decision.reply,
    verb,
    changedContactIds,
    deleted: false as const,
    started: false as const,
    campaignId: campaign.id,
    active: campaign.active,
    steps: fixture.steps,
  };
}

export async function checkDocumentReplies(io: {
  isolated: boolean;
  conversationId: string;
  sentMessageId: string;
  sender: string;
  seenIds: string[];
  messages: ThreadMessage[];
  remember: (notice: { messageId: string; body: string }) => Promise<boolean>;
}) {
  if (io.isolated) return { ok: false as const, checked: 0, stored: 0, error: ISOLATED_EXTERNAL_BLOCK, providerCalled: false as const };
  const ingested = await ingestDocumentReplies(io);
  return { ok: true as const, checked: 1, stored: ingested.stored, created: ingested.created.map((item) => item.messageId), providerCalled: false as const };
}

export type BookingRecord = { id: string; join: string; invitation: RecipientOutcome | "not-sent" };

export async function placePending(pending: { local_start: string; minutes: number; time_zone: string; label?: string }, io: {
  isolated: boolean;
  officeZone: string;
  openMinute?: number;
  closeMinute?: number;
  bufferMinutes?: number;
  hoursSource?: string;
  loadEvents: () => Promise<BusySlot[]>;
  findBooking: () => Promise<BookingRecord | null>;
  createMeeting: () => Promise<{ ok: boolean; id?: string; join?: string; error?: string }>;
  sendInvitation: (booking: BookingRecord) => Promise<{ ok: boolean; unknown?: boolean; error?: string }>;
  saveBooking: (booking: BookingRecord) => Promise<void>;
}) {
  const existing = await io.findBooking();
  if (existing) {
    if (existing.invitation === "unknown") {
      return { ok: false as const, booked: true, created: false, invitation: "unknown" as const, reason: "The meeting already exists and the invitation outcome is unknown. I did not create another meeting or send another invitation.", commitCalled: false, providerCreates: 0 };
    }
    if (existing.invitation === "sent") {
      return { ok: true as const, booked: true, created: false, invitation: "sent" as const, reason: "Already booked. I did not book it again.", commitCalled: false, providerCreates: 0 };
    }
    const invite = await io.sendInvitation(existing);
    const invitation = invite.unknown ? "unknown" as const : invite.ok ? "sent" as const : "failed" as const;
    await io.saveBooking({ ...existing, invitation });
    return {
      ok: invite.ok,
      booked: true,
      created: false,
      invitation,
      reason: invite.ok ? "The existing meeting was kept. The invitation was sent. No second meeting was created." : "The existing meeting was kept. The invitation did not succeed. No second meeting was created.",
      commitCalled: false,
      providerCreates: 0,
    };
  }
  const reviewed = await reviewAndBook({
    start: pending.local_start,
    minutes: pending.minutes,
    zone: pending.time_zone,
    officeZone: io.officeZone,
    openMinute: io.openMinute,
    closeMinute: io.closeMinute,
    bufferMinutes: io.bufferMinutes,
    hoursSource: io.hoursSource || FIXED_HOURS,
    isolated: io.isolated,
    loadEvents: io.loadEvents,
    commit: async () => ({ ok: true }),
  });
  if (!reviewed.ok || reviewed.commitCalled !== true) {
    return { ok: false as const, booked: false, created: false, reason: reviewed.reason, hoursSource: reviewed.hoursSource, commitCalled: false, providerCreates: 0 };
  }
  const created = await io.createMeeting();
  if (!created.ok || !created.id) {
    return { ok: false as const, booked: false, created: false, reason: created.error || "The meeting was not created.", providerCreates: 1 };
  }
  const booking: BookingRecord = { id: created.id, join: created.join || "", invitation: "unknown" };
  await io.saveBooking(booking);
  let invite: { ok: boolean; unknown?: boolean; error?: string };
  try {
    invite = await io.sendInvitation(booking);
  } catch {
    return { ok: false as const, booked: true, created: true, invitation: "unknown" as const, bookingId: booking.id, reason: "The meeting was created, but the invitation outcome is unknown. I will not create another meeting.", providerCreates: 1 };
  }
  if (invite.unknown) {
    return { ok: false as const, booked: true, created: true, invitation: "unknown" as const, bookingId: booking.id, reason: "The meeting was created, but the invitation outcome is unknown. I will not create another meeting.", providerCreates: 1 };
  }
  booking.invitation = invite.ok ? "sent" : "failed";
  await io.saveBooking(booking);
  if (!invite.ok) {
    return { ok: false as const, booked: true, created: true, invitation: "failed" as const, bookingId: booking.id, reason: `The meeting was created (${booking.id}). The invitation failed. A retry will not create a second meeting. ${invite.error || ""}`.trim(), providerCreates: 1 };
  }
  return { ok: true as const, booked: true, created: true, invitation: "sent" as const, bookingId: booking.id, join: booking.join, reason: "Booked once. The invitation was sent.", providerCreates: 1 };
}

export async function cancelPendingDesk(store: CancelStore, actionStatus = "discarded") {
  return runDeskCancellation(store, actionStatus);
}

export { FIXED_HOURS };
