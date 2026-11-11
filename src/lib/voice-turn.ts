import type { SpeechPiece } from "./speech-utterance.ts";

export const VOICE_AUTOSEND_KEY = "ua-voice-autosend";
export const VOICE_PAUSE_MS = 3000;

export type TurnState = {
  committed: string[];
  session: number;
  sessionFinals: string[];
  interim: string;
};

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function emptyTurn(): TurnState {
  return { committed: [], session: 0, sessionFinals: [], interim: "" };
}

export function turnText(state: TurnState) {
  return collapseRepeats(clean([...state.committed, ...state.sessionFinals, state.interim].filter(Boolean).join(" ")));
}

function sameWords(left: string, right: string) {
  return clean(left).toLowerCase() === clean(right).toLowerCase();
}

export function collapseRepeats(value: string) {
  let words = clean(value).split(" ").filter(Boolean);
  let changed = true;
  while (changed) {
    changed = false;
    for (let size = Math.floor(words.length / 2); size >= 1; size -= 1) {
      for (let index = 0; index + size * 2 <= words.length; index += 1) {
        const left = words.slice(index, index + size).join(" ");
        const right = words.slice(index + size, index + size * 2).join(" ");
        if (sameWords(left, right)) {
          words = [...words.slice(0, index), ...words.slice(index + size)];
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return words.join(" ");
}

export function joinCumulative(parts: string[]) {
  let acc = "";
  for (const part of parts) {
    const next = clean(part);
    if (!next) continue;
    if (!acc) {
      acc = next;
      continue;
    }
    const left = acc.toLowerCase();
    const right = next.toLowerCase();
    if (right.startsWith(left)) {
      acc = next;
      continue;
    }
    if (left.startsWith(right) || left.includes(right)) continue;
    const a = acc.split(" ");
    const b = next.split(" ");
    let overlap = 0;
    const max = Math.min(a.length, b.length);
    for (let size = max; size >= 1; size -= 1) {
      if (sameWords(a.slice(a.length - size).join(" "), b.slice(0, size).join(" "))) {
        overlap = size;
        break;
      }
    }
    acc = clean(`${a.join(" ")} ${b.slice(overlap).join(" ")}`);
  }
  return collapseRepeats(acc);
}

export type LiveSegment = { id: number; text: string; final?: boolean };

export type LiveSpeech = {
  activeHandler: number;
  session: number;
  committed: string;
  segments: LiveSegment[];
};

export function emptyLive(handler = 1): LiveSpeech {
  return { activeHandler: handler, session: 0, committed: "", segments: [] };
}

export function liveText(state: LiveSpeech) {
  return joinCumulative([state.committed, ...state.segments.map((segment) => segment.text)]);
}

export function applyLiveStt(state: LiveSpeech, event: { handler: number; session: number; segments: LiveSegment[] }) {
  if (event.handler !== state.activeHandler) return { state, text: liveText(state), ignored: true };
  let committed = state.committed;
  let segments = state.segments;
  if (event.session !== state.session) {
    committed = joinCumulative([committed, ...segments.map((segment) => segment.text)]);
    segments = [];
  }
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  for (const segment of event.segments) {
    const text = clean(segment.text);
    if (!text) continue;
    byId.set(segment.id, { id: segment.id, text, final: Boolean(segment.final) });
  }
  const next: LiveSpeech = {
    activeHandler: state.activeHandler,
    session: event.session,
    committed,
    segments: [...byId.values()].sort((left, right) => left.id - right.id),
  };
  return { state: next, text: liveText(next), ignored: false };
}

function normalize(value: string) {
  return clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function distance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = i - 1;
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const next = left[i - 1] === right[j - 1] ? previous : Math.min(previous, row[j], row[j - 1]) + 1;
      previous = row[j];
      row[j] = next;
    }
  }
  return row[right.length] ?? 0;
}

function similarity(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - distance(a, b) / Math.max(a.length, b.length);
}

function longer(left: string, right: string) {
  return right.length >= left.length ? right : left;
}

export function foldRevision(base: string, next: string) {
  const left = clean(base);
  const right = clean(next);
  if (!right) return left;
  if (!left) return right;
  const a = normalize(left);
  const b = normalize(right);
  if (b.startsWith(a) || a.startsWith(b) || similarity(left, right) > 0.8) return longer(left, right);
  const leftWords = left.split(" ");
  const rightWords = right.split(" ");
  let shared = 0;
  while (shared < leftWords.length && shared < rightWords.length && sameWords(leftWords[shared], rightWords[shared])) shared += 1;
  if (shared >= 4) return longer(left, right);
  for (let size = Math.min(leftWords.length, rightWords.length); size >= 3; size -= 1) {
    const tail = leftWords.slice(leftWords.length - size).join(" ");
    const head = rightWords.slice(0, size).join(" ");
    if (similarity(tail, right) > 0.8 || similarity(left, head) > 0.8 || normalize(right).startsWith(normalize(tail)) || normalize(tail).startsWith(normalize(right))) {
      const kept = longer(tail, right);
      return clean(`${leftWords.slice(0, leftWords.length - size).join(" ")} ${kept}`);
    }
  }
  return collapseRepeats(clean(`${left} ${right}`));
}

function foldList(parts: string[]) {
  return parts.reduce((acc, part) => foldRevision(acc, part), "");
}

export function pushRecognition(state: TurnState, session: number, results: SpeechPiece[]) {
  const finals: string[] = [];
  const interims: string[] = [];
  for (const piece of results) {
    const said = clean(String(piece?.transcript || ""));
    if (!said) continue;
    if (piece?.isFinal) finals.push(said);
    else interims.push(said);
  }
  let committed = clean(state.committed.join(" "));
  if (state.session !== 0 && session !== state.session) committed = foldRevision(committed, clean(state.sessionFinals.join(" ")));
  const sessionFinal = foldList(finals);
  const sessionInterim = foldList(interims);
  const text = foldList([committed, sessionFinal, sessionInterim]);
  const next: TurnState = {
    committed: committed ? [committed] : [],
    session,
    sessionFinals: sessionFinal ? [sessionFinal] : [],
    interim: sessionInterim,
  };
  return { state: next, text };
}

export function shouldAutoSend(enabled: boolean, silenceMs: number, pauseMs = VOICE_PAUSE_MS) {
  return Boolean(enabled) && silenceMs >= pauseMs;
}

export function mergeLiveDraft(previous: string, incoming: string) {
  return joinCumulative([previous, incoming]);
}

export function voiceDebugEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("ua-voice-debug") === "1";
  } catch {
    return false;
  }
}

export function readVoiceAutoSend() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(VOICE_AUTOSEND_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeVoiceAutoSend(on: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VOICE_AUTOSEND_KEY, on ? "1" : "0");
}
