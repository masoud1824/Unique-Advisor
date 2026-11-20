import { recordedAudience, type CardContact } from "./card-preview.ts";
import { approvalFingerprint, approvalStillValid, claimDelivery, type DeliveryPacket } from "./desk-workflows.ts";
import { NEWSLETTER_DESIGNS, type NewsletterDesign } from "./newsletter.ts";

export const NEWSLETTER_APPROVAL = "I approve this exact newsletter preview";

export type ArchiveArticle = {
  heading: string;
  text: string;
  images: string[];
  links: { label: string; href: string }[];
};

export type NewsletterVersion = {
  version: number;
  title: string;
  subject: string;
  design: NewsletterDesign;
  tags: string[];
  articles: ArchiveArticle[];
  attachments: string[];
  createdAt: string;
  updatedAt: string;
};

export type SavedNewsletter = {
  id: string;
  advisorId: string;
  createdBy: "advisor" | "assistant";
  archived: boolean;
  versions: NewsletterVersion[];
};

export type DeliveryResult = { name: string; email: string; result: "simulated" | "failed" | "excluded" };

export type NewsletterDelivery = {
  id: string;
  advisorId: string;
  newsletterId: string;
  version: number;
  snapshot: NewsletterVersion;
  sender: string;
  source: "database" | "dropbox";
  recipients: DeliveryResult[];
  exclusions: string[];
  at: string;
};

export type ArchiveState = {
  newsletters: SavedNewsletter[];
  sends: NewsletterDelivery[];
  pending: { request: string; fingerprint: string; preview: string } | null;
};

export function emptyArchive(): ArchiveState {
  return { newsletters: [], sends: [], pending: null };
}

const memory = globalThis as { __uaNews?: Map<string, ArchiveState> };

export function advisorArchive(advisorId: string) {
  if (!memory.__uaNews) memory.__uaNews = new Map();
  const found = memory.__uaNews.get(advisorId);
  if (found) return found;
  const created = emptyArchive();
  memory.__uaNews.set(advisorId, created);
  return created;
}

export function rememberAdvisorArchive(advisorId: string, state: ArchiveState) {
  if (!memory.__uaNews) memory.__uaNews = new Map();
  memory.__uaNews.set(advisorId, state);
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function latestVersion(newsletter: SavedNewsletter) {
  return newsletter.versions[newsletter.versions.length - 1];
}

function sentVersion(state: ArchiveState, newsletterId: string, version: number) {
  return state.sends.some((item) => item.newsletterId === newsletterId && item.version === version && item.recipients.some((row) => row.result === "simulated"));
}

function designOrPine(value: string): NewsletterDesign {
  return NEWSLETTER_DESIGNS.some((item) => item.id === value) ? value as NewsletterDesign : "pine";
}

export function article(heading: string, text: string, images: string[] = [], links: ArchiveArticle["links"] = []): ArchiveArticle {
  return { heading, text, images, links };
}

export function createNewsletter(state: ArchiveState, input: {
  advisorId: string;
  createdBy: "advisor" | "assistant";
  title: string;
  subject?: string;
  design?: string;
  tags?: string[];
  articles: ArchiveArticle[];
  attachments?: string[];
  now: string;
}): { state: ArchiveState; newsletter: SavedNewsletter } {
  const next = copy(state);
  const version: NewsletterVersion = {
    version: 1,
    title: input.title.trim(),
    subject: (input.subject || input.title).trim(),
    design: designOrPine(input.design || "pine"),
    tags: input.tags || [],
    articles: input.articles,
    attachments: input.attachments || [],
    createdAt: input.now,
    updatedAt: input.now,
  };
  const newsletter: SavedNewsletter = {
    id: `nl-${input.advisorId}-${next.newsletters.length + 1}`,
    advisorId: input.advisorId,
    createdBy: input.createdBy,
    archived: false,
    versions: [version],
  };
  next.newsletters.push(newsletter);
  next.pending = null;
  return { state: next, newsletter };
}

function withLatest(state: ArchiveState, advisorId: string, newsletterId: string, change: (version: NewsletterVersion) => NewsletterVersion, now: string) {
  const next = copy(state);
  const newsletter = next.newsletters.find((item) => item.id === newsletterId && item.advisorId === advisorId);
  if (!newsletter) return { ok: false as const, error: "That newsletter is not in this advisor's archive." };
  const current = latestVersion(newsletter);
  const changed = change(copy(current));
  changed.updatedAt = now;
  if (sentVersion(state, newsletter.id, current.version)) {
    changed.version = current.version + 1;
    changed.createdAt = now;
    newsletter.versions.push(changed);
  } else {
    newsletter.versions[newsletter.versions.length - 1] = { ...changed, version: current.version, createdAt: current.createdAt };
  }
  next.pending = null;
  return { ok: true as const, state: next, newsletter };
}

export function addArticle(state: ArchiveState, advisorId: string, newsletterId: string, item: ArchiveArticle, now: string) {
  return withLatest(state, advisorId, newsletterId, (version) => {
    version.articles = [...version.articles, item];
    return version;
  }, now);
}

export function editArticle(state: ArchiveState, advisorId: string, newsletterId: string, index: number, item: ArchiveArticle, now: string) {
  return withLatest(state, advisorId, newsletterId, (version) => {
    if (!version.articles[index]) return version;
    const articles = [...version.articles];
    articles[index] = item;
    version.articles = articles;
    return version;
  }, now);
}

export function removeArticle(state: ArchiveState, advisorId: string, newsletterId: string, index: number, now: string) {
  return withLatest(state, advisorId, newsletterId, (version) => {
    version.articles = version.articles.filter((_, position) => position !== index);
    return version;
  }, now);
}

export function reorderArticles(state: ArchiveState, advisorId: string, newsletterId: string, from: number, to: number, now: string) {
  return withLatest(state, advisorId, newsletterId, (version) => {
    const articles = [...version.articles];
    const [moved] = articles.splice(from, 1);
    if (!moved) return version;
    articles.splice(to, 0, moved);
    version.articles = articles;
    return version;
  }, now);
}

export function duplicateNewsletter(state: ArchiveState, advisorId: string, newsletterId: string, now: string) {
  const source = state.newsletters.find((item) => item.id === newsletterId && item.advisorId === advisorId);
  if (!source) return { ok: false as const, error: "That newsletter is not in this advisor's archive." };
  const current = latestVersion(source);
  return {
    ok: true as const,
    ...createNewsletter(state, {
      advisorId,
      createdBy: source.createdBy,
      title: `${current.title} copy`,
      subject: current.subject,
      design: current.design,
      tags: current.tags,
      articles: copy(current.articles),
      attachments: current.attachments,
      now,
    }),
  };
}

export function archiveNewsletter(state: ArchiveState, advisorId: string, newsletterId: string) {
  const next = copy(state);
  const newsletter = next.newsletters.find((item) => item.id === newsletterId && item.advisorId === advisorId);
  if (!newsletter) return { ok: false as const, error: "That newsletter is not in this advisor's archive." };
  newsletter.archived = true;
  return { ok: true as const, state: next, newsletter };
}

export function reopenNewsletter(state: ArchiveState, advisorId: string, newsletterId: string) {
  const next = copy(state);
  const newsletter = next.newsletters.find((item) => item.id === newsletterId && item.advisorId === advisorId);
  if (!newsletter) return { ok: false as const, error: "That newsletter is not in this advisor's archive." };
  newsletter.archived = false;
  return { ok: true as const, state: next, newsletter };
}

export function searchNewsletters(state: ArchiveState, advisorId: string, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word && !["my", "the", "a", "an", "newsletter", "newsletters", "find", "use", "last", "month", "but", "change"].includes(word));
  return state.newsletters.filter((item) => {
    if (item.advisorId !== advisorId) return false;
    const version = latestVersion(item);
    const haystack = [version.title, version.subject, version.tags.join(" "), ...version.articles.flatMap((entry) => [entry.heading, entry.text])].join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&" + "amp;")
    .replaceAll("<", "&" + "lt;")
    .replaceAll(">", "&" + "gt;")
    .replaceAll("\"", "&" + "quot;");
}

export function articleHtml(item: ArchiveArticle) {
  const text = escapeHtml(item.text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
  const images = item.images.map((src) => `<img src="${escapeHtml(src)}" alt="">`).join("");
  const links = item.links.map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join(" ");
  return `<h2>${escapeHtml(item.heading)}</h2><p>${text}</p>${images}${links}`;
}

export function previewNewsletter(version: NewsletterVersion, sender: string, width: "desktop" | "mobile") {
  const pixels = width === "desktop" ? 640 : 360;
  const stories = version.articles.map((item) => articleHtml(item)).join("");
  return [
    "<!DOCTYPE html><html><head>",
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `</head><body><table role="presentation" width="${pixels}" style="width:100%;max-width:${pixels}px">`,
    `<tr><td>Subject: ${escapeHtml(version.subject)}</td></tr>`,
    `<tr><td>From: ${escapeHtml(sender)}</td></tr>`,
    `<tr><td><h1>${escapeHtml(version.title)}</h1>${stories}</td></tr>`,
    "</table></body></html>",
  ].join("");
}

function sentKeys(state: ArchiveState, newsletterId: string, version: number) {
  return state.sends.flatMap((item) => item.newsletterId === newsletterId && item.version === version
    ? item.recipients.filter((row) => row.result === "simulated").map((row) => `${newsletterId}|v${version}|${row.email}`)
    : []);
}

function sendPacket(version: NewsletterVersion, sender: string, recipients: { name: string; email: string }[]): DeliveryPacket {
  return {
    kind: "newsletter",
    recipients: recipients.map((item) => ({ name: item.name, email: item.email })),
    subject: version.subject,
    design: `${version.design}|${sender}|v${version.version}`,
    body: JSON.stringify(version.articles),
    attachments: version.attachments,
  };
}

export function newsletterFingerprint(version: NewsletterVersion, sender: string, recipients: { name: string; email: string }[]) {
  return approvalFingerprint(sendPacket(version, sender, recipients));
}

export function planNewsletterSend(state: ArchiveState, input: {
  advisorId: string;
  newsletterId: string;
  request: string;
  sender: string;
  contacts?: CardContact[];
}) {
  const newsletter = state.newsletters.find((item) => item.id === input.newsletterId && item.advisorId === input.advisorId);
  if (!newsletter) return { ok: false as const, error: "That newsletter is not in this advisor's archive. Nothing was sent." };
  const version = latestVersion(newsletter);
  if (version.articles.length < 1) return { ok: false as const, error: "Add at least one article before sending. Nothing was sent." };
  const sender = input.sender.trim();
  if (!sender.includes("@")) return { ok: false as const, error: "This advisor has no sender address. Nothing was sent." };
  const audience = recordedAudience({
    request: input.request,
    contacts: input.contacts,
    alreadySent: sentKeys(state, newsletter.id, version.version),
    sentPrefix: `${newsletter.id}|v${version.version}`,
    alreadySentReason: "This newsletter version was already delivered to this address.",
  });
  if (!audience.ok) return audience;
  const fingerprint = newsletterFingerprint(version, sender, audience.recipients);
  const desktop = previewNewsletter(version, sender, "desktop");
  const mobile = previewNewsletter(version, sender, "mobile");
  const preview = [
    "Simulated newsletter preview. Nothing has been sent.",
    `Version: ${newsletter.id} version ${version.version}`,
    `Subject: ${version.subject}`,
    `Sender: ${sender}`,
    `Source: ${audience.source}`,
    `Articles (${version.articles.length}): ${version.articles.map((item) => item.heading).join("; ") || "none"}`,
    "Complete newsletter:",
    version.articles.map((item, index) => `${index + 1}. ${item.heading}\n${item.text}`).join("\n\n") || "none",
    `Recipients (${audience.count}):`,
    audience.recipients.map((item) => `- ${item.name} <${item.email}>`).join("\n") || "- none",
    "Exclusions:",
    audience.exclusions.map((line) => `- ${line}`).join("\n") || "- none",
    `Recipient count: ${audience.count}`,
    `Say “${NEWSLETTER_APPROVAL}” to simulate this exact version. A change withdraws this approval.`,
  ].join("\n");
  return { ok: true as const, newsletter, version, audience, fingerprint, preview, desktop, mobile };
}

export function simulateNewsletterSend(state: ArchiveState, input: {
  advisorId: string;
  newsletterId: string;
  request: string;
  sender: string;
  approval: string;
  fingerprint: string;
  now: string;
  contacts?: CardContact[];
  failAddresses?: string[];
}) {
  const planned = planNewsletterSend(state, input);
  if (!planned.ok) return { ...planned, emailed: false as const };
  if (input.approval.trim() !== NEWSLETTER_APPROVAL) return { ok: false as const, emailed: false as const, error: "This newsletter has not been approved. Nothing was sent." };
  const packet = sendPacket(planned.version, input.sender, planned.audience.recipients);
  if (!approvalStillValid(input.fingerprint, packet)) {
    return { ok: false as const, emailed: false as const, error: "That approval was withdrawn because the newsletter or its recipients changed. Nothing was sent." };
  }
  if (planned.audience.count === 0) return { ok: false as const, emailed: false as const, error: "Nobody remains after the exclusions. Nothing was sent." };
  const failed = new Set((input.failAddresses || []).map((item) => item.toLowerCase()));
  const fingerprint = [planned.newsletter.id, planned.version.version, planned.audience.recipients.map((item) => `${item.email}:${failed.has(item.email) ? "fail" : "ok"}`).join("|")].join("\n");
  const guard = new Set(state.sends.map((item) => item.id));
  const claimed = claimDelivery(guard, fingerprint, () => ({ ok: true as const, detail: "simulated" }));
  if (!claimed.ok) return { ok: false as const, emailed: false as const, error: "This exact delivery was already simulated. Successful recipients were not sent again." };
  const recipients: DeliveryResult[] = planned.audience.recipients.map((item) => ({
    name: item.name,
    email: item.email,
    result: failed.has(item.email) ? "failed" : "simulated",
  }));
  const next = copy(state);
  const newsletter = next.newsletters.find((item) => item.id === planned.newsletter.id);
  if (!newsletter) return { ok: false as const, emailed: false as const, error: "That newsletter is not in this advisor's archive. Nothing was sent." };
  if (recipients.some((item) => item.result === "simulated")) newsletter.archived = true;
  next.sends.push({
    id: `send-${next.sends.length + 1}`,
    advisorId: input.advisorId,
    newsletterId: newsletter.id,
    version: planned.version.version,
    snapshot: copy(planned.version),
    sender: input.sender,
    source: planned.audience.source,
    recipients,
    exclusions: planned.audience.exclusions,
    at: input.now,
  });
  next.pending = null;
  const failedCount = recipients.filter((item) => item.result === "failed").length;
  return {
    ok: true as const,
    emailed: false as const,
    state: next,
    recipients,
    detail: failedCount
      ? `Simulated ${recipients.length - failedCount} of ${recipients.length}. ${failedCount} failed and can be retried. No email was sent.`
      : `Simulated newsletter version ${planned.version.version} to ${recipients.length} fictional recipient${recipients.length === 1 ? "" : "s"}. No email was sent.`,
  };
}

function ordinal(text: string) {
  const names: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  const word = text.match(/\b(first|second|third|fourth|fifth)\b/i);
  if (word) return names[word[1].toLowerCase()];
  const digit = text.match(/\barticle\s+(\d+)/i);
  return digit ? Number(digit[1]) : 0;
}

export function archiveIntent(text: string) {
  const tidy = text.replace(/\s+/g, " ").trim();
  if (new RegExp(NEWSLETTER_APPROVAL, "i").test(tidy)) return true;
  if (/\breplace the (?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+article\b/i.test(tidy)) return true;
  if (/\badd an article\b/i.test(tidy)) return true;
  if (!/\bnewsletters?\b/i.test(tidy)) return false;
  return /\bsave (?:it )?for later\b|\bfind my\b|\blast month\b|\breopen\b|\bduplicate\b|\bfictional\b/i.test(tidy);
}

export function newsletterArchiveTurn(state: ArchiveState, input: { advisorId: string; request: string; sender: string; now: string; approval?: string }) {
  const request = input.request.replace(/\s+/g, " ").trim();
  if (new RegExp(`^${NEWSLETTER_APPROVAL}$`, "i").test(request)) {
    if (!state.pending) return { handled: true, state, reply: "There is no newsletter preview waiting. Nothing was sent.", emailed: false as const };
    const result = simulateNewsletterSend(state, {
      advisorId: input.advisorId,
      newsletterId: state.pending.request.split("\n")[0],
      request: state.pending.request.split("\n").slice(1).join("\n"),
      sender: input.sender,
      approval: NEWSLETTER_APPROVAL,
      fingerprint: state.pending.fingerprint,
      now: input.now,
    });
    if (!result.ok) return { handled: true, state, reply: result.error, emailed: false as const };
    return { handled: true, state: result.state, reply: result.detail, emailed: false as const };
  }
  if (/\bsave (?:it )?for later\b/i.test(request) && /\bnewsletters?\b/i.test(request)) {
    const topic = request.match(/\b(?:a|an|the)\s+([a-z][a-z ]{2,40}?)\s+newsletters?\b/i)?.[1]?.trim() || "Planning";
    const created = createNewsletter(state, {
      advisorId: input.advisorId,
      createdBy: "assistant",
      title: `${topic[0].toUpperCase()}${topic.slice(1)} Newsletter`,
      design: "pine",
      tags: [topic.toLowerCase()],
      articles: [article("Introduction", `This is a saved ${topic} draft for later. It does not use client records.`)],
      now: input.now,
    });
    return { handled: true, state: created.state, reply: `Saved “${created.newsletter.versions[0].title}” in this advisor's archive. It has 1 article. It was not sent.`, emailed: false as const };
  }
  if (/\bfind my\b/i.test(request)) {
    const found = searchNewsletters(state, input.advisorId, request);
    if (!found.length) return { handled: true, state, reply: "I could not find that newsletter in this advisor's archive.", emailed: false as const };
    const lines = found.map((item) => {
      const version = latestVersion(item);
      return `${item.id}: ${version.title}, version ${version.version}, ${version.articles.length} article${version.articles.length === 1 ? "" : "s"}${item.archived ? ", archived" : ""}`;
    });
    return { handled: true, state, reply: lines.join("\n"), emailed: false as const };
  }
  if (/\blast month\b/i.test(request) && /\bintroduction\b/i.test(request)) {
    const month = input.now.slice(0, 7);
    const previous = `${month.endsWith("01") ? String(Number(month.slice(0, 4)) - 1) : month.slice(0, 4)}-${month.endsWith("01") ? "12" : String(Number(month.slice(5, 7)) - 1).padStart(2, "0")}`;
    const candidates = state.newsletters.filter((item) => item.advisorId === input.advisorId && latestVersion(item).updatedAt.startsWith(previous));
    const source = candidates[candidates.length - 1];
    if (!source) return { handled: true, state, reply: "I could not find a newsletter updated last month for this advisor.", emailed: false as const };
    const duplicated = duplicateNewsletter(state, input.advisorId, source.id, input.now);
    if (!duplicated.ok) return { handled: true, state, reply: duplicated.error, emailed: false as const };
    const revised = editArticle(duplicated.state, input.advisorId, duplicated.newsletter.id, 0, {
      ...latestVersion(duplicated.newsletter).articles[0],
      text: "Revised introduction. The other articles are unchanged.",
    }, input.now);
    if (!revised.ok) return { handled: true, state: duplicated.state, reply: revised.error, emailed: false as const };
    return { handled: true, state: revised.state, reply: `Duplicated last month's newsletter and changed only the introduction. The earlier version was not changed, and nothing was sent.`, emailed: false as const };
  }
  const own = [...state.newsletters].reverse().find((item) => item.advisorId === input.advisorId);
  if (/\breplace the\b/i.test(request) && /\barticle\b/i.test(request)) {
    if (!own) return { handled: true, state, reply: "There is no newsletter to revise.", emailed: false as const };
    const index = ordinal(request) - 1;
    const heading = request.match(/heading "([^"]+)"/i)?.[1] || "";
    const text = request.match(/text "([^"]+)"/i)?.[1] || "";
    if (index < 0 || !heading || !text) return { handled: true, state, reply: "Tell me the article number, heading, and text. I did not change the newsletter.", emailed: false as const };
    const current = latestVersion(own).articles[index];
    if (!current) return { handled: true, state, reply: "That article number is not in the newsletter.", emailed: false as const };
    const revised = editArticle(state, input.advisorId, own.id, index, { ...current, heading, text }, input.now);
    if (!revised.ok) return { handled: true, state, reply: revised.error, emailed: false as const };
    return { handled: true, state: revised.state, reply: `Replaced article ${index + 1} only. The other articles are unchanged. Nothing was sent.`, emailed: false as const };
  }
  if (/\badd an article about\b/i.test(request)) {
    if (!own) return { handled: true, state, reply: "There is no newsletter to add to.", emailed: false as const };
    const about = request.match(/\babout\s+(.+?)[.?]?$/i)?.[1]?.trim() || "the topic";
    const revised = addArticle(state, input.advisorId, own.id, article(about[0].toUpperCase() + about.slice(1), `Draft article about ${about}. No client records were used.`), input.now);
    if (!revised.ok) return { handled: true, state, reply: revised.error, emailed: false as const };
    return { handled: true, state: revised.state, reply: `Added an article about ${about}. Nothing was sent.`, emailed: false as const };
  }
  if (/\bfictional\b/i.test(request) && /\bnewsletters?\b/i.test(request)) {
    if (!own) return { handled: true, state, reply: "Save a newsletter before preparing a send. Nothing was sent.", emailed: false as const };
    const planned = planNewsletterSend(state, { advisorId: input.advisorId, newsletterId: own.id, request, sender: input.sender });
    if (!planned.ok) return { handled: true, state, reply: planned.error, emailed: false as const };
    const next = copy(state);
    next.pending = { request: `${own.id}\n${request}`, fingerprint: planned.fingerprint, preview: planned.preview };
    return { handled: true, state: next, reply: planned.preview, emailed: false as const };
  }
  return { handled: false, state, reply: "", emailed: false as const };
}
