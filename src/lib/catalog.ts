export const TAGS = [
  "Life Insurance Client",
  "Life Insurance Prospect",
  "RRSP Client",
  "RRSP Prospect",
  "TFSA Client",
  "TFSA Prospect",
  "Mortgage Prospect",
  "Estate Planning Client",
  "Group Benefits",
  "Critical Illness",
] as const;

export type CardTemplate = { id: string; title: string; message: string; image: string };

export type LetterTemplate = { id: string; title: string; subject: string; body: string };

export const CARDS: CardTemplate[] = [
  {
    id: "birthday",
    title: "Birthday Wishes",
    image: "/cards/birthday.jpg",
    message: "Dear [Contact Name],\n\nWishing you a good year ahead. Thank you for the trust you place in this practice.",
  },
  {
    id: "thankyou",
    title: "Thank You",
    image: "/cards/thankyou.jpg",
    message: "Dear [Contact Name],\n\nThank you. A short note, not a pitch — I appreciate you sending people this way.",
  },
  {
    id: "holiday",
    title: "Holiday Greeting",
    image: "/cards/holiday.jpg",
    message: "Dear [Contact Name],\n\nWishing you a season of abundance, and a quiet moment to enjoy it.",
  },
  {
    id: "welcome",
    title: "Welcome",
    image: "/cards/welcome.jpg",
    message: "Dear [Contact Name],\n\nWelcome. Your file is open. The next useful step is a review of what you already have.",
  },
  {
    id: "anniversary",
    title: "Milestone Anniversary",
    image: "/cards/anniversary.jpg",
    message: "Dear [Contact Name],\n\nAnother year of working together. Thank you for staying with this practice.",
  },
];

export const LETTERS: LetterTemplate[] = [
  {
    id: "market",
    title: "Market Update",
    subject: "Your Monthly Market Insights",
    body: "Dear [FirstName],\n\nMarkets have shown resilience this month.\n\n• Key index movements\n• RRSP / TFSA reminders\n• One planning idea worth a look",
  },
  {
    id: "tips",
    title: "Financial Tips",
    subject: "3 Simple Ways to Strengthen Your Plan",
    body: "Dear [FirstName],\n\nSmall consistent steps compound:\n\n1. Automate contributions\n2. Review beneficiaries\n3. Rebalance once a year",
  },
  {
    id: "seasonal",
    title: "Seasonal Greeting",
    subject: "Wishing You a Prosperous Season",
    body: "Dear [FirstName],\n\nThank you for your trust. Wishing you health and a steady year ahead.",
  },
  {
    id: "blank",
    title: "Blank",
    subject: "",
    body: "Dear [FirstName],\n\n",
  },
];

export function firstName(full: string) {
  const part = full.trim().split(/\s+/)[0];
  return part || "there";
}

export function personalize(text: string, fullName: string) {
  const name = fullName.trim() || "there";
  return text.replaceAll("[Contact Name]", name).replaceAll("[FirstName]", firstName(name));
}
