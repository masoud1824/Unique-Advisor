import { websiteButtonHtml } from "./advisor-website.ts";

export const NEWSLETTER_DESIGNS = [
  { id: "navy", name: "Navy & Gold", detail: "Numbered stories and gold buttons" },
  { id: "pine", name: "Pine", detail: "Cream page with a green header" },
  { id: "ink", name: "Ink Sidebar", detail: "Logo and contact in a dark rail" },
  { id: "sand", name: "Warm Sand", detail: "Each story in its own card" },
  { id: "brief", name: "Forest Brief", detail: "A tight list when you have many stories" },
  { id: "slate", name: "Slate Feature", detail: "Lead story large, the rest short" },
] as const;

export type NewsletterDesign = (typeof NEWSLETTER_DESIGNS)[number]["id"];

export type NewsletterArticle = { title: string; body: string };

export type NewsletterSocial = { linkedin: string; instagram: string; facebook: string; youtube: string };

export type NewsletterContact = { name: string; title?: string; phone: string; email: string; place: string; website: string };

export function signatureLines(parts: { name?: string; title?: string; company?: string; phone?: string; email?: string; website?: string }) {
  const name = (parts.name || "").trim();
  const company = (parts.company || "").trim();
  const firm = company && company.toLowerCase() !== name.toLowerCase() ? company : "";
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of [name, parts.title, firm, parts.phone, parts.email, parts.website]) {
    const line = String(item || "").trim();
    const key = line.toLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines;
}

export type NewsletterIssue = {
  design: NewsletterDesign;
  kicker: string;
  title: string;
  subject: string;
  articles: NewsletterArticle[];
  social: NewsletterSocial;
};

const SOCIAL_LABELS: { key: keyof NewsletterSocial; label: string }[] = [
  { key: "linkedin", label: "LinkedIn" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
];

export function emptySocial(): NewsletterSocial {
  return { linkedin: "", instagram: "", facebook: "", youtube: "" };
}

export function starterIssue(): NewsletterIssue {
  return {
    design: "navy",
    kicker: "Newsletter",
    title: "Newsletter Title Here",
    subject: "Newsletter Title Here",
    articles: [0, 1, 2, 3].map((index) => ({
      title: "Article Title Here",
      body: index === 0
        ? "Write the full article in this box. The newsletter keeps only the first five lines on the page, so a reader sees the opening and then presses Read more. That opens the rest of this article. It does not send them to another website. Keep writing until the piece is finished. Every line after the fifth stays closed until Read more is pressed. This last sentence is the part a reader opens with Read more."
        : "Add the rest of this article here. Only five lines show until Read more is pressed.",
    })),
    social: emptySocial(),
  };
}

export function packNewsletter(issue: NewsletterIssue) {
  return JSON.stringify({ v: 1, ...issue, articles: issue.articles.slice(0, 12) });
}

export function unpackNewsletter(body: string): NewsletterIssue | null {
  const text = body.trim();
  if (!text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text) as Partial<NewsletterIssue> & { v?: number };
    if (parsed.v !== 1 || !isDesign(parsed.design)) return null;
    const articles = Array.isArray(parsed.articles) ? parsed.articles.slice(0, 12) : [];
    return {
      design: parsed.design,
      kicker: String(parsed.kicker ?? "Newsletter").slice(0, 40),
      title: String(parsed.title ?? "").slice(0, 120),
      subject: String(parsed.subject ?? parsed.title ?? "").slice(0, 120),
      articles: articles.map((item) => ({
        title: String(item?.title ?? "").slice(0, 140),
        body: String(item?.body ?? "").slice(0, 8000),
      })),
      social: {
        linkedin: String(parsed.social?.linkedin ?? ""),
        instagram: String(parsed.social?.instagram ?? ""),
        facebook: String(parsed.social?.facebook ?? ""),
        youtube: String(parsed.social?.youtube ?? ""),
      },
    };
  } catch {
    return null;
  }
}

export function readNewsletterPayload(raw: string): { issue: NewsletterIssue; contact: NewsletterContact } | null {
  try {
    const parsed = JSON.parse(raw) as { issue?: NewsletterIssue; contact?: Partial<NewsletterContact> };
    const issue = unpackNewsletter(JSON.stringify({ v: 1, ...(parsed.issue ?? {}) }));
    if (!issue || !parsed.contact) return null;
    return {
      issue,
      contact: {
        name: String(parsed.contact.name ?? "").slice(0, 80),
        title: String(parsed.contact.title ?? "").slice(0, 80),
        phone: String(parsed.contact.phone ?? "").slice(0, 40),
        email: String(parsed.contact.email ?? "").slice(0, 120),
        place: String(parsed.contact.place ?? "").slice(0, 80),
        website: String(parsed.contact.website ?? "").slice(0, 160),
      },
    };
  } catch {
    return null;
  }
}

export function plainNewsletter(issue: NewsletterIssue) {
  const stories = issue.articles
    .filter((item) => item.title.trim() || item.body.trim())
    .map((item) => [item.title.trim(), item.body.trim()].filter(Boolean).join("\n"));
  return [issue.title.trim(), ...stories].filter(Boolean).join("\n\n");
}

export function renderNewsletter(input: {
  issue: NewsletterIssue;
  contact: NewsletterContact;
  logoSrc: string;
  mode?: "preview" | "email" | "page";
  articleHref?: (index: number) => string;
}) {
  const mode = input.mode ?? "preview";
  const design = isDesign(input.issue.design) ? input.issue.design : "navy";
  const theme = THEMES[design];
  const kicker = escapeHtml(input.issue.kicker.trim() || "Newsletter");
  const title = escapeHtml(input.issue.title.trim() || "Newsletter");
  const articles = input.issue.articles
    .map((item) => ({ title: item.title.trim(), body: item.body.trim() }))
    .filter((item) => item.title || item.body)
    .slice(0, 12);
  const logoInk = theme.layout === "numbered" || theme.layout === "sidebar" ? theme.ink : "#ffffff";
  const logo = logoBlock(input.logoSrc, input.contact.name, logoInk);
  const contact = contactLines(input.contact);
  const social = socialLinks(input.issue.social, "#ffffff");
  const stories = articles.length
    ? articles.map((item, index) => articleBlock(theme, item, index, articles.length, mode, input.articleHref?.(index) ?? `#a-${index}`)).join("")
    : `<tr><td style="padding:28px 32px;color:${theme.muted};font-family:Segoe UI,Arial,sans-serif;font-size:15px">Add a title to see the story here.</td></tr>`;
  const header = theme.layout === "sidebar" ? "" : headerBlock(theme, logo, kicker);
  const footer = footerBlock(theme, contact, social, input.contact.website);
  const body =
    theme.layout === "sidebar"
      ? `${sidebarBlock(theme, logo, kicker, title, stories)}${footer}`
      : `${header}<tr><td style="padding:${theme.layout === "brief" || theme.layout === "feature" ? "18px 20px 6px" : "28px 28px 8px"};text-align:${theme.layout === "brief" || theme.layout === "feature" ? "left" : "center"};background:${theme.page}"><h1 style="margin:0;font-family:${theme.font};font-size:${theme.layout === "brief" || theme.layout === "feature" ? "22px" : "34px"};line-height:1.2;font-weight:700;color:${theme.ink}">${title}</h1>${theme.layout === "brief" || theme.layout === "feature" ? "" : `<div style="width:72px;height:4px;background:${theme.gold};margin:14px auto 0"></div>`}</td></tr>${stories}${footer}`;
  return `<!DOCTYPE html><html><head></head><body style="margin:0;padding:0;background:${theme.canvas}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${theme.canvas}"><tr><td align="center" style="padding:12px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:${theme.page};border-collapse:collapse">${body}</table></td></tr></table></body></html>`;
}

type Theme = {
  canvas: string;
  page: string;
  header: string;
  gold: string;
  ink: string;
  muted: string;
  font: string;
  layout: "numbered" | "stacked" | "sidebar" | "cards" | "brief" | "feature";
};

const THEMES: Record<NewsletterDesign, Theme> = {
  navy: { canvas: "#e7eef6", page: "#ffffff", header: "#0c2f6b", gold: "#d4a017", ink: "#102a56", muted: "#7d8da3", font: "Segoe UI,Arial,sans-serif", layout: "numbered" },
  pine: { canvas: "#e7efe9", page: "#F3EFE6", header: "#1C3D36", gold: "#9a7b4f", ink: "#1C3D36", muted: "#6B655C", font: "Georgia,Times New Roman,serif", layout: "stacked" },
  ink: { canvas: "#eceae6", page: "#ffffff", header: "#1A1916", gold: "#c4a574", ink: "#1A1916", muted: "#6B655C", font: "Georgia,Times New Roman,serif", layout: "sidebar" },
  sand: { canvas: "#efe4d6", page: "#f6f1e7", header: "#8c4a32", gold: "#b4532a", ink: "#3d2b22", muted: "#8a7568", font: "Georgia,Times New Roman,serif", layout: "cards" },
  brief: { canvas: "#eef3f0", page: "#ffffff", header: "#1f4d3a", gold: "#1f4d3a", ink: "#16382b", muted: "#5d6b64", font: "Segoe UI,Arial,sans-serif", layout: "brief" },
  slate: { canvas: "#e8edf3", page: "#f8fafc", header: "#1e293b", gold: "#2563eb", ink: "#0f172a", muted: "#64748b", font: "Segoe UI,Arial,sans-serif", layout: "feature" },
};

function isDesign(value: unknown): value is NewsletterDesign {
  return NEWSLETTER_DESIGNS.some((item) => item.id === value);
}

function headerBlock(theme: Theme, logo: string, kicker: string) {
  if (theme.layout === "numbered") {
    return `<tr><td style="padding:0;background:#ffffff"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="52%" bgcolor="#ffffff" style="padding:22px 28px;background:#ffffff">${logo}</td><td width="48%" bgcolor="${theme.header}" align="right" style="padding:22px 28px;background:${theme.header};color:#ffffff;font-family:${theme.font};font-size:28px;font-weight:700">${kicker}</td></tr><tr><td colspan="2" height="8" bgcolor="${theme.gold}" style="background:${theme.gold};font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>`;
  }
  return `<tr><td bgcolor="${theme.header}" style="padding:22px 28px;background:${theme.header}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td>${logo}</td><td align="right" style="color:#ffffff;font-family:${theme.font};font-size:22px;font-weight:700">${kicker}</td></tr></table></td></tr>`;
}

function logoBlock(src: string, name: string, ink: string) {
  if (src.startsWith("cid:") || src.startsWith("data:image/") || src.startsWith("https://") || src.startsWith("http://")) {
    return `<img src="${escapeAttr(src)}" alt="" style="display:block;width:auto;max-width:180px;height:auto;border:0">`;
  }
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:20px;font-weight:700;color:${ink}">${escapeHtml(name.trim() || "Your Logo")}</div>`;
}

function articleBlock(
  theme: Theme,
  item: { title: string; body: string },
  index: number,
  total: number,
  mode: "preview" | "email" | "page",
  href: string,
) {
  const title = escapeHtml(item.title || "Untitled");
  const full = escapeHtml(item.body).replace(/\n/g, "<br>");
  const copy = full ? `<div style="white-space:normal;overflow:visible;word-wrap:break-word;overflow-wrap:anywhere">${full}</div>` : "";
  const moreBlock = "";
  if (theme.layout === "feature") {
    if (index === 0) {
      return `<tr><td style="padding:0 20px 8px;background:${theme.page}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${theme.header}"><tr><td style="padding:22px 20px;color:#ffffff;font-family:${theme.font}"><article id="a-${index}"><div style="font-family:${theme.font};font-size:22px;font-weight:700;line-height:1.2">${title}</div>${copy ? `<div style="margin-top:10px;font-family:${theme.font};font-size:16px;line-height:1.5;color:#e2e8f0">${copy}</div>` : ""}${moreBlock}</article></td></tr></table></td></tr>`;
    }
    return `<tr><td style="padding:8px 20px 16px;background:${theme.page};font-family:${theme.font};border-bottom:1px solid #e2e8f0"><article id="a-${index}"><div style="font-family:${theme.font};font-size:22px;font-weight:700;line-height:1.2;color:${theme.ink}">${title}</div>${copy ? `<div style="margin-top:8px;font-family:${theme.font};font-size:16px;line-height:1.5;color:${theme.muted}">${copy}</div>` : ""}${moreBlock}</article></td></tr>`;
  }
  if (theme.layout === "cards") {
    return `<tr><td style="padding:8px 28px;background:${theme.page}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td style="padding:18px 20px;font-family:${theme.font}"><article id="a-${index}"><div style="font-size:20px;font-weight:700;color:${theme.ink}">${title}</div>${copy ? `<div style="margin-top:8px;color:${theme.muted};font-size:15px;line-height:1.5">${copy}</div>` : ""}${moreBlock}</article></td></tr></table></td></tr>`;
  }
  if (theme.layout === "stacked") {
    return `<tr><td style="padding:8px 32px 18px;background:${theme.page};font-family:${theme.font};border-bottom:1px solid #e4d8c4"><article id="a-${index}"><div style="font-size:22px;font-weight:700;color:${theme.ink}">${title}</div>${copy ? `<div style="margin-top:8px;color:${theme.muted};font-size:16px;line-height:1.5">${copy}</div>` : ""}${moreBlock}</article></td></tr>`;
  }
  if (theme.layout === "brief") {
    return `<tr><td style="padding:14px 20px;background:${theme.page};border-bottom:1px solid #e5eeea;font-family:${theme.font}"><article id="a-${index}"><div style="font-size:16px;font-weight:700;color:${theme.ink}">${index + 1}. ${title}</div>${copy ? `<div style="margin-top:4px;color:${theme.muted};font-size:14px;line-height:1.45">${copy}</div>` : ""}${moreBlock}</article></td></tr>`;
  }
  if (theme.layout === "sidebar") {
    return `<tr><td style="padding:6px 18px 16px;background:${theme.page};font-family:${theme.font}"><article id="a-${index}"><div style="font-size:18px;line-height:1.3;font-weight:700;color:${theme.ink}">${title}</div>${copy ? `<div style="margin-top:6px;color:${theme.muted};font-size:15px;line-height:1.5;word-wrap:break-word">${copy}</div>` : ""}${moreBlock}</article></td></tr>`;
  }
  const rule = index < total - 1 ? "border-bottom:1px solid #e6edf5" : "";
  return `<tr><td style="padding:0 20px;background:${theme.page}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${rule}"><tr><td width="52" valign="top" style="padding:16px 0"><div style="width:40px;height:40px;background:${theme.header};color:#ffffff;border-radius:8px;text-align:center;line-height:40px;font-family:${theme.font};font-weight:700">${index + 1}</div></td><td valign="top" style="padding:16px 12px 16px 0;font-family:${theme.font}"><article id="a-${index}"><div style="font-size:18px;font-weight:700;color:${theme.ink}">${title}</div>${copy ? `<div style="margin-top:6px;color:${theme.muted};font-size:14px;line-height:1.45">${copy}</div>` : ""}${moreBlock}</article></td></tr></table></td></tr>`;
}

function lineWidth(layout: Theme["layout"]) {
  if (layout === "sidebar") return 42;
  if (layout === "feature") return 52;
  if (layout === "brief") return 64;
  return 68;
}

function splitLines(body: string, width: number) {
  const lines = visualLines(body, width);
  if (lines.length <= 5) return { shown: lines.join("\n"), rest: "" };
  return { shown: lines.slice(0, 5).join("\n"), rest: lines.slice(5).join("\n") };
}

function visualLines(body: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of body.replace(/\r\n/g, "\n").split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (current && next.length > width) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    if (current) lines.push(current);
  }
  return lines;
}

function readMore(theme: Theme, href: string, preview = false) {
  const onDark = theme.layout === "feature";
  const background = onDark ? "#ffffff" : "transparent";
  const color = onDark ? theme.header : theme.gold;
  const look = `display:inline-block;background:${background};color:${color};text-decoration:underline;font-family:${theme.font};font-size:14px;font-weight:700;padding:${onDark ? "8px 14px" : "0"};border-radius:${onDark ? "20px" : "0"};cursor:pointer`;
  if (preview) return `<label for="open-nl" class="more" style="${look}">Read more</label>`;
  return `<a class="more" href="${escapeAttr(href)}" style="${look}">Read more</a>`;
}

function sidebarBlock(theme: Theme, logo: string, kicker: string, title: string, stories: string) {
  return `<tr><td style="padding:0;background:${theme.page};overflow:visible"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><td width="188" valign="top" bgcolor="${theme.header}" style="width:188px;background:${theme.header};color:#ffffff;padding:22px 16px;font-family:${theme.font};font-size:14px;line-height:1.45"><div style="display:inline-block;background:#ffffff;line-height:0;border-radius:8px">${logo}</div><div style="margin-top:18px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${theme.gold}">${kicker}</div></td><td valign="top" style="background:${theme.page};overflow:visible"><div style="padding:22px 18px 6px;font-family:${theme.font};font-size:28px;line-height:1.2;color:${theme.ink};font-weight:700;overflow:visible;word-wrap:break-word">${title}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${stories}</table></td></tr></table></td></tr>`;
}

function footerBlock(theme: Theme, contact: string[], social: string, website = "") {
  const button = websiteButtonHtml(website);
  if (contact.length === 0 && !social && !button) return `<tr><td height="16" style="font-size:0;background:${theme.page}">&nbsp;</td></tr>`;
  const lines = contact.map((line) => `<div style="margin-top:6px">${mark(line)}&nbsp;&nbsp;${escapeHtml(line)}</div>`).join("");
  return `<tr><td bgcolor="${theme.header}" style="padding:0;background:${theme.header}"><div style="height:8px;background:${theme.gold};font-size:0;line-height:0">&nbsp;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="top" style="padding:22px 28px;color:#ffffff;font-family:${theme.font};font-size:14px;line-height:1.5">${lines || "&nbsp;"}${button}</td>${social ? `<td valign="middle" align="right" style="padding:22px 28px">${social}</td>` : ""}</tr></table></td></tr>`;
}

function contactLines(contact: NewsletterContact) {
  return signatureLines({
    name: contact.name,
    title: contact.title,
    company: contact.place,
    phone: contact.phone,
    email: contact.email,
  });
}

function socialLinks(social: NewsletterSocial, color: string) {
  return SOCIAL_LABELS.flatMap(({ key, label }) => {
    const url = safeUrl(social[key] ?? "");
    if (!url) return [];
    return [`<a href="${escapeAttr(url)}" target="_blank" style="display:inline-block;margin:0 0 0 8px;color:${color};text-decoration:underline;font-family:Segoe UI,Arial,sans-serif;font-size:13px">${label}</a>`];
  }).join("");
}

function mark(line: string) {
  if (line.includes("@")) return "✉";
  if (/^https?:\/\//i.test(line)) return "⌖";
  if (/\d/.test(line)) return "☎";
  return "⌖";
}

export function safeUrl(value: string) {
  const url = value.trim();
  if (!/^https?:\/\/[^\s<>"]+$/i.test(url)) return "";
  return url;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;");
}

function escapeAttr(value: string) {
  return escapeHtml(value);
}
