import {
  asksArchiveSearch,
  asksCampaignControl,
  asksContactRecord,
  asksEmailThreadStatus,
  asksIssueDates,
  asksMeetingPreview,
  asksSavedCampaignReview,
  audienceRequest,
} from "./delivery-audience.ts";

/** Drop a negated send, start, book, or create clause so it cannot count as a request to deliver. */
export function withoutNegatedDelivery(text: string) {
  return String(text || "")
    .replace(/\bnot\s+permission\s+to\b[^.]*/gi, " ")
    .replace(/\b(?:rather than|instead of)\s+(?:sending|starting|enrolling|booking)\b[^.]*/gi, " ")
    .replace(/\b(?:do not|don't|never|without)\b[^.]*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True only when this turn still asks to send, start, or book after negated clauses are removed. */
export function deliveryRequested(text: string) {
  const allowed = withoutNegatedDelivery(text);
  if (/\b(?:send|deliver|start|run|launch|book)\b/i.test(allowed)) return true;
  if (/\b(?:e-?mail|mail)\s+(?:it|this|that|them|him|her|out|to)\b/i.test(allowed)) return true;
  return false;
}

/**
 * A preview, edit, or lookup that must stay on the desk.
 * An explicit constraint (archive search, issue dates, one contact, email-thread status)
 * wins over a broader keyword such as newsletter, life insurance, or signature.
 * A real send returns "" so the delivery path can ask for confirmation.
 */
export function contentHoldKind(text: string) {
  const tidy = String(text || "");
  if (!tidy.trim()) return "";
  if (deliveryRequested(tidy)) return "";
  if (asksEmailThreadStatus(tidy)) return "email-thread";
  if (asksArchiveSearch(tidy)) return "archive";
  if (asksContactRecord(tidy)) return "contact-record";
  if (asksIssueDates(tidy)) return "issue-dates";
  if (asksCampaignControl(tidy) || asksSavedCampaignReview(tidy)) return "campaign";
  if (asksMeetingPreview(tidy)) return "meeting";
  if (isCardHold(tidy)) return "e-card";
  if (isLetterHold(tidy)) return "e-letter";
  if (isNewsletterHoldText(tidy) || asksSavedIssuePreview(tidy)) return "newsletter";
  // A line edit that merely mentions a document, email, or calendar is not a preview.
  if (isListRevision(tidy)) return "";
  const allowed = withoutNegatedDelivery(tidy);
  if (!allowed) return "";
  if (/\b(?:drips?|campaigns?)\b/i.test(allowed)) return "campaign";
  if (/\b(?:forms?|useful links?)\b/i.test(allowed)) return "form";
  if (isDocumentHold(allowed)) return "document";
  if (isSignatureHold(allowed)) return "signature";
  if (isEmailHold(allowed)) return "email";
  if (isCalendarHold(allowed)) return "calendar";
  if (asksAudienceList(tidy)) return "contacts";
  return "";
}

function asksSavedIssuePreview(text: string) {
  const tidy = String(text || "");
  if (asksIssueDates(tidy) || asksArchiveSearch(tidy)) return false;
  if (/\b(?:forms?|useful links?|polic(?:y|ies)|documents?)\b/i.test(tidy)) return false;
  const numbered = /\b(?:newsletter|issue|copy)\s+(?:number|no\.?|#)\s*\d+\b/i.test(tidy);
  if (!numbered) return false;
  return audienceRequest(tidy) !== "" || /\b(?:rehears(?:e|al)|preview|look like)\b/i.test(tidy);
}

function isListRevision(text: string) {
  return /\b(?:replace|change|swap|update|edit)\b[\s\S]{0,60}\b(?:bullet|point|line|item|sentence|paragraph|section)\b/i.test(text)
    || /\b(?:replace|change|swap)\s+the\s+(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\b/i.test(text);
}

function isDocumentHold(allowed: string) {
  if (/\bassistant test\b/i.test(allowed)) return true;
  return /\b(?:show|preview|open|read)\b/i.test(allowed) && /\bdocuments?\b/i.test(allowed);
}

function isSignatureHold(allowed: string) {
  return /\bsignatures?\b/i.test(allowed);
}

function isEmailHold(allowed: string) {
  return /\be-?mail\s+preview\b/i.test(allowed) || (/\bpreview\b/i.test(allowed) && /\be-?mails?\b/i.test(allowed));
}

function isCalendarHold(allowed: string) {
  if (/\bcalendars?\b/i.test(allowed)) return true;
  return /\b(?:show|see|read|check|what(?:'s| is)|list)\b/i.test(allowed)
    && /\b(?:meetings?|appointments?|schedule|agenda)\b/i.test(allowed);
}

function isCardHold(text: string) {
  if (/\b(?:e-?cards?|greeting cards?)\b/i.test(text)) return true;
  if (/\b(?:thank(?:\s+you)?|birthday|holiday|welcome|anniversary)\s+cards?\b/i.test(text)) return true;
  return /\bcards?\b/i.test(text) && /\b(?:preview|show|prepare|change|replace|rewrite|update|edit|message)\b/i.test(text);
}

function isLetterHold(text: string) {
  if (/\b(?:e-?cards?|cards?|newsletters?|drips?|campaigns?)\b/i.test(text)) return false;
  if (!/\b(?:e-?letters?|letters?|notes?)\b/i.test(text)) return false;
  if (/\b(?:write|draft|compose|prepare)\b/i.test(text) && /\b(?:to|for)\b/i.test(text) && !/\b(?:preview|open|show|saved|archive)\b/i.test(text)) return false;
  return true;
}

function isNewsletterHoldText(text: string) {
  if (asksArchiveSearch(text)) return false;
  if (/\bnewsletters?\b/i.test(text)) return true;
  return /\b(?:move|reorder|rearrange|add|shorten|remove)\b/i.test(text) && /\b(?:articles?|positions?)\b/i.test(text);
}

function asksAudienceList(text: string) {
  if (asksIssueDates(text) || asksContactRecord(text)) return false;
  return /\b(?:who can receive|eligible names|exclusions?|can receive mail)\b/i.test(text)
    || (/\blife[\s-]*insurance clients?\b/i.test(text) && /\b(?:who|which|list|show|eligible|receive)\b/i.test(text));
}

/** Cancel withdraws the approval. The draft row and its text stay. */
export function draftWithdrawalUpdate() {
  return { status: "unsent" as const, approval_state: "withdrawn" as const, deletesRows: false as const };
}

export function holdNote(kind: string) {
  if (kind === "campaign") return "Nothing was started.";
  if (kind === "meeting" || kind === "calendar") return "Nothing was booked.";
  return "Nothing was sent.";
}

/** A reply claims delivery only when a sentence says something was sent or booked and does not negate it. */
export function replyClaimsDelivery(text: string) {
  return String(text || "").split(/[.\n]/).some((sentence) => {
    if (/\b(?:nothing|not|never|did not|didn't|cannot|can't|wasn't|weren't|without|no recipient)\b/i.test(sentence)) return false;
    return /\b(?:was sent|were sent|has been sent|is booked|was booked|was started|was emailed)\b/i.test(sentence);
  });
}
