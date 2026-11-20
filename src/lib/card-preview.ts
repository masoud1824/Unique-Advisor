import { CARDS, personalize, type CardTemplate } from "./catalog.ts";
import { cardTitleHint, matchCardByName } from "./advisor-intent.ts";
import { claimDelivery } from "./desk-workflows.ts";

export type CardContact = {
  name: string;
  email: string;
  tags: string[];
  unsubscribed: boolean;
  source: "database" | "dropbox";
};

export const DROPBOX_CONTACT_SOURCE = "/Unique Advisor/Assistant Test/fictional-contacts.txt";
export const CARD_APPROVAL = "I approve this exact card preview";

export const FICTIONAL_CARD_CONTACTS: CardContact[] = [
  { name: "Casey Sample", email: "casey.sample@example.invalid", tags: ["Life Insurance Client"], unsubscribed: false, source: "database" },
  { name: "Riley Sample", email: "riley.sample@example.invalid", tags: ["Life Insurance Client"], unsubscribed: false, source: "database" },
  { name: "Quinn Sample", email: "quinn.sample@example.invalid", tags: ["Life Insurance Client"], unsubscribed: true, source: "database" },
  { name: "Avery Sample", email: "", tags: ["Life Insurance Client"], unsubscribed: false, source: "database" },
  { name: "Morgan Sample", email: "morgan.sample@example.invalid", tags: ["TFSA Client"], unsubscribed: false, source: "database" },
  { name: "Jordan Example", email: "jordan.example@example.invalid", tags: ["Life Insurance Client"], unsubscribed: false, source: "dropbox" },
  { name: "Quinn Sample", email: "quinn.sample@example.invalid", tags: ["Life Insurance Client"], unsubscribed: true, source: "dropbox" },
];

const memory = globalThis as { __uaCardSim?: Set<string>; __uaCardRequest?: Map<number, string> };

export function rememberCardRequest(advisorId: number, request: string) {
  if (!memory.__uaCardRequest) memory.__uaCardRequest = new Map();
  memory.__uaCardRequest.set(advisorId, request);
}

export function rememberedCardRequest(advisorId: number) {
  return memory.__uaCardRequest?.get(advisorId) || "";
}

export function cardSimulationStore() {
  if (!memory.__uaCardSim) memory.__uaCardSim = new Set();
  return memory.__uaCardSim;
}

const TAG_SKIP = new Set(["a", "an", "the", "to", "for", "from", "my", "this", "client", "clients", "contact", "contacts", "customer", "customers", "group", "tagged", "tag", "greeting", "greetings", "send", "fictional", "database", "dropbox", "card", "cards", "newsletter", "newsletters"]);

export function cardSource(request: string): "database" | "dropbox" {
  return /\bdropbox\b|\bfictional-contacts\.txt\b/i.test(request) ? "dropbox" : "database";
}

export function chooseCardDesign(request: string, designs: CardTemplate[] = CARDS) {
  const hinted = cardTitleHint(request);
  const pool = designs.map((card) => ({ id: card.id, title: card.title }));
  const matched = matchCardByName(hinted || request, pool);
  if (matched && "card" in matched) {
    const design = designs.find((card) => card.id === matched.card.id);
    if (design) return { ok: true as const, design };
  }
  if (matched && "cards" in matched) {
    return { ok: false as const, error: `Which design should I use: ${matched.cards.map((card) => card.title).join(", ")}? Nothing was sent.` };
  }
  return { ok: false as const, error: `Which existing design should I use: ${designs.map((card) => card.title).join(", ")}? Nothing was sent.` };
}

function tagWords(phrase: string) {
  return phrase.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word && !TAG_SKIP.has(word));
}

function tagMatches(tags: string[], phrase: string) {
  const words = tagWords(phrase);
  if (words.length === 0) return false;
  return tags.some((tag) => {
    const text = tag.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

function recordedNames(request: string, contacts: CardContact[]) {
  const folded = request.toLowerCase();
  return contacts.filter((contact) => folded.includes(contact.name.toLowerCase()));
}

export function planCardPreview(input: {
  request: string;
  sender: string;
  contacts?: CardContact[];
  designs?: CardTemplate[];
  alreadySent?: string[];
}) {
  const contacts = input.contacts || FICTIONAL_CARD_CONTACTS;
  const source = cardSource(input.request);
  const sender = input.sender.trim();
  if (!sender.includes("@")) return { ok: false as const, error: "This advisor has no sender address. Nothing was sent." };
  const chosen = chooseCardDesign(input.request, input.designs);
  if (!chosen.ok) return chosen;
  const pool = contacts.filter((contact) => contact.source === source);
  const names = recordedNames(input.request, pool);
  const uniqueNames = [...new Map(names.map((contact) => [contact.name.toLowerCase(), contact])).values()];
  const groupPhrase = input.request.match(/\b([a-z0-9]+(?:\s+[a-z0-9]+){0,3}\s+clients?)\b/i)?.[1] || "";
  let selected: CardContact[] = [];
  let outside: CardContact[] = [];
  if (uniqueNames.length > 0) {
    selected = uniqueNames;
  } else if (groupPhrase && tagWords(groupPhrase).length > 0) {
    selected = pool.filter((contact) => tagMatches(contact.tags, groupPhrase));
    outside = pool.filter((contact) => !selected.includes(contact));
  } else {
    return { ok: false as const, error: "Name a recorded contact or a recorded group. I did not invent a recipient, and nothing was sent." };
  }
  const sent = new Set(input.alreadySent || []);
  const exclusions: string[] = [];
  const recipients: CardContact[] = [];
  for (const contact of selected) {
    const address = contact.email.trim().toLowerCase();
    if (contact.unsubscribed) {
      exclusions.push(`${contact.name}${address ? ` <${address}>` : ""} — Unsubscribed.`);
      continue;
    }
    if (!address) {
      exclusions.push(`${contact.name} — No email is recorded.`);
      continue;
    }
    const key = `${chosen.design.id}|${address}`;
    if (sent.has(key)) {
      exclusions.push(`${contact.name} <${address}> — This design was already sent to this address.`);
      continue;
    }
    recipients.push({ ...contact, email: address });
  }
  const messages = recipients.map((contact) => `${contact.name}: ${personalize(chosen.design.message, contact.name).replace(/\s+/g, " ").trim()}`);
  const preview = [
    "Simulated card preview. Nothing has been sent.",
    `Design: ${chosen.design.title}`,
    `Image: ${chosen.design.image}`,
    `Sender: ${sender}`,
    `Source: ${source === "dropbox" ? `Dropbox contact file ${DROPBOX_CONTACT_SOURCE}` : "Unique Advisor database"} (fictional records only).`,
    "Message template:",
    chosen.design.message,
    recipients.length ? `Personalized from recorded names:\n${messages.join("\n")}` : "Personalized from recorded names: none.",
    `Recipients (${recipients.length}):`,
    recipients.map((contact) => `- ${contact.name} <${contact.email}>`).join("\n") || "- none",
    "Exclusions:",
    exclusions.map((line) => `- ${line}`).join("\n") || "- none",
    outside.length ? `Not selected, because the recorded tag does not match:\n${outside.map((contact) => `- ${contact.name}: ${contact.tags.join(", ") || "no tag recorded"}`).join("\n")}` : "Not selected, because the recorded tag does not match: none.",
    `Recipient count: ${recipients.length}`,
    `Say “${CARD_APPROVAL}” to simulate this exact delivery. Real email stays blocked.`,
  ].join("\n");
  return {
    ok: true as const,
    design: chosen.design,
    sender,
    source,
    recipients,
    exclusions,
    outside,
    count: recipients.length,
    preview,
  };
}

export function recordedAudience(input: {
  request: string;
  contacts?: CardContact[];
  alreadySent?: string[];
  sentPrefix: string;
  alreadySentReason: string;
}) {
  const contacts = input.contacts || FICTIONAL_CARD_CONTACTS;
  const source = cardSource(input.request);
  const pool = contacts.filter((contact) => contact.source === source);
  const names = recordedNames(input.request, pool);
  const uniqueNames = [...new Map(names.map((contact) => [contact.name.toLowerCase(), contact])).values()];
  const groupPhrase = input.request.match(/\b([a-z0-9]+(?:\s+[a-z0-9]+){0,3}\s+clients?)\b/i)?.[1] || "";
  let selected: CardContact[] = [];
  let outside: CardContact[] = [];
  if (uniqueNames.length > 0) {
    selected = uniqueNames;
  } else if (groupPhrase && tagWords(groupPhrase).length > 0) {
    selected = pool.filter((contact) => tagMatches(contact.tags, groupPhrase));
    outside = pool.filter((contact) => !selected.includes(contact));
  } else {
    return { ok: false as const, error: "Name a recorded contact or a recorded group. I did not invent a recipient, and nothing was sent." };
  }
  const sent = new Set(input.alreadySent || []);
  const exclusions: string[] = [];
  const recipients: CardContact[] = [];
  for (const contact of selected) {
    const address = contact.email.trim().toLowerCase();
    if (contact.unsubscribed) {
      exclusions.push(`${contact.name}${address ? ` <${address}>` : ""} — Unsubscribed.`);
      continue;
    }
    if (!address) {
      exclusions.push(`${contact.name} — No email is recorded.`);
      continue;
    }
    if (sent.has(`${input.sentPrefix}|${address}`)) {
      exclusions.push(`${contact.name} <${address}> — ${input.alreadySentReason}`);
      continue;
    }
    recipients.push({ ...contact, email: address });
  }
  return { ok: true as const, source, recipients, exclusions, outside, count: recipients.length };
}

export function simulateCardDelivery(input: {
  request: string;
  sender: string;
  approval: string;
  contacts?: CardContact[];
  sent?: Set<string>;
}) {
  const planned = planCardPreview({ request: input.request, sender: input.sender, contacts: input.contacts, alreadySent: [...(input.sent || [])] });
  if (!planned.ok) return { ...planned, simulated: false as const, emailed: false as const };
  if (input.approval.trim() !== CARD_APPROVAL) return { ok: false as const, simulated: false as const, emailed: false as const, error: "This card has not been approved. Nothing was sent." };
  if (planned.count === 0) return { ok: false as const, simulated: false as const, emailed: false as const, error: "Nobody remains after the exclusions. Nothing was sent." };
  const fingerprint = [planned.design.id, planned.sender, planned.source, ...planned.recipients.map((contact) => contact.email)].join("|");
  const store = input.sent || new Set<string>();
  const claimed = claimDelivery(store, fingerprint, () => ({ ok: true as const, detail: "simulated" }));
  if (!claimed.ok) return { ok: false as const, simulated: false as const, emailed: false as const, error: "This exact card was already simulated. It was not sent again." };
  for (const contact of planned.recipients) store.add(`${planned.design.id}|${contact.email}`);
  return {
    ok: true as const,
    simulated: true as const,
    emailed: false as const,
    count: planned.count,
    detail: `Simulated the ${planned.design.title} design to ${planned.count} fictional recipient${planned.count === 1 ? "" : "s"}. No email was sent.`,
  };
}
