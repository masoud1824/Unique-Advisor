import { createServerFn } from "@tanstack/react-start";
import { archiveMessages, listDrips, saveDrip, sendApprovedAdvisorMail, startDrip } from "@/lib/advisor.functions";
import { createCalendarEvent, createZoomMeeting, ensureLinkTables, readCalendars, readDropbox, readZoom, saveDropboxNote } from "@/lib/advisor-links";
import { bookZoom, advisorZone, confirmPendingZoom, clearPendingZoom, findNamedContacts, listUpcomingMeetings, meetingReply } from "@/lib/zoom-bookings";
import { answerAboutAppointment, calendarListingFromThread, calendarSpan, isCalendarListing, isCalendarSummary, listedAppointments, presentCalendar, refersToAppointment, type CalendarRecord } from "@/lib/calendar-span";
import { modelContext, orchestrationControl, resolveConfirmation } from "@/lib/orchestration";
import { agreesToSendCard, asksForPlan, asksToComposeEmail, asksToResume, batchAwaitingYes, blocksLookup, campaignAudience, campaignAwaitingYes, campaignConfirmLine, cardAwaitingApprove, cardAwaitingYes, cardConfirmLine, cardDoubtAllowed, cardDoubtLine, cardSentLine, contactPhrase, decideTurn, declinesCard, deskKeepsTurn, earlierDraftReply, editListedText, eletterAwaitingYes, eletterConfirmLine, eletterFromRequest, eletterRecipient, fileSubject, freshDraft, grokDoubtReply, heardCommand, isCalendarAsk, isCampaignAsk, isCardAsk, isCancellation, isEletterAsk, isFileAsk, isInboxAsk, isNewsletterAsk, isNewsletterEdit, isOnboardingDemo, isReviewAsk, isRevisionAsk, isStandaloneDraft, isTaskSwitch, isTextEdit, isZoomAsk, looksLikeInstruction, matchCardByName, newsletterArticle, newsletterAwaitingYes, newsletterConfirmLine, newsletterDropIndex, newsletterReadyLine, newsletterRecipients, newsletterSentLine, newsletterTitle, newsletterTopics, onboardingDraft, parseHeardJob, pendingQuestion, revisionFollows, revisionMessages, revisionOf, rewriteAllowed, shouldIgnorePending, splitSecretaryTasks, taskKind, textHitsRuleCard, tidyHeard, toolsAllowed, workloadPlan, yesApplies } from "@/lib/advisor-intent";
import { assistantHistoryMessage, readCompletionMessage, takeSentences } from "@/lib/voice-stream";
import { assistantClock, isTimeAgreement } from "@/lib/meeting-time";
import { gateAdvisor, gateOperator, operatorIsDefault, enforcePreviewOperator, shownWebsite } from "@/lib/advisor-db";
import { dbSource } from "@/lib/db";
import { websiteButtonHtml } from "@/lib/advisor-website";
import { ASSISTANT_LOCK, assistantGate, decideAction, decideSend, parseAssistantSettings } from "@/lib/assistant-policy";
import { loadClientBook, readDefaultRules, readRules, runAdvisorMorning, sourceClientReport, writeDefaultRules, writeRules } from "@/lib/assistant-work";
import { CARDS } from "@/lib/catalog";
import { factsFromResponse, publicAssistantError } from "@/lib/assistant-diagnostics";
import { getSql } from "@/lib/db";
import { composeAdvisorPrompt, OPERATING_INSTRUCTIONS, operatingSystemBlock } from "@/lib/assistant-operating";
import { nameQuestion, resolveSpokenContact, spokenNameOptions } from "@/lib/contact-match";
import { ELETTER_DESIGNS, ELETTER_GREETING, isEletterPack, plainEletter, renderEletter } from "@/lib/eletter";
import { bookingHref, createAppointmentLink } from "@/lib/appointments";
import { accessTokenForAdvisor, graphInbox } from "@/lib/microsoft-mail";
import { taskOn, taskPaused } from "@/lib/secretary-rules";
import { DRIP_INTERVALS, dripLabel } from "@/lib/drips";
import { NEWSLETTER_DESIGNS, plainNewsletter, renderNewsletter, unpackNewsletter } from "@/lib/newsletter";

var EMAIL2 = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var OPENAI = "https://api.openai.com/v1";
var OPENAI_CHAT = "gpt-4.1";
var OPENAI_TTS = "gpt-4o-mini-tts";
var OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];
export function openAiVoice(value) {
  const name = String(value || "").trim().toLowerCase();
  return OPENAI_VOICES.includes(name) ? name : "coral";
}
async function ensureAssistantTables() {
  const sql = await getSql();
  await sql.query("alter table operators add column if not exists assistant_json text not null default ''");
  await sql.query("alter table operators add column if not exists xai_api_key text not null default ''");
  await sql.query("alter table operators add column if not exists openai_api_key text not null default ''");
  await sql.query("alter table advisors add column if not exists assistant_voice text not null default 'coral'");
  await sql.query(`create table if not exists assistant_drafts (
    id serial primary key,
    advisor_id integer not null references advisors(id) on delete cascade,
    to_email text not null,
    to_name text not null default '',
    subject text not null,
    body text not null,
    status text not null default 'pending',
    created_at timestamptz not null default now()
  )`);
  await sql.query(`create table if not exists assistant_messages (
    id serial primary key,
    advisor_id integer not null references advisors(id) on delete cascade,
    role text not null,
    content text not null,
    created_at timestamptz not null default now()
  )`);
  await sql.query(`create table if not exists assistant_chats (
    id serial primary key,
    advisor_id integer not null references advisors(id) on delete cascade,
    title text not null default 'New chat',
    created_at timestamptz not null default now()
  )`);
  await sql.query("alter table assistant_messages add column if not exists chat_id integer");
  await sql.query(`create table if not exists assistant_diagnostics (
    id serial primary key,
    advisor_id integer,
    handled_by text not null,
    calls_json text not null default '[]',
    created_at timestamptz not null default now()
  )`);
  await sql.query("alter table operators add column if not exists operating_instructions text not null default ''");
  await sql.query("alter table assistant_chats add column if not exists calendar_result text not null default ''");
  await sql.query("alter table assistant_drafts add column if not exists approval_state text not null default 'none'");
}
async function readSettings2() {
  await ensureAssistantTables();
  const rows = await (await getSql())`select assistant_json from operators where id = 1`;
  return parseAssistantSettings(rows[0]?.assistant_json || "");
}
async function readOperatingInstructions() {
  await ensureAssistantTables();
  const sql = await getSql();
  const row = (await sql`select operating_instructions from operators where id = 1`)[0];
  const saved = String(row?.operating_instructions || "").trim();
  if (saved) return saved;
  await sql`update operators set operating_instructions = ${OPERATING_INSTRUCTIONS} where id = 1`;
  return OPERATING_INSTRUCTIONS;
}
async function gateOpenAiOperator(code: string) {
  const gate = await gateOperator(code || "");
  if (!gate.ok) return gate;
  if (dbSource === "pglite") {
    await enforcePreviewOperator();
    if (await operatorIsDefault()) return { ok: false, error: "Set a private Superadmin password before using the OpenAI key." };
  }
  return { ok: true as const };
}
async function companyApiKey() {
  await ensureAssistantTables();
  const row = (await (await getSql())`select openai_api_key from operators where id = 1`)[0];
  const saved = String(row?.openai_api_key || "").trim();
  return saved || String(process.env.OPENAI_API_KEY || "").trim();
}
function speechBody(text, voice = "coral") {
  return JSON.stringify({ model: OPENAI_TTS, input: text, voice: openAiVoice(voice), response_format: "mp3" });
}
async function savedAdvisorVoice(advisorId) {
  await ensureAssistantTables();
  if (!(advisorId > 0)) return "coral";
  const row = (await (await getSql())`select assistant_voice from advisors where id = ${advisorId}`)[0];
  return openAiVoice(row?.assistant_voice);
}
function noteProvider(calls, facts) {
  if (!calls || !facts) return;
  if (!facts.provider && !facts.model && !facts.requestId && facts.promptTokens == null && facts.completionTokens == null && facts.totalTokens == null && facts.status == null) return;
  calls.push(facts);
  if (calls.length > 8) calls.shift();
}
async function saveAssistantDiagnostic(advisorId, handledBy, calls) {
  await ensureAssistantTables();
  const clean = calls.slice(0, 8).map((call) => ({
    provider: call.provider,
    model: call.model,
    requestId: call.requestId,
    promptTokens: call.promptTokens,
    completionTokens: call.completionTokens,
    totalTokens: call.totalTokens,
    at: call.at,
    status: call.status ?? null,
    detail: String(call.detail || "").slice(0, 180),
    reference: String(call.reference || "").slice(0, 24)
  }));
  await (await getSql())`insert into assistant_diagnostics (advisor_id, handled_by, calls_json) values (${advisorId && advisorId > 0 ? advisorId : null}, ${handledBy}, ${JSON.stringify(clean)})`;
}
export const speakAssistant = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  const text = String(data.text || "").replace(/\s+/g, " ").trim().slice(0, 700);
  if (!text) return { ok: false, error: "Nothing to say." };
  const apiKey = await companyApiKey();
  if (!apiKey) return { ok: false, error: "No voice key." };
  const voice = await savedAdvisorVoice(gate.row.id);
  const response = await fetch(`${OPENAI}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: speechBody(text, voice)
  });
  if (!response.ok) return { ok: false, error: "The warmer voice is not available." };
  await saveAssistantDiagnostic(gate.row.id, "openai", [factsFromResponse(response)]).catch(() => void 0);
  const audio = Buffer.from(await response.arrayBuffer()).toString("base64");
  if (!audio) return { ok: false, error: "The warmer voice is not available." };
  return { ok: true, audio, mime: response.headers.get("content-type") || "audio/mpeg" };
});
var voiceWarmed = null;
export async function warmVoiceLink() {
  if (!voiceWarmed) {
    voiceWarmed = (async () => {
      const started = Date.now();
      const apiKey = await companyApiKey();
      if (!apiKey) return;
      await fetch(`${OPENAI}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: speechBody("Ready.")
      }).catch((error) => {
        console.info(`[voice] warm-error ${error instanceof Error ? error.message : "failed"}`);
      });
      console.info(`[voice] warm ${Date.now() - started}ms`);
    })();
  }
  return voiceWarmed;
}
export async function speakSentence(text, onChunk, advisorId = 0) {
  const apiKey = await companyApiKey();
  if (!apiKey) throw new Error("No voice key.");
  const started = Date.now();
  console.info(`[voice] tts-start chars=${text.length}`);
  const voice = await savedAdvisorVoice(advisorId);
  const response = await fetch(`${OPENAI}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: speechBody(text, voice)
  });
  if (!response.ok || !response.body) throw new Error("The warmer voice is not available.");
  await saveAssistantDiagnostic(null, "openai", [factsFromResponse(response)]).catch(() => void 0);
  const reader = response.body.getReader();
  let first = true;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    if (first) {
      first = false;
      console.info(`[voice] tts-first-audio ${Date.now() - started}ms`);
    }
    onChunk(Buffer.from(step.value));
  }
}
export const warmAssistantVoice = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  await warmVoiceLink();
  return { ok: true };
});
export const transcribeAssistant = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  const audio = String(data.audio || "");
  if (audio.length < 80) return { ok: false, error: "No speech was captured." };
  if (audio.length > 8e6) return { ok: false, error: "That recording is too long. Speak one sentence, then pause." };
  const apiKey = await companyApiKey();
  if (!apiKey) return { ok: false, error: "Voice transcription is not available." };
  const bytes = Buffer.from(audio, "base64");
  const mime = String(data.mime || "audio/webm").split(";")[0] || "audio/webm";
  const started = Date.now();
  const names = (Array.isArray(data.names) ? data.names : []).map((name) => String(name || "").trim().slice(0, 50)).filter(Boolean).slice(0, 40);
  const send = async (model) => {
    const form = new FormData();
    form.append("model", model);
    if (names.length) form.append("prompt", `Financial advisor. Contact names: ${names.join(", ")}.`.slice(0, 800));
    form.append("file", new Blob([bytes], { type: mime }), mime.includes("mp4") ? "speech.m4a" : "speech.webm");
    return fetch(`${OPENAI}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  };
  let response = await send("gpt-4o-mini-transcribe");
  if (!response.ok) response = await send("whisper-1");
  if (!response.ok) return { ok: false, error: "The recording could not be transcribed." };
  const body = await response.json();
  await saveAssistantDiagnostic(gate.row.id, "openai", [factsFromResponse(response, body)]).catch(() => void 0);
  const text = String(body.text || "").replace(/\s+/g, " ").trim();
  console.info(`[voice] server-stt ${Date.now() - started}ms chars=${text.length}`);
  if (!text) return { ok: false, error: "Nothing was heard." };
  return { ok: true, text };
});
async function latestChat(advisorId) {
  await ensureAssistantTables();
  const sql = await getSql();
  let chat = (await sql`select id from assistant_chats where advisor_id = ${advisorId} order by id desc limit 1`)[0];
  if (!chat) chat = (await sql`insert into assistant_chats (advisor_id, title) values (${advisorId}, 'New chat') returning id`)[0];
  const chatId = Number(chat.id);
  await sql`update assistant_messages set chat_id = ${chatId} where advisor_id = ${advisorId} and chat_id is null`;
  return chatId;
}
async function advisorThread(advisorId, chatId) {
  await ensureAssistantTables();
  const rows = await (await getSql())`
    select role, content, created_at from assistant_messages
    where advisor_id = ${advisorId} and chat_id = ${chatId}
    order by id desc limit 40
  `;
  return rows.reverse().map((row) => ({
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    at: new Date(row.created_at).toISOString()
  }));
}
async function saveCalendarSnapshot(advisorId, chatId, text) {
  const listing = String(text || "");
  if (!(Number(chatId) > 0) || !isCalendarListing(listing)) return;
  await ensureAssistantTables();
  await (await getSql())`
    update assistant_chats set calendar_result = ${listing.slice(0, 4000)}
    where id = ${Number(chatId)} and advisor_id = ${advisorId}
  `;
}
async function loadCalendarSnapshot(advisorId, chatId) {
  if (!(Number(chatId) > 0)) return "";
  await ensureAssistantTables();
  const row = (await (await getSql())`
    select calendar_result from assistant_chats where id = ${Number(chatId)} and advisor_id = ${advisorId}
  `)[0];
  return String(row?.calendar_result || "");
}
async function remember(advisorId, chatId, role, content) {
  await ensureAssistantTables();
  const text = content.slice(0, 4e3);
  await (await getSql())`
    insert into assistant_messages (advisor_id, chat_id, role, content)
    values (${advisorId}, ${chatId}, ${role}, ${text})
  `;
  if (role === "user") {
    await (await getSql())`
      update assistant_chats set title = ${text.slice(0, 42)}
      where id = ${chatId} and advisor_id = ${advisorId} and title = 'New chat'
    `;
  }
}
function cleanTurns(input) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => {
    const turn = item;
    const role = turn.role === "assistant" ? "assistant" : turn.role === "user" ? "user" : null;
    const content = String(turn.content ?? "").trim().slice(0, 4e3);
    return role && content ? { role, content } : null;
  }).filter((item) => Boolean(item)).slice(-8);
}
function toolArgs(call) {
  try {
    return JSON.parse(call.function?.arguments || "{}");
  } catch {
    return {};
  }
}
function tagWords(value) {
  const skip = /* @__PURE__ */ new Set(["client", "clients", "customer", "customers", "contact", "contacts", "people", "group", "tag", "tags", "the", "and", "for", "with", "who", "have", "has", "my", "your", "a", "an", "to", "of", "please", "send"]);
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word && !skip.has(word));
}
function tagHit(raw, phrase) {
  const asked = tagWords(phrase);
  if (asked.length === 0) return false;
  return raw.split(",").some((tag) => {
    const text = tag.toLowerCase();
    return asked.every((word) => text.includes(word));
  });
}
async function peopleForMail(advisorId, args, request = "") {
  if (isOnboardingDemo(request) || isStandaloneDraft(request)) return { ok: false, error: isOnboardingDemo(request) ? onboardingDraft(request) : freshDraft(request) };
  const rows = await (await getSql())`
    select id, full_name, email, tags from contacts where advisor_id = ${advisorId} order by full_name limit 5000
  `;
  const contactId = Number(args.contactId);
  if (contactId > 0) {
    const row = rows.find((item) => Number(item.id) === contactId);
    if (!row) return { ok: false, error: "That contact is not in this advisor's list." };
    if (!row.email.trim()) return { ok: false, error: `Add an email for ${row.full_name} before sending.` };
    return { ok: true, rows: [row], byTag: false };
  }
  const tag = String(args.tag ?? "").trim();
  const name = String(args.contactName ?? "").trim();
  const named = name.split(/\s*,\s*|\s+\band\b\s+/i).map((part) => part.trim()).filter((part) => part.length > 1);
  if (named.length > 1) {
    const found = [];
    for (const part of named) {
      const hits = await findNamedContacts(advisorId, part);
      if (hits.length === 0) return { ok: false, error: `I could not find ${part} in your contacts.` };
      if (hits.length > 1) return { ok: false, error: `Did you mean ${hits.slice(0, 4).map((row) => row.full_name).join(" or ")}?` };
      if (!String(hits[0].email || "").trim()) return { ok: false, error: `Add an email for ${hits[0].full_name} before sending.` };
      found.push(hits[0]);
    }
    const unique = found.filter((row, index) => found.findIndex((item) => Number(item.id) === Number(row.id)) === index);
    return { ok: true, rows: unique, byTag: false };
  }
  const everyone = /^(all|everyone)$/i.test(name) || tag.toLowerCase() === "all" || /\b(all contacts|everyone)\b/i.test(request);
  if (everyone) {
    const chosen2 = rows.filter((row) => row.email.trim()).slice(0, 80);
    if (chosen2.length === 0) return { ok: false, error: "No contacts have an email address." };
    return { ok: true, rows: chosen2, byTag: false };
  }
  const group = tag.length > 0 || /\b(clients?|contacts?|customers?|tagged|tag)\b/i.test(`${tag} ${name} ${request}`);
  if (group) {
    const candidates = [tag, name, request].filter((item) => item.trim().length >= 2);
    const phrase = candidates.find((item) => rows.some((row) => tagHit(row.tags, item))) || tag || name || request;
    const matched = rows.filter((row) => tagHit(row.tags, phrase));
    const chosen2 = matched.filter((row) => row.email.trim()).slice(0, 80);
    if (chosen2.length > 0) return { ok: true, rows: chosen2, byTag: true };
    const known = [...new Set(rows.flatMap((row) => row.tags.split(",").map((item) => item.trim()).filter(Boolean)))];
    return { ok: false, error: `No contacts with an email are tagged for \u201C${phrase}\u201D. Tags on file: ${known.join(", ") || "none"}.` };
  }
  if (name.length < 2 || looksLikeInstruction(name)) return { ok: false, error: "Name the contact, or name a tag such as life insurance clients. I did not search for an instruction." };
  const matches = rows.filter((row) => row.full_name.toLowerCase().includes(name.toLowerCase()));
  if (matches.length === 1) {
    if (!matches[0].email.trim()) return { ok: false, error: `Add an email for ${matches[0].full_name} before sending.` };
    return { ok: true, rows: [matches[0]], byTag: false };
  }
  if (matches.length > 1) {
    return { ok: false, error: "More than one contact matches. Use the contact id.", matches: matches.map((row) => ({ id: Number(row.id), name: row.full_name, email: row.email })) };
  }
  if (matches.length === 0) {
    const named2 = rows.map((row) => ({ id: Number(row.id), name: row.full_name }));
    const hit = resolveSpokenContact(name, named2);
    const found = hit.kind === "none" ? resolveSpokenContact(request, named2) : hit;
    if (found.kind === "one") {
      const exact = request.toLowerCase().includes(found.name.toLowerCase());
      if (!exact) {
        const options = spokenNameOptions(request, named2).names;
        const list = [...new Set([found.name, ...options])].slice(0, 6);
        return { ok: false, error: nameQuestion(list) };
      }
      const row = rows.find((item) => item.full_name === found.name);
      if (!row) return { ok: false, error: "That contact is not in this advisor's list, and no tag matches." };
      if (!row.email.trim()) return { ok: false, error: `Add an email for ${row.full_name} before sending.` };
      return { ok: true, rows: [row], byTag: false };
    }
    if (found.kind === "many") return { ok: false, error: found.question };
  }
  const tagged = rows.filter((row) => tagHit(row.tags, name) || tagHit(row.tags, request));
  const chosen = tagged.filter((row) => row.email.trim()).slice(0, 80);
  if (chosen.length > 0) return { ok: true, rows: chosen, byTag: true };
  return { ok: false, error: "That contact is not in this advisor's list, and no tag matches." };
}
function whoLine2(rows) {
  const names = rows.map((row) => row.full_name);
  if (names.length <= 4) return names.join(", ");
  return `${names.slice(0, 4).join(", ")} and ${names.length - 4} more`;
}
async function cardsForAdvisor(advisorId) {
  const sql = await getSql();
  const hidden = await sql`select card_id from hidden_catalog_cards where advisor_id = ${advisorId}`;
  const hiddenIds = new Set(hidden.map((row) => row.card_id));
  const edits = await sql`select card_id, message, hidden from platform_card_edits`.catch(() => []);
  const editById = new Map(edits.map((row) => [row.card_id, row]));
  const platformHidden = (id) => {
    const flag = editById.get(id)?.hidden;
    return flag === true || String(flag) === "t" || String(flag) === "true";
  };
  const saved = await sql`select id, title, message from saved_cards where advisor_id = ${advisorId} order by id desc limit 40`;
  const shared = await sql`select id, name, body from platform_templates where kind = 'card' order by id desc limit 40`;
  return [
    ...CARDS.filter((card) => !hiddenIds.has(card.id) && !platformHidden(card.id)).map((card) => ({
      id: card.id,
      title: card.title,
      message: String(editById.get(card.id)?.message || card.message),
      image: card.image
    })),
    ...saved.map((row) => ({ id: `saved-${row.id}`, title: row.title, message: row.message, image: `/api/cards/${row.id}?v=2` })),
    ...shared.filter((row) => !hiddenIds.has(`shared-${row.id}`)).map((row) => ({ id: `shared-${row.id}`, title: row.name, message: row.body, image: `/api/platform-cards/${row.id}?v=2` }))
  ];
}
function escapePreview(value) {
  const amp = "&amp;";
  const lt = "&lt;";
  const gt = "&gt;";
  const quot = "&quot;";
  return value.replace(/&/g, amp).replace(/</g, lt).replace(/>/g, gt).replace(/"/g, quot);
}
function cardPreviewHtml(image, message, name, website = "") {
  const safeImage = image.startsWith("/") || image.startsWith("data:image/") ? image : "";
  const picture = safeImage ? `<tr><td><img src="${escapePreview(safeImage)}" alt="" style="display:block;width:100%;max-width:640px;height:auto"></td></tr>` : "";
  const note = escapePreview(message).replace(/\n/g, "<br>");
  const button = websiteButtonHtml(website);
  return `<!DOCTYPE html><html><body style="margin:0;background:#f3efe6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:12px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff">${picture}<tr><td style="padding:22px 24px 8px;font-family:Georgia,serif;font-size:18px;line-height:1.5;color:#1c1915">${note}</td></tr><tr><td style="padding:0 24px 22px;font-family:Georgia,serif;font-size:14px;color:#1a1916">${button}<div style="margin-top:12px;color:#6b655c">For ${escapePreview(name)}</div></td></tr></table></td></tr></table></body></html>`;
}
async function stagePreparedCard(advisorId, card, people) {
  await ensureCardPending();
  const ids = people.map((person) => Number(person.id)).filter((id) => id > 0);
  const name = whoLine2(people);
  const sql = await getSql();
  await sql`
    insert into assistant_card_pending (advisor_id, card_id, card_title, contact_name, contact_id, card_message, card_image, contact_ids)
    values (${advisorId}, ${card.id}, ${card.title}, ${name}, ${ids[0] || 0}, ${String(card.message || "")}, ${String(card.image || "")}, ${JSON.stringify(ids)})
    on conflict (advisor_id) do update set
      card_id = excluded.card_id,
      card_title = excluded.card_title,
      contact_name = excluded.contact_name,
      contact_id = excluded.contact_id,
      card_message = excluded.card_message,
      card_image = excluded.card_image,
      contact_ids = excluded.contact_ids
  `;
}
async function sendAdvisorCard(input) {
  const cards = await cardsForAdvisor(input.advisorId);
  const asked = String(input.args.cardId ?? input.args.card ?? "").trim().toLowerCase();
  const card = cards.find((item) => item.id.toLowerCase() === asked) || cards.find((item) => item.title.toLowerCase() === asked) || (asked ? cards.find((item) => item.title.toLowerCase().includes(asked)) : void 0);
  if (!card) return { ok: false, error: "That card is not in this advisor's e-cards.", cards: cards.map((item) => ({ id: item.id, title: item.title })) };
  const people = await peopleForMail(input.advisorId, input.args, input.request || "");
  if (!people.ok) return people;
  const message = String(input.args.message ?? "").trim() || card.message;
  const names = whoLine2(people.rows);
  await stagePreparedCard(input.advisorId, { ...card, message }, people.rows.map((row) => ({ id: Number(row.id), full_name: row.full_name })));
  return { ok: true, confirm: true, message: cardConfirmLine(card.title, names) };
}
async function savedNewsletters(advisorId) {
  const rows = await (await getSql())`
    select id, title, subject, body from saved_letters where advisor_id = ${advisorId} order by id desc limit 40
  `;
  return rows.filter((row) => !isEletterPack(row.body)).map((row) => ({ id: Number(row.id), title: row.title, subject: row.subject }));
}
function blankNewsletterText(value) {
  const text = value.trim().toLowerCase();
  if (!text) return true;
  if (["blank", "newsletter", "newsletter title here", "article title here", "title", "untitled"].includes(text)) return true;
  if (text.startsWith("write the full article") || text.startsWith("add the rest of this article")) return true;
  return false;
}
function namedTemplate(list, request) {
  const text = request.toLowerCase();
  return list.find((item) => {
    if (item.name.length > 3 && text.includes(item.name.toLowerCase())) return true;
    return new RegExp(`\\b${item.id}\\b`, "i").test(request);
  });
}
function randomTemplate(list, avoid) {
  const pool = list.filter((item) => item.id !== avoid);
  const choices = pool.length > 0 ? pool : [...list];
  return choices[Math.floor(Math.random() * choices.length)];
}
async function lastTemplate(advisorId, kind) {
  await ensureLinkTables();
  const row = (await (await getSql())`
    select payload from assistant_actions where advisor_id = ${advisorId} and kind = ${kind} order by id desc limit 1
  `)[0];
  try {
    return String(JSON.parse(row?.payload || "{}").design || "");
  } catch {
    return "";
  }
}
async function chooseEletterDesign(advisorId, request) {
  const named = namedTemplate(ELETTER_DESIGNS, request);
  if (named) return named.id;
  return randomTemplate(ELETTER_DESIGNS, await lastTemplate(advisorId, "eletter")).id;
}
async function chooseNewsletterDesign(advisorId, request) {
  const named = namedTemplate(NEWSLETTER_DESIGNS, request);
  if (named) return named.id;
  return randomTemplate(NEWSLETTER_DESIGNS, await lastTemplate(advisorId, "newsletter")).id;
}
function eletterTitle(given, body) {
  const title = given.replace(/\s+/g, " ").trim();
  if (title.length >= 2 && !/^(letter|e-?letter|newsletter)?\s*title$/i.test(title)) return title.slice(0, 120);
  const rest = body.replace(/^dear \[[^\]]+\],?\s*/i, "").replace(/^dear [^,\n]{1,80},?\s*/i, "");
  const line = rest.split(/[\n.!?]/).map((item) => item.trim()).find((item) => item.length >= 2) || "A note for you";
  return line.split(/\s+/).slice(0, 8).join(" ").slice(0, 120);
}
async function advisorBrand(slug, code) {
  const gate = await gateAdvisor(slug, code);
  if (!gate.ok) return gate;
  let social = { linkedin: "", instagram: "", facebook: "", youtube: "" };
  let photoOn = false;
  try {
    const parsed = JSON.parse(gate.site.publicSocial || "{}");
    social = {
      linkedin: parsed.linkedinShow ? String(parsed.linkedin || "") : "",
      instagram: parsed.instagramShow ? String(parsed.instagram || "") : "",
      facebook: parsed.facebookShow ? String(parsed.facebook || "") : "",
      youtube: ""
    };
    photoOn = parsed.photoOnEletter === void 0 ? Boolean(parsed.photoOnNewsletter) : Boolean(parsed.photoOnEletter);
  } catch {
    social = { linkedin: "", instagram: "", facebook: "", youtube: "" };
  }
  return {
    ok: true,
    gate,
    social,
    photoOn,
    contact: {
      name: gate.site.publicName || gate.site.advisorName,
      title: gate.site.publicTitle || "",
      phone: gate.site.publicPhone || "",
      email: gate.site.publicCardEmail || "",
      place: gate.site.publicCompany || "",
      website: shownWebsite(gate.site)
    }
  };
}
async function sendAdvisorEletter(input) {
  const brand = await advisorBrand(input.slug, input.code);
  if (!brand.ok) return brand;
  if (brand.gate.row.id !== input.advisorId) return { ok: false, error: "That letter is not in this advisor's desk." };
  const rawBody = String(input.args.body ?? "").trim();
  if (rawBody.length < 2) return { ok: false, error: "Write the e-letter from what the advisor said before sending it." };
  const body = /^dear\b/i.test(rawBody) ? rawBody.slice(0, 8e3) : `${ELETTER_GREETING}

${rawBody}`.slice(0, 8e3);
  const people = await peopleForMail(input.advisorId, input.args, input.request || "");
  if (!people.ok) return people;
  let letterBody = body;
  if (people.rows.length === 1 && /\b(?:zoom|in[- ]person|meetings?|appointments?|booking link|book a meeting)\b/i.test(`${input.request || ""}
${letterBody}`)) {
    const person = people.rows[0];
    const link = await createAppointmentLink({
      advisorId: input.advisorId,
      contactId: Number(person.id),
      name: person.full_name,
      email: person.email || "",
      topic: eletterTitle(String(input.args.title ?? ""), letterBody)
    }).catch(() => null);
    if (link?.token && !letterBody.includes(`[[book:${link.token}]]`)) letterBody = `${letterBody}

[[book:${link.token}]]`.slice(0, 8e3);
  }
  const title = eletterTitle(String(input.args.title ?? ""), letterBody.replace(/\[\[book:[a-f0-9]+\]\]/gi, ""));
  const design = await chooseEletterDesign(input.advisorId, input.request || "");
  const designName = ELETTER_DESIGNS.find((item) => item.id === design)?.name ?? "Letter";
  const names = whoLine2(people.rows);
  const logo = brand.photoOn && brand.gate.site.publicPhoto.startsWith("data:image/") && brand.gate.site.publicPhoto.length < 18e4 ? brand.gate.site.publicPhoto : "";
  const booked = letterBody.match(/\[\[book:([a-f0-9]{16,40})\]\]/i);
  const html = renderEletter({
    letter: { kind: "eletter", design, kicker: "A letter", title, subject: title, body: letterBody, social: brand.social },
    contact: brand.contact,
    logoSrc: logo,
    mode: "preview",
    bookHref: booked ? bookingHref(booked[1]) : ""
  });
  const summary = `${designName}: ${title} \xB7 to ${names}`.slice(0, 180);
  const saved = await saveAction(input.advisorId, "eletter", summary, {
    title,
    design,
    body: letterBody,
    contactIds: people.rows.map((row) => Number(row.id)),
    contactName: names
  });
  return { ok: true, pending: true, actionId: saved.actionId, summary, preview: body, html, message: `The e-letter \u201C${title}\u201D is ready for ${names}. Tags were checked. It has not been sent. Press Approve and send.` };
}
function newsletterWords(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
function newsletterArticles(args) {
  const raw = args.articles ?? args.stories ?? args.boxes;
  const rows = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\n---\n/).map((part) => {
    const [title, ...rest] = part.trim().split("\n");
    return { title: title ?? "", body: rest.join("\n") };
  }) : [];
  const cleaned = rows.map((item) => {
    const row = item && typeof item === "object" ? item : { title: "", body: String(item ?? "") };
    return {
      title: String(row.title ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
      body: String(row.body ?? row.text ?? "").trim().slice(0, 4e3)
    };
  }).filter((item) => !blankNewsletterText(item.title) && !blankNewsletterText(item.body));
  return {
    ready: cleaned.filter((item) => newsletterWords(item.body) >= 40).slice(0, 8),
    short: cleaned.filter((item) => newsletterWords(item.body) < 40).map((item) => item.title || "Untitled")
  };
}
async function proposeNewsletter(input) {
  const title = String(input.args.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (blankNewsletterText(title)) return { ok: false, error: "Write a real newsletter title. Do not use Blank or leave it empty." };
  const articles = newsletterArticles(input.args);
  if (articles.ready.length === 0) return { ok: false, error: "Each story needs a title and at least 40 words." };
  const brand = await advisorBrand(input.slug, input.code);
  if (!brand.ok) return brand;
  if (brand.gate.row.id !== input.advisorId) return { ok: false, error: "That newsletter is not in this advisor's desk." };
  const people = await peopleForMail(input.advisorId, input.args, input.request || "");
  if (!people.ok) return people;
  const design = await chooseNewsletterDesign(input.advisorId, input.request || "");
  const issue = {
    design,
    kicker: "Newsletter",
    title,
    subject: title,
    articles: articles.ready,
    social: brand.social
  };
  const names = whoLine2(people.rows);
  const html = renderNewsletter({ issue, contact: brand.contact, logoSrc: "", mode: "preview", articleHref: () => "#" });
  const summary = `${title} \xB7 to ${names}`.slice(0, 180);
  const saved = await saveAction(input.advisorId, "newsletter", summary, {
    title,
    design,
    articles: articles.ready,
    contactIds: people.rows.map((row) => Number(row.id)),
    preview: plainNewsletter(issue).slice(0, 500)
  });
  return { ok: true, pending: true, actionId: saved.actionId, title, to: people.rows.map((row) => row.full_name), summary, preview: plainNewsletter(issue), html, message: `The newsletter \u201C${title}\u201D is ready for ${names}. Tags were checked. It has not been sent. Press Approve and send.` };
}
async function sendAdvisorNewsletter(input) {
  const gate = await gateAdvisor(input.slug, input.code);
  if (!gate.ok) return gate;
  if (gate.row.id !== input.advisorId) return { ok: false, error: "That newsletter is not in this advisor's desk." };
  const letters = (await (await getSql())`
    select id, title, subject, body from saved_letters where advisor_id = ${input.advisorId} order by id desc limit 40
  `).filter((item) => !isEletterPack(item.body));
  const asked = String(input.args.letterId ?? input.args.title ?? "").trim().toLowerCase();
  if (!asked || asked === "letter title" || asked === "title" || asked === "e-letter" || asked === "eletter") {
    return { ok: false, error: "That is not a saved newsletter. If the advisor asked for an e-letter, call send_eletter." };
  }
  const letter = letters.find((item) => String(item.id) === asked) || letters.find((item) => item.title.toLowerCase() === asked) || (asked ? letters.find((item) => item.title.toLowerCase().includes(asked)) : void 0);
  if (!letter) return { ok: false, error: "That newsletter is not saved.", newsletters: letters.map((item) => ({ id: Number(item.id), title: item.title })) };
  const issue = unpackNewsletter(letter.body);
  if (!issue) return { ok: false, error: "That saved newsletter is missing its design." };
  if (blankNewsletterText(letter.title) || blankNewsletterText(issue.title)) return { ok: false, error: "That saved newsletter is blank. Call propose_newsletter instead." };
  const people = await peopleForMail(input.advisorId, input.args, input.request || "");
  if (!people.ok) return people;
  const brand = await advisorBrand(input.slug, input.code);
  if (!brand.ok) return brand;
  const ready5 = { ...issue, social: brand.social, articles: issue.articles.filter((item) => item.title.trim() || item.body.trim()) };
  const sent = await archiveMessages({
    data: {
      slug: input.slug,
      code: input.code,
      kind: "letter",
      title: letter.title,
      subject: letter.subject || letter.title,
      body: plainNewsletter(ready5).slice(0, 3900),
      contactIds: people.rows.map((row) => Number(row.id)),
      newsletter: JSON.stringify({ issue: ready5, contact: brand.contact }),
      logo: brand.gate.site.publicPhoto.startsWith("data:image/") ? brand.gate.site.publicPhoto : ""
    }
  });
  if (!sent?.ok) return { ok: false, error: String(sent?.error || "The newsletter was not sent.") };
  return { ok: true, sent: true, title: letter.title, count: sent.count, to: people.rows.map((row) => row.full_name) };
}
async function saveDraft(advisorId, args) {
  const to = String(args.to ?? "").trim().toLowerCase();
  const name = String(args.name ?? "").trim().slice(0, 80);
  const subject = String(args.subject ?? "").trim().slice(0, 120);
  const body = String(args.body ?? "").trim().slice(0, 4e3);
  if (!EMAIL2.test(to) || to.includes(",") || subject.length < 2 || body.length < 2) return { ok: false, error: "A draft needs one email address, a subject, and a message." };
  await ensureAssistantTables();
  const rows = await (await getSql())`
    insert into assistant_drafts (advisor_id, to_email, to_name, subject, body)
    values (${advisorId}, ${to}, ${name}, ${subject}, ${body})
    returning id
  `;
  return { ok: true, draftId: Number(rows[0]?.id), to, name, subject };
}
async function saveAction(advisorId, kind, summary, payload) {
  await ensureLinkTables();
  const rows = await (await getSql())`
    insert into assistant_actions (advisor_id, kind, summary, payload)
    values (${advisorId}, ${kind}, ${summary.slice(0, 180)}, ${JSON.stringify(payload)})
    returning id
  `;
  return { ok: true, actionId: Number(rows[0]?.id), summary };
}
async function proposeMeeting(advisorId, args) {
  const where = args.where === "google" || args.where === "outlook" || args.where === "zoom" ? args.where : "";
  const title = String(args.title ?? "").trim().slice(0, 120);
  const start = String(args.start ?? "").trim();
  const minutes = Math.min(180, Math.max(15, Number(args.minutes) || 30));
  if (!where || title.length < 2 || Number.isNaN(new Date(start).getTime())) return { ok: false, error: "A meeting needs a place, a title, and a date and time." };
  const kind = where === "zoom" ? "zoom" : "calendar";
  const provider = where === "outlook" ? "outlook_calendar" : where;
  return saveAction(advisorId, kind, `${title} \xB7 ${start}`, { provider, title, start, minutes });
}
async function proposeDropbox(advisorId, args) {
  const name = String(args.name ?? "").trim().slice(0, 40);
  const content = String(args.content ?? "").trim().slice(0, 4e3);
  if (name.length < 2 || content.length < 2) return { ok: false, error: "A Dropbox note needs a name and some text." };
  return saveAction(advisorId, "dropbox", name, { name, content });
}
async function newsletterPreviewHtml(slug, code, issue) {
  const brand = await advisorBrand(slug, code);
  if (!brand.ok) return "";
  return renderNewsletter({ issue: { ...issue, social: brand.social }, contact: brand.contact, logoSrc: "", mode: "preview", articleHref: () => "#" });
}
function issueFromAction(payload) {
  try {
    const parsed = JSON.parse(payload);
    const design = NEWSLETTER_DESIGNS.some((item) => item.id === parsed.design) ? parsed.design : "navy";
    const articles = Array.isArray(parsed.articles) ? parsed.articles.map((item) => ({ title: String(item.title || ""), body: String(item.body || "") })).filter((item) => item.title || item.body) : [];
    if (!parsed.title || articles.length === 0) return null;
    return { design, kicker: "Newsletter", title: parsed.title, subject: parsed.title, articles, social: { linkedin: "", instagram: "", facebook: "", youtube: "" } };
  } catch {
    return null;
  }
}
async function sendProposedNewsletter(input) {
  const issue = issueFromAction(input.payload);
  if (!issue) return { ok: false, error: "That newsletter could not be read." };
  let ids = [];
  try {
    ids = (JSON.parse(input.payload).contactIds || []).map(Number).filter((id) => id > 0);
  } catch {
    ids = [];
  }
  if (ids.length === 0) return { ok: false, error: "That newsletter has no recipients." };
  const brand = await advisorBrand(input.slug, input.code);
  if (!brand.ok) return brand;
  const ready5 = { ...issue, social: brand.social };
  const sent = await archiveMessages({
    data: {
      slug: input.slug,
      code: input.code,
      kind: "letter",
      title: issue.title,
      subject: issue.title,
      body: plainNewsletter(ready5).slice(0, 3900),
      contactIds: ids,
      newsletter: JSON.stringify({ issue: ready5, contact: brand.contact }),
      logo: ""
    }
  });
  if (!sent?.ok) return { ok: false, error: String(sent?.error || "The newsletter was not sent.") };
  return { ok: true, detail: `${issue.title} was sent to ${sent.count} contact${sent.count === 1 ? "" : "s"}.` };
}
async function sendQueuedCard(input) {
  const ids = (input.payload.contactIds || []).map(Number).filter((id) => id > 0);
  const title = String(input.payload.title || "").trim();
  if (!title || ids.length === 0) return { ok: false, error: "That e-card could not be sent." };
  const sent = await archiveMessages({
    data: { slug: input.slug, code: input.code, kind: "card", title, body: String(input.payload.message || ""), contactIds: ids, image: String(input.payload.image || "") }
  });
  if (!sent?.ok) return { ok: false, error: String(sent?.error || "The e-card was not sent.") };
  return { ok: true, detail: cardSentLine(title, Array.isArray(sent.names) ? sent.names : []) };
}
async function sendQueuedEletter(input) {
  const brand = await advisorBrand(input.slug, input.code);
  if (!brand.ok) return brand;
  const title = String(input.payload.title || "").trim();
  const body = String(input.payload.body || "").trim();
  const ids = (input.payload.contactIds || []).map(Number).filter((id) => id > 0);
  const design = ELETTER_DESIGNS.some((item) => item.id === input.payload.design) ? input.payload.design : ELETTER_DESIGNS[0].id;
  if (!title || body.length < 2 || ids.length === 0) return { ok: false, error: "That e-letter could not be sent." };
  const letter = { kind: "eletter", design, kicker: "A letter", title, subject: title, body, social: brand.social };
  const logo = brand.photoOn && brand.gate.site.publicPhoto.startsWith("data:image/") ? brand.gate.site.publicPhoto : "";
  const sent = await archiveMessages({
    data: {
      slug: input.slug,
      code: input.code,
      kind: "letter",
      title,
      subject: title,
      body: plainEletter(letter).slice(0, 3900),
      contactIds: ids,
      newsletter: JSON.stringify({ letter, contact: brand.contact }),
      logo
    }
  });
  if (!sent?.ok) return { ok: false, error: String(sent?.error || "The e-letter was not sent.") };
  return { ok: true, detail: `${title} was sent to ${sent.count} contact${sent.count === 1 ? "" : "s"}.` };
}
function dripDays(value) {
  const number = Number(value);
  if (DRIP_INTERVALS.some((item) => item[0] === number)) return number;
  const text = String(value ?? "").toLowerCase();
  if (/every month|monthly|each month/.test(text)) return 30;
  if (/2 weeks|two weeks|every 14/.test(text)) return 14;
  if (/every week|weekly|each week/.test(text)) return 7;
  if (/every day|daily|each day/.test(text)) return 1;
  const match = text.match(/every\s+(\d+)\s+days?/);
  const days = Number(match?.[1]);
  return DRIP_INTERVALS.some((item) => item[0] === days) ? days : 0;
}
async function proposeCampaign(input) {
  const listed = await listDrips({ data: { slug: input.slug, code: input.code } });
  if (!listed?.ok) return { ok: false, error: String(listed?.error || "Campaigns could not be loaded.") };
  const own = listed.campaigns || [];
  const defaults = (listed.defaults || []).map((item) => {
    let steps = [];
    try {
      steps = JSON.parse(item.body).steps || [];
    } catch {
      steps = [];
    }
    return { id: item.id, name: item.name, steps };
  });
  const catalog = [
    ...own.map((item) => ({ source: "own", id: item.id, name: item.name, steps: item.steps })),
    ...defaults.map((item) => ({ source: "default", id: item.id, name: item.name, steps: item.steps }))
  ];
  if (catalog.length === 0) return { ok: false, error: "There is no campaign yet. Ask the advisor to create one first." };
  const asked = String(input.args.campaign ?? input.args.name ?? "").trim().toLowerCase();
  if (asked.length < 2) return { ok: false, error: `Ask which campaign to run. Available: ${catalog.map((item) => item.name).join(", ")}.` };
  const matches = catalog.filter((item) => item.name.toLowerCase().includes(asked) || asked.includes(item.name.toLowerCase()));
  if (matches.length !== 1) return { ok: false, error: `Ask which campaign. Matching names: ${(matches.length ? matches : catalog).map((item) => item.name).join(", ")}.` };
  const campaign = matches[0];
  const everyDays = dripDays(input.args.frequency) || dripDays(input.args.everyDays) || dripDays(input.request);
  if (!everyDays) return { ok: false, error: "Ask how often the next article should go: every day, every 2 days, every 3 days, every week, every 2 weeks, or every month. Do not run it yet." };
  const people = await peopleForMail(input.advisorId, input.args, input.request);
  if (!people.ok) {
    const ask = /name the contact/i.test(people.error) ? "Ask who should receive this campaign, or which tag, such as life insurance clients." : people.error;
    return { ok: false, error: ask };
  }
  const design = randomTemplate(ELETTER_DESIGNS, await lastTemplate(input.advisorId, "campaign")).id;
  const designName = ELETTER_DESIGNS.find((item) => item.id === design)?.name ?? "Letter";
  const first = campaign.steps[0] || { title: campaign.name, body: "" };
  const brand = await advisorBrand(input.slug, input.code);
  const names = people.rows.map((row) => row.full_name).join(", ");
  const summary = `${campaign.name} \xB7 ${designName} \xB7 ${dripLabel(everyDays)} \xB7 ${names}`.slice(0, 180);
  const saved = await saveAction(input.advisorId, "campaign", summary, {
    campaignId: campaign.source === "own" ? campaign.id : 0,
    name: campaign.name,
    steps: campaign.steps,
    everyDays,
    contactIds: people.rows.map((row) => Number(row.id)),
    tag: String(input.args.tag ?? ""),
    design,
    previewTitle: first.title || campaign.name,
    previewBody: first.body || ""
  });
  if (!saved.ok) return saved;
  const html = brand.ok ? renderEletter({
    letter: { kind: "eletter", design, kicker: "A note", title: first.title || campaign.name, subject: first.title || campaign.name, body: first.body || "", social: brand.social },
    contact: brand.contact,
    logoSrc: "",
    mode: "preview"
  }) : "";
  return {
    ok: true,
    pending: true,
    actionId: saved.actionId,
    summary,
    preview: `${first.title}

${first.body}`,
    html,
    message: `${campaign.name} will run in ${designName}, ${dripLabel(everyDays).toLowerCase()}, for ${names}. It has not started. Press Run the campaign.`
  };
}
async function runQueuedCampaign(input) {
  let payload = {};
  try {
    payload = JSON.parse(input.payload);
  } catch {
    return { ok: false, error: "That campaign could not be read." };
  }
  let id = Number(payload.campaignId) || 0;
  if (!id) {
    const saved = await saveDrip({ data: { slug: input.slug, code: input.code, name: payload.name || "Campaign", steps: payload.steps || [], design: payload.design || "" } });
    if (!saved?.ok) return { ok: false, error: String(saved?.error || "The campaign could not be saved.") };
    id = Number(saved.campaigns?.[0]?.id) || 0;
  }
  const started = await startDrip({
    data: { slug: input.slug, code: input.code, id, everyDays: payload.everyDays, contactIds: payload.contactIds || [], tag: payload.tag || "", design: payload.design || "" }
  });
  if (!started?.ok) return { ok: false, error: String(started?.error || "The campaign was not started.") };
  const count = (payload.contactIds || []).length;
  return { ok: true, detail: started.warning || `The campaign is running for ${count} contact${count === 1 ? "" : "s"}. The first article was emailed. The next ones go ${dripLabel(Number(payload.everyDays) || 7).toLowerCase()}.` };
}
async function runModel(settings, advisorId, advisorName, turns, slug, code, rulesNote, onDelta, calls, chatId = 0) {
  const apiKey = await companyApiKey();
  if (!apiKey) return { ok: false, error: "The assistant is not available right now. In Superadmin, open OpenAI and save the key." };
  const tools = [];
  if (settings.tools.clients) {
    tools.push({ type: "function", function: { name: "list_clients", description: "Read this advisor's contacts.", parameters: { type: "object", properties: {}, additionalProperties: false } } });
    tools.push({ type: "function", function: { name: "client_report", description: "Report who needs contact, yearly KYC, and upsell or cross-sell gaps.", parameters: { type: "object", properties: {}, additionalProperties: false } } });
    tools.push({ type: "function", function: { name: "list_cards", description: "List this advisor's e-cards.", parameters: { type: "object", properties: {}, additionalProperties: false } } });
    tools.push({ type: "function", function: { name: "send_card", description: "Match an e-card and a contact, then ask the advisor to confirm. A later yes sends it. Do not send it in this call, and do not tell them to press Approve and send.", parameters: { type: "object", properties: { cardId: { type: "string" }, contactId: { type: "number" }, contactName: { type: "string" }, tag: { type: "string" }, message: { type: "string" } }, required: ["cardId"], additionalProperties: false } } });
    tools.push({ type: "function", function: { name: "list_newsletters", description: "List saved newsletters.", parameters: { type: "object", properties: {}, additionalProperties: false } } });
    tools.push({ type: "function", function: { name: "propose_newsletter", description: "Prepare a new newsletter for approval. Set tag when the advisor names a group such as life insurance clients. Leave design empty unless they named a template. This does not send.", parameters: { type: "object", properties: { title: { type: "string" }, articles: { type: "array", items: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title", "body"] } }, contactName: { type: "string" }, tag: { type: "string" }, design: { type: "string" } }, required: ["title", "articles"], additionalProperties: false } } });
    tools.push({ type: "function", function: { name: "send_newsletter", description: "Send a saved newsletter. Set tag when the advisor names a group. Do not use this for a new letter.", parameters: { type: "object", properties: { title: { type: "string" }, contactName: { type: "string" }, tag: { type: "string" } }, required: ["title"], additionalProperties: false } } });
    tools.push({ type: "function", function: { name: "send_eletter", description: "Prepare one e-letter for approval. Set tag when the advisor names a group such as life insurance clients. Leave design empty unless they named a template. This does not send.", parameters: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, contactName: { type: "string" }, tag: { type: "string" }, design: { type: "string" } }, required: ["title", "body"], additionalProperties: false } } });
    tools.push({ type: "function", function: { name: "list_campaigns", description: "List this advisor's drip campaigns and the default campaigns.", parameters: { type: "object", properties: {}, additionalProperties: false } } });
    tools.push({ type: "function", function: { name: "propose_campaign", description: "Prepare a drip campaign. Pick the campaign they named. Leave design empty; a random template is chosen. Set frequency only if they said how often. Set tag or contactName only if they said who. If frequency or recipients are missing, the tool tells you to ask. This does not start the campaign.", parameters: { type: "object", properties: { campaign: { type: "string" }, frequency: { type: "string" }, contactName: { type: "string" }, tag: { type: "string" } }, required: ["campaign"], additionalProperties: false } } });
  }
  if (settings.tools.calendar) tools.push({ type: "function", function: { name: "list_calendar", description: "Read this advisor's calendar.", parameters: { type: "object", properties: {}, additionalProperties: false } } });
  if (settings.tools.zoom) tools.push({ type: "function", function: { name: "list_zoom", description: "Read this advisor's Zoom meetings.", parameters: { type: "object", properties: {}, additionalProperties: false } } });
  if (settings.tools.dropbox) tools.push({ type: "function", function: { name: "list_dropbox", description: "List this advisor's Dropbox files.", parameters: { type: "object", properties: {}, additionalProperties: false } } });
  if (settings.tools.zoom || settings.tools.calendar) tools.push({ type: "function", function: { name: "propose_meeting", description: "Propose a Zoom or calendar meeting that is not with a named contact. This does not book it.", parameters: { type: "object", properties: { where: { type: "string", enum: ["zoom", "google", "outlook"] }, title: { type: "string" }, start: { type: "string" }, minutes: { type: "number" } }, required: ["where", "title", "start", "minutes"], additionalProperties: false } } });
  if (settings.tools.zoom) tools.push({ type: "function", function: { name: "book_zoom", description: "Book a Zoom meeting with one contact. Pass whenText as the advisor's own words, such as tomorrow at 3 or next Tuesday at 10am. Do not convert the day yourself. The first call does not book. It returns the question to show the advisor. Say that question and wait. Call again with confirm true only after the advisor agrees. If the time has passed, ask for a new time.", parameters: { type: "object", properties: { contactName: { type: "string" }, whenText: { type: "string" }, minutes: { type: "number" }, topic: { type: "string" }, confirm: { type: "boolean" } }, required: ["contactName"], additionalProperties: false } } });
  if (settings.tools.dropbox) tools.push({ type: "function", function: { name: "propose_dropbox", description: "Propose a Dropbox note. This does not upload it.", parameters: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"], additionalProperties: false } } });
  if (settings.tools.draft) tools.push({ type: "function", function: { name: "draft_email", description: "Prepare one plain email. This does not send it.", parameters: { type: "object", properties: { to: { type: "string" }, name: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"], additionalProperties: false } } });
  const now = /* @__PURE__ */ new Date();
  const zone = await advisorZone(advisorId).catch(() => "America/Toronto");
  const clock = assistantClock(now, zone);
  const request = [...turns].reverse().find((turn) => turn.role === "user")?.content ?? "";
  const allowTools = tools.length > 0 && toolsAllowed(request);
  const operating = await readOperatingInstructions();
  const history = turns.slice(-12).map((turn) => ({ role: turn.role, content: turn.content }));
  const remembered = allowTools ? await loadCalendarSnapshot(advisorId, chatId) : "";
  if (remembered && !history.some((turn) => turn.role === "assistant" && String(turn.content || "").includes(remembered.slice(0, 80)))) {
    history.splice(Math.max(0, history.length - 1), 0, { role: "assistant", content: remembered });
  }
  const messages = [
    { role: "system", content: composeAdvisorPrompt({ operating, clock, advisorName, advisorId, settingsInstructions: settings.instructions, lock: ASSISTANT_LOCK, rulesNote }) },
    ...history
  ];
  const drafts = [];
  const made = [];
  let ready5 = "";
  let lastProblem = "";
  for (let round = 0; round < 4; round += 1) {
    const payload = { model: OPENAI_CHAT, temperature: 0.3, max_tokens: 4e3, messages, ...allowTools ? { tools, tool_choice: "auto" } : {} };
    let failure = null;
    let response = await fetch(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...payload, stream: true, stream_options: { include_usage: true } })
    });
    if (!response.ok) {
      const failed = await response.text().catch(() => "");
      failure = publicAssistantError(response.status, failed);
      noteProvider(calls, { ...factsFromResponse(response, void 0, failed, void 0, { url: `${OPENAI}/chat/completions`, model: OPENAI_CHAT }), status: response.status, detail: failure.detail, reference: failure.reference });
      console.error(`[assistant] model ${response.status} ${failure.detail}`);
      response = await fetch(`${OPENAI}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload)
      });
    }
    if (!response.ok) {
      const failed = await response.text().catch(() => "");
      failure = publicAssistantError(response.status, failed);
      noteProvider(calls, { ...factsFromResponse(response, void 0, failed, void 0, { url: `${OPENAI}/chat/completions`, model: OPENAI_CHAT }), status: response.status, detail: failure.detail, reference: failure.reference });
      console.error(`[assistant] model retry ${response.status} ${failure.detail}`);
      const plain = await fetch(`${OPENAI}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: payload.model, temperature: 0.3, max_tokens: 1200, messages })
      });
      if (plain.ok) response = plain;
      else {
        const plainFailed = await plain.text().catch(() => "");
        failure = publicAssistantError(plain.status, plainFailed);
        noteProvider(calls, { ...factsFromResponse(plain, void 0, plainFailed, void 0, { url: `${OPENAI}/chat/completions`, model: OPENAI_CHAT }), status: plain.status, detail: failure.detail, reference: failure.reference });
        console.error(`[assistant] model plain ${plain.status} ${failure.detail}`);
        return { ok: false, error: failure.error };
      }
    }
    const message = await readCompletionMessage(response);
    noteProvider(calls, message?.providerFacts);
    if (!message?.content && !(message?.tool_calls || []).length) return { ok: false, error: "The assistant did not answer." };
    const calls2 = Array.isArray(message.tool_calls) ? message.tool_calls.slice(0, 4) : [];
    if (calls2.length === 0) {
      const spoken = String(message.content || ready5 || "I have nothing to add.").trim();
      if (/\bbooked\b/i.test(spoken) && !/\bnot booked\b/i.test(spoken)) {
        const reply = "Not booked. No Zoom meeting, Outlook event, or confirmation email was created.";
        onDelta?.(reply);
        return { ok: true, reply, drafts, actions: made };
      }
      onDelta?.(spoken);
      return { ok: true, reply: spoken, drafts, actions: made };
    }
    messages.push(assistantHistoryMessage(message));
    for (const call of calls2) {
      const name = call.function?.name || call.name;
      const args = toolArgs(call);
      let result = { ok: false, error: "That tool is not available." };
      try {
        if (name === "list_clients" && settings.tools.clients) result = await loadClientBook(advisorId);
        if (name === "client_report" && settings.tools.clients) result = await sourceClientReport(advisorId);
        if (name === "list_cards" && settings.tools.clients) result = { cards: (await cardsForAdvisor(advisorId)).map((item) => ({ id: item.id, title: item.title })) };
        if (name === "send_card" && settings.tools.clients) {
          result = await sendAdvisorCard({ advisorId, slug, code, args, request });
          const staged = result && typeof result === "object" && result.confirm === true && result.ok === true;
          if (staged) {
            const reply = String(result.message || "");
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12e3) });
            onDelta?.(reply);
            return { ok: true, reply, drafts, actions: [] };
          }
        }
        if (name === "list_newsletters" && settings.tools.clients) result = { newsletters: await savedNewsletters(advisorId) };
        if (name === "propose_newsletter" && settings.tools.clients) result = await proposeNewsletter({ advisorId, slug, code, args, request });
        if (name === "send_newsletter" && settings.tools.clients) result = await sendAdvisorNewsletter({ advisorId, slug, code, args, request });
        if (name === "send_eletter" && settings.tools.clients) result = await sendAdvisorEletter({ advisorId, slug, code, args, request });
        if (name === "list_campaigns" && settings.tools.clients) {
          const listed = await listDrips({ data: { slug, code } });
          result = listed?.ok ? { campaigns: (listed.campaigns || []).map((item) => item.name), defaults: (listed.defaults || []).map((item) => item.name) } : { ok: false, error: listed?.error || "Campaigns could not be loaded." };
        }
        if (name === "propose_campaign" && settings.tools.clients) result = await proposeCampaign({ advisorId, slug, code, args, request });
        if (name === "list_calendar" && settings.tools.calendar) {
          const text = await calendarBrief(advisorId, request);
          result = { text };
          await saveCalendarSnapshot(advisorId, chatId, text);
        }
        if (name === "list_zoom" && settings.tools.zoom) result = await readZoom(advisorId);
        if (name === "list_dropbox" && settings.tools.dropbox) result = await readDropbox(advisorId);
        if (name === "propose_meeting" && (settings.tools.zoom || settings.tools.calendar)) result = await proposeMeeting(advisorId, args);
        if (name === "book_zoom" && settings.tools.zoom) {
          result = await bookZoom(advisorId, args, turns.filter((turn) => turn.role === "user").map((turn) => turn.content), now);
          const reply = meetingReply(result);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12e3) });
          onDelta?.(reply);
          return { ok: true, reply, drafts, actions: made };
        }
        if (name === "propose_dropbox" && settings.tools.dropbox) result = await proposeDropbox(advisorId, args);
        if (name === "draft_email" && settings.tools.draft) {
          const draft = await saveDraft(advisorId, args);
          result = draft;
          if (draft.ok) drafts.push({ id: draft.draftId, to: draft.to, name: draft.name, subject: draft.subject });
        }
      } catch (error) {
        console.error("[assistant] tool", name, error);
        result = { ok: false, error: "Sorry, something went wrong \u2014 please try again." };
      }
      const failed = result && typeof result === "object" && "ok" in result && result.ok === false;
      if (failed) lastProblem = String(result.error || "That step did not work.");
      const waiting = result && typeof result === "object" && result.ok && result.pending;
      const waitingKind = name === "send_card" ? "card" : name === "send_eletter" ? "eletter" : name === "propose_newsletter" ? "newsletter" : name === "propose_campaign" ? "campaign" : "";
      if (waiting && waitingKind) {
        const madeLetter = result;
        ready5 = madeLetter.message || "It is ready below. Press Approve and send.";
        made.push({
          id: Number(madeLetter.actionId),
          kind: waitingKind,
          summary: madeLetter.summary || ready5,
          preview: madeLetter.preview || "",
          previewHtml: madeLetter.html || "",
          previewImage: String(madeLetter.image || "")
        });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12e3) });
    }
  }
  return { ok: true, reply: ready5 || lastProblem || "I could not finish that. Try again.", drafts, actions: made };
}
export const loadAssistantDiagnostics = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateOperator(data.code || "");
  if (!gate.ok) return gate;
  await ensureAssistantTables();
  const rows = await (await getSql())`
    select id, advisor_id, handled_by, calls_json, created_at from assistant_diagnostics order by id desc limit 40
  `;
  const requests = rows.map((row) => {
    let calls = [];
    try {
      const parsed = JSON.parse(row.calls_json || "[]");
      if (Array.isArray(parsed)) {
        calls = parsed.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const source = item;
          const text = (value) => {
            const clean = String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
            return /sk-|bearer\s|api[_-]?key/i.test(clean) ? "" : clean;
          };
          const count = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
          return [{
            provider: text(source.provider),
            model: text(source.model),
            requestId: text(source.requestId),
            promptTokens: count(source.promptTokens),
            completionTokens: count(source.completionTokens),
            totalTokens: count(source.totalTokens),
            at: text(source.at),
            status: count(source.status),
            detail: text(source.detail),
            reference: text(source.reference)
          }];
        });
      }
    } catch {
      calls = [];
    }
    return {
      id: row.id,
      advisorId: row.advisor_id,
      handledBy: row.handled_by === "openai" ? "openai" : "fixed",
      at: row.created_at,
      calls: calls.map((call) => ({
        provider: call.provider,
        model: call.model,
        requestId: call.requestId,
        promptTokens: call.promptTokens,
        completionTokens: call.completionTokens,
        totalTokens: call.totalTokens,
        at: call.at,
        status: call.status,
        detail: call.detail,
        reference: call.reference
      }))
    };
  });
  return { ok: true, requests };
});
export const loadAssistantSettings = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateOperator(data.code || "");
  if (!gate.ok) return gate;
  return { ok: true, settings: await readSettings2() };
});
export const saveAssistantSettings = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateOperator(data.code || "");
  if (!gate.ok) return gate;
  const settings = parseAssistantSettings(data.settings);
  await ensureAssistantTables();
  await (await getSql())`update operators set assistant_json = ${JSON.stringify(settings)} where id = 1`;
  return { ok: true, settings };
});
export const loadOperatingInstructions = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateOperator(data.code || "");
  if (!gate.ok) return gate;
  return { ok: true, text: await readOperatingInstructions() };
});
export const saveOperatingInstructions = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateOperator(data.code || "");
  if (!gate.ok) return gate;
  const text = String(data.text || "").trim();
  if (text.length < 80) return { ok: false, error: "The operating instructions are too short to replace." };
  await ensureAssistantTables();
  await (await getSql())`update operators set operating_instructions = ${text.slice(0, 12000)} where id = 1`;
  return { ok: true, text: text.slice(0, 12000) };
});
export const testOpenAiAccount = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateOpenAiOperator(data.code || "");
  if (!gate.ok) return gate;
  const typed = String(data.apiKey || "").trim();
  let apiKey = typed;
  let source = "typed";
  if (!apiKey) {
    await ensureAssistantTables();
    const row = (await (await getSql())`select openai_api_key from operators where id = 1`)[0];
    const saved = String(row?.openai_api_key || "").trim();
    if (saved) {
      apiKey = saved;
      source = "saved";
    } else if (String(process.env.OPENAI_API_KEY || "").trim()) {
      apiKey = String(process.env.OPENAI_API_KEY).trim();
      source = "server";
    }
  }
  if (!apiKey) return { ok: false, error: "No OpenAI key is saved yet. Paste the key, then choose Test connection or Save." };
  if (typed && (!typed.startsWith("sk-") || typed.length < 20)) return { ok: false, error: "That key does not look like an OpenAI key. It should start with sk-." };
  const check = await fetch(`${OPENAI}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!check.ok) return { ok: false, error: "OpenAI did not accept this key." };
  return { ok: true, hint: `Connected. The key ends in ${apiKey.slice(-4)}.`, source };
});
export const loadOpenAiAccount = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateOpenAiOperator(data.code || "");
  if (!gate.ok) return gate;
  await ensureAssistantTables();
  const row = (await (await getSql())`select openai_api_key from operators where id = 1`)[0];
  const saved = String(row?.openai_api_key || "").trim();
  if (saved) return { ok: true, hint: `key ending ${saved.slice(-4)}`, source: "saved" };
  if (process.env.OPENAI_API_KEY) return { ok: true, hint: "from the server", source: "server" };
  return { ok: true, hint: "", source: "none" };
});
export const connectOpenAiAccount = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateOpenAiOperator(data.code || "");
  if (!gate.ok) return gate;
  const apiKey = String(data.apiKey || "").trim();
  if (!apiKey.startsWith("sk-") || apiKey.length < 20) return { ok: false, error: "Paste the OpenAI API key. It starts with sk-." };
  const check = await fetch(`${OPENAI}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!check.ok) return { ok: false, error: "That OpenAI key was not accepted." };
  await ensureAssistantTables();
  await (await getSql())`update operators set openai_api_key = ${apiKey} where id = 1`;
  return { ok: true, hint: `key ending ${apiKey.slice(-4)}` };
});
export const disconnectOpenAiAccount = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateOpenAiOperator(data.code || "");
  if (!gate.ok) return gate;
  await ensureAssistantTables();
  await (await getSql())`update operators set openai_api_key = '' where id = 1`;
  return { ok: true };
});
export const loadAdvisorVoice = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  return { ok: true, voice: await savedAdvisorVoice(gate.row.id) };
});
export const saveAdvisorVoice = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  const voice = openAiVoice(data.voice);
  await ensureAssistantTables();
  await (await getSql())`update advisors set assistant_voice = ${voice} where id = ${gate.row.id}`;
  return { ok: true, voice };
});
export const previewAdvisorVoice = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  try {
    const gate = await gateAdvisor(data.slug || "", data.code || "");
    if (!gate.ok) return gate;
    const spoken = await openAiSpeech("Hello. This is your assistant. Your meeting is ready, and the letter is waiting for your approval.", data.voice);
    if (!spoken.ok) return spoken;
    return { ok: true, audio: Buffer.from(spoken.audio).toString("base64"), mime: spoken.mime || "audio/mpeg", voice: spoken.voice, model: spoken.model };
  } catch (error) {
    console.error("[voice] preview", error instanceof Error ? error.message : "failed");
    return { ok: false, error: "Voice preview failed before any audio was returned." };
  }
});
export const loadDefaultRules = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateOperator(data.code || "");
  if (!gate.ok) return gate;
  return { ok: true, rules: await readDefaultRules() };
});
export const saveDefaultRules = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateOperator(data.code || "");
  if (!gate.ok) return gate;
  const rules = await writeDefaultRules(data.rules);
  return { ok: true, rules };
});
export const listAssistantDrafts = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  const access = assistantGate({ status: gate.row.status, plan: gate.site.plan, settings: await readSettings2() });
  if (!access.ok) return access;
  await ensureAssistantTables();
  const drafts = await (await getSql())`
    select id, to_email, to_name, subject, body from assistant_drafts
    where advisor_id = ${gate.row.id} and status = 'pending' order by created_at desc limit 10
  `;
  return { ok: true, drafts: drafts.map((row) => ({ id: Number(row.id), to: row.to_email, name: row.to_name, subject: row.subject, body: row.body })) };
});
export const listAssistantMessages = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  let chatId = Number(data.chatId);
  const sql = await getSql();
  if (!(chatId > 0 ? (await sql`select id from assistant_chats where id = ${chatId} and advisor_id = ${gate.row.id}`)[0] : null)) chatId = await latestChat(gate.row.id);
  await sql`
    delete from assistant_chats
    where advisor_id = ${gate.row.id} and title = 'New chat' and id <> ${chatId}
      and not exists (select 1 from assistant_messages where assistant_messages.chat_id = assistant_chats.id and assistant_messages.advisor_id = ${gate.row.id})
  `;
  const chats = await sql`
    select c.id, c.title,
      coalesce((select max(m.created_at) from assistant_messages m where m.chat_id = c.id and m.advisor_id = c.advisor_id), c.created_at) as at
    from assistant_chats c where c.advisor_id = ${gate.row.id} order by at desc limit 30
  `;
  return {
    ok: true,
    messages: await advisorThread(gate.row.id, chatId),
    chats: chats.map((row) => ({ id: Number(row.id), title: row.title, at: new Date(row.at).toISOString() })),
    chatId,
    rules: await readRules(gate.row.id)
  };
});
export const startAssistantChat = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  await ensureAssistantTables();
  const sql = await getSql();
  const row = (await sql`insert into assistant_chats (advisor_id, title) values (${gate.row.id}, 'New chat') returning id`)[0];
  return { ok: true, chatId: Number(row.id) };
});
export const deleteAssistantChat = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  const chatId = Number(data.chatId);
  const sql = await getSql();
  await sql`delete from assistant_messages where chat_id = ${chatId} and advisor_id = ${gate.row.id}`;
  await sql`delete from assistant_chats where id = ${chatId} and advisor_id = ${gate.row.id}`;
  return { ok: true };
});
export const runMorningCheck = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  const settings = await readSettings2();
  try {
    const morning = await runAdvisorMorning({ advisorId: gate.row.id, slug: gate.row.slug, code: data.code || "", status: gate.row.status, plan: gate.site.plan, settings });
    if (!morning.ok || !morning.note) return { ok: true, note: "" };
    let chatId = Number(data.chatId);
    const sql = await getSql();
    if (!(chatId > 0 ? (await sql`select id from assistant_chats where id = ${chatId} and advisor_id = ${gate.row.id}`)[0] : null)) chatId = await latestChat(gate.row.id);
    await remember(gate.row.id, chatId, "assistant", morning.note);
    return { ok: true, note: morning.note };
  } catch {
    return { ok: true, note: "" };
  }
});
export const saveAssistantRules = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  const source = data.clientSource === "dropbox" || data.clientSource === "desk" ? data.clientSource : "";
  const file = String(data.dropboxFile ?? "").trim();
  if (source === "dropbox" && file && (!file.startsWith("/") || file.includes(".."))) return { ok: false, error: "The Dropbox path must start with / , such as /Unique Advisor/clients.csv." };
  await writeRules(gate.row.id, {
    birthdayCards: Boolean(data.birthdayCards),
    newsletterReminder: Boolean(data.newsletterReminder),
    showBirthday: data.showBirthday === false ? false : data.showBirthday === true ? true : void 0,
    showNewsletter: data.showNewsletter === false ? false : data.showNewsletter === true ? true : void 0,
    note: "",
    rules: Array.isArray(data.rules) ? data.rules.map((item) => {
      const row = item;
      return { id: String(row?.id || ""), category: String(row?.category || ""), text: String(row?.text ?? ""), on: row?.on !== false };
    }) : void 0,
    clientSource: source,
    dropboxFile: file
  });
  return { ok: true };
});
async function ensureCardPending() {
  const sql = await getSql();
  await sql.query(`create table if not exists assistant_card_pending (
    advisor_id integer primary key,
    card_id text not null,
    card_title text not null,
    contact_name text not null
  )`);
  await sql.query("alter table assistant_card_pending add column if not exists contact_id integer");
  await sql.query("alter table assistant_card_pending add column if not exists card_message text not null default ''");
  await sql.query("alter table assistant_card_pending add column if not exists card_image text not null default ''");
  await sql.query("alter table assistant_card_pending add column if not exists contact_ids text not null default ''");
}
async function restoreCardPending(advisorId, pending) {
  const sql = await getSql();
  await sql`
    insert into assistant_card_pending (advisor_id, card_id, card_title, contact_name, contact_id, card_message, card_image, contact_ids)
    values (${advisorId}, ${pending.card_id}, ${pending.card_title}, ${pending.contact_name}, ${Number(pending.contact_id) || 0}, ${pending.card_message || ""}, ${pending.card_image || ""}, ${pending.contact_ids || ""})
    on conflict (advisor_id) do update set
      card_id = excluded.card_id,
      card_title = excluded.card_title,
      contact_name = excluded.contact_name,
      contact_id = excluded.contact_id,
      card_message = excluded.card_message,
      card_image = excluded.card_image,
      contact_ids = excluded.contact_ids
  `;
}
async function deliverConfirmedCard(advisorId, slug, code) {
  await ensureCardPending();
  const sql = await getSql();
  const pending = (await sql`
    delete from assistant_card_pending where advisor_id = ${advisorId}
    returning card_id, card_title, contact_name, contact_id, card_message, card_image, contact_ids
  `)[0];
  if (!pending?.card_id) return { ok: false, error: "I don't have an e-card waiting to send. Tell me the card and the contact again." };
  const cards = await cardsForAdvisor(advisorId);
  const card = cards.find((item) => item.id === pending.card_id);
  const title = card?.title || pending.card_title;
  const message = String(pending.card_message || card?.message || "").trim() || `Dear [Contact Name],

${title}`;
  const image = String(pending.card_image || card?.image || "");
  let ids = [];
  try {
    const parsed = JSON.parse(String(pending.contact_ids || "[]"));
    if (Array.isArray(parsed)) ids = parsed.map(Number).filter((id) => id > 0);
  } catch {
    ids = [];
  }
  if (ids.length === 0 && Number(pending.contact_id) > 0) ids = [Number(pending.contact_id)];
  if (ids.length === 0) {
    const people = await findNamedContacts(advisorId, pending.contact_name);
    const person = people.find((row) => row.full_name.toLowerCase() === pending.contact_name.toLowerCase()) || (people.length === 1 ? people[0] : void 0);
    if (!person) {
      await restoreCardPending(advisorId, pending);
      return { ok: false, error: `I could not find ${pending.contact_name} in your contacts.` };
    }
    ids = [Number(person.id)];
  }
  console.info(`[assistant] card-yes ${title}`);
  let sent;
  try {
    sent = await sendQueuedCard({ slug, code, payload: { title, message, image, contactIds: ids } });
  } catch (error) {
    console.error("[assistant] card-send", error);
    await restoreCardPending(advisorId, pending);
    return { ok: false, error: "The e-card was not sent." };
  }
  if (!sent.ok) {
    await restoreCardPending(advisorId, pending);
    return sent;
  }
  try {
    await ensureLinkTables();
    await sql`update assistant_actions set status = 'discarded' where advisor_id = ${advisorId} and kind = 'card' and status = 'pending'`;
  } catch (error) {
    console.error("[assistant] card-action", error);
  }
  return sent;
}
async function deliverPendingCardAction(advisorId, slug, code) {
  await ensureLinkTables();
  const sql = await getSql();
  const action = (await sql`
    select id, payload from assistant_actions
    where advisor_id = ${advisorId} and kind = 'card' and status = 'pending'
    order by id desc limit 1
  `)[0];
  if (!action) return { ok: false, error: "I don't have an e-card waiting to send. Tell me the card and the contact again." };
  let payload = {};
  try {
    payload = JSON.parse(action.payload);
  } catch {
    return { ok: false, error: "That e-card could not be read." };
  }
  console.info(`[assistant] card-yes ${String(payload.title || "card")}`);
  const sent = await sendQueuedCard({ slug, code, payload });
  if (!sent.ok) return sent;
  await sql`update assistant_actions set status = 'done' where id = ${action.id} and advisor_id = ${advisorId}`;
  return sent;
}
async function cancelWaitingCard(advisorId) {
  await ensureCardPending();
  const sql = await getSql();
  await sql`delete from assistant_card_pending where advisor_id = ${advisorId}`;
  try {
    await ensureLinkTables();
    await sql`update assistant_actions set status = 'discarded' where advisor_id = ${advisorId} and kind = 'card' and status = 'pending'`;
  } catch (error) {
    console.error("[assistant] card-cancel", error);
  }
}
async function replyWith(advisorId, chatId, reply, onDelta, actions = []) {
  await saveCalendarSnapshot(advisorId, chatId, reply);
  await remember(advisorId, chatId, "assistant", reply);
  onDelta?.(reply);
  return { ok: true, reply, drafts: [], actions };
}
async function deliverConfirmedNewsletter(advisorId, slug, code) {
  await ensureLinkTables();
  const sql = await getSql();
  const action = (await sql`
    select id, payload from assistant_actions
    where advisor_id = ${advisorId} and kind = 'newsletter' and status = 'pending'
    order by id desc limit 1
  `)[0];
  if (!action) return { ok: false, error: "I don't have a newsletter waiting to send." };
  const sent = await sendProposedNewsletter({ slug, code, payload: action.payload });
  if (!sent.ok) return sent;
  await sql`update assistant_actions set status = 'done' where id = ${action.id} and advisor_id = ${advisorId}`;
  let title = "Newsletter";
  let names = [];
  try {
    const parsed = JSON.parse(action.payload);
    title = String(parsed.title || title);
    const ids = (parsed.contactIds || []).map(Number).filter((id) => id > 0);
    const rows = await sql`select id, full_name from contacts where advisor_id = ${advisorId} order by full_name limit 5000`;
    names = ids.map((id) => rows.find((row) => Number(row.id) === id)?.full_name || "").filter(Boolean);
  } catch {
    names = [];
  }
  return { ok: true, detail: newsletterSentLine(title, names) };
}
async function revisePendingNewsletter(advisorId, slug, code, text, choosing) {
  await ensureLinkTables();
  const sql = await getSql();
  const action = (await sql`
    select id, payload from assistant_actions
    where advisor_id = ${advisorId} and kind = 'newsletter' and status = 'pending'
    order by id desc limit 1
  `)[0];
  if (!action) return { reply: "I don't have a newsletter open. Tell me the articles and who to send it to.", actions: [] };
  let parsed = {};
  try {
    parsed = JSON.parse(action.payload);
  } catch {
    parsed = {};
  }
  const articles = (parsed.articles || []).map((item) => ({ title: String(item.title || "").trim(), body: String(item.body || "").trim() })).filter((item) => item.title || item.body);
  const titles = articles.map((item) => item.title || "Untitled");
  const ids = (parsed.contactIds || []).map(Number).filter((id) => id > 0);
  const rows = ids.length ? await sql`select id, full_name from contacts where advisor_id = ${advisorId} order by full_name limit 5000` : [];
  const names = ids.map((id) => rows.find((row) => Number(row.id) === id)?.full_name || "").filter(Boolean);
  const title = String(parsed.title || "Newsletter");
  const design = NEWSLETTER_DESIGNS.some((item) => item.id === parsed.design) ? parsed.design : "navy";
  const show = async (next2, note) => {
    const issue = { design, kicker: "Newsletter", title, subject: title, articles: next2, social: { linkedin: "", instagram: "", facebook: "", youtube: "" } };
    const preview = plainNewsletter(issue);
    const html = next2.length ? await newsletterPreviewHtml(slug, code, issue) : "";
    const summary = `${title} \xB7 to ${names.join(", ") || "your contacts"}`.slice(0, 180);
    await sql`update assistant_actions set payload = ${JSON.stringify({ ...parsed, title, articles: next2, preview: preview.slice(0, 500) })}, summary = ${summary} where id = ${action.id} and advisor_id = ${advisorId}`;
    return { reply: `${note}

${newsletterReadyLine(title, names, next2.map((item) => item.title))}`, actions: [{ id: Number(action.id), kind: "newsletter", summary, preview, previewHtml: html, previewImage: "" }] };
  };
  const list = titles.map((item, index) => `${index + 1}. ${item}`).join("\n");
  if (articles.length === 0) return { reply: "That newsletter has no parts left. What should the articles be about?", actions: [] };
  const drop = newsletterDropIndex(text, titles, choosing);
  if (drop === "ask") return { reply: `Which part should I take out?

${list}`, actions: [] };
  if (drop === "miss") return { reply: `I could not see that part. Which part should I take out?

${list}`, actions: [] };
  const removed = titles[drop];
  const next = articles.filter((_, index) => index !== drop);
  if (next.length === 0) {
    await sql`update assistant_actions set status = 'discarded' where id = ${action.id} and advisor_id = ${advisorId}`;
    return { reply: `I took out \u201C${removed}\u201D. The newsletter is empty. What should the articles be about?`, actions: [] };
  }
  return show(next, `I took out \u201C${removed}\u201D.`);
}
async function taskReady(advisorId, id) {
  const rules = await readRules(advisorId);
  return taskOn(rules.rules, id) ? "" : taskPaused(id);
}
async function calendarBrief(advisorId, text = "") {
  const paused = await taskReady(advisorId, "meetings");
  if (paused) return paused;
  const zone = await advisorZone(advisorId).catch(() => "America/Toronto");
  const span = calendarSpan(text, new Date(), zone);
  const calendar = await readCalendars(advisorId, { start: span.start, end: span.end });
  const items: CalendarRecord[] = [];
  const events = "events" in calendar && Array.isArray(calendar.events) ? calendar.events : [];
  for (const event of events) items.push({ source: event.source || "Calendar", title: event.title || "Busy", start: event.start || "", end: event.end || "", id: event.id || "", join: event.join || "" });
  try {
    const zoom = await readZoom(advisorId);
    for (const meeting of zoom.meetings || []) items.push({ source: "Zoom", id: meeting.id || "", title: meeting.topic || "Zoom meeting", start: meeting.start || "", join: meeting.join || "" });
  } catch {
    /* Zoom stays out of the list when it is not connected. */
  }
  try {
    const sql = await getSql();
    const saved = await sql`
      select id, topic, start_at, join_url from zoom_bookings
      where advisor_id = ${advisorId} and start_at >= ${span.start} and start_at < ${span.end} and join_url <> ''
    `;
    for (const row of saved) items.push({ source: "Zoom", id: `zoom-${row.id}`, title: row.topic || "Zoom meeting", start: new Date(row.start_at).toISOString(), join: row.join_url || "" });
  } catch {
    /* Saved meetings are included only when that table can be read. */
  }
  const note = "error" in calendar && calendar.error ? String(calendar.error) : "";
  const reply = presentCalendar(span, items);
  return [reply, note].filter(Boolean).join("\n");
}
async function inboxBrief(advisorId) {
  const paused = await taskReady(advisorId, "inbox");
  if (paused) return paused;
  const sql = await getSql();
  const sent = await sql`
    select kind, title, contact_name from messages where advisor_id = ${advisorId} order by id desc limit 8
  `;
  const sentLine = sent.length ? `Mail this desk has sent:
${sent.map((row) => `- ${row.kind}: ${row.title} to ${row.contact_name}`).join("\n")}` : "This desk has not sent any mail yet.";
  try {
    const token = await accessTokenForAdvisor(advisorId);
    const box = await graphInbox(token);
    if (!box.ok) return `${box.error}

${sentLine}`;
    const lines = box.messages.map((item) => `- ${item.from}: ${item.subject}${item.preview ? ` \u2014 ${item.preview}` : ""}`);
    return `Latest inbox mail:
${lines.join("\n") || "The inbox is empty."}

${sentLine}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The mailbox could not be read.";
    return `${message}

${sentLine}`;
  }
}
async function contactBrief(advisorId, name) {
  const paused = await taskReady(advisorId, "clients");
  if (paused) return paused;
  const hits = await findNamedContacts(advisorId, name);
  if (hits.length === 0) return `I could not find ${name} in your contacts.`;
  if (hits.length > 1) return `Did you mean ${hits.slice(0, 4).map((row2) => row2.full_name).join(" or ")}?`;
  const person = hits[0];
  const sql = await getSql();
  const row = (await sql`
    select phone, birthday, products, product_note, kyc_on from contacts where id = ${Number(person.id)} and advisor_id = ${advisorId}
  `)[0];
  const products = cleanProductIds(row?.products || "");
  const labels = products.map((id) => productLabel(id));
  const mail = await sql`
    select kind, title from messages
    where advisor_id = ${advisorId} and lower(contact_email) = ${String(person.email || "").toLowerCase()}
    order by id desc limit 6
  `;
  const report = reportFromPeople([{
    name: person.full_name,
    email: person.email || "",
    phone: row?.phone || "",
    dob: row?.birthday || "",
    products,
    productNote: row?.product_note || "",
    kycOn: row?.kyc_on || "",
    lastContact: ""
  }]);
  const ideas = report.opportunities[0]?.ideas || [];
  let meetings = "No meeting on the desk for today or tomorrow.";
  try {
    const listed = await listUpcomingMeetings(advisorId);
    const theirs = (listed.meetings || []).filter((item) => item.client.toLowerCase().includes(person.full_name.toLowerCase()));
    if (theirs.length) meetings = theirs.map((item) => `${item.title} \xB7 ${item.when}`).join("; ");
  } catch {
    meetings = "Meetings could not be read.";
  }
  const history = mail.length ? mail.map((item) => `${item.kind}: ${item.title}`).join("; ") : "No mail from this desk yet.";
  const gaps = ideas.length ? ideas.join(" ") : "No cross-sell gap is showing from the products on file.";
  return [
    person.full_name,
    `Products: ${labels.length ? labels.join(", ") : "none on file"}${row?.product_note ? `. Note: ${row.product_note}` : ""}.`,
    `KYC: ${(row?.kyc_on || "").trim() || "not on file"}.`,
    `Recent mail: ${history}.`,
    `Meetings: ${meetings}.`,
    `Cross-sell: ${gaps}`
  ].join("\n");
}
async function reviewBrief(advisorId) {
  const paused = await taskReady(advisorId, "review");
  if (paused) return paused;
  const report = await clientReport(advisorId);
  const total = report.needsContact.length + report.kycDue.length + report.opportunities.length;
  if (total === 0) return "I went through the contacts on this desk. Nobody is due for a call, and no KYC date is older than 12 months.";
  const names = (list) => list.slice(0, 8).map((item) => item.name).join(", ") || "none";
  const both = report.needsContact.filter((person) => report.kycDue.some((due) => due.name === person.name));
  const calls = report.needsContact.filter((person) => !both.some((item) => item.name === person.name));
  const kycOnly = report.kycDue.filter((person) => !both.some((item) => item.name === person.name));
  const leads = report.opportunities.slice(0, 5).map((item) => `${item.name}: ${item.ideas[0]}`).join("; ") || "none";
  const lines = ["I went through the contacts on this desk."];
  if (both.length) lines.push(`Contact these first (${both.length}): ${names(both)}. KYC is due and there has been no contact in the last 90 days.`);
  if (calls.length) lines.push(`Due for a call (${report.needsContact.length} in total): ${names(calls)}.`);
  if (kycOnly.length) lines.push(`KYC due (${report.kycDue.length} in total): ${names(kycOnly)}.`);
  lines.push(`Cross-sell gaps on file: ${leads}.`);
  lines.push("These are gaps on file, not a recommendation to buy.");
  return lines.join("\n");
}
async function deliverConfirmedEletter(advisorId, slug, code) {
  await ensureLinkTables();
  const sql = await getSql();
  const action = (await sql`
    select id, payload from assistant_actions
    where advisor_id = ${advisorId} and kind = 'eletter' and status = 'pending'
    order by id desc limit 1
  `)[0];
  if (!action) return { ok: false, error: "I don't have an e-letter waiting to send." };
  const sent = await sendQueuedEletter({ slug, code, payload: JSON.parse(action.payload) });
  if (!sent.ok) return sent;
  await sql`update assistant_actions set status = 'done' where id = ${action.id} and advisor_id = ${advisorId}`;
  let title = "E-letter";
  let names = [];
  try {
    const parsed = JSON.parse(action.payload);
    title = String(parsed.title || title);
    const ids = (parsed.contactIds || []).map(Number);
    const rows = await sql`select id, full_name from contacts where advisor_id = ${advisorId} order by full_name limit 5000`;
    names = ids.map((id) => rows.find((row) => Number(row.id) === id)?.full_name || "").filter(Boolean);
  } catch {
    names = [];
  }
  const who = names.length === 0 ? "your contacts" : names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return { ok: true, detail: `Sent \u2014 the e-letter \u201C${title}\u201D is on its way to ${who}.` };
}
async function deliverConfirmedCampaign(advisorId, slug, code) {
  await ensureLinkTables();
  const sql = await getSql();
  const action = (await sql`
    select id, payload from assistant_actions
    where advisor_id = ${advisorId} and kind = 'campaign' and status = 'pending'
    order by id desc limit 1
  `)[0];
  if (!action) return { ok: false, error: "I don't have a campaign waiting to start." };
  const sent = await runQueuedCampaign({ slug, code, payload: action.payload });
  if (!sent.ok) return sent;
  await sql`update assistant_actions set status = 'done' where id = ${action.id} and advisor_id = ${advisorId}`;
  return { ok: true, detail: `Sent \u2014 the campaign is running. ${sent.detail}` };
}
function preparedWork(reply, actions = []) {
  return { reply, actions, confirm: /^just to confirm:/i.test(reply) };
}
async function keepOnlyPending(advisorId, kind, actionId) {
  if (!(actionId > 0)) return;
  await ensureLinkTables();
  await (await getSql())`update assistant_actions set status = 'discarded' where advisor_id = ${advisorId} and kind = ${kind} and status = 'pending' and id <> ${actionId}`;
}
async function wantsCard(advisorId, tidy) {
  if (refersToAppointment(tidy)) return false;
  if (isCardAsk(tidy)) return true;
  try {
    const rules = await readRules(advisorId);
    return textHitsRuleCard(tidy, rules.rules);
  } catch {
    return false;
  }
}
async function fulfillSecretary(advisorId, slug, code, text) {
  const tidy = tidyHeard(text);
  if (isStandaloneDraft(tidy)) return preparedWork(freshDraft(text));
  if (isOnboardingDemo(tidy)) return preparedWork(onboardingDraft(text));
  if (isNewsletterAsk(tidy)) {
    const paused = await taskReady(advisorId, "newsletters");
    if (paused) return preparedWork(paused);
    const topics = newsletterTopics(tidy);
    if (topics.length === 0) return preparedWork("What should the articles be about?");
    const recipients = newsletterRecipients(tidy);
    const audience = campaignAudience(tidy);
    if (recipients.length === 0 && !audience.tag) return preparedWork("Who should I send the newsletter to?");
    const title = newsletterTitle(topics);
    const prepared = await proposeNewsletter({
      advisorId,
      slug,
      code,
      args: { title, articles: topics.map((topic) => newsletterArticle(topic)), contactName: (recipients.length ? recipients : audience.names).join(" and "), tag: audience.tag },
      request: tidy
    });
    if (!prepared.ok) return preparedWork(prepared.error);
    await keepOnlyPending(advisorId, "newsletter", Number(prepared.actionId));
    const names = Array.isArray(prepared.to) ? prepared.to : recipients;
    return preparedWork(newsletterReadyLine(title, names, topics.map((topic) => newsletterArticle(topic).title)), [{
      id: Number(prepared.actionId),
      kind: "newsletter",
      summary: prepared.summary || title,
      preview: prepared.preview || "",
      previewHtml: prepared.html || "",
      previewImage: ""
    }]);
  }
  if (isEletterAsk(tidy)) {
    const paused = await taskReady(advisorId, "eletters");
    if (paused) return preparedWork(paused);
    const letter = eletterFromRequest(tidy);
    const named = eletterRecipient(tidy);
    const topics = newsletterTopics(tidy);
    const recipients = named ? [named] : newsletterRecipients(tidy);
    const audience = campaignAudience(tidy);
    if (!letter && topics.length === 0) return null;
    if (recipients.length === 0 && !audience.tag) return preparedWork("Who should I send the letter to?");
    const article = letter || newsletterArticle(topics[0]);
    const body = letter ? letter.body : [article.body, ...topics.slice(1).map((topic) => newsletterArticle(topic).body)].join("\n\n");
    const title = letter ? letter.title : article.title;
    const prepared = await sendAdvisorEletter({
      advisorId,
      slug,
      code,
      args: { title, body, contactName: (recipients.length ? recipients : audience.names).join(" and "), tag: audience.tag },
      request: tidy
    });
    if (!prepared.ok) return preparedWork(prepared.error);
    await keepOnlyPending(advisorId, "eletter", Number(prepared.actionId));
    return preparedWork(eletterConfirmLine(title, recipients.length ? recipients : [audience.tag || "your contacts"]), [{
      id: Number(prepared.actionId),
      kind: "eletter",
      summary: prepared.summary || title,
      preview: prepared.preview || "",
      previewHtml: prepared.html || "",
      previewImage: ""
    }]);
  }
  if (await wantsCard(advisorId, tidy)) {
    const paused = await taskReady(advisorId, "cards");
    if (paused) return preparedWork(paused);
    const name = contactPhrase(tidy);
    const cards = await cardsForAdvisor(advisorId);
    const picked = matchCardByName(tidy, cards);
    if (name.length < 2) {
      if (picked && "card" in picked) return preparedWork(`The ${picked.card.title} card. Which contact should I send it to?`);
      if (picked && "cards" in picked) return preparedWork(cardDoubtLine(picked.cards.map((item) => item.title)));
      return preparedWork("Which contact should I send the e-card to?");
    }
    const people = await findNamedContacts(advisorId, name);
    if (people.length === 0) return preparedWork(`I could not find ${name} in your contacts. Which contact should I use?`);
    if (people.length > 1) return preparedWork(`Did you mean ${people.slice(0, 4).map((row) => row.full_name).join(" or ")}?`);
    const person = people[0];
    if (!picked) return preparedWork(cardDoubtLine(cards.slice(0, 4).map((item) => item.title), person.full_name));
    if ("cards" in picked) return preparedWork(cardDoubtLine(picked.cards.map((item) => item.title), person.full_name));
    await stagePreparedCard(advisorId, picked.card, [{ id: Number(person.id), full_name: person.full_name }]);
    return preparedWork(cardConfirmLine(picked.card.title, person.full_name));
  }
  if (isZoomAsk(tidy)) {
    const paused = await taskReady(advisorId, "meetings");
    if (paused) return preparedWork(paused);
    const name = contactPhrase(tidy);
    if (name.length < 2) return preparedWork("Which contact is the Zoom meeting with?");
    const result = await bookZoom(advisorId, { contactName: name, whenText: tidy, minutes: 30 }, [tidy], /* @__PURE__ */ new Date());
    return preparedWork(meetingReply(result));
  }
  if (isCalendarAsk(tidy)) return preparedWork(await calendarBrief(advisorId, tidy));
  if (isCampaignAsk(tidy)) {
    const paused = await taskReady(advisorId, "campaigns");
    if (paused) return preparedWork(paused);
    const listed = await listDrips({ data: { slug, code } });
    if (!listed?.ok) return preparedWork(String(listed?.error || "Campaigns could not be loaded."));
    const catalog = [
      ...(listed.campaigns || []).map((item) => item.name),
      ...(listed.defaults || []).map((item) => item.name)
    ].filter(Boolean);
    const asked = tidy.toLowerCase();
    const match = catalog.filter((name) => asked.includes(name.toLowerCase())).sort((left, right) => right.length - left.length)[0];
    if (!match) return preparedWork(`Which campaign? ${catalog.join(", ") || "There is no campaign on this desk yet."}`);
    const audience = campaignAudience(tidy);
    const every = dripDays(tidy) || 7;
    const prepared = await proposeCampaign({ advisorId, slug, code, args: { campaign: match, frequency: String(every), contactName: audience.names.join(" and "), tag: audience.tag }, request: tidy });
    if (!prepared.ok) return preparedWork(prepared.error);
    await keepOnlyPending(advisorId, "campaign", Number(prepared.actionId));
    const names = audience.names.length ? audience.names : String(prepared.summary || "").split("\xB7").pop()?.trim().split(",").map((item) => item.trim()).filter(Boolean) || [];
    return preparedWork(campaignConfirmLine(match, names, dripLabel(every).toLowerCase()), [{
      id: Number(prepared.actionId),
      kind: "campaign",
      summary: prepared.summary || match,
      preview: prepared.preview || "",
      previewHtml: prepared.html || "",
      previewImage: ""
    }]);
  }
  if (isInboxAsk(tidy)) return preparedWork(await inboxBrief(advisorId));
  if (isFileAsk(tidy)) {
    const name = fileSubject(tidy);
    if (name.length < 2) return preparedWork("Which contact should I open?");
    return preparedWork(await contactBrief(advisorId, name));
  }
  if (isReviewAsk(tidy)) return preparedWork(await reviewBrief(advisorId));
  if (looksLikeInstruction(tidy) || /^(?:yes|yeah|yep|no|nope|ok|okay)\b/i.test(tidy)) return null;
  const onlyName = await findNamedContacts(advisorId, tidy);
  if (onlyName.length === 1 && tidy.toLowerCase() === onlyName[0].full_name.toLowerCase()) {
    return preparedWork(await contactBrief(advisorId, onlyName[0].full_name));
  }
  return null;
}
async function confirmSpokenZoom(advisorId, thread) {
  const placed = await confirmPendingZoom(advisorId);
  if (placed?.reply) return placed.reply;
  const earlier = [...thread].reverse().find((turn) => turn.role === "user" && /\b(?:zoom|meeting)\b/i.test(turn.content) && !isTimeAgreement(turn.content));
  if (!earlier) return "";
  const result = await bookZoom(advisorId, { contactName: contactPhrase(earlier.content), whenText: earlier.content, minutes: 30 }, [earlier.content, "yes"], /* @__PURE__ */ new Date());
  return meetingReply(result);
}
async function directAdvisorCommand(advisorId, slug, code, chatId, text, onDelta) {
  const tidy = tidyHeard(text);
  if (isTextEdit(tidy) || (blocksLookup(tidy) && !agreesToSendCard(tidy) && !declinesCard(tidy))) return null;
  const sql = await getSql();
  const thread = await advisorThread(advisorId, chatId);
  const waitingCard = cardAwaitingYes(thread) || cardAwaitingApprove(thread);
  if (declinesCard(tidy) && (waitingCard || newsletterAwaitingYes(thread) || eletterAwaitingYes(thread) || campaignAwaitingYes(thread) || batchAwaitingYes(thread))) {
    await cancelWaitingCard(advisorId);
    try {
      await clearPendingZoom(advisorId);
    } catch (error) {
      console.error("[assistant] zoom-cancel", error);
    }
    try {
      await ensureLinkTables();
      await sql`update assistant_actions set status = 'discarded' where advisor_id = ${advisorId} and status = 'pending' and kind in ('newsletter', 'eletter', 'campaign', 'card')`;
    } catch (error) {
      console.error("[assistant] send-cancel", error);
    }
    return replyWith(advisorId, chatId, "Okay. I did not send it.", onDelta);
  }
  const lastAssistant = [...thread].reverse().find((turn) => turn.role === "assistant")?.content || "";
  const pickingPart = /which part should i take out/i.test(lastAssistant);
  if (!agreesToSendCard(tidy) && (isNewsletterEdit(tidy) || pickingPart && !taskKind(tidy) && tidy.length < 80)) {
    const revised = await revisePendingNewsletter(advisorId, slug, code, tidy, pickingPart);
    return replyWith(advisorId, chatId, revised.reply, onDelta, revised.actions);
  }
  if ((agreesToSendCard(tidy) || isTimeAgreement(tidy)) && /shall i book|just to confirm: a \d+-minute zoom|zoom meeting with/i.test(lastAssistant)) {
    const paused = await taskReady(advisorId, "meetings");
    if (paused) return replyWith(advisorId, chatId, paused, onDelta);
    const reply = await confirmSpokenZoom(advisorId, thread);
    return replyWith(advisorId, chatId, reply || "The meeting was not booked. Say the contact and the time again.", onDelta);
  }
  if (agreesToSendCard(tidy) && batchAwaitingYes(thread)) {
    const lastBatch = [...thread].reverse().find((turn) => turn.role === "assistant")?.content || "";
    const lines = [];
    if (/newsletter/i.test(lastBatch)) {
      const paused = await taskReady(advisorId, "newsletters");
      if (paused) lines.push(paused);
      else {
        const sent = await deliverConfirmedNewsletter(advisorId, slug, code);
        lines.push(sent.ok ? sent.detail : `Newsletter: ${sent.error}`);
      }
    }
    if (/e-letter/i.test(lastBatch)) {
      const paused = await taskReady(advisorId, "eletters");
      if (paused) lines.push(paused);
      else {
        const sent = await deliverConfirmedEletter(advisorId, slug, code);
        lines.push(sent.ok ? sent.detail : `E-letter: ${sent.error}`);
      }
    }
    if (/\bcampaign\b/i.test(lastBatch)) {
      const paused = await taskReady(advisorId, "campaigns");
      if (paused) lines.push(paused);
      else {
        const sent = await deliverConfirmedCampaign(advisorId, slug, code);
        lines.push(sent.ok ? sent.detail : `Campaign: ${sent.error}`);
      }
    }
    if (/e-card/i.test(lastBatch)) {
      const paused = await taskReady(advisorId, "cards");
      if (paused) lines.push(paused);
      else {
        let sent = await deliverConfirmedCard(advisorId, slug, code);
        if (!sent.ok && /don't have an e-card waiting/i.test(sent.error)) sent = await deliverPendingCardAction(advisorId, slug, code);
        lines.push(sent.ok ? sent.detail : `E-card: ${sent.error}`);
      }
    }
    if (/shall i book it/i.test(lastBatch)) {
      const paused = await taskReady(advisorId, "meetings");
      if (paused) lines.push(paused);
      else {
        const placed = await confirmPendingZoom(advisorId);
        lines.push(placed?.reply || "The meeting was not booked.");
      }
    }
    return replyWith(advisorId, chatId, lines.filter(Boolean).join("\n") || "Nothing was waiting.", onDelta);
  }
  if (agreesToSendCard(tidy) && eletterAwaitingYes(thread) && !cardAwaitingYes(thread) && !newsletterAwaitingYes(thread)) {
    const paused = await taskReady(advisorId, "eletters");
    if (paused) return replyWith(advisorId, chatId, paused, onDelta);
    const sent = await deliverConfirmedEletter(advisorId, slug, code);
    if (!sent.ok) return replyWith(advisorId, chatId, `Sorry, something went wrong \u2014 please try again. ${sent.error}`, onDelta);
    return replyWith(advisorId, chatId, sent.detail, onDelta);
  }
  if (agreesToSendCard(tidy) && campaignAwaitingYes(thread) && !cardAwaitingYes(thread) && !newsletterAwaitingYes(thread) && !eletterAwaitingYes(thread)) {
    const paused = await taskReady(advisorId, "campaigns");
    if (paused) return replyWith(advisorId, chatId, paused, onDelta);
    const sent = await deliverConfirmedCampaign(advisorId, slug, code);
    if (!sent.ok) return replyWith(advisorId, chatId, `Sorry, something went wrong \u2014 please try again. ${sent.error}`, onDelta);
    return replyWith(advisorId, chatId, sent.detail, onDelta);
  }
  if (agreesToSendCard(tidy) && newsletterAwaitingYes(thread) && !cardAwaitingYes(thread)) {
    const sent = await deliverConfirmedNewsletter(advisorId, slug, code);
    if (!sent.ok) return replyWith(advisorId, chatId, `Sorry, something went wrong \u2014 please try again. ${sent.error}`, onDelta);
    return replyWith(advisorId, chatId, sent.detail, onDelta);
  }
  if (agreesToSendCard(tidy) && waitingCard) {
    let sent = cardAwaitingYes(thread) ? await deliverConfirmedCard(advisorId, slug, code) : { ok: false, error: "I don't have an e-card waiting to send. Tell me the card and the contact again." };
    if (!sent.ok && /don't have an e-card waiting/i.test(sent.error)) sent = await deliverPendingCardAction(advisorId, slug, code);
    if (!sent.ok) return replyWith(advisorId, chatId, `Sorry, something went wrong \u2014 please try again. ${sent.error}`, onDelta);
    return replyWith(advisorId, chatId, sent.detail, onDelta);
  }
  if (/\bdid you send\b/i.test(tidy) && /\bcard\b/i.test(tidy)) {
    const row = (await sql`select title, contact_name from messages where advisor_id = ${advisorId} and kind = 'card' order by id desc limit 1`)[0];
    const reply = row ? cardSentLine(row.title, [row.contact_name]) : "I have not sent a card yet. Tell me the card and who it is for, and I will ask you to confirm before I send it.";
    return replyWith(advisorId, chatId, reply, onDelta);
  }
  async function stageCard(card, person) {
    await stagePreparedCard(advisorId, card, [{ id: Number(person.id), full_name: person.full_name }]);
    return replyWith(advisorId, chatId, cardConfirmLine(card.title, person.full_name), onDelta);
  }
  const last = [...thread].reverse().find((turn) => turn.role === "assistant")?.content || "";
  const whichCard = last.match(/which e-card should i send to (.+?)\?/i);
  const cardQuestion = /did you mean\b/i.test(last) && /\bcard\b/i.test(last);
  const meantFor = cardQuestion ? last.match(/\bfor ([^?\n]+)\?/i)?.[1]?.trim() || "" : "";
  const needContact = last.match(/the (.+?) card\. which contact should i send it to\?/i);
  const personHint = whichCard?.[1]?.trim() || meantFor;
  const askingCard = Boolean(whichCard) || cardQuestion || Boolean(needContact);
  const namedInCommand = contactPhrase(tidy);
  if (isOnboardingDemo(tidy)) return replyWith(advisorId, chatId, onboardingDraft(text), onDelta);
  const cardAsk = await wantsCard(advisorId, tidy);
  const newCardCommand = cardAsk && namedInCommand.length >= 2;
  if (askingCard && !newCardCommand && !isZoomAsk(tidy)) {
    const cards = await cardsForAdvisor(advisorId);
    const named = [...last.matchAll(/\bthe (.+?) card\b/gi)].map((match) => match[1].trim()).filter(Boolean);
    if (agreesToSendCard(tidy) && named.length > 1) return replyWith(advisorId, chatId, cardDoubtLine(named, personHint), onDelta);
    const answer = needContact?.[1] || (agreesToSendCard(tidy) && named.length === 1 ? named[0] : tidy);
    const picked = matchCardByName(answer, cards);
    if (picked && "card" in picked) {
      const who = personHint || (needContact ? tidy : "");
      if (looksLikeInstruction(who) || isOnboardingDemo(who)) return replyWith(advisorId, chatId, onboardingDraft(text), onDelta);
      if (who.trim().length < 2) return replyWith(advisorId, chatId, `The ${picked.card.title} card. Which contact should I send it to?`, onDelta);
      const people = await findNamedContacts(advisorId, who);
      const person = people.find((row) => row.full_name.toLowerCase() === who.trim().toLowerCase()) || people[0];
      if (!person) return replyWith(advisorId, chatId, `I could not find ${who.trim()} in your contacts.`, onDelta);
      return stageCard(picked.card, { id: Number(person.id), full_name: person.full_name });
    }
    const choices = picked && "cards" in picked ? picked.cards : cards.slice(0, 4);
    const shortAnswer = tidy.length <= 80 && !/\b(?:newsletter|e-?letter|campaign|meeting|zoom|book)\b/i.test(tidy);
    if (picked || shortAnswer) return replyWith(advisorId, chatId, cardDoubtLine(choices.map((item) => item.title), personHint), onDelta);
  }
  const parts3 = splitSecretaryTasks(tidy);
  if (parts3.length > 1) {
    const done = [];
    const confirms = [];
    const actions = [];
    const seen = /* @__PURE__ */ new Set();
    for (const part of parts3) {
      const kind = taskKind(part);
      if (kind && seen.has(kind)) {
        done.push(`I can prepare one ${kind} at a time. After you say yes, ask me: ${part}`);
        continue;
      }
      if (kind) seen.add(kind);
      const prepared2 = await fulfillSecretary(advisorId, slug, code, part);
      if (!prepared2) {
        done.push(`I could not do this part: ${part}`);
        continue;
      }
      if (prepared2.confirm) confirms.push(prepared2.reply);
      else done.push(prepared2.reply);
      actions.push(...prepared2.actions);
    }
    const reply = [
      done.filter(Boolean).join("\n\n"),
      confirms.join("\n"),
      confirms.length > 1 ? "Say yes and I will send all of these." : ""
    ].filter(Boolean).join("\n\n");
    return replyWith(advisorId, chatId, reply || "Tell me which part to do first.", onDelta, actions);
  }
  if (agreesToSendCard(tidy) || declinesCard(tidy) || isTimeAgreement(tidy)) return null;
  const prepared = await fulfillSecretary(advisorId, slug, code, tidy);
  if (!prepared) return null;
  return replyWith(advisorId, chatId, prepared.reply, onDelta, prepared.actions);
}
async function hearWithGrok(advisorId, text, rulesNote, lastAssistant, calls) {
  const apiKey = await companyApiKey();
  if (!apiKey) return null;
  let titles = "";
  try {
    titles = (await cardsForAdvisor(advisorId)).map((card) => card.title).slice(0, 30).join(", ");
  } catch {
    titles = "";
  }
  const operating = await readOperatingInstructions();
  const system = `${operatingSystemBlock(operating)}

You are the understanding layer for one financial advisor. The same operating instructions apply to typed and voice requests. You do not send, book, or say that something was sent. The desk will do the work and ask the advisor to confirm. The advisor's rules are binding only when they do not conflict with the operating instructions. A letter, e-letter, note, or email is never an e-card. A newsletter is never an e-card. A drip or campaign is never an e-card. Who needs a review, which client needs a review, and who is due to contact means job review, not a card. Season's greeting, seasons greeting, seasonal greeting, thank you, thanks, birthday, holiday, halloween, welcome, and anniversary mean an e-card unless they asked for a letter, note, email, or newsletter. If a rule says a phrase is an e-card, the job is card. Use an e-card title from this desk. If more than one title fits, set unsure true and set ask to exactly: Did you mean the Name card? rewrite is one clear instruction: card "send the [exact title] e-card to [name]"; newsletter "create a newsletter about [topics] and send it to [names]"; remove "remove the [name] part from the newsletter"; eletter "write a letter to [name] and tell them [what they said]"; campaign "start the [name] drip campaign for [who]"; inbox "read my emails"; file "what products does [name] have"; review "which clients need a review"; calendar "show my calendar"; meeting "book a zoom meeting with [name] [day and time]"; several, every job in one rewrite separated by ". Then "; chat, not a secretary task and rewrite empty. Reply with JSON only, no markdown: {"job":"card|newsletter|eletter|campaign|inbox|file|review|calendar|meeting|several|chat","card":"","contact":"","rewrite":"","unsure":false,"ask":""}.`;
  const user = `Rules:
${rulesNote.slice(0, 4e3) || "None."}

E-cards: ${titles || "none yet"}

Your last reply: ${lastAssistant.slice(0, 800) || "none"}

Advisor said: ${text.slice(0, 800)}`;
  try {
    const response = await fetch(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: OPENAI_CHAT,
        temperature: 0,
        max_tokens: 300,
        messages: [{ role: "system", content: system }, { role: "user", content: user }]
      }),
      signal: AbortSignal.timeout(2e4)
    });
    if (!response.ok) return null;
    const json = await response.json();
    noteProvider(calls, factsFromResponse(response, json));
    return parseHeardJob(json.choices?.[0]?.message?.content || "");
  } catch (error) {
    console.error("[assistant] hear", error);
    return null;
  }
}
async function dropStaleApproval(advisorId) {
  const sql = await getSql();
  await sql`update assistant_actions set status = 'discarded' where advisor_id = ${advisorId} and status = 'pending'`;
  await sql`update assistant_drafts set status = 'discarded' where advisor_id = ${advisorId} and status = 'pending'`;
}
async function applyOrchestration(advisorId, control) {
  const sql = await getSql();
  await ensureAssistantTables();
  if (control.cancelStaged) {
    await sql`update assistant_drafts set status = 'cancelled', approval_state = 'cancelled' where advisor_id = ${advisorId} and status = 'pending'`;
    try {
      await ensureLinkTables();
      await sql`update assistant_actions set status = 'cancelled' where advisor_id = ${advisorId} and status = 'pending'`;
    } catch (error) {
      console.error("[assistant] cancel", error instanceof Error ? error.message : "failed");
    }
    return;
  }
  if (control.invalidateApproval) {
    await sql`update assistant_drafts set status = 'unsent', approval_state = 'withdrawn' where advisor_id = ${advisorId} and status = 'pending'`;
    return;
  }
  if (control.parkDraft) {
    await sql`update assistant_drafts set status = 'parked', approval_state = 'withdrawn' where advisor_id = ${advisorId} and status = 'pending'`;
  }
}
async function stagedRecords(advisorId) {
  const sql = await getSql();
  await ensureAssistantTables();
  const drafts = await sql`select id, status, approval_state from assistant_drafts where advisor_id = ${advisorId} and status in ('pending', 'unsent', 'parked', 'cancelled') order by id desc limit 8`;
  let actions = [];
  try {
    await ensureLinkTables();
    actions = await sql`select id, kind, status from assistant_actions where advisor_id = ${advisorId} and status in ('pending', 'stale', 'cancelled') order by id desc limit 8`;
  } catch {
    actions = [];
  }
  return [
    ...actions.map((row) => ({ id: Number(row.id), kind: String(row.kind), status: String(row.status), approval: String(row.status) === "pending" ? "pending" : String(row.status) })),
    ...drafts.map((row) => ({
      id: Number(row.id),
      kind: "draft",
      status: String(row.status) === "pending" ? "pending" : "stale",
      approval: String(row.approval_state || "none"),
    })),
  ];
}
async function orchestrationNote(advisorId, control) {
  const sql = await getSql();
  const drafts = await sql`select id, subject, body, status, approval_state from assistant_drafts where advisor_id = ${advisorId} and status <> 'sent' order by id desc limit 4`;
  let actions = [];
  try {
    actions = await sql`select id, kind, status from assistant_actions where advisor_id = ${advisorId} order by id desc limit 6`;
  } catch {
    actions = [];
  }
  return modelContext({
    blockLookups: control.blockLookups,
    drafts: drafts.map((draft) => ({ id: Number(draft.id), subject: String(draft.subject || ""), body: String(draft.body || ""), status: String(draft.status), approval: String(draft.approval_state || "none") })),
    actions: actions.map((action) => ({ id: Number(action.id), kind: String(action.kind), status: String(action.status), approval: String(action.status) })),
  });
}
function confirmationReply(decision) {
  if (decision.action === "missing") return "Nothing is staged for approval. I did not send anything.";
  if (decision.action === "stale") return "That approval is no longer valid. The saved draft was not deleted, and nothing was sent.";
  if (decision.action === "ambiguous") return "More than one action is waiting. Tell me which one to approve. I did not send anything.";
  return "";
}
export async function answerAdvisor(data, onDelta) {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  const settings = await readSettings2();
  const access = assistantGate({ status: gate.row.status, plan: gate.site.plan, settings });
  if (!access.ok) return access;
  const latest = [...cleanTurns(data.messages)].reverse().find((turn) => turn.role === "user");
  if (!latest) return { ok: false, error: "Type a question first." };
  const sql = await getSql();
  let chatId = Number(data.chatId);
  if (!(chatId > 0 ? (await sql`select id from assistant_chats where id = ${chatId} and advisor_id = ${gate.row.id}`)[0] : null)) chatId = await latestChat(gate.row.id);
  await remember(gate.row.id, chatId, "user", latest.content);
  const calls = [];
  let handled = null;
  try {
    const rules = await readRules(gate.row.id);
    const note = (rules.rules || []).filter((rule) => rule.on).map((rule) => rule.text).join("\n");
    const page = String(data.page || "").trim().slice(0, 80);
    const thread = await advisorThread(gate.row.id, chatId);
    if (/^change(?: the)? time\b/i.test(latest.content.trim())) {
      await clearPendingZoom(gate.row.id);
      const reply = "What day and time should I use instead?";
      handled = "fixed";
      await remember(gate.row.id, chatId, "assistant", reply);
      onDelta?.(reply);
      return { ok: true, reply, drafts: [], actions: [] };
    }
    console.info("[assistant] ask");
    const lastSaid = [...thread].reverse().find((turn) => turn.role === "assistant")?.content || "";
    const control = orchestrationControl(latest.content);
    await applyOrchestration(gate.row.id, control);
    if (control.cancelStaged && !control.conversational) {
      const reply = "Cancelled. The saved text is still here, and the send approval was withdrawn. Nothing was sent.";
      handled = "fixed-cancel";
      await remember(gate.row.id, chatId, "assistant", reply);
      onDelta?.(reply);
      return { ok: true, reply, drafts: [], actions: [] };
    }
    if (control.confirm) {
      const decision = resolveConfirmation(latest.content, await stagedRecords(gate.row.id));
      const refused = confirmationReply(decision);
      if (refused) {
        handled = "fixed-confirm";
        await remember(gate.row.id, chatId, "assistant", refused);
        onDelta?.(refused);
        return { ok: true, reply: refused, drafts: [], actions: [] };
      }
      const kept = await directAdvisorCommand(gate.row.id, data.slug || "", data.code || "", chatId, latest.content, onDelta);
      if (kept) {
        handled = "fixed-confirm";
        return kept;
      }
      const reply = "The staged action could not be completed. Nothing was sent.";
      handled = "fixed-confirm";
      await remember(gate.row.id, chatId, "assistant", reply);
      onDelta?.(reply);
      return { ok: true, reply, drafts: [], actions: [] };
    }
    if (control.conversational) {
      const context = await orchestrationNote(gate.row.id, control);
      const result = await runModel(settings, gate.row.id, gate.row.advisor_name || gate.row.slug, thread, data.slug || "", data.code || "", `${note}\n\n${context}${page ? `\n\nThe advisor is on the ${page} page of the desk.` : ""}`, onDelta, calls, chatId);
      if (result.ok) {
        handled = "openai";
        await remember(gate.row.id, chatId, "assistant", result.reply);
      } else {
        handled = calls.length ? "openai" : "model-unavailable";
      }
      return result;
    }
    if (deskKeepsTurn(latest.content, lastSaid)) {
      const kept = await directAdvisorCommand(gate.row.id, data.slug || "", data.code || "", chatId, latest.content, onDelta);
      if (kept) {
        handled = "fixed";
        return kept;
      }
      if (isTimeAgreement(latest.content) && /zoom|meeting|shall i book|toronto time|\d{1,2}:\d{2}\s*[ap]\.?m/i.test(lastSaid)) {
        const reply2 = await confirmSpokenZoom(gate.row.id, thread);
        if (reply2) {
          handled = "fixed";
          await remember(gate.row.id, chatId, "assistant", reply2);
          onDelta?.(reply2);
          return { ok: true, reply: reply2, drafts: [], actions: [] };
        }
      }
      const reply = "I don't have anything waiting for a yes or no. Tell me what you want done.";
      handled = "fixed";
      await remember(gate.row.id, chatId, "assistant", reply);
      onDelta?.(reply);
      return { ok: true, reply, drafts: [], actions: [] };
    }
    if (taskKind(latest.content)) {
      const known = await directAdvisorCommand(gate.row.id, data.slug || "", data.code || "", chatId, latest.content, onDelta);
      if (known) {
        handled = "fixed";
        return known;
      }
    }
    const heard = await hearWithGrok(gate.row.id, latest.content, note, lastSaid, calls);
    if (heard?.unsure && cardDoubtAllowed(latest.content, heard.job)) {
      const reply = grokDoubtReply(heard);
      if (reply) {
        handled = calls.length ? "openai" : "fixed";
        await remember(gate.row.id, chatId, "assistant", reply);
        onDelta?.(reply);
        return { ok: true, reply, drafts: [], actions: [] };
      }
    }
    const rewritten = heard && rewriteAllowed(latest.content, heardCommand(heard) || latest.content) ? heardCommand(heard) : "";
    if (rewritten) {
      const again = await directAdvisorCommand(gate.row.id, data.slug || "", data.code || "", chatId, rewritten, onDelta);
      if (again) {
        handled = "fixed";
        return again;
      }
    }
    const direct = await directAdvisorCommand(gate.row.id, data.slug || "", data.code || "", chatId, latest.content, onDelta);
    if (direct) {
      handled = "fixed";
      return direct;
    }
    if (isTimeAgreement(latest.content)) {
      const last = [...thread].reverse().find((turn) => turn.role === "assistant")?.content || "";
      if (/zoom|meeting|toronto time|calendar|\d{1,2}:\d{2}\s*[ap]\.?m/i.test(last)) {
        const placed = await confirmPendingZoom(gate.row.id);
        if (placed) {
          handled = "fixed";
          await remember(gate.row.id, chatId, "assistant", placed.reply);
          onDelta?.(placed.reply);
          return { ok: true, reply: placed.reply, drafts: [], actions: [] };
        }
      }
    }
    if (onDelta) console.info("[voice] ask-start");
    const result = await runModel(settings, gate.row.id, gate.row.advisor_name || gate.row.slug, thread, data.slug || "", data.code || "", page ? `${note}

The advisor is on the ${page} page of the desk. Use that when it is relevant.` : note, onDelta, calls, chatId);
    if (result.ok) {
      handled = "openai";
      await remember(gate.row.id, chatId, "assistant", result.reply);
    } else if (calls.length) handled = "openai";
    return result;
  } catch (error) {
    console.error("[assistant]", error);
    return { ok: false, error: "Sorry, something went wrong \u2014 please try again." };
  } finally {
    if (handled) await saveAssistantDiagnostic(gate.row.id, handled, calls).catch(() => void 0);
  }
}
export const askAssistant = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => answerAdvisor(data));
export const approveAssistantDraft = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  const settings = await readSettings2();
  await ensureAssistantTables();
  const draft = (await (await getSql())`
    select id, advisor_id, to_email, to_name, subject, body, status from assistant_drafts
    where id = ${Number(data.draftId)} and advisor_id = ${gate.row.id} limit 1
  `)[0];
  const decision = decideSend({ status: gate.row.status, plan: gate.site.plan, settings, actorId: gate.row.id, draftAdvisorId: draft ? Number(draft.advisor_id) : -1, draftStatus: draft?.status ?? "missing" });
  if (!decision.ok) return decision;
  if (!draft) return { ok: false, error: "That draft belongs to another advisor." };
  const sent = await sendApprovedAdvisorMail({ data: { slug: data.slug, code: data.code, to: draft.to_email, subject: draft.subject, body: draft.body, toName: draft.to_name } });
  if (!sent?.ok) return { ok: false, error: String(sent && "error" in sent ? sent.error : "The email was not sent.") };
  await (await getSql())`update assistant_drafts set status = 'sent' where id = ${draft.id} and advisor_id = ${gate.row.id}`;
  return { ok: true };
});
export const discardAssistantDraft = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  await (await getSql())`update assistant_drafts set status = 'discarded' where id = ${Number(data.draftId)} and advisor_id = ${gate.row.id} and status = 'pending'`;
  return { ok: true };
});
export const listAssistantActions = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  const access = assistantGate({ status: gate.row.status, plan: gate.site.plan, settings: await readSettings2() });
  if (!access.ok) return access;
  await ensureLinkTables();
  const rows = await (await getSql())`
    select id, kind, summary, payload from assistant_actions
    where advisor_id = ${gate.row.id} and status = 'pending' order by created_at desc limit 10
  `;
  const actions = [];
  for (const row of rows) {
    let preview = "";
    let previewHtml = "";
    let previewImage = "";
    if (row.kind === "newsletter") {
      const issue = issueFromAction(row.payload);
      if (issue) previewHtml = await newsletterPreviewHtml(data.slug || "", data.code || "", issue);
    }
    if (row.kind === "card") {
      try {
        const parsed = JSON.parse(row.payload);
        previewImage = String(parsed.image || "");
        previewHtml = cardPreviewHtml(previewImage, String(parsed.message || ""), row.summary, shownWebsite(gate.site));
      } catch {
        previewHtml = "";
      }
    }
    if (row.kind === "campaign") {
      try {
        const parsed = JSON.parse(row.payload);
        const brand = await advisorBrand(data.slug || "", data.code || "");
        if (brand.ok && ELETTER_DESIGNS.some((item) => item.id === parsed.design)) {
          previewHtml = renderEletter({
            letter: { kind: "eletter", design: parsed.design, kicker: "A note", title: String(parsed.previewTitle || "Article"), subject: String(parsed.previewTitle || "Article"), body: String(parsed.previewBody || ""), social: brand.social },
            contact: brand.contact,
            logoSrc: "",
            mode: "preview"
          });
        }
      } catch {
        previewHtml = "";
      }
    }
    if (row.kind === "eletter") {
      try {
        const parsed = JSON.parse(row.payload);
        const brand = await advisorBrand(data.slug || "", data.code || "");
        if (brand.ok) {
          const design = ELETTER_DESIGNS.some((item) => item.id === parsed.design) ? parsed.design : ELETTER_DESIGNS[0].id;
          previewHtml = renderEletter({
            letter: { kind: "eletter", design, kicker: "A letter", title: String(parsed.title || "Letter"), subject: String(parsed.title || "Letter"), body: String(parsed.body || ""), social: brand.social },
            contact: brand.contact,
            logoSrc: "",
            mode: "preview"
          });
        }
      } catch {
        previewHtml = "";
      }
    }
    actions.push({ id: Number(row.id), kind: row.kind, summary: row.summary, preview, previewHtml, previewImage });
  }
  return { ok: true, actions };
});
export const approveAssistantAction = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  const settings = await readSettings2();
  await ensureLinkTables();
  const sql = await getSql();
  let chatId = Number(data.chatId);
  if (!(chatId > 0 ? (await sql`select id from assistant_chats where id = ${chatId} and advisor_id = ${gate.row.id}`)[0] : null)) chatId = await latestChat(gate.row.id);
  const action = (await sql`
    select id, advisor_id, kind, payload, status from assistant_actions
    where id = ${Number(data.actionId)} and advisor_id = ${gate.row.id} limit 1
  `)[0];
  const known = action?.kind === "zoom" || action?.kind === "dropbox" || action?.kind === "calendar" || action?.kind === "newsletter" || action?.kind === "card" || action?.kind === "eletter" || action?.kind === "campaign";
  const kind = known ? action.kind : "calendar";
  const decision = decideAction({ status: gate.row.status, plan: gate.site.plan, settings, actorId: gate.row.id, actionAdvisorId: action ? Number(action.advisor_id) : -1, actionStatus: action?.status ?? "missing", kind });
  if (!decision.ok) return decision;
  if (!action) return { ok: false, error: "That request belongs to another advisor." };
  let payload = {};
  try {
    payload = JSON.parse(action.payload);
  } catch {
    return { ok: false, error: "That request could not be read." };
  }
  const done = action.kind === "campaign" ? await runQueuedCampaign({ slug: data.slug || "", code: data.code || "", payload: action.payload }) : action.kind === "newsletter" ? await sendProposedNewsletter({ slug: data.slug || "", code: data.code || "", payload: action.payload }) : action.kind === "card" ? await sendQueuedCard({ slug: data.slug || "", code: data.code || "", payload }) : action.kind === "eletter" ? await sendQueuedEletter({ slug: data.slug || "", code: data.code || "", payload }) : action.kind === "zoom" ? await createZoomMeeting(gate.row.id, { title: payload.title || "Meeting", start: payload.start || "", minutes: Number(payload.minutes) || 30 }) : action.kind === "dropbox" ? await saveDropboxNote(gate.row.id, { name: payload.name || "note", content: payload.content || "" }) : await createCalendarEvent(gate.row.id, { provider: payload.provider === "google" ? "google" : "outlook_calendar", title: payload.title || "Meeting", start: payload.start || "", minutes: Number(payload.minutes) || 30 });
  if (!done.ok) {
    const error = "error" in done ? String(done.error || "That was not sent.") : "That was not sent.";
    try {
      await remember(gate.row.id, chatId, "assistant", error);
    } catch (rememberError) {
      console.error("[assistant] remember", rememberError);
    }
    return done;
  }
  const detail = "detail" in done && done.detail ? String(done.detail) : "Done.";
  try {
    await remember(gate.row.id, chatId, "assistant", detail);
  } catch (rememberError) {
    console.error("[assistant] remember", rememberError);
  }
  await sql`update assistant_actions set status = 'done' where id = ${action.id} and advisor_id = ${gate.row.id}`;
  return { ok: true, detail };
});
export const discardAssistantAction = createServerFn({ method: "POST" }).validator((input) => input).handler(async ({ data }) => {
  const gate = await gateAdvisor(data.slug || "", data.code || "");
  if (!gate.ok) return gate;
  await (await getSql())`update assistant_actions set status = 'discarded' where id = ${Number(data.actionId)} and advisor_id = ${gate.row.id} and status = 'pending'`;
  return { ok: true };
});
export async function openAiSpeech(text, voice) {
  const chosen = openAiVoice(voice);
  try {
    const apiKey = await companyApiKey();
    if (!apiKey) return { ok: false, error: "No OpenAI key is saved. Open Superadmin, choose OpenAI, paste the key, and press Save." };
    const response = await fetch(`${OPENAI}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: speechBody(text, chosen),
    });
    if (!response.ok) {
      let detail = "";
      try {
        const failed = await response.json();
        detail = String(failed?.error?.message || failed?.error || "").replace(/sk-[A-Za-z0-9_-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
      } catch {
        detail = "";
      }
      console.error(`[voice] sample ${response.status}`);
      return { ok: false, error: detail ? `OpenAI refused ${chosen} on ${OPENAI_TTS} (${response.status}): ${detail}` : `OpenAI refused ${chosen} on ${OPENAI_TTS} (${response.status}).` };
    }
    const type = String(response.headers.get("content-type") || "");
    const audio = await response.arrayBuffer();
    console.info(`[voice] sample bytes=${audio.byteLength} type=${type.split(";")[0]}`);
    if (!type.includes("audio") && !type.includes("mpeg")) return { ok: false, error: `OpenAI returned ${type || "no content type"} instead of audio.` };
    if (audio.byteLength < 100) return { ok: false, error: "OpenAI returned an empty voice clip." };
    return { ok: true, audio, mime: type.split(";")[0] || "audio/mpeg", voice: chosen, model: OPENAI_TTS };
  } catch (error) {
    console.error("[voice] sample", error instanceof Error ? error.message : "failed");
    return { ok: false, error: "The voice service did not answer. Check the OpenAI key, then press Preview again." };
  }
}
