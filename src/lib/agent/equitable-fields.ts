import { createHash } from "node:crypto";

export const FORM_CODE = "671BCF";
export const FORM_TITLE = "Beneficiary Change Request Form (671BCF)";

/** Equitable 671BCF is the only fill mapping. Other providers stay unfilled. */
export function providerMapping(title: string, href: string) {
  return /671bcf/i.test(`${title} ${href}`) ? FORM_CODE : "";
}

/** Signature and witness lines. These are never written. */
export const SIGNATURE_FIELDS = [
  "Name of Policy Owner",
  "Title of Policy Owner",
  "Name of Joint Policy Owner",
  "Title of Joint Policy Owner",
  "Date",
  "Date_2",
  "Date_3",
  "Date_4",
  "City and Province",
  "City and Province_2",
  "ddmmyyyy",
  "ddmmyyyy_2",
] as const;

export type Designation = "named" | "policy-owners" | "insured";

export type DraftFacts = {
  clientName?: string;
  owner?: string;
  policyNumber?: string;
  email?: string;
  address?: string;
  phone?: string;
  beneficiaryName?: string;
  relationship?: string;
  sharePercent?: string;
  designation?: Designation;
  trustee?: string;
  beneficiaryBirth?: string;
  beneficiaryContact?: string;
};

export const REQUIRED_QUESTIONS: Array<{ key: keyof DraftFacts; ask: string }> = [
  { key: "beneficiaryName", ask: "What is the beneficiary's full legal name?" },
  { key: "relationship", ask: "What is the beneficiary's relationship to the owner?" },
  { key: "sharePercent", ask: "What share percentage should this beneficiary receive?" },
  { key: "designation", ask: "Is the beneficiary a named person, the policy owners, or the insured person?" },
  { key: "trustee", ask: "If the beneficiary is a minor, what is the trustee's name? If there is no trustee, say no trustee." },
];

type Fixture = Required<Pick<DraftFacts, "clientName" | "owner" | "policyNumber" | "email" | "address" | "phone">>;

/** Fictional staging clients only. Real contact records are not read. */
const FIXTURES: Record<string, Fixture> = {
  "staging-practice": {
    clientName: "Avery Example",
    owner: "Avery Example",
    policyNumber: "AE-1001",
    email: "avery.example@example.invalid",
    address: "1 Example Street, Toronto ON",
    phone: "416-555-0101",
  },
  "staging-other": {
    clientName: "Blake Example",
    owner: "Blake Example",
    policyNumber: "BE-2002",
    email: "blake.example@example.invalid",
    address: "2 Example Avenue, Ottawa ON",
    phone: "613-555-0102",
  },
};

export function missingQuestions(facts: DraftFacts) {
  return REQUIRED_QUESTIONS.filter((item) => !String(facts[item.key] || "").trim()).map((item) => item.ask);
}

export function factsHash(facts: DraftFacts) {
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}

export type DraftPayload = {
  advisorId: string;
  clientName: string;
  formCode: string;
  destination: string;
  factsHash: string;
};

export function draftPayloadHash(payload: DraftPayload) {
  return createHash("sha256").update(JSON.stringify({
    advisorId: payload.advisorId,
    clientName: payload.clientName,
    formCode: payload.formCode,
    destination: payload.destination,
    factsHash: payload.factsHash,
  })).digest("hex");
}

function norm(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function userSaid(text: string, value: string) {
  const needle = norm(value);
  return Boolean(needle) && norm(text).includes(needle);
}

function negated(text: string, value: string) {
  const needle = escapeRegExp(norm(value));
  if (!needle) return false;
  return new RegExp(`\\b(?:not|no|never|isn't|isnt|don't use|dont use)\\s+(?:a\\s+|the\\s+)?${needle}\\b`).test(norm(text));
}

export function knownClient(slug: string, name: string, userText: string) {
  const fixture = FIXTURES[slug];
  if (!fixture) return { found: false as const, reason: "This preview only has fictional staging clients. No client record was read." };
  const asked = String(name || "").trim();
  if (!asked) return { found: false as const, reason: "Which fictional client is this draft for?" };
  if (!userSaid(userText, asked)) return { found: false as const, reason: "That client name was not in the latest message, so I did not assume one." };
  if (negated(userText, asked)) return { found: false as const, reason: "That client name was negated. I did not use it." };
  if (norm(asked) !== norm(fixture.clientName)) {
    return { found: false as const, reason: `${asked} is not the fictional client for this advisor. Nothing was copied from another advisor.` };
  }
  const people = properNames(userText);
  if (people.length > 1 && /\bor\b/i.test(userText)) {
    return { found: false as const, reason: `Which client do you mean: ${people.join(" or ")}?` };
  }
  return { found: true as const, facts: { ...fixture } };
}

function properNames(text: string) {
  return [...new Set([...String(text || "").matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g)].map((match) => match[0]))];
}

function percentages(text: string) {
  return [...new Set([...String(text || "").matchAll(/\b(\d{1,3})\s*(?:%|percent)\b/gi)].map((match) => String(Number(match[1]))))];
}

export type FactRejection = { field: string; reason: string };

/** Accept only facts the latest message actually stated. Never fills a signature. */
export function acceptSuppliedFacts(current: DraftFacts, incoming: DraftFacts, userText: string) {
  const next: DraftFacts = { ...current };
  const accepted: string[] = [];
  const rejected: FactRejection[] = [];
  const text = String(userText || "");
  const consider = (field: keyof DraftFacts, value: string | undefined, allow: () => string) => {
    const clean = String(value || "").trim();
    if (!clean) return;
    const reason = allow();
    if (reason) {
      rejected.push({ field, reason });
      return;
    }
    next[field] = clean as never;
    accepted.push(field);
  };
  consider("beneficiaryName", incoming.beneficiaryName, () => {
    if (!userSaid(text, incoming.beneficiaryName || "")) return "The beneficiary name was not in the latest message.";
    if (negated(text, incoming.beneficiaryName || "")) return "The beneficiary name was negated.";
    const people = properNames(text).filter((name) => norm(name) !== norm(current.clientName || ""));
    if (people.length > 1 && /\bor\b/i.test(text)) return `Which beneficiary do you mean: ${people.join(" or ")}?`;
    return "";
  });
  consider("relationship", incoming.relationship, () => userSaid(text, incoming.relationship || "") && !negated(text, incoming.relationship || "") ? "" : "The relationship was not stated.");
  consider("sharePercent", incoming.sharePercent, () => {
    const share = String(incoming.sharePercent || "").replace(/[^\d]/g, "");
    if (!share) return "The share was not a percentage.";
    const stated = percentages(text);
    if (stated.length !== 1) return stated.length > 1 ? `Which share do you mean: ${stated.join("% or ")}%?` : "The share percentage was not stated.";
    if (stated[0] !== String(Number(share))) return "That share was not the percentage in the latest message.";
    if (negated(text, stated[0])) return "That share was negated.";
    incoming.sharePercent = stated[0];
    return "";
  });
  consider("designation", incoming.designation, () => {
    const value = String(incoming.designation || "");
    if (value !== "named" && value !== "policy-owners" && value !== "insured") return "Pass the designation as named, policy-owners, or insured.";
    const choices = designationPhrases(text);
    if (choices.length !== 1) return choices.length > 1 ? "The designation is ambiguous. Say named beneficiary, policy owners, or the insured person." : "The designation was not stated.";
    if (choices[0] !== value) return "That designation was not what the message said.";
    return "";
  });
  consider("trustee", incoming.trustee, () => {
    const value = String(incoming.trustee || "").trim();
    if (norm(value) === "none") {
      return /\b(no trustee|not a minor|there is no trustee)\b/i.test(text) ? "" : "Say no trustee if there is not one. I did not assume that.";
    }
    return userSaid(text, value) && !negated(text, value) ? "" : "The trustee name was not stated.";
  });
  consider("beneficiaryBirth", incoming.beneficiaryBirth, () => userSaid(text, incoming.beneficiaryBirth || "") ? "" : "The date of birth was not stated.");
  consider("beneficiaryContact", incoming.beneficiaryContact, () => userSaid(text, incoming.beneficiaryContact || "") ? "" : "The beneficiary contact was not stated.");
  consider("phone", incoming.phone, () => userSaid(text, incoming.phone || "") ? "" : "The phone number was not stated.");
  consider("address", incoming.address, () => userSaid(text, incoming.address || "") ? "" : "The address was not stated.");
  consider("email", incoming.email, () => userSaid(text, incoming.email || "") ? "" : "The email was not stated.");
  if (incoming.sharePercent && accepted.includes("sharePercent")) next.sharePercent = String(incoming.sharePercent).replace(/[^\d]/g, "");
  return { facts: next, accepted, rejected, changed: factsHash(current) !== factsHash(next) };
}

function designationPhrases(text: string): Designation[] {
  const found: Designation[] = [];
  if (/\b(named beneficiary|following beneficiar)/i.test(text)) found.push("named");
  if (/\bpolicy owners?\b/i.test(text)) found.push("policy-owners");
  if (/\binsured person\b|\bthe insured\b/i.test(text)) found.push("insured");
  return [...new Set(found)];
}

const DESIGNATION_FIELD: Record<Designation, string> = {
  named: "I designate the following beneficiaryies for this benefit",
  "policy-owners": "I designate the policy owners as beneficiaryies for this benefit",
  insured: "I designate the insured person as the beneficiary for this benefit If the insured person is a minor and no trustee is named below payment",
};

/** Map confirmed facts onto 671BCF. Signature fields are not in this plan. */
export function pdfAssignments(facts: DraftFacts) {
  const text: Record<string, string> = {};
  const put = (name: string, value: string | undefined) => {
    if (SIGNATURE_FIELDS.includes(name as (typeof SIGNATURE_FIELDS)[number])) throw new Error("A signature field cannot be filled.");
    if (String(value || "").trim()) text[name] = String(value).trim();
  };
  put("Policy Owner Name first middle last", facts.owner);
  put("Policy Number", facts.policyNumber);
  put("Phone Number", facts.phone);
  put("Address", facts.address);
  put("Email Address of Policy Owner", facts.email);
  put("Name first middle lastRow1", facts.beneficiaryName);
  put("RelationshipRow1", facts.relationship);
  put("Share Row1", facts.sharePercent);
  put("Date of birth if a minor ddmmyyyyRow1", facts.beneficiaryBirth);
  if (facts.trustee && facts.trustee !== "none") put("Name of trustee for minor not applicable in QCRow1", facts.trustee);
  put("Email address or phone number of beneficiary or trusteeRow1", facts.beneficiaryContact);
  const checks = facts.designation ? [DESIGNATION_FIELD[facts.designation]] : [];
  return { text, checks };
}
