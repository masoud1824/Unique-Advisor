/** English hint sent to the transcriber. It is not the user's speech. */
export function transcriptionPrompt(names: string[]) {
  const list = names.map((name) => name.trim()).filter(Boolean).slice(0, 40);
  if (!list.length) return "";
  return `Financial advisor. Contact names: ${list.join(", ")}.`.slice(0, 800);
}

export function normalizeSpeech(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

const HINT_WORDS = /financial advisor|contact names|english and farsi are both expected|english only/g;

/** True when the text is the transcriber hint, or that hint with the names removed. */
export function transcriptEchoesPrompt(transcript: string, prompt: string, names: string[] = []) {
  const heard = normalizeSpeech(transcript);
  const hint = normalizeSpeech(prompt);
  if (!heard) return false;
  if (hint && (heard === hint || (heard.startsWith(hint) && heard.length - hint.length < 12) || (hint.startsWith(heard) && heard.length > 24))) return true;
  if (/english and farsi are both expected/.test(heard) && /contact names|financial advisor/.test(heard)) return true;
  if (names.length < 3) return false;
  let rest = heard;
  let hits = 0;
  for (const name of names) {
    const needle = normalizeSpeech(name);
    if (!needle || !rest.includes(needle)) continue;
    hits += 1;
    rest = rest.replace(needle, " ");
  }
  rest = rest.replace(HINT_WORDS, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return hits >= 3 && rest.length < 8;
}

export function isDuplicateTranscript(previous: string, text: string, elapsedMs: number) {
  const left = normalizeSpeech(previous);
  const right = normalizeSpeech(text);
  if (!left || !right) return false;
  return left === right && elapsedMs >= 0 && elapsedMs < 4000;
}

export function micFailureMessage(name: string) {
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError" || name === "not-allowed" || name === "service-not-allowed") {
    return "Microphone permission was denied. Allow the microphone for this site in the browser settings, then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "audio-capture") {
    return "No microphone was found. Choose an input in the browser site settings, then try again.";
  }
  if (name === "NotReadableError") return "The microphone is in use by another app. Close that app, then try again.";
  if (name === "unsupported") return "This browser cannot record speech. Use Chrome or Safari, then try again.";
  return "";
}

/** Interim recognition is not a command. Stop may use the latest interim. A final is submitted once. */
export function speechToSubmit(pieces: Array<{ transcript?: string; isFinal?: boolean }>, stopped: boolean) {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const finals = pieces.map((piece) => (piece?.isFinal ? clean(String(piece.transcript || "")) : "")).filter(Boolean);
  if (finals.length) return finals[finals.length - 1];
  if (!stopped) return "";
  const interim = [...pieces].reverse().find((piece) => !piece?.isFinal && clean(String(piece?.transcript || "")));
  return clean(String(interim?.transcript || ""));
}

export type TranscriptDecision = { post: false; message: string } | { post: true; text: string };

/**
 * Decide whether a capture is the user's speech.
 * The prompt, an empty recording, a cancelled or stale request, and a duplicate final are not commands.
 */
export function decideTranscript(input: {
  audioBytes: number;
  prompt: string;
  names?: string[];
  browserText?: string;
  serverText?: string;
  serverOk?: boolean;
  cancelled?: boolean;
  stale?: boolean;
  duplicate?: boolean;
  permissionDenied?: boolean;
  noDevice?: boolean;
}): TranscriptDecision {
  if (input.permissionDenied) return { post: false, message: "Microphone permission was denied." };
  if (input.noDevice) return { post: false, message: "No microphone was found." };
  if (input.cancelled || input.stale || input.duplicate) return { post: false, message: "" };
  const names = input.names || [];
  const browser = String(input.browserText || "").replace(/\s+/g, " ").trim();
  const server = String(input.serverText || "").replace(/\s+/g, " ").trim();
  const echoed = (value: string) => transcriptEchoesPrompt(value, input.prompt, names);
  const browserOk = Boolean(browser) && !echoed(browser);
  const serverOk = Boolean(input.serverOk) && Boolean(server) && !echoed(server);
  const retry = "Nothing was heard. Tap Voice command, speak, then tap Stop.";
  if (input.audioBytes < 200 && !browserOk) return { post: false, message: retry };
  if (!serverOk && !browserOk) {
    if (input.serverOk === false && input.audioBytes >= 200 && !echoed(server)) return { post: false, message: "The recording could not be transcribed. Try again." };
    return { post: false, message: retry };
  }
  if (serverOk && browserOk) {
    return { post: true, text: server.length >= browser.length ? server : browser };
  }
  return { post: true, text: serverOk ? server : browser };
}

/**
 * A microphone check never becomes a chat command.
 * Permission, device, silence, and unsupported recognition stay as inline guidance.
 */
export function microphoneTestReport(input: {
  permission?: string;
  deviceLabel?: string;
  trackState?: string;
  bytes?: number;
  mime?: string;
  level?: number | null;
  recognition?: boolean;
  errorName?: string;
}) {
  const named = micFailureMessage(input.errorName || "");
  if (named) return { submit: false as const, message: named };
  if (input.permission === "denied") {
    return { submit: false as const, message: "Microphone permission was denied. Allow the microphone for this site in the browser settings, then tap Test mic again." };
  }
  if (!input.trackState || input.trackState === "ended") {
    return { submit: false as const, message: "No microphone was found. Choose an input in the browser site settings, then tap Test mic again." };
  }
  const device = input.deviceLabel?.trim()
    ? `Selected input: ${input.deviceLabel.trim()}.`
    : "The browser did not name the selected input. Check the site microphone setting if this is the wrong device.";
  const size = `Recording: ${Math.max(0, input.bytes || 0)} bytes${input.mime ? ` (${input.mime})` : ""}. Track is ${input.trackState}.`;
  const recognition = input.recognition
    ? "Live recognition is available."
    : "Live recognition is not available in this browser. Voice command can still record and transcribe after Stop.";
  if (input.level == null) {
    return { submit: false as const, message: `${device} ${size} Sound level was not measured. ${recognition} This test did not send a command.` };
  }
  if (input.level < 0.015) {
    return { submit: false as const, message: `${device} ${size} The microphone opened, but no speech was detected. Speak closer to the mic and confirm this site is allowed to use it, then tap Test mic again. ${recognition} This test did not send a command.` };
  }
  return { submit: false as const, message: `${device} ${size} Sound was detected. This test did not send a command. ${recognition}` };
}
