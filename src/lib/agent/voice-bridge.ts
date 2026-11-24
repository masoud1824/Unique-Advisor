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
