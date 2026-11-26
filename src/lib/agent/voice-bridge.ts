import { isDuplicateTranscript, normalizeSpeech } from "../transcript-guard.ts";

export type VoicePhase = "idle" | "listening" | "transcribing" | "thinking" | "preparing" | "speaking" | "error";

/** Speech never approves a save, send, or upload. There is no confidence score. */
export function speechAuthorizesAction() {
  return false;
}

export function bareApprovalSpeech(text: string) {
  return /^(yes|yeah|yep|ok|okay|approve|approved|do it|go ahead|save it|save)\.?$/i.test(String(text || "").trim());
}

export function echoesAssistantReply(heard: string, reply: string) {
  const left = normalizeSpeech(heard);
  const right = normalizeSpeech(reply);
  if (!left || !right || left.length < 12) return false;
  return left === right || (right.includes(left) && left.length > 24) || (left.includes(right) && right.length > 24);
}

/** Stop always returns to idle and must not schedule another listen. */
export function phaseAfterStop(): VoicePhase {
  return "idle";
}

export function explicitReplayRunsTools() {
  return false;
}

export function sameTurnGuard(input: { busy: boolean; previous: string; text: string; elapsedMs: number }) {
  if (input.busy) return { accept: false as const, reason: "busy" as const };
  if (isDuplicateTranscript(input.previous, input.text, input.elapsedMs)) return { accept: false as const, reason: "duplicate" as const };
  return { accept: true as const, reason: "ok" as const };
}

/** Split a reply into spoken pieces without dropping the ending. */
export function speechSegments(text: string, limit = 700) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";
  const push = (piece: string) => {
    const value = piece.trim();
    if (value) chunks.push(value);
  };
  for (const sentence of sentences) {
    if (sentence.length > limit) {
      push(current);
      current = "";
      for (let index = 0; index < sentence.length; index += limit) push(sentence.slice(index, index + limit));
      continue;
    }
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > limit) {
      push(current);
      current = sentence;
    } else current = next;
  }
  push(current);
  return chunks;
}
