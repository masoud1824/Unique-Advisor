export type TaskRule = { id: string; category: string; text: string; on: boolean };

export const SECRETARY_RULES: TaskRule[] = [
  {
    id: "cards",
    category: "E-cards",
    on: true,
    text: "When I ask to send an e-card, including season's greeting, seasons greeting, or thank you, match the card and the contact, show the confirmation, and send it when I say yes. If more than one card fits, ask which card I mean. Do not send it before I confirm.",
  },
  {
    id: "newsletters",
    category: "Newsletters",
    on: true,
    text: "When I ask for a newsletter, write one full article for every topic I name, including several topics and several people in one request. Show it, then send it only after I say yes.",
  },
  {
    id: "eletters",
    category: "E-letters",
    on: true,
    text: "When I ask for an e-letter, write it from what I said for one contact or a list, show it, and send it only after I say yes.",
  },
  {
    id: "campaigns",
    category: "Drip campaigns",
    on: true,
    text: "When I ask to run a drip campaign, use a campaign already on this desk, for one contact, several contacts, or a tag. Confirm who and how often, then start it only after I say yes.",
  },
  {
    id: "inbox",
    category: "Email",
    on: true,
    text: "When I ask to read my email, show the latest inbox messages and the mail this desk has sent. Do not reply or forward unless I ask.",
  },
  {
    id: "clients",
    category: "Clients",
    on: true,
    text: "When I ask about a contact, report the products on file, the KYC date, recent mail, upcoming meetings, and cross-sell gaps. Do not invent a product that is not on file.",
  },
  {
    id: "review",
    category: "Follow-up",
    on: true,
    text: "When I ask who needs attention, list KYC that is due, people not contacted in 90 days, and cross-sell gaps. These are gaps on file, not a recommendation to buy.",
  },
  {
    id: "meetings",
    category: "Meetings",
    on: true,
    text: "When I ask to book a Zoom meeting, confirm the contact, day, and time, and book it only after I say yes. Use Toronto time unless I name another zone.",
  },
  {
    id: "several",
    category: "Several tasks",
    on: true,
    text: "When I ask for several jobs in one message, do every one. Do the reading now. Prepare every e-card, newsletter, e-letter, campaign, and meeting, then ask me to say yes once before anything is sent or booked.",
  },
];

export function taskOn(rules: Array<{ id?: string; on?: boolean }> | undefined, id: string) {
  const rule = (rules || []).find((item) => item.id === id);
  if (!rule) return true;
  return rule.on !== false;
}

export function taskPaused(id: string) {
  const rule = SECRETARY_RULES.find((item) => item.id === id);
  const name = rule?.category || "That task";
  return `${name} is turned off. Open Rules and turn it on.`;
}
