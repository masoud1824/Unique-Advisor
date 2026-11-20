export type DeliveryPacket = {
  kind: "card" | "letter" | "newsletter" | "form" | "campaign";
  recipients: Array<{ name: string; email: string }>;
  subject: string;
  design: string;
  body: string;
  attachments: string[];
};

export type ToolResult = { ok: true; detail: string } | { ok: false; error: string };

export function approvalFingerprint(packet: DeliveryPacket) {
  const people = packet.recipients.map((person) => `${person.name}<${person.email}>`).sort();
  const files = [...packet.attachments].sort();
  return [packet.kind, people.join("|"), packet.subject, packet.design, packet.body, files.join("|")].join("\n");
}

export function confirmationText(packet: DeliveryPacket) {
  const who = packet.recipients.map((person) => `${person.name} <${person.email || "no email on file"}>`).join(", ") || "no recipient";
  const files = packet.attachments.length ? packet.attachments.join(", ") : "none";
  const label = packet.kind === "card" ? "e-card" : packet.kind === "letter" ? "e-letter" : packet.kind === "form" ? "form" : packet.kind === "campaign" ? "campaign" : "newsletter";
  return [
    `Just to confirm: send this ${label} “${packet.subject}” to ${who}?`,
    `Design: ${packet.design || "none"}`,
    `Attachments: ${files}`,
    "This approval is only for this version and these recipients. A revision withdraws it.",
  ].join("\n");
}

export function approvalStillValid(approved: string, packet: DeliveryPacket) {
  return approved === approvalFingerprint(packet);
}

export function contactDeliveryBlock(tags: string, email: string) {
  const unsubscribed = String(tags || "").split(",").some((tag) => tag.trim().toLowerCase() === "unsubscribed");
  if (unsubscribed) return "Unsubscribed";
  if (!String(email || "").trim()) return "No email is recorded";
  return "";
}

export type NewsletterCandidate = { id: number; title: string; articles: Array<{ title: string; body: string }> };

function namedCopyId(text: string) {
  const source = String(text || "");
  if (/\bdid not open or change\b/i.test(source)) return 0;
  const ids = [
    ...source.matchAll(/\bsaved copy:?\s*#\s*(\d+)\b/gi),
    ...source.matchAll(/\b(?:newsletter\s+)?cop(?:y|ies)\s+#\s*(\d+)\b/gi),
    ...source.matchAll(/\bnewsletter\s+#\s*(\d+)\b/gi),
    ...source.matchAll(/\b(?:newsletter|issue|copy)\s+(?:number|no\.?|#)\s*(\d+)\b/gi),
  ].map((match) => Number(match[1]));
  const unique = [...new Set(ids)];
  return unique.length === 1 ? unique[0] : 0;
}

function namesOpenDraft(text: string) {
  return /\b(?:the|this|that)\s+open\b/i.test(String(text || "")) || /\bcurrently open\b/i.test(String(text || ""));
}

export function chooseOpenNewsletter<T extends NewsletterCandidate>(issues: T[], request: string, lastAssistant = "", preferredId = 0) {
  const haystack = `${request}\n${lastAssistant}`;
  const lowered = haystack.toLowerCase();
  const quoted = [...haystack.matchAll(/[“"]([^"”]{2,80})[”"]/g)].map((match) => match[1].trim().toLowerCase());
  const byArticle = issues.filter((issue) => issue.articles.some((article) => quoted.includes(article.title.toLowerCase())));
  if (byArticle.length === 1) return byArticle[0];
  const byLoose = issues.filter((issue) => issue.articles.some((article) => {
    const title = article.title.trim().toLowerCase();
    return title.length > 3 && lowered.includes(title);
  }));
  if (byLoose.length === 1) return byLoose[0];
  const byTitle = issues.filter((issue) => issue.title.trim().length > 3 && lowered.includes(issue.title.toLowerCase()));
  if (byTitle.length === 1) return byTitle[0];
  if (byTitle.length > 1) {
    const names = new Set(byTitle.map((issue) => issue.title.trim().toLowerCase()));
    if (names.size === 1) {
      const explicit = namedCopyId(request);
      const fromRequest = explicit ? byTitle.find((issue) => issue.id === explicit) : undefined;
      if (fromRequest) return fromRequest;
      const preferred = Number(preferredId) > 0 ? byTitle.find((issue) => issue.id === Number(preferredId)) : undefined;
      if (preferred) return preferred;
      if (namesOpenDraft(request)) {
        const fromOpen = namedCopyId(lastAssistant);
        const openDraft = fromOpen ? byTitle.find((issue) => issue.id === fromOpen) : undefined;
        if (openDraft) return openDraft;
      }
      const requestNamesTitle = [...names].some((name) => request.toLowerCase().includes(name));
      if (!requestNamesTitle) {
        const fromChat = namedCopyId(lastAssistant);
        const remembered = fromChat ? byTitle.find((issue) => issue.id === fromChat) : undefined;
        if (remembered) return remembered;
      }
      return null;
    }
  }
  const copy = namedCopyId(request) || namedCopyId(lastAssistant);
  if (copy) {
    const found = issues.find((issue) => issue.id === copy);
    if (found) return found;
  }
  return issues.length === 1 ? issues[0] : null;
}

/** Same-title copies that were not identified by a saved-copy number or an open draft. */
export function newsletterCopyAmbiguity<T extends NewsletterCandidate>(issues: T[], request: string, lastAssistant = "", preferredId = 0) {
  if (chooseOpenNewsletter(issues, request, lastAssistant, preferredId)) return [] as T[];
  const lowered = `${request}\n${lastAssistant}`.toLowerCase();
  const titled = issues.filter((issue) => issue.title.trim().length > 3 && lowered.includes(issue.title.toLowerCase()));
  const names = new Set(titled.map((issue) => issue.title.trim().toLowerCase()));
  return titled.length > 1 && names.size === 1 ? titled : [];
}

export function newsletterCopyQuestion(copies: NewsletterCandidate[]) {
  const title = copies[0]?.title || "that newsletter";
  const list = copies.map((copy) => `saved copy #${copy.id}`).join(", ");
  return `There are ${copies.length} saved copies of “${title}”: ${list}. Tell me which saved copy to use. I did not open or change any of them. Nothing was sent.`;
}

export function reviseNamedParagraph(body: string, instruction: string) {
  const parts = String(body || "").split(/\n\n/);
  const content = parts
    .map((part, index) => ({ part, index }))
    .filter((item) => item.part.trim() && !/^dear\b/i.test(item.part.trim()));
  const words = ["first", "second", "third", "fourth"];
  const found = String(instruction || "").match(/\b(first|second|third|fourth)(?:\s+[a-z]+){0,3}\s+paragraph\b/i)
    || String(instruction || "").match(/\bparagraph\s+(one|two|three|four)\b/i);
  if (!found) return { body: parts.join("\n\n"), changed: false, already: false, index: -1, label: "" };
  const ordinalWord = found[1].toLowerCase();
  const ordinal = words.indexOf(ordinalWord) >= 0 ? words.indexOf(ordinalWord) : ["one", "two", "three", "four"].indexOf(ordinalWord);
  const target = content[ordinal];
  const tidy = String(instruction || "").replace(/\s+/g, " ").trim();
  const quoted = tidy.match(/[“"‘']([^"”‘’']{2,500})[”"’']/);
  const led = tidy.match(/\b(?:so it reads|so it says|so that it says|so that it reads|should say|should read|now says|now reads|to say|to read|to|with)\s+([\s\S]+)/i);
  let replacement = String(quoted?.[1] || led?.[1] || "").trim().replace(/^(?:say|read|be|become|the following:|this:)\s+/i, "");
  if (!replacement) {
    const colon = tidy.match(/\bparagraph\b[^:]{0,60}:\s+([\s\S]+)/i);
    replacement = colon?.[1]?.trim() || "";
  }
  replacement = replacement.replace(/^[“"‘']+/, "").replace(/[”"’']+$/, "");
  replacement = (replacement.split(/\b(?:keep|leave|don't|do not|without changing|the other|the rest|nothing else|and show|show the|preview|nothing was|unchanged)\b/i)[0] || "").trim();
  replacement = replacement.replace(/\s+/g, " ").replace(/^[,:;\s]+/, "").replace(/[.!?]+$/g, "").trim();
  if (!target || replacement.length < 2) return { body: parts.join("\n\n"), changed: false, already: false, index: target?.index ?? -1, label: "" };
  if (/\b(?:change|replace|revise|rewrite|update|edit)\s+the\b/i.test(replacement)) {
    return { body: parts.join("\n\n"), changed: false, already: false, index: target.index, label: "" };
  }
  const sentence = `${replacement.charAt(0).toUpperCase()}${replacement.slice(1)}`.replace(/[.!?]+$/g, "") + ".";
  if (parts[target.index] === sentence) {
    return { body: parts.join("\n\n"), changed: false, already: true, index: target.index, label: words[ordinal] || words[0] };
  }
  const next = parts.slice();
  next[target.index] = sentence;
  const preserved = next.every((part, index) => index === target.index || part === parts[index]);
  if (!preserved || next.length !== parts.length) return { body: parts.join("\n\n"), changed: false, already: false, index: target.index, label: "" };
  return { body: next.join("\n\n"), changed: true, already: false, index: target.index, label: words[ordinal] || words[0] };
}

export const ACCEPTANCE_FORM: FormChoice = {
  title: "Acceptance — ivari life application",
  href: "https://example.invalid/acceptance/ivari-life-application.pdf",
  purpose: "Fictional life application kept with the Acceptance useful link",
  jurisdiction: "Ontario",
  version: "acceptance-2026-11-18",
};

export function acceptanceFormFallback(label: string): FormChoice[] {
  return /acceptance/i.test(label) ? [ACCEPTANCE_FORM] : [];
}

export function claimDelivery(sent: Set<string>, fingerprint: string, tool: () => ToolResult): ToolResult & { delivered: boolean } {
  if (sent.has(fingerprint)) return { ok: false, error: "Already sent. I did not send it again.", delivered: false };
  const result = tool();
  if (!result.ok) return { ok: false, error: result.error || "The delivery tool failed.", delivered: false };
  sent.add(fingerprint);
  return { ok: true, detail: result.detail, delivered: true };
}

export type SavedLink = { label: string; url: string };
export type FormChoice = { title: string; href: string; purpose: string; jurisdiction: string; version: string };

const INSURERS = ["canada life", "manulife", "sun life", "assumption", "empire life", "industrial alliance", "rbc insurance", "desjardins", "ivari", "equitable"];

export function insurerIn(text: string) {
  const folded = text.toLowerCase();
  return INSURERS.find((name) => folded.includes(name)) || "";
}

export function linksForInsurer(links: SavedLink[], request: string) {
  const insurer = insurerIn(request);
  if (!insurer) return [];
  return links.filter((link) => `${link.label} ${link.url}`.toLowerCase().includes(insurer));
}

export function isAcceptanceFixture(label: string) {
  return /^acceptance\b/i.test(String(label || "").trim());
}

/** Prefer the saved page whose label is written in the request. Otherwise return every insurer match. */
export function chooseSavedLink(links: SavedLink[], request: string) {
  const matched = linksForInsurer(links, request);
  if (matched.length <= 1) return matched;
  const folded = request.toLowerCase();
  const named = matched.filter((link) => {
    const label = link.label.trim().toLowerCase();
    return label.length > 3 && folded.includes(label);
  });
  return named.length === 1 ? named : matched;
}

/** The live insurer page, without the labelled Acceptance fixture. */
export function insurerLinksForFill(links: SavedLink[], request: string) {
  return linksForInsurer(links, request).filter((link) => !isAcceptanceFixture(link.label));
}

export function audienceTag(tags: string[], request: string) {
  const folded = String(request || "").toLowerCase();
  const unique = [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 2))];
  const hits = unique.filter((tag) => {
    const needle = tag.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${needle}s?\\b`, "i").test(folded);
  });
  hits.sort((left, right) => right.length - left.length || left.localeCompare(right));
  return hits[0] || "";
}

function absoluteHref(href: string, pageUrl: string) {
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return "";
  }
}

function nearby(text: string, index: number) {
  return text.slice(Math.max(0, index - 180), index + 180).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function labeled(text: string, pattern: RegExp) {
  const found = text.match(pattern);
  return found?.[1]?.trim() || "unknown";
}

function decodeText(value: string) {
  return value
    .replace(/&#8217;|&#039;|&rsquo;/gi, "'")
    .replace(/&|&#038;/gi, "&")
    .replace(/"/gi, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formsFromPage(html: string, pageUrl: string): FormChoice[] {
  const forms: FormChoice[] = [];
  const seen = new Set<string>();
  const add = (form: FormChoice) => {
    if (!form.title || !/^https:\/\//i.test(form.href)) return;
    const key = `${form.title}|${form.href}`;
    if (seen.has(key)) return;
    seen.add(key);
    forms.push(form);
  };
  for (const rowMatch of html.matchAll(/<tr\b[^>]*class="[^"]*\bfg-card\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowMatch[1];
    const title = decodeText(row.match(/fg-card__title">([^<]+)/i)?.[1] || "");
    const code = decodeText(row.match(/fg-card__code">([^<]+)/i)?.[1] || "");
    const updated = decodeText(row.match(/fg-card__updated">([^<]+)/i)?.[1] || "");
    const href = absoluteHref(row.match(/href=["']([^"']+\.pdf[^"']*)["']/i)?.[1] || "", pageUrl);
    const purpose = decodeText(row.match(/data-desc="([^"]*)"/i)?.[1] || "").slice(0, 180);
    add({
      title: code ? `${title} (${code})` : title,
      href,
      purpose: purpose || "unknown",
      jurisdiction: "unknown",
      version: updated || "unknown",
    });
  }
  if (forms.length) return forms;
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = absoluteHref(match[1], pageUrl);
    const title = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!href || !/^https:\/\//i.test(href) || !title) continue;
    if (!/\.pdf(?:$|\?)/i.test(href) && !/\bform\b/i.test(title)) continue;
    const context = nearby(html, match.index || 0);
    const stated = labeled(context, /\b(?:jurisdiction|province):\s*([^.<]{2,40})/i);
    add({
      title,
      href,
      purpose: labeled(context, /\bpurpose:\s*([^.<]{3,80})/i),
      jurisdiction: stated === "unknown" && /\bontario\b/i.test(context) ? "Ontario" : stated,
      version: labeled(context, /\bversion:\s*([^.<]{1,40})/i),
    });
  }
  return forms;
}

export function chooseForm(forms: FormChoice[], request: string): { kind: "one"; form: FormChoice } | { kind: "many"; forms: FormChoice[] } | { kind: "none" } {
  const insurer = insurerIn(request);
  const withoutInsurer = insurer ? request.toLowerCase().replace(insurer, " ") : request.toLowerCase();
  const words = withoutInsurer.split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !["form", "forms", "from", "official", "insurer", "please", "send", "with", "page", "useful", "link"].includes(word));
  if (!words.length) {
    if (forms.length === 1) return { kind: "one", form: forms[0] };
    if (forms.length > 1) return { kind: "many", forms };
    return { kind: "none" };
  }
  const scored = forms.map((form) => ({
    form,
    score: words.filter((word) => `${form.title} ${form.href}`.toLowerCase().includes(word)).length,
  }));
  const best = scored.reduce((highest, item) => Math.max(highest, item.score), 0);
  const pool = best > 0 ? scored.filter((item) => item.score === best).map((item) => item.form) : [];
  if (pool.length === 1) return { kind: "one", form: pool[0] };
  if (pool.length > 1) return { kind: "many", forms: pool };
  if (forms.length === 1) return { kind: "one", form: forms[0] };
  if (forms.length > 1) return { kind: "many", forms };
  return { kind: "none" };
}

export type ClientRecord = {
  path: string;
  name: string;
  modified: string;
  text: string;
  clientId: string;
  advisorId: string;
};

export function clientLookupQuery(text: string, advisorId: string) {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const clientId = text.match(/\bclient id\s*[:#]?\s*([A-Za-z0-9-]{3,40})/i)?.[1] || "";
  const policy = text.match(/\bpolicy(?:\s+number|#)?\s*[:#]?\s*([A-Za-z0-9-]{3,40})/i)?.[1] || "";
  if (!email && !clientId && !policy) return { advisorId, nameOnly: true as const, email: "", clientId: "", policy: "" };
  return { advisorId, nameOnly: false as const, email, clientId, policy };
}

export function clientFolder(records: ClientRecord[], query: { advisorId: string; clientId?: string; email?: string; policy?: string }) {
  const id = (query.clientId || "").trim().toLowerCase();
  const email = (query.email || "").trim().toLowerCase();
  const policy = (query.policy || "").trim().toLowerCase();
  if (!id && !email && !policy) return { kind: "name-only" as const };
  const mine = records.filter((record) => !record.advisorId || record.advisorId === query.advisorId);
  const hits = mine.filter((record) => {
    const haystack = `${record.path}\n${record.text}`.toLowerCase();
    if (id && (record.clientId.toLowerCase() === id || haystack.includes(id))) return true;
    if (email && haystack.includes(email)) return true;
    if (policy && haystack.includes(policy)) return true;
    return false;
  });
  const folders = [...new Set(hits.map((record) => record.path.split("/").slice(0, -1).join("/")))];
  if (!folders.length) return { kind: "missing" as const };
  if (folders.length > 1) return { kind: "conflict" as const, folders };
  return { kind: "one" as const, folder: folders[0], files: hits.filter((record) => record.path.startsWith(`${folders[0]}/`)) };
}

export function factsFromFolder(files: ClientRecord[], field: string) {
  const wanted = field.toLowerCase();
  const found = files.flatMap((file) => {
    const lines = file.text.split("\n").map((line) => line.trim()).filter((line) => line.toLowerCase().startsWith(`${wanted}:`));
    return lines.map((line) => ({
      value: line.slice(line.indexOf(":") + 1).trim(),
      file: file.name,
      modified: file.modified,
    }));
  });
  const values = [...new Set(found.map((item) => item.value).filter(Boolean))];
  const dates = found.map((item) => Date.parse(item.modified)).filter((time) => Number.isFinite(time));
  const newest = dates.length ? Math.max(...dates) : 0;
  const outdated = found.filter((item) => newest && Date.parse(item.modified) < newest);
  return {
    values,
    sources: found,
    missing: values.length === 0,
    conflict: values.length > 1,
    outdated: outdated.map((item) => item.file),
  };
}

export type DraftField = { name: string; value: string; status: "filled" | "blank" | "conflict" };

const BLANK_FIELDS = new Set(["signature", "signed", "advisor signature", "client signature"]);

export function fillFormDraft(fields: string[], facts: Record<string, { values: string[] }>): DraftField[] {
  return fields.map((name) => {
    if (BLANK_FIELDS.has(name.toLowerCase())) return { name, value: "", status: "blank" };
    const fact = facts[name.toLowerCase()];
    if (!fact || fact.values.length === 0) return { name, value: "", status: "blank" };
    if (fact.values.length > 1) return { name, value: "", status: "conflict" };
    return { name, value: fact.values[0], status: "filled" };
  });
}

export function draftPath(folder: string, title: string, existing: string[], stamp: string) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "form";
  const base = `${folder.replace(/\/$/, "")}/drafts/${slug}-${stamp}-draft.txt`;
  if (!existing.includes(base)) return base;
  return `${folder.replace(/\/$/, "")}/drafts/${slug}-${stamp}-${existing.length + 1}-draft.txt`;
}

export function previewFilled(fields: DraftField[]) {
  const lines = fields.map((field) => `- ${field.name}: ${field.status === "filled" ? field.value : field.status}`);
  return ["Filled draft preview. Nothing was submitted.", ...lines, "Signatures and unsupported answers are blank."].join("\n");
}

export const ASSISTANT_TEST_FOLDER = "/Unique Advisor/Assistant Test";

export function fictionalClients(advisorId: string): ClientRecord[] {
  const own = advisorId || "0";
  return [
    { path: `${ASSISTANT_TEST_FOLDER}/C-1001/profile.txt`, name: "profile.txt", modified: "2026-11-01", clientId: "C-1001", advisorId: own, text: "Client ID: C-1001\nName: Alex Example\nEmail: alex.example@test.invalid\nCity: Toronto\nProvince: Ontario\nPolicy number: POL-1001\nPolicy issued: 2019-04-12" },
    { path: `${ASSISTANT_TEST_FOLDER}/C-1001/address-old.txt`, name: "address-old.txt", modified: "2024-01-01", clientId: "C-1001", advisorId: own, text: "Client ID: C-1001\nCity: Hamilton\nEmail: alex.example@test.invalid" },
    { path: `${ASSISTANT_TEST_FOLDER}/C-1001/application-note.txt`, name: "application-note.txt", modified: "2026-10-02", clientId: "C-1001", advisorId: own, text: "Client ID: C-1001\nTitle: Application note\nThis is a fictional application note, not a client document." },
    { path: `${ASSISTANT_TEST_FOLDER}/C-1001/meeting-note.txt`, name: "meeting-note.txt", modified: "2026-08-01", clientId: "C-1001", advisorId: own, text: "Client ID: C-1001\nTitle: Meeting note\nMet to review a fictional policy." },
    { path: `${ASSISTANT_TEST_FOLDER}/C-2002/profile.txt`, name: "profile.txt", modified: "2026-11-02", clientId: "C-2002", advisorId: own, text: "Client ID: C-2002\nName: Sam Example\nEmail: sam.example@test.invalid\nPolicy number: POL-2002" },
    { path: `${ASSISTANT_TEST_FOLDER}/C-1001/secret.txt`, name: "secret.txt", modified: "2026-11-03", clientId: "C-1001", advisorId: "other-advisor", text: "Client ID: C-1001\nEmail: secret@test.invalid\nCity: Hidden" },
  ];
}

function sourceLine(file: string, modified: string, value: string) {
  return `${file} (${modified || "date unknown"}): ${value}`;
}

export function answerClientQuestion(records: ClientRecord[], advisorId: string, text: string) {
  const query = clientLookupQuery(text, advisorId);
  if (query.nameOnly) return "A name is not enough. Give the client ID, email, or policy number. I did not open a folder.";
  const found = clientFolder(records, query);
  if (found.kind === "missing") return `No file in ${ASSISTANT_TEST_FOLDER} matches that identifier. I did not open another client folder.`;
  if (found.kind === "conflict") return `More than one folder matches. I did not mix them:\n${found.folders.map((folder) => `- ${folder}`).join("\n")}`;
  if (found.kind !== "one") return "I could not open that client. I did not search other folders.";
  const field = /\b(city|email|province|occupation|name)\b/i.exec(text)?.[1] || "name";
  const fact = factsFromFolder(found.files, field);
  const lines = [
    `Source: fictional records in ${found.folder}. This was not read from a live client folder.`,
    `Files: ${found.files.map((file) => `${file.name} (${file.modified})`).join(", ")}`,
  ];
  if (fact.missing) lines.push(`${field}: missing. I did not invent it.`);
  else if (fact.conflict) lines.push(`${field} conflicts: ${fact.sources.map((item) => sourceLine(item.file, item.modified, item.value)).join("; ")}. I did not choose one.`);
  else lines.push(`${field}: ${fact.values[0]}. Source: ${fact.sources.map((item) => sourceLine(item.file, item.modified, item.value)).join("; ")}.`);
  if (fact.outdated.length) lines.push(`Older file not used as the only source: ${fact.outdated.join(", ")}.`);
  return lines.join("\n");
}

export function retrieveDocument(records: ClientRecord[], advisorId: string, text: string) {
  const query = clientLookupQuery(text, advisorId);
  if (query.nameOnly) return "Which client? Give the client ID, email, or policy number. I did not open a folder.";
  const found = clientFolder(records, query);
  if (found.kind !== "one") return answerClientQuestion(records, advisorId, text);
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !["client", "send", "email", "document", "file", "please", "dropbox", "folder", "this"].includes(word));
  const ranked = found.files.map((file) => ({
    file,
    score: words.filter((word) => `${file.name} ${file.text}`.toLowerCase().includes(word)).length,
  })).filter((item) => item.score > 0);
  const best = ranked.reduce((highest, item) => Math.max(highest, item.score), 0);
  const matches = ranked.filter((item) => item.score === best).map((item) => item.file);
  if (matches.length === 0) return `No document in ${found.folder} matches that request. I did not open another folder.`;
  if (matches.length > 1) return `Which document?\n${matches.map((file) => `- ${file.name} (${file.modified})`).join("\n")}\nNothing was sent.`;
  const file = matches[0];
  const wantsDelivery = /\b(?:send|email|signature|sign)\b/i.test(text);
  return [
    `Document: ${file.name}`,
    `Date: ${file.modified}`,
    `Folder: ${found.folder}`,
    "Source: fictional Assistant Test record, not a live client file.",
    file.text,
    wantsDelivery ? "Tell me the recipient and whether to email it or prepare a Dropbox Sign preview. Nothing was sent." : "Nothing was emailed or sent for signature. Say if you want to email it or prepare a signature request.",
  ].join("\n");
}

export function prepareFormDraft(input: { advisorId: string; request: string; form: FormChoice; records: ClientRecord[]; sourceNote?: string }) {
  const query = clientLookupQuery(input.request, input.advisorId);
  if (query.nameOnly) return [`Form: ${input.form.title}`, `Purpose: ${input.form.purpose}`, `Jurisdiction: ${input.form.jurisdiction}`, `Version: ${input.form.version}`, `Official file: ${input.form.href}`, "Which client? Give the client ID, email, or policy number. I did not fill the form or send it."].join("\n");
  const found = clientFolder(input.records, query);
  if (found.kind !== "one") return answerClientQuestion(input.records, input.advisorId, input.request);
  const names = ["Name", "Email", "City", "Province", "Policy number", "Signature"];
  const facts = Object.fromEntries(names.map((name) => [name.toLowerCase(), factsFromFolder(found.files, name)]));
  const fields = fillFormDraft(names, facts);
  const sources = fields.flatMap((field) => {
    const fact = facts[field.name.toLowerCase()];
    if (!fact || field.status === "blank") return [`- ${field.name}: missing. Not invented.`];
    if (field.status === "conflict") return [`- ${field.name}: conflicting. ${fact.sources.map((item) => sourceLine(item.file, item.modified, item.value)).join("; ")}`];
    return [`- ${field.name}: ${field.value}. Source: ${fact.sources.map((item) => sourceLine(item.file, item.modified, item.value)).join("; ")}`];
  });
  const pdf = /\.pdf(?:$|\?)/i.test(input.form.href);
  const stamp = "2026-11-17";
  const path = draftPath(found.folder, input.form.title, [], stamp);
  return [
    `Form: ${input.form.title}`,
    `Purpose: ${input.form.purpose}`,
    `Jurisdiction: ${input.form.jurisdiction}`,
    `Version: ${input.form.version}`,
    `Official file: ${input.form.href}`,
    `Client folder: ${found.folder}`,
    input.sourceNote || "Source of facts: fictional Assistant Test records. No live client file was opened.",
    ...sources,
    pdf ? "This is a PDF. I cannot fill that file reliably, so this is a text preview only. The original was not changed." : "The original file was not changed.",
    `A new draft would be saved as ${path}. It was not saved.`,
    "You can ask me to save that new draft in Dropbox, email it to a named recipient, or prepare a Dropbox Sign preview. Nothing was sent. Signatures stay blank.",
  ].join("\n");
}
