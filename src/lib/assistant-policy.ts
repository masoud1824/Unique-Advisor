import { PLANS, type PlanId } from "./site-types.ts";

export type AssistantSettings = {
  enabled: boolean;
  instructions: string;
  plans: PlanId[];
  tools: { clients: boolean; draft: boolean; calendar: boolean; zoom: boolean; dropbox: boolean };
};

export const ASSISTANT_LOCK =
  "This assistant belongs to one advisor only. Never read or use another advisor's clients, email, calendar, Zoom, Dropbox, cards, or chats. When this advisor asks you to send an e-card, the desk matches the card and the contact and asks them to confirm. A yes sends that e-card. Do not tell them to press Approve and send for an e-card, and do not say it was sent until the desk has sent it. When this advisor asks you to create a newsletter or send a new one about a topic, call propose_newsletter. Write at least one full paragraph, 40 words or more, about each topic they named. Put each topic in its own story box with its own title. Do not use a title only, a single sentence, or a saved newsletter, and never use one named Blank. Pick a design only when the advisor names one. Otherwise leave the design empty. The desk chooses a different e-letter or newsletter template each time, not the same one again. propose_newsletter does not send. When this advisor names a group, such as life insurance clients, set tag to those words and do not pick one person. The desk checks each contact's tags and keeps only the people whose tags match. Tell them how many people matched. Use send_newsletter only when they name a newsletter that is already saved and is not blank. When this advisor asks you to send an e-letter, do not use a newsletter and do not call send_newsletter. Call send_eletter. Write the letter from what they just told you, choose one e-letter design only if they named one, and set a real title taken from their words if they did not name one. Never leave the title blank. If they did not name a design, leave it empty so a different template is chosen. send_eletter does not send. It shows the letter in its template. Tell them to press Approve and send. Do not refuse. Do not say e-cards are only for birthdays. Other emails, meetings, and Dropbox files still wait for approval unless this advisor's own rules say otherwise. Do not guess a contact, date, or time. If one of those is missing or could be more than one person, ask one short question and wait. Before sending or booking, repeat the exact contact name and wait for a yes.";

export const DEFAULT_ASSISTANT: AssistantSettings = {
  enabled: true,
  instructions:
    "You are the assistant inside Unique Advisor. Help this advisor decide who to contact and write short, plain emails. Do not give legal, tax, or product advice. If a fact is not in the records, say you do not know.",
  plans: ["professional", "team"],
  tools: { clients: true, draft: true, calendar: true, zoom: true, dropbox: true },
};

export function parseAssistantSettings(raw: unknown): AssistantSettings {
  let parsed: Partial<AssistantSettings> = {};
  if (typeof raw === "string" && raw.trim()) {
    try {
      parsed = JSON.parse(raw) as Partial<AssistantSettings>;
    } catch {
      parsed = {};
    }
  } else if (raw && typeof raw === "object") {
    parsed = raw as Partial<AssistantSettings>;
  }
  const plans = (Array.isArray(parsed.plans)
    ? parsed.plans.filter((plan): plan is PlanId => PLANS.includes(plan as PlanId) && plan !== "starter")
    : DEFAULT_ASSISTANT.plans
  ).filter((plan) => plan !== "starter");
  return {
    enabled: parsed.enabled !== false,
    instructions: String(parsed.instructions || DEFAULT_ASSISTANT.instructions).trim().slice(0, 4000) || DEFAULT_ASSISTANT.instructions,
    plans: plans.length > 0 ? plans : DEFAULT_ASSISTANT.plans,
    tools: {
      clients: parsed.tools?.clients !== false,
      draft: parsed.tools?.draft !== false,
      calendar: parsed.tools?.calendar !== false,
      zoom: parsed.tools?.zoom !== false,
      dropbox: parsed.tools?.dropbox !== false,
    },
  };
}

export function assistantGate(input: {
  status: string;
  plan: string;
  settings: AssistantSettings;
}): { ok: true } | { ok: false; error: string } {
  if (input.status === "suspended") return { ok: false, error: "This service is paused." };
  if (input.plan === "starter") return { ok: false, error: "Starter includes e-cards, newsletters, and drip campaigns. The AI assistant is on Professional and Team." };
  if (!input.settings.enabled) return { ok: false, error: "The assistant is turned off." };
  if (!PLANS.includes(input.plan as PlanId) || !input.settings.plans.includes(input.plan as PlanId)) {
    return { ok: false, error: "This plan does not include the assistant." };
  }
  return { ok: true };
}

export function decideSend(input: {
  status: string;
  plan: string;
  settings: AssistantSettings;
  actorId: number;
  draftAdvisorId: number;
  draftStatus: string;
}): { ok: true } | { ok: false; error: string } {
  const access = assistantGate(input);
  if (!access.ok) return access;
  if (!input.settings.tools.draft) return { ok: false, error: "Email drafts are turned off." };
  if (input.actorId !== input.draftAdvisorId) return { ok: false, error: "That draft belongs to another advisor." };
  if (input.draftStatus !== "pending") return { ok: false, error: "That draft was already handled." };
  return { ok: true };
}

export function decideAction(input: {
  status: string;
  plan: string;
  settings: AssistantSettings;
  actorId: number;
  actionAdvisorId: number;
  actionStatus: string;
  kind: "zoom" | "calendar" | "dropbox" | "newsletter" | "card" | "eletter" | "campaign";
}): { ok: true } | { ok: false; error: string } {
  const access = assistantGate(input);
  if (!access.ok) return access;
  const allowed = input.kind === "newsletter" || input.kind === "card" || input.kind === "eletter" || input.kind === "campaign"
    ? input.settings.tools.clients
    : input.kind === "dropbox"
      ? input.settings.tools.dropbox
      : input.kind === "zoom"
        ? input.settings.tools.zoom
        : input.settings.tools.calendar;
  if (!allowed) return { ok: false, error: "That connection is turned off." };
  if (input.actorId !== input.actionAdvisorId) return { ok: false, error: "That request belongs to another advisor." };
  if (input.actionStatus !== "pending") return { ok: false, error: "That request was already handled." };
  return { ok: true };
}
