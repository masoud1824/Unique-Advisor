export function isBuiltinAdvisorSite(value: string) {
  return /\/a\/[^/]+\/site\/?$/i.test(String(value || "").trim());
}

export function shownWebsite(input: { siteMode?: string; siteUrl?: string; publicWebsite?: string; slug?: string }) {
  const mode = String(input.siteMode || "").trim().toLowerCase();
  const own = String(input.siteUrl || "").trim();
  const profile = String(input.publicWebsite || "").trim();
  const slug = String(input.slug || "").trim();
  const builtin = slug ? `https://youradviser.grok.me/a/${slug}/site` : "";
  const custom = (value: string) => (value && !isBuiltinAdvisorSite(value) ? value.slice(0, 300) : "");
  if (mode === "builtin") {
    if (builtin) return builtin;
    if (isBuiltinAdvisorSite(profile)) return profile.slice(0, 300);
    if (isBuiltinAdvisorSite(own)) return own.slice(0, 300);
    return "";
  }
  if (mode === "own") return custom(own) || custom(profile) || builtin || own.slice(0, 300) || profile.slice(0, 300);
  return custom(own) || custom(profile) || builtin || profile.slice(0, 300) || own.slice(0, 300);
}

export function useCurrentWebsite(value: string, website: string, previous: string[] = []) {
  const current = String(website || "").trim();
  let next = String(value || "");
  if (!current) return next;
  const held: string[] = [];
  next = next.replace(/https?:\/\/[^\s"'<>]*\/api\/book\/[a-f0-9]+/gi, (url) => {
    const mark = `@@BOOK${held.length}@@`;
    held.push(url);
    return mark;
  });
  next = next.replace(/https?:\/\/[^\s"'<>]*\/a\/[^/\s"'<>]+\/site\/?/gi, current);
  const seen = new Set<string>();
  for (const item of previous) {
    const prior = String(item || "").trim();
    if (prior.length < 8 || prior === current || seen.has(prior) || isBuiltinAdvisorSite(prior)) continue;
    seen.add(prior);
    next = next.split(prior).join(current);
  }
  return next.replace(/@@BOOK(\d+)@@/g, (_mark, index) => held[Number(index)] || "");
}

export const WEBSITE_BUTTON_LABEL = "Visit my website";
export const WEBSITE_BUTTON_COLOR = "#C9A227";

export function websiteHref(value: string) {
  const raw = String(value || "").trim().replace(/^visit my website:\s*/i, "");
  if (!raw || /\s/.test(raw) || raw.includes("@")) return "";
  if (/^[\d()+\-./]+$/.test(raw)) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const host = url.hostname.replace(/\.$/, "");
    if (!host.includes(".") || !/[a-z]/i.test(host)) return "";
  } catch {
    return "";
  }
  return withScheme;
}

export function isWebsiteLine(line: string) {
  const text = String(line || "").trim();
  if (/^visit my website\b/i.test(text)) return true;
  return Boolean(websiteHref(text));
}

function esc(value: string) {
  const amp = "&" + "amp;";
  const lt = "&" + "lt;";
  const gt = "&" + "gt;";
  const quot = "&" + "quot;";
  return String(value ?? "").replace(/&/g, amp).replace(/</g, lt).replace(/>/g, gt).replace(/"/g, quot);
}

export function websiteButtonText(url: string) {
  const href = websiteHref(url);
  if (!href) return "";
  return `${WEBSITE_BUTTON_LABEL}: ${href}`;
}

export function websiteButtonHtml(url: string) {
  const href = websiteHref(url);
  if (!href) return "";
  const safe = esc(href);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px"><tr><td align="center" bgcolor="${WEBSITE_BUTTON_COLOR}" style="border-radius:8px;background:${WEBSITE_BUTTON_COLOR}"><a href="${safe}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.2;font-weight:700;color:#1a1916;text-decoration:none;border-radius:8px;background:${WEBSITE_BUTTON_COLOR}">${WEBSITE_BUTTON_LABEL}</a></td></tr></table>`;
}

export function signatureWithWebsite(signature: string, website: string) {
  const href = websiteHref(website);
  const lines = String(signature || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isWebsiteLine(line));
  if (href) lines.push(websiteButtonText(href));
  return lines.join("\n");
}

export function cardHtml(text: string, imageUrl: string, signature = "") {
  const formatted = esc(text).replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
  const lines = String(signature || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const kept: string[] = [];
  let button = "";
  for (const line of lines) {
    if (isWebsiteLine(line)) {
      const href = websiteHref(line);
      if (href) button = websiteButtonHtml(href);
      continue;
    }
    kept.push(line);
  }
  const footer = kept.length || button
    ? `<div style="margin-top:8px;padding-top:14px;border-top:1px solid #e1e8ef;font-size:15px;line-height:1.5;color:#1a2332">${kept.map((line, index) => (index === 0 ? `<strong>${esc(line)}</strong>` : esc(line))).join("<br>")}${button}</div>`
    : "";
  const image = imageUrl
    ? `<img src="${esc(imageUrl)}" alt="Card" width="520" style="width:100%;max-width:520px;height:auto;display:block;border:0;border-radius:8px">`
    : "";
  return `<div style="font-family:Segoe UI,sans-serif;max-width:520px;color:#1a2332">${image}${formatted ? `<div style="font-size:16px;line-height:1.5;margin:16px 0">${formatted}</div>` : ""}${footer}</div>`;
}
