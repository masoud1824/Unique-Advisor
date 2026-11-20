import { emptySocial, signatureLines, type NewsletterContact, type NewsletterSocial } from "./newsletter.ts";
import { websiteButtonHtml } from "./advisor-website.ts";

export const ELETTER_DESIGNS = [
  { id: "plum", name: "Royal Plum", detail: "Gold crest on a deep plum header" },
  { id: "azure", name: "Azure Ribbon", detail: "Bright blue band with a gold line" },
  { id: "coral", name: "Coral Atelier", detail: "Warm coral paper and a large title" },
  { id: "emerald", name: "Emerald Rail", detail: "Green side rail and gold type" },
  { id: "sunset", name: "Sunset Luxe", detail: "Rose header with an amber accent" },
  { id: "ruled", name: "Old Lined Paper", detail: "Cream stationery, blue lines, red margin" },
] as const;

export type EletterDesign = (typeof ELETTER_DESIGNS)[number]["id"];

export const ELETTER_SWATCH: Record<EletterDesign, string> = {
  plum: "linear-gradient(90deg,#5c1a4a,#e4b15a)",
  azure: "linear-gradient(90deg,#0e4da8,#f0c14a)",
  coral: "linear-gradient(90deg,#e06a4f,#f7c7b0)",
  emerald: "linear-gradient(90deg,#0f6b4c,#d4af37)",
  sunset: "linear-gradient(90deg,#c2416b,#f4a261)",
  ruled: "linear-gradient(90deg,#f6edd6,#d35b5b 18%,#7ea0c4)",
};

export type Eletter = {
  kind: "eletter";
  design: EletterDesign;
  kicker: string;
  title: string;
  subject: string;
  body: string;
  social: NewsletterSocial;
};

export const ELETTER_GREETING = "Dear [Contact Name],";

export function starterEletter(): Eletter {
  return {
    kind: "eletter",
    design: "plum",
    kicker: "A letter",
    title: "Letter title",
    subject: "Letter title",
    body: ELETTER_GREETING,
    social: emptySocial(),
  };
}

export function packEletter(letter: Eletter) {
  return JSON.stringify({ v: 2, ...letter, kind: "eletter", body: letter.body.slice(0, 8000) });
}

export function isEletterPack(body: string) {
  const text = String(body ?? "").trim();
  if (!text.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(text) as { v?: number; kind?: string };
    return parsed.kind === "eletter" && parsed.v === 2;
  } catch {
    return false;
  }
}

export function unpackEletter(body: string): Eletter | null {
  if (!isEletterPack(body)) return null;
  try {
    const parsed = JSON.parse(body) as Partial<Eletter>;
    if (!isDesign(parsed.design)) return null;
    return {
      kind: "eletter",
      design: parsed.design,
      kicker: String(parsed.kicker ?? "A letter").slice(0, 40),
      title: String(parsed.title ?? "").slice(0, 120),
      subject: String(parsed.subject ?? parsed.title ?? "").slice(0, 120),
      body: String(parsed.body ?? "").slice(0, 8000),
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

export function readEletterSend(raw: string): { letter: Eletter; contact: NewsletterContact } | null {
  try {
    const parsed = JSON.parse(raw) as { letter?: Eletter; contact?: Partial<NewsletterContact> };
    const letter = unpackEletter(JSON.stringify({ v: 2, ...(parsed.letter ?? {}) }));
    if (!letter || !parsed.contact) return null;
    return {
      letter,
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

export function plainEletter(letter: Eletter) {
  const body = letter.body.replace(/\s*\[\[book:[a-f0-9]+\]\]\s*/gi, "\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return [letter.title.trim(), body].filter(Boolean).join("\n\n");
}

export function renderEletter(input: {
  letter: Eletter;
  contact: NewsletterContact;
  logoSrc: string;
  mode?: "preview" | "email" | "page";
  href?: string;
  bookHref?: string;
}) {
  const design = isDesign(input.letter.design) ? input.letter.design : "plum";
  const theme = THEMES[design];
  const title = escapeHtml(input.letter.title.trim() || "Letter");
  const kicker = escapeHtml(input.letter.kicker.trim() || "A letter");
  const mark = logoBlock("", input.contact.name, theme.layout === "rail" ? "#ffffff" : theme.ink);
  const portrait = smallPortrait(input.logoSrc);
  const contact = contactLines(input.contact);
  const social = socialLinks(input.letter.social, "#ffffff");
  const booked = input.letter.body.match(/\[\[book:([a-f0-9]{16,40})\]\]/i);
  const bookHref = booked ? input.bookHref || `https://youradviser.grok.me/api/book/${booked[1]}` : "";
  const cleanBody = input.letter.body.replace(/\s*\[\[book:[a-f0-9]+\]\]\s*/gi, "\n\n").trim();
  const copy = `${letterCopy(cleanBody, theme)}${bookHref ? bookingButtonHtml(bookHref, theme) : ""}`;
  const shell = design === "ruled"
    ? ruledSheet(theme, mark, kicker, title, copy, contact, social, portrait, input.contact.website)
    : fancySheet(theme, mark, kicker, title, copy, contact, social, portrait, input.contact.website);
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:${theme.canvas}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${theme.canvas}"><tr><td align="center" style="padding:16px">${shell}</td></tr></table></body></html>`;
}

export function renderMeetingEletter(input: {
  design?: EletterDesign;
  kicker: string;
  title: string;
  bodyHtml: string;
  contact: NewsletterContact;
  logoSrc: string;
  compliance: string;
}) {
  const design = isDesign(input.design) ? input.design : "plum";
  const theme = THEMES[design];
  const title = escapeHtml(input.title.trim() || "Meeting");
  const kicker = escapeHtml(input.kicker.trim() || "Meeting");
  const mark = logoBlock("", input.contact.name, theme.layout === "rail" ? "#ffffff" : theme.ink);
  const portrait = smallPortrait(input.logoSrc);
  const social = socialLinks({ linkedin: "", instagram: "", facebook: "", youtube: "" }, "#ffffff");
  const footer = footerBlock(theme, [], social, portrait, true);
  const compliance = `<tr><td style="padding:0 24px 18px;background:${theme.header};color:#ffffff;font-family:${theme.font};font-size:12px;line-height:1.45">${escapeHtml(input.compliance)}</td></tr>`;
  const shell = `<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:${theme.page};border-collapse:collapse"><tr><td align="center" bgcolor="${theme.header}" style="padding:28px 24px 22px;background:${theme.header};color:#ffffff"><div style="display:inline-block;background:#ffffff;padding:8px 14px">${mark}</div><div style="margin-top:14px;letter-spacing:3px;font-size:12px;text-transform:uppercase;font-family:${theme.font};color:${theme.gold}">${kicker}</div></td></tr><tr><td height="6" bgcolor="${theme.gold}" style="background:${theme.gold};font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="padding:28px 32px 8px;background:${theme.page}"><div style="font-family:${theme.font};font-size:30px;line-height:1.15;font-weight:700;color:${theme.ink}">${title}</div><div style="width:72px;height:4px;background:${theme.gold};margin:14px 0 0"></div></td></tr><tr><td style="padding:8px 32px 28px;background:${theme.page};font-family:${theme.font};font-size:16px;line-height:1.65;color:${theme.ink}">${input.bodyHtml}</td></tr>${footer}${compliance}</table>`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:${theme.canvas}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${theme.canvas}"><tr><td align="center" style="padding:16px">${shell}</td></tr></table></body></html>`;
}

type Layout = "crest" | "ribbon" | "atelier" | "rail" | "dusk" | "ruled";

type Theme = {
  canvas: string;
  page: string;
  header: string;
  gold: string;
  ink: string;
  muted: string;
  font: string;
  layout: Layout;
};

const THEMES: Record<EletterDesign, Theme> = {
  plum: { canvas: "#f3e4ee", page: "#fff8f3", header: "#5c1a4a", gold: "#e4b15a", ink: "#3a1230", muted: "#6d4a5c", font: "Georgia,Times New Roman,serif", layout: "crest" },
  azure: { canvas: "#e5f0ff", page: "#ffffff", header: "#0e4da8", gold: "#f0c14a", ink: "#0c2f6b", muted: "#4d6488", font: "Segoe UI,Arial,sans-serif", layout: "ribbon" },
  coral: { canvas: "#ffe8e0", page: "#fff6f2", header: "#e06a4f", gold: "#f2c9a0", ink: "#6b2e22", muted: "#8a5a4c", font: "Georgia,Times New Roman,serif", layout: "atelier" },
  emerald: { canvas: "#e5f4ec", page: "#f7fbf8", header: "#0f6b4c", gold: "#d4af37", ink: "#0d3d2c", muted: "#4d6b5c", font: "Georgia,Times New Roman,serif", layout: "rail" },
  sunset: { canvas: "#ffe8d6", page: "#fffaf4", header: "#c2416b", gold: "#f4a261", ink: "#4a2030", muted: "#8a5a55", font: "Segoe UI,Arial,sans-serif", layout: "dusk" },
  ruled: { canvas: "#efe6d2", page: "#fbf6e8", header: "#efe2c4", gold: "#d35b5b", ink: "#2c2416", muted: "#7a6a52", font: "Georgia,Times New Roman,serif", layout: "ruled" },
};

function isDesign(value: unknown): value is EletterDesign {
  return ELETTER_DESIGNS.some((item) => item.id === value);
}

function fancySheet(theme: Theme, logo: string, kicker: string, title: string, copy: string, contact: string[], social: string, portrait: string, website = "") {
  const width = "640";
  const footer = footerBlock(theme, contact, social, portrait, false, website);
  if (theme.layout === "rail") {
    return `<table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${width}px;background:${theme.page};border-collapse:collapse"><tr><td width="168" valign="top" bgcolor="${theme.header}" style="width:168px;background:${theme.header};color:#ffffff;padding:28px 16px;font-family:${theme.font}"><div style="letter-spacing:2px;font-size:12px;text-transform:uppercase;color:${theme.gold}">${kicker}</div><div style="margin-top:14px">${logo}</div></td><td valign="top" style="padding:32px 28px;background:${theme.page}"><div style="font-family:${theme.font};font-size:32px;line-height:1.15;color:${theme.ink};font-weight:700">${title}</div><div style="width:64px;height:3px;background:${theme.gold};margin:14px 0 18px"></div><div style="font-family:${theme.font};font-size:16px;line-height:1.6;color:${theme.ink}">${copy}</div></td></tr>${footer}</table>`;
  }
  const header = theme.layout === "crest"
    ? `<tr><td align="center" bgcolor="${theme.header}" style="padding:28px 24px 22px;background:${theme.header};color:#ffffff"><div style="display:inline-block;background:#ffffff;padding:8px 14px">${logo}</div><div style="margin-top:14px;letter-spacing:3px;font-size:12px;text-transform:uppercase;font-family:${theme.font};color:${theme.gold}">${kicker}</div></td></tr><tr><td height="6" bgcolor="${theme.gold}" style="background:${theme.gold};font-size:0;line-height:0">&nbsp;</td></tr>`
    : theme.layout === "atelier"
      ? `<tr><td height="14" bgcolor="${theme.header}" style="background:${theme.header};font-size:0">&nbsp;</td></tr><tr><td style="padding:22px 32px 0;background:${theme.page}"><table role="presentation" width="100%"><tr><td>${logo}</td><td align="right" style="font-family:${theme.font};letter-spacing:2px;text-transform:uppercase;color:${theme.header};font-size:12px">${kicker}</td></tr></table></td></tr>`
      : `<tr><td bgcolor="${theme.header}" style="padding:22px 28px;background:${theme.header}"><table role="presentation" width="100%"><tr><td style="background:#ffffff;padding:6px 10px;width:1px">${logo}</td><td align="right" style="color:#ffffff;font-family:${theme.font};font-size:13px;letter-spacing:2px;text-transform:uppercase">${kicker}</td></tr></table></td></tr><tr><td height="5" bgcolor="${theme.gold}" style="background:${theme.gold};font-size:0">&nbsp;</td></tr>`;
  return `<table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${width}px;background:${theme.page};border-collapse:collapse">${header}<tr><td style="padding:28px 32px 8px;background:${theme.page}"><div style="font-family:${theme.font};font-size:${theme.layout === "atelier" ? "36px" : "30px"};line-height:1.15;font-weight:700;color:${theme.ink}">${title}</div><div style="width:72px;height:4px;background:${theme.gold};margin:14px 0 0"></div></td></tr><tr><td style="padding:8px 32px 28px;background:${theme.page};font-family:${theme.font};font-size:16px;line-height:1.65;color:${theme.ink}">${copy}</td></tr>${footer}</table>`;
}

function ruledSheet(theme: Theme, logo: string, kicker: string, title: string, copy: string, contact: string[], social: string, portrait: string, website = "") {
  return `<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:${theme.page};border:1px solid #e4d7b8;border-collapse:collapse"><tr><td style="padding:16px 20px 8px;background:#f4ead2"><table role="presentation" width="100%"><tr><td style="font-family:${theme.font};font-size:18px;color:${theme.ink}">${logo}</td><td align="right" style="font-family:${theme.font};font-style:italic;color:#7a5b32;font-size:18px">${kicker}</td></tr></table></td></tr><tr><td style="padding:8px 20px 0;background:${theme.page};font-family:${theme.font};font-size:26px;color:${theme.ink}">${title}</td></tr><tr><td style="padding:10px 12px 16px;background:${theme.page}">${copy}</td></tr>${footerBlock(theme, contact, social, portrait, false, website)}</table>`;
}

function bookingButtonHtml(href: string, theme: Theme) {
  const safe = escapeAttr(href);
  const color = "#1C3D36";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px"><tr><td align="center" bgcolor="${color}" style="border-radius:8px;background:${color}"><a href="${safe}" target="_blank" style="display:inline-block;padding:14px 22px;font-family:${theme.font};font-size:16px;line-height:1.2;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;background:${color}">Book a meeting</a></td></tr></table>`;
}

function letterCopy(body: string, theme: Theme) {
  if (theme.layout === "ruled") return ruledCopy(body, theme);
  const full = linkify(escapeHtml(body).replace(/\n/g, "<br>"));
  return full || `<span style="color:${theme.muted}">Write the letter to see it here.</span>`;
}

function linkify(html: string) {
  return html.replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="font-weight:700">${url}</a>`);
}

function ruledCopy(body: string, theme: Theme) {
  const lines = visualLines(body, 52);
  const sheet = lines.length ? lines : ["Write the letter to see it here."];
  const rows = sheet.map((line) => paperRow(line, theme, false));
  const pad = Math.max(0, 8 - sheet.length);
  for (let index = 0; index < pad; index += 1) rows.push(paperRow("", theme, true));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows.join("")}</table>`;
}

function paperRow(line: string, theme: Theme, blank: boolean) {
  const text = blank ? "&nbsp;" : escapeHtml(line) || "&nbsp;";
  return `<tr><td width="34" style="width:34px;border-right:2px solid ${theme.gold};border-bottom:1px solid #c5d5ea;background:${theme.page};font-size:0">&nbsp;</td><td style="height:32px;border-bottom:1px solid #c5d5ea;background:${theme.page};padding:4px 10px 2px;font-family:${theme.font};font-size:16px;line-height:24px;color:${theme.ink}">${text}</td></tr>`;
}

function footerBlock(theme: Theme, contact: string[], social: string, portrait: string, blankOk = false, website = "") {
  const band = theme.layout === "ruled" ? "#7a5b32" : theme.header;
  const lines = contact.map((line) => `<div style="margin-top:4px">${escapeHtml(line)}</div>`).join("");
  const button = websiteButtonHtml(website);
  if (blankOk && !lines && !portrait && !social && !button) return "";
  const copy = `${lines}${button}` || (blankOk ? "" : "Add your name, phone, and email in Profile.");
  const side = `${social ? `<div style="margin-bottom:8px">${social}</div>` : ""}${portrait}`;
  return `<tr><td bgcolor="${band}" style="padding:16px 24px;background:${band};color:#ffffff;font-family:${theme.font};font-size:14px;line-height:1.5"><table role="presentation" width="100%"><tr><td valign="middle">${copy || "&nbsp;"}</td>${side ? `<td align="right" valign="middle" style="padding-left:16px;width:1px">${side}</td>` : ""}</tr></table></td></tr>`;
}

function smallPortrait(src: string) {
  if (!(src.startsWith("cid:") || src.startsWith("data:image/") || src.startsWith("https://") || src.startsWith("http://"))) return "";
  return `<img src="${escapeAttr(src)}" alt="" style="display:block;width:auto;max-width:128px;height:auto;max-height:128px;border:0;border-radius:8px">`;
}

function logoBlock(src: string, name: string, ink: string) {
  if (src.startsWith("cid:") || src.startsWith("data:image/") || src.startsWith("https://") || src.startsWith("http://")) {
    return `<img src="${escapeAttr(src)}" alt="" style="display:block;width:auto;max-width:180px;height:auto;border:0">`;
  }
  return `<div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:${ink}">${escapeHtml(name.trim() || "Your name")}</div>`;
}

function socialLinks(social: NewsletterSocial, color: string) {
  const links = [
    ["LinkedIn", social.linkedin],
    ["Instagram", social.instagram],
    ["Facebook", social.facebook],
  ].filter((item) => item[1].trim());
  return links.map(([label, href]) => `<a href="${escapeAttr(href)}" style="color:${color};text-decoration:underline;font-family:Segoe UI,Arial,sans-serif;font-size:13px;margin-left:10px">${escapeHtml(label)}</a>`).join("");
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

function visualLines(body: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of body.replace(/\r\n/g, "\n").split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      if (lines.length) lines.push("");
      continue;
    }
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

function escapeHtml(value: string) {
  return value.replace(/&/g, "&" + "amp;").replace(/</g, "&" + "lt;").replace(/>/g, "&" + "gt;");
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/"/g, "&" + "quot;");
}
