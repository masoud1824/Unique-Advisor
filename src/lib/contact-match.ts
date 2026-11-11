export type NamedContact = { id: number; name: string };

export type SpokenMatch =
  | { kind: "none" }
  | { kind: "ask"; question: string }
  | { kind: "one"; name: string; text: string; start: number; end: number }
  | { kind: "many"; names: string[]; question: string; start: number; end: number };

const STOP = new Set(["book", "a", "an", "the", "meeting", "zoom", "with", "please", "send", "to", "and", "for", "at", "on", "tomorrow", "today", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "next", "this", "email", "letter", "newsletter", "client", "clients", "call", "about", "can", "you", "me", "my", "of", "in", "it", "is"]);

function wordsOf(value: string) {
  return value.toLowerCase().match(/[a-z][a-z'-]*/g) || [];
}

function editDistance(left: string, right: string) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = a[i - 1] === b[j - 1] ? previous : Math.min(previous, row[j], row[j - 1]) + 1;
      previous = row[j];
      row[j] = next;
    }
  }
  return row[b.length] ?? 0;
}

function soundex(value: string) {
  const letters = value.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return "";
  const map: Record<string, string> = { b: "1", f: "1", p: "1", v: "1", c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2", d: "3", t: "3", l: "4", m: "5", n: "5", r: "6" };
  let code = letters[0].toUpperCase();
  let previous = map[letters[0]] || "";
  for (const char of letters.slice(1)) {
    const digit = map[char] || "";
    if (digit && digit !== previous) code += digit;
    if (digit || "aeiouy".includes(char)) previous = digit;
    if (code.length === 4) break;
  }
  return code.padEnd(4, "0");
}

function scorePhrase(phrase: string, name: string) {
  const spoken = phrase.toLowerCase().replace(/[^a-z\s'-]/g, " ").replace(/\s+/g, " ").trim();
  const full = name.toLowerCase().replace(/\s+/g, " ").trim();
  if (!spoken || !full) return 0;
  if (spoken === full) return 1;
  const parts = full.split(" ");
  const first = parts[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1] : "";
  const spokenWords = spoken.split(" ");
  if (spoken === first || (last && spoken === last)) return 0.9;
  if (spokenWords.length === 1 && spoken.length >= 3 && (first.startsWith(spoken) || (last && last.startsWith(spoken)))) return 0.84;
  const ratio = 1 - editDistance(spoken, full) / Math.max(spoken.length, full.length);
  let phonetic = 0;
  const heardFirst = soundex(spokenWords[0] || "");
  const heardLast = soundex(spokenWords[spokenWords.length - 1] || "");
  if (heardFirst && heardFirst === soundex(first)) phonetic = spokenWords.length === 1 ? 0.86 : 0.84;
  if (last && spokenWords.length > 1 && heardLast === soundex(last)) phonetic = Math.max(phonetic, 0.88);
  if (last && spokenWords.length > 1 && heardFirst === soundex(first)) {
    const heard = spokenWords[spokenWords.length - 1];
    if (heardLast === soundex(last) || (heard.length >= 3 && (last.startsWith(heard) || heard.startsWith(last)))) phonetic = 0.93;
  }
  return Math.max(ratio, phonetic);
}

function spans(text: string) {
  const found: Array<{ word: string; start: number; end: number }> = [];
  for (const match of text.matchAll(/[A-Za-z][A-Za-z'-]*/g)) {
    const word = match[0];
    const start = match.index ?? 0;
    found.push({ word, start, end: start + word.length });
  }
  return found;
}

function rankSpoken(text: string, contacts: NamedContact[]) {
  const indexed = spans(text);
  const ranked = new Map<string, { name: string; score: number; start: number; end: number }>();
  for (let index = 0; index < indexed.length; index += 1) {
    for (let length = 1; length <= 3 && index + length <= indexed.length; length += 1) {
      const slice = indexed.slice(index, index + length);
      if (slice.every((item) => STOP.has(item.word.toLowerCase()))) continue;
      const phrase = slice.map((item) => item.word).join(" ");
      const start = slice[0].start;
      const end = slice[slice.length - 1].end;
      for (const contact of contacts) {
        const name = contact.name.trim();
        if (name.length < 2) continue;
        const score = scorePhrase(phrase, name);
        if (score < 0.7) continue;
        const previous = ranked.get(name);
        if (!previous || score > previous.score) ranked.set(name, { name, score, start, end });
      }
    }
  }
  return [...ranked.values()].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
}

export function nameQuestion(names: string[]) {
  if (names.length === 1) return `Did you mean ${names[0]}?`;
  if (names.length === 2) return `Did you mean ${names[0]} or ${names[1]}?`;
  return `Did you mean ${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}?`;
}

function recipientWords(text: string) {
  const matches = [...text.matchAll(/\b(?:to|with|for)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/gi)];
  const last = matches[matches.length - 1]?.[1] || "";
  return last.split(/\s+/).filter((word) => word && !STOP.has(word.toLowerCase()) && !/^(thank|you|card|email|letter|newsletter|zoom|meeting)$/i.test(word));
}

export function spokenNameOptions(text: string, contacts: NamedContact[]) {
  const hits = rankSpoken(text, contacts);
  const spoken = recipientWords(text).map((word) => word.toLowerCase());
  const extra = contacts
    .map((contact) => contact.name.trim())
    .filter((name) => {
      const parts = name.toLowerCase().split(" ");
      return spoken.some((word) => word.length >= 3 && parts.some((part) => part.startsWith(word) || word.startsWith(part)));
    });
  const names = [...new Set([...hits.filter((item) => item.score >= 0.7).map((item) => item.name), ...extra])].slice(0, 6);
  const top = hits[0];
  return { names, start: top?.start ?? 0, end: top?.end ?? 0, exact: Boolean(top && text.toLowerCase().includes(top.name.toLowerCase())) };
}

export function resolveSpokenContact(text: string, contacts: NamedContact[]): SpokenMatch {
  const hits = rankSpoken(text, contacts).filter((item) => item.score >= 0.8);
  if (hits.length === 0) {
    if (recipientWords(text).length > 0) return { kind: "ask", question: "Which contact should I use? I could not match that name." };
    return { kind: "none" };
  }
  const top = hits[0];
  const close = hits.filter((item) => top.score - item.score < 0.05);
  if (close.length > 1) {
    const names = close.map((item) => item.name).slice(0, 4);
    return { kind: "many", names, question: nameQuestion(names), start: top.start, end: top.end };
  }
  const name = top.name;
  if (text.toLowerCase().includes(name.toLowerCase())) return { kind: "one", name, text: text.replace(/\s+/g, " ").trim(), start: top.start, end: top.end };
  const rewritten = `${text.slice(0, top.start)}${name}${text.slice(top.end)}`.replace(/\s+/g, " ").trim();
  return { kind: "one", name, text: rewritten, start: top.start, end: top.start + name.length };
}

export function nameTokens(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/** Case-insensitive full-name search: every word must appear in the name, email, phone, or tags. */
export function contactMatchesQuery(
  contact: { fullName?: string; email?: string; phone?: string; tags?: string[] },
  query: string,
) {
  const words = nameTokens(query);
  if (!words.length) return true;
  const hay = nameTokens([contact.fullName, contact.email, contact.phone, ...(contact.tags || [])].filter(Boolean).join(" "));
  return words.every((word) => hay.some((part) => part.includes(word)));
}

export function applyChosenName(text: string, start: number, end: number, name: string) {
  return `${text.slice(0, start)}${name}${text.slice(end)}`.replace(/\s+/g, " ").trim();
}

