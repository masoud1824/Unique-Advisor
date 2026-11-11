import { PALETTES, type Palette } from "@/lib/site-types";

export type WebLink = { id: string; label: string; url: string };
export type WebBlock = { id: string; heading: string; body: string; image: string };
export type WebTab = {
  id: string;
  label: string;
  visible: boolean;
  kind: "page" | "link";
  url: string;
  headline: string;
  intro: string;
  image: string;
  blocks: WebBlock[];
  links: WebLink[];
};
export type WebSite = {
  heroTitle: string;
  heroText: string;
  heroImage: string;
  bannerOn: boolean;
  logo: string;
  footer: string;
  ask: boolean;
  layout: SiteLayout;
  palette?: Palette;
  tabs: WebTab[];
};

export const SITE_LAYOUTS = ["classic", "banner", "editorial", "sidebar", "cards"] as const;
export type SiteLayout = (typeof SITE_LAYOUTS)[number];

export const LAYOUT_LABELS: Record<SiteLayout, string> = {
  classic: "Portrait",
  banner: "Wide banner",
  editorial: "Editorial",
  sidebar: "Side menu",
  cards: "Card grid",
};

export const LAYOUT_NOTES: Record<SiteLayout, string> = {
  classic: "Your photo sits beside the opening line.",
  banner: "A wide picture across the top, then the story.",
  editorial: "A large title and articles stacked down the page.",
  sidebar: "Your name and menu stay on the left.",
  cards: "Each page is a card in a grid.",
};

const PHOTO = /^\/photos\/[a-z0-9-]+\.jpg$/;
const BANNER = /^\/banners\/[a-z0-9-]+\.jpg$/;
const SHARED_BANNER = /^\/api\/platform-banners\/\d+$/;
const MAX_IMAGE = 500_000;

export const BANNER_FRAME = {
  display: "block",
  width: "100%",
  maxWidth: "100%",
  height: "auto",
  overflowAnchor: "none",
} as const;

export const BANNER_LIBRARY = [
  { id: "shelter", name: "Family shelter", src: "/banners/shelter.jpg" },
  { id: "path", name: "A safe path", src: "/banners/path.jpg" },
  { id: "home", name: "Protected home", src: "/banners/home.jpg" },
  { id: "umbrella", name: "Cover for the children", src: "/banners/umbrella.jpg" },
  { id: "table", name: "Around the table", src: "/banners/table.jpg" },
  { id: "sunrise", name: "Looking ahead", src: "/banners/sunrise.jpg" },
  { id: "meadow", name: "Open meadow", src: "/banners/meadow.jpg" },
  { id: "porch", name: "Evening porch", src: "/banners/porch.jpg" },
  { id: "generations", name: "More than one generation", src: "/banners/generations.jpg" },
  { id: "harbor", name: "A calm harbor", src: "/banners/harbor.jpg" },
] as const;

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export function defaultWebsite(): WebSite {
  return {
    heroTitle: "What the policy is actually for.",
    heroText:
      "Life insurance, critical illness, disability income, and group benefits do different jobs. This page says which job, in plain language. If you want that mapped to your own numbers, leave a note.",
    heroImage: "/banners/shelter.jpg",
    bannerOn: true,
    logo: "",
    footer:
      "General information only. It is not a recommendation, a quote, or a promise that a policy will pay. Whether coverage fits depends on your health, your budget, and the wording of the contract.",
    ask: true,
    layout: "classic",
    tabs: [
      page("life", "Life insurance", "A contract that pays the people you name if you die while the policy is in force.", "/photos/life.jpg", [
        "Term coverage is priced for a set number of years. Permanent coverage is built to last, and costs more because of it.",
        "The death benefit is generally paid as a lump sum to the beneficiary, outside the delays of a will.",
        "The amount should track debts, income your household would lose, and how long that gap lasts — not a round number from an ad.",
      ]),
      page("critical", "Critical illness", "A lump sum paid to you if you are diagnosed with a condition the contract lists.", "/photos/critical.jpg", [
        "It is not life insurance. You are alive, and the money is yours to spend — income, travel for care, or paying down a mortgage.",
        "Definitions matter. “Cancer,” “heart attack,” and “stroke” mean what the policy says, not what a headline says.",
        "It can sit beside disability coverage. One replaces income. The other is a one-time cheque.",
      ]),
      page("disability", "Disability income", "A monthly amount if illness or injury keeps you from doing your work.", "/photos/disability.jpg", [
        "Your ability to earn is usually the largest asset on the balance sheet, and the one with no spare key.",
        "Workplace plans often replace only part of pay, may be taxable, and can end when the job does.",
        "Own-occupation wording, waiting period, and benefit period change the price more than the brand name on the letterhead.",
      ]),
      page("group", "Group benefits", "Coverage an employer buys for a group. Useful, and rarely the whole plan.", "/photos/group.jpg", [
        "You usually cannot take the life or disability amount with you if you leave.",
        "The maximum is chosen for the group, not for your mortgage or your dependants.",
        "A personal policy can fill the part the group plan does not reach, and stay in force if you change firms.",
      ]),
    ],
  };
}

export function readWebsite(raw: string): WebSite | null {
  if (!raw.trim()) return null;
  try {
    return sanitizeWebsite(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function sanitizeWebsite(input: unknown): WebSite | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Partial<WebSite>;
  const tabs = Array.isArray(source.tabs) ? source.tabs.slice(0, 10).map(cleanTab).filter((tab) => tab.label.length > 0) : [];
  const seen = new Set<string>();
  for (const tab of tabs) {
    while (seen.has(tab.id)) tab.id = `${tab.id}-${newId()}`.slice(0, 40);
    seen.add(tab.id);
  }
  return {
    heroTitle: line(source.heroTitle, 140) || "Welcome",
    heroText: prose(source.heroText, 800),
    heroImage: cleanImage(source.heroImage),
    bannerOn: source.bannerOn !== false,
    logo: cleanImage(source.logo),
    footer: prose(source.footer, 500),
    ask: source.ask !== false,
    layout: SITE_LAYOUTS.includes(source.layout as SiteLayout) ? (source.layout as SiteLayout) : "classic",
    ...(PALETTES.includes(source.palette as Palette) ? { palette: source.palette as Palette } : {}),
    tabs,
  };
}

export function safeHttp(value: string) {
  const url = value.trim();
  if (!/^https?:\/\/[^\s<>"]+$/i.test(url) || url.length > 300) return "";
  return url;
}

export function cleanImage(value: unknown) {
  const image = typeof value === "string" ? value.trim() : "";
  if (!image) return "";
  if (PHOTO.test(image) || BANNER.test(image) || SHARED_BANNER.test(image)) return image;
  if (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image) && image.length <= MAX_IMAGE) return image;
  return "";
}

function page(id: string, label: string, intro: string, image: string, points: string[]): WebTab {
  return {
    id,
    label,
    visible: true,
    kind: "page",
    url: "",
    headline: label,
    intro,
    image,
    blocks: points.map((body) => ({ id: newId(), heading: "", body, image: "" })),
    links: [],
  };
}

function cleanTab(input: unknown, index: number): WebTab {
  const source = input && typeof input === "object" ? (input as Partial<WebTab>) : {};
  const kind = source.kind === "link" ? "link" : "page";
  const blocks = Array.isArray(source.blocks)
    ? source.blocks.slice(0, 8).map((block) => {
        const item = block && typeof block === "object" ? (block as Partial<WebBlock>) : {};
        return {
          id: cleanId(item.id, newId()),
          heading: line(item.heading, 120),
          body: prose(item.body, 1200),
          image: cleanImage(item.image),
        };
      }).filter((block) => block.heading || block.body || block.image)
    : [];
  const links = Array.isArray(source.links)
    ? source.links.slice(0, 6).map((link) => {
        const item = link && typeof link === "object" ? (link as Partial<WebLink>) : {};
        return { id: cleanId(item.id, newId()), label: line(item.label, 60), url: safeHttp(String(item.url ?? "")) };
      }).filter((link) => link.label && link.url)
    : [];
  return {
    id: cleanId(source.id, `page-${index + 1}`),
    label: line(source.label, 40),
    visible: source.visible !== false,
    kind,
    url: kind === "link" ? safeHttp(String(source.url ?? "")) : "",
    headline: line(source.headline, 140),
    intro: prose(source.intro, 800),
    image: cleanImage(source.image),
    blocks,
    links,
  };
}

function cleanId(value: unknown, fallback: string) {
  const id = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  return id || fallback;
}

function line(value: unknown, max: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function prose(value: unknown, max: number) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}
