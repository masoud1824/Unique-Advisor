export const PLANS = ["starter", "professional", "team"] as const;
export type PlanId = (typeof PLANS)[number];

export const PALETTES = ["ink", "forest", "burgundy", "slate", "midnight", "coastal", "copper", "linen"] as const;
export type Palette = (typeof PALETTES)[number];

export const PACKAGES = ["explain", "capture", "followup"] as const;
export type PackageId = (typeof PACKAGES)[number];

export const INTERESTS = ["life", "critical", "disability", "group", "unsure"] as const;
export type Interest = (typeof INTERESTS)[number];

export type AdvisorStatus = "active" | "suspended";

export type SiteSettings = {
  packageId: PackageId;
  palette: Palette;
  showLife: boolean;
  showCritical: boolean;
  showDisability: boolean;
  showGroup: boolean;
  showFacts: boolean;
  showForm: boolean;
  codeIsDefault: boolean;
};

export type PublicSite = SiteSettings & {
  slug: string;
  practiceName: string;
  advisorName: string;
  plan: PlanId;
  status: AdvisorStatus;
  siteMode: "builtin" | "own";
  siteUrl: string;
  publicName: string;
  publicTitle: string;
  publicPhoto: string;
  publicPhone: string;
  publicCardEmail: string;
  publicCompany: string;
  publicWebsite: string;
  publicSocial: string;
  siteContent: string;
};

export type Contact = {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  birthday: string;
  products: string[];
  productNote: string;
  kycOn: string;
  tags: string[];
};

export type SavedPiece = {
  id: number;
  title: string;
  subject: string;
  body: string;
  image?: string;
};

export type ArchivedMessage = {
  id: number;
  kind: string;
  title: string;
  subject: string;
  body: string;
  contactName: string;
  contactEmail: string;
  createdAt: string;
};

export type SharedCard = {
  id: number;
  name: string;
  body: string;
  image: string;
};

export type DeskData = {
  slug: string;
  practiceName: string;
  advisorName: string;
  plan: PlanId;
  palette: Palette;
  contacts: Contact[];
  cards: SavedPiece[];
  letters: SavedPiece[];
  messages: ArchivedMessage[];
  tags: string[];
  hiddenCardIds: string[];
  contactTitle: string;
  contactPhone: string;
  contactEmail: string;
  contactCompany: string;
  contactWebsite: string;
  siteMode?: "builtin" | "own";
  siteUrl?: string;
  linkedin: string;
  linkedinShow: boolean;
  instagram: string;
  instagramShow: boolean;
  facebook: string;
  facebookShow: boolean;
  photo: string;
  photoOnNewsletter: boolean;
  photoOnEletter?: boolean;
  sharedCards: SharedCard[];
};

export type Subscriber = {
  id: number;
  slug: string;
  practiceName: string;
  advisorName: string;
  email: string;
  plan: PlanId;
  status: AdvisorStatus;
  createdAt: string;
  promoCode: string;
  promoKind: string;
  promoAmount: number;
  setupFee?: number;
  setupWaived?: boolean;
};

export type LeadStep = {
  id: number;
  title: string;
  detail: string;
  dueOn: string;
  done: boolean;
};

export type Lead = {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  interest: string;
  note: string;
  createdAt: string;
  steps: LeadStep[];
};

export const PALETTE_LABELS: Record<Palette, string> = {
  ink: "Navy & gold",
  forest: "Pine",
  burgundy: "Wine",
  slate: "Harbor",
  midnight: "Midnight",
  coastal: "Coastal",
  copper: "Copper",
  linen: "Linen",
};

export const PALETTE_NOTES: Record<Palette, string> = {
  ink: "Warm paper, navy headlines, a gold line.",
  forest: "Soft green page and deep pine headlines.",
  burgundy: "Blush page, wine headlines, gold accent.",
  slate: "Cool grey page, slate headlines, green accent.",
  midnight: "Dark navy page, cream type, gold accent.",
  coastal: "Sea-mist page, deep blue headlines, sand accent.",
  copper: "Warm stone page and rust headlines.",
  linen: "Ivory page, charcoal headlines, quiet blue.",
};

export type PaletteColors = {
  bg: string;
  fg: string;
  muted: string;
  primary: string;
  primaryFg: string;
  accent: string;
  surface: string;
  line: string;
};

export const PALETTE_COLORS: Record<Palette, PaletteColors> = {
  ink: { bg: "#f4efe6", fg: "#1c1915", muted: "#6b6258", primary: "#14324f", primaryFg: "#f7f3ea", accent: "#a6843d", surface: "#fffdf8", line: "#e4dccf" },
  forest: { bg: "#f3f6f2", fg: "#1a2420", muted: "#5c6b64", primary: "#1e4d3a", primaryFg: "#f4faf6", accent: "#c4a15a", surface: "#fbfcfb", line: "#d7e2db" },
  burgundy: { bg: "#f7f2ef", fg: "#241816", muted: "#6e5c57", primary: "#6b2d3c", primaryFg: "#fbf6f4", accent: "#c4a15a", surface: "#fffaf8", line: "#eadfd8" },
  slate: { bg: "#f2f4f6", fg: "#1b2128", muted: "#5c6770", primary: "#2c3e50", primaryFg: "#f4f7f8", accent: "#3d7a6a", surface: "#fbfcfd", line: "#dce3e8" },
  midnight: { bg: "#0e1c2b", fg: "#f4efe6", muted: "#b7c3cf", primary: "#f3e6c4", primaryFg: "#0e1c2b", accent: "#c6a15b", surface: "#163049", line: "#2a4663" },
  coastal: { bg: "#e7f3f6", fg: "#123038", muted: "#4d6a72", primary: "#0b6e8a", primaryFg: "#f4fbfc", accent: "#e0a23a", surface: "#f7fcfd", line: "#c5dde3" },
  copper: { bg: "#f8efe6", fg: "#2a211c", muted: "#73655c", primary: "#b85a2a", primaryFg: "#fff8f3", accent: "#1f4b3a", surface: "#fffaf6", line: "#ead5c4" },
  linen: { bg: "#f7f4ef", fg: "#22211e", muted: "#6d6962", primary: "#2f3a44", primaryFg: "#f7f4ef", accent: "#3f6f8f", surface: "#fffcf8", line: "#e6e0d6" },
};

export function paletteStyle(palette: Palette): Record<string, string> {
  const colors = PALETTE_COLORS[palette] ?? PALETTE_COLORS.ink;
  return {
    "--t-bg": colors.bg,
    "--t-fg": colors.fg,
    "--t-muted": colors.muted,
    "--t-primary": colors.primary,
    "--t-primary-fg": colors.primaryFg,
    "--t-accent": colors.accent,
    "--t-surface": colors.surface,
    "--t-line": colors.line,
    background: colors.bg,
    color: colors.fg,
  };
}

export const PACKAGE_LABELS: Record<PackageId, string> = {
  explain: "Explain",
  capture: "Capture",
  followup: "Follow-up",
};

export const PACKAGE_DETAILS: Record<PackageId, string> = {
  explain: "Pages only. You choose the sections. Nothing runs after someone visits.",
  capture: "Did you know and the form stay on. Each question is saved and tagged with the topic.",
  followup: "Same as Capture. Each new question also gets three steps: today, in 3 days, and in 14 days.",
};

export const PLAN_LABELS: Record<PlanId, string> = {
  starter: "Starter",
  professional: "Professional",
  team: "Team",
};

export const PLAN_PRICES: Record<PlanId, number> = {
  starter: 49,
  professional: 249,
  team: 299,
};

export const SETUP_FEES: Record<PlanId, number> = {
  starter: 100,
  professional: 500,
  team: 1000,
};

export type PromoKind = "percent" | "amount";
export type PromoApplies = "monthly" | "setup" | "both";

export type Promotion = {
  id: number;
  code: string;
  kind: PromoKind;
  amount: number;
  applies: PromoApplies;
  monthlyPercent: number;
  setupPercent: number;
  note: string;
  active: boolean;
  maxUses: number;
  usedCount: number;
  expiresOn: string;
};

export function priced(base: number, kind?: string, amount?: number) {
  const value = Math.max(0, Math.round(Number(amount) || 0));
  if (kind === "percent") return Math.max(0, Math.round((base * (100 - Math.min(100, value))) / 100));
  if (kind === "amount") return Math.max(0, base - value);
  return base;
}

export function percentOff(base: number, percent?: number) {
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  return Math.max(0, Math.round((base * (100 - value)) / 100));
}

export function monthlyPrice(plan: PlanId, kind?: string, amount?: number, applies?: string, monthlyPercent?: number) {
  if (monthlyPercent != null && monthlyPercent >= 0) return percentOff(PLAN_PRICES[plan], monthlyPercent);
  if (applies === "setup") return PLAN_PRICES[plan];
  return priced(PLAN_PRICES[plan], kind, amount);
}

export function setupPrice(plan: PlanId, kind?: string, amount?: number, applies?: string, setupPercent?: number) {
  const base = SETUP_FEES[plan];
  if (setupPercent != null && setupPercent >= 0) return percentOff(base, setupPercent);
  if (applies === "setup" || applies === "both") return priced(base, kind, amount);
  return base;
}

export function discountLabel(kind?: string, amount?: number, applies?: string, monthlyPercent?: number, setupPercent?: number) {
  if ((monthlyPercent != null && monthlyPercent >= 0) || (setupPercent != null && setupPercent >= 0)) {
    const parts = [];
    if ((monthlyPercent || 0) > 0) parts.push(`${monthlyPercent}% off the monthly fee`);
    if ((setupPercent || 0) > 0) parts.push(`${setupPercent}% off the setup fee`);
    return parts.join(" and ");
  }
  const value = Math.max(0, Math.round(Number(amount) || 0));
  const off = kind === "percent" && value > 0 ? `${value}% off` : kind === "amount" && value > 0 ? `$${value} off` : "";
  if (!off) return "";
  if (applies === "setup") return `${off} the setup fee`;
  if (applies === "both") return `${off} the monthly price and the setup fee`;
  return `${off} the monthly price`;
}

export const PLAN_DETAILS: Record<PlanId, string> = {
  starter: "E-cards, newsletters, and drip campaigns. One-time setup fee $100. The AI assistant is not included.",
  professional: "Starter, plus your own tags, e-cards, and newsletters. One-time setup fee $500.",
  team: "The same tools as Professional. One-time setup fee $1,000. Super admin shows the plan as Team.",
};

export const INTEREST_LABELS: Record<Interest, string> = {
  life: "Life insurance",
  critical: "Critical illness",
  disability: "Disability income",
  group: "Group benefits",
  unsure: "Not sure yet",
};

export function allowsCustom(plan: PlanId) {
  return plan === "professional" || plan === "team";
}

export function locksLeadTools(packageId: PackageId) {
  return packageId === "capture" || packageId === "followup";
}

export function applyPackage<T extends SiteSettings>(settings: T): T {
  if (!locksLeadTools(settings.packageId)) return settings;
  return { ...settings, showFacts: true, showForm: true };
}

export type CorporateFeature = { title: string; body: string };

export type CorporatePlan = {
  name: string;
  note: string;
  price: string;
  points: string;
  button: string;
  featured: boolean;
};

export type FontChoice = { size: number; color: string };

export type SiteFonts = {
  menu: FontChoice;
  kicker: FontChoice;
  accent: FontChoice;
  title: FontChoice;
  intro: FontChoice;
  button: FontChoice;
  ghost: FontChoice;
  sectionLabel: FontChoice;
  sectionTitle: FontChoice;
  sectionText: FontChoice;
  cardTitle: FontChoice;
  cardText: FontChoice;
  planName: FontChoice;
  planNote: FontChoice;
  price: FontChoice;
  planList: FontChoice;
  footer: FontChoice;
  footerLink: FontChoice;
};

export const DEFAULT_FONTS: SiteFonts = {
  menu: { size: 15, color: "#14324f" },
  kicker: { size: 12, color: "#a6843d" },
  accent: { size: 56, color: "#c9a227" },
  title: { size: 34, color: "#f7f3ea" },
  intro: { size: 18, color: "#e7dfd2" },
  button: { size: 16, color: "#1c1915" },
  ghost: { size: 16, color: "#f7f3ea" },
  sectionLabel: { size: 12, color: "#a6843d" },
  sectionTitle: { size: 38, color: "#14324f" },
  sectionText: { size: 17, color: "#5c564c" },
  cardTitle: { size: 17, color: "#14324f" },
  cardText: { size: 16, color: "#5c564c" },
  planName: { size: 26, color: "#14324f" },
  planNote: { size: 13, color: "#a6843d" },
  price: { size: 43, color: "#14324f" },
  planList: { size: 16, color: "#3d3832" },
  footer: { size: 16, color: "#e7dfd2" },
  footerLink: { size: 16, color: "#f7f3ea" },
};

export const FONT_LABELS: [keyof SiteFonts, string][] = [
  ["menu", "Menu"],
  ["kicker", "Small line"],
  ["accent", "AI Assistant line"],
  ["title", "Title"],
  ["intro", "Introduction"],
  ["button", "Gold button"],
  ["ghost", "Second button"],
  ["sectionLabel", "Section small line"],
  ["sectionTitle", "Section title"],
  ["sectionText", "Section introduction"],
  ["cardTitle", "Card title"],
  ["cardText", "Card text"],
  ["planName", "Plan name"],
  ["planNote", "Plan note"],
  ["price", "Price"],
  ["planList", "Plan list"],
  ["footer", "Footer"],
  ["footerLink", "Footer links"],
];

export type CorporateLink = { label: string; href: string };

export type CorporateSite = {
  links: CorporateLink[];
  kicker: string;
  accent: string;
  headline: string;
  subhead: string;
  primaryButton: string;
  secondaryButton: string;
  buttonColor: string;
  assistantVisible: boolean;
  assistantKicker: string;
  assistantTitle: string;
  assistantLead: string;
  assistantCards: CorporateFeature[];
  featuresVisible: boolean;
  featuresKicker: string;
  featuresTitle: string;
  features: CorporateFeature[];
  pricingVisible: boolean;
  pricingKicker: string;
  pricingTitle: string;
  plans: CorporatePlan[];
  footer: string;
  footerLinks: CorporateLink[];
  fonts: SiteFonts;
};

export type PlatformSettings = {
  trialDays: number;
  defaultPlan: PlanId;
  currency: "CAD" | "USD";
  allowCustomTags: boolean;
  allowWebsite: boolean;
  site: CorporateSite;
};

export const DEFAULT_PLATFORM: PlatformSettings = {
  trialDays: 7,
  defaultPlan: "professional",
  currency: "CAD",
  allowCustomTags: true,
  allowWebsite: true,
  site: {
    links: [
      { label: "AI assistant", href: "#assistant" },
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "Log in", href: "/login" },
      { label: "Start trial", href: "/signup" },
    ],
    kicker: "For financial advisors and insurance brokers",
    accent: "AI Assistant,",
    headline: "The CRM & Marketing Platform Built for Financial Advisors and Insurance Brokers",
    subhead:
      "Starter covers e-cards, newsletters, and drip campaigns. Professional and Team add a private AI assistant that finds who to call, sends the birthday card, and gets the next newsletter and meeting ready. Your clients. Your email. Never another advisor’s.",
    primaryButton: "Start your 7-day free trial",
    secondaryButton: "See plans",
    buttonColor: "#c9a227",
    assistantVisible: true,
    assistantKicker: "Professional and Team",
    assistantTitle: "The AI assistant handles the desk work.",
    assistantLead: "Starter stays with e-cards, newsletters, and drip campaigns. On Professional and Team, each advisor has a private assistant that never sees another advisor’s clients, mail, or files.",
    assistantCards: [
      { title: "Who to call", body: "It checks your clients and recent messages, then names the follow-up." },
      { title: "Birthday cards", body: "On the day, it sends your Unique Advisor e-card from your own email." },
      { title: "Newsletters", body: "It reminds you when an issue is due and sends it when you say so." },
      { title: "Meetings and files", body: "It prepares the calendar or Zoom invite and the Dropbox note, then waits for your approval." },
    ],
    featuresVisible: true,
    featuresKicker: "The practice desk",
    featuresTitle: "The tools behind the assistant",
    features: [
      {
        title: "AI assistant on your book",
        body: "Ask who to call today. It reads only your clients and recent messages, then writes the follow-up. You approve it. It sends from your mailbox.",
      },
      {
        title: "Birthday cards, that morning",
        body: "Add a birth date. On the day, the AI assistant sends your Unique Advisor birthday card from your own email. One card, once a year, only to your people.",
      },
      {
        title: "Newsletters, without the blank page",
        body: "If a month goes by with no newsletter, the assistant says so and helps you prepare the next issue. It sends through Unique Advisor when you say send.",
      },
      {
        title: "Meetings, Zoom, and the file",
        body: "Connect your calendar, Zoom, and Dropbox. The assistant can line up the meeting and the note. Nothing is booked or saved until you approve it.",
      },
    ],
    pricingVisible: true,
    pricingKicker: "Pricing",
    pricingTitle: "Clear plans. No surprise fees.",
    plans: [
      { name: "Starter", note: "Marketing tools only", price: "$49", points: "One-time setup $100\nUp to 500 contacts\nE-cards\nNewsletters\nDrip campaigns", button: "Start free trial", featured: false },
      { name: "Professional", note: "Recommended", price: "$249", points: "One-time setup $500\nUnlimited contacts\nPrivate AI assistant\nBirthday cards and newsletters\nYour coverage website", button: "Start free trial", featured: true },
      { name: "Team", note: "Up to 5 advisors", price: "$299", points: "One-time setup $1,000\nEverything in Professional\nA separate AI assistant for each advisor\nEach book of clients stays private", button: "Start free trial", featured: false },
    ],
    footer: "© 2026 Unique Advisor. The AI assistant for financial advisors.",
    footerLinks: [
      { label: "Advisor login", href: "/login" },
      { label: "Superadmin", href: "/admin" },
    ],
    fonts: DEFAULT_FONTS,
  },
};
