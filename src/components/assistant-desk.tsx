import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { approveAssistantAction, approveAssistantDraft, askAssistant, deleteAssistantChat, discardAssistantAction, discardAssistantDraft, listAssistantActions, listAssistantDrafts, listAssistantMessages, runMorningCheck, saveAssistantRules, speakAssistant, startAssistantChat, transcribeAssistant, warmAssistantVoice } from "@/lib/assistant.functions";
import { assistantPieces } from "@/lib/assistant-reply";
import { isEcho, playStoredReply, playableReplyLine, prepareDeskCommand, preferredBrowserVoice, repeatsRequest, shouldBargeIn, shouldCaptureSpeech, spokenBrief, transcriptHold, voiceAudible, type ClipPlay } from "@/lib/voice-desk";
import { applyChosenName, isHearingCheck, resolveSpokenContact, spokenNameOptions, type SpokenMatch } from "@/lib/contact-match";
import { isOnboardingDemo, showUnclearChoice } from "@/lib/advisor-intent";
import { shouldReplacePreview } from "@/lib/delivery-audience";
import { refersToAppointment } from "@/lib/calendar-span";
import { decideTranscript, micFailureMessage, microphoneTestReport, publicTranscriptionError, soundsLikeNoise, transcriptEchoesPrompt, transcriptionPrompt } from "@/lib/transcript-guard";
import { emptyTurn, pushRecognition, readVoiceAutoSend, shouldAutoSend, turnText, voiceDebugEnabled, type TurnState } from "@/lib/voice-turn";
import { appendVoiceLog } from "@/lib/voice-log.functions";
import { previewCanSend, previewTitle, trayOffers } from "@/lib/chat-previews";
import type { DeskData } from "@/lib/site-types";

type Turn = { id?: number; role: "user" | "assistant"; content: string; at?: string; previews?: Action[] };
type Draft = { id: number; to: string; name: string; subject: string; body: string };
type Action = { id: number; kind: string; summary: string; status?: string; canSend?: boolean; preview?: string; previewHtml?: string; previewImage?: string };
type Chat = { id: number; title: string; at?: string };
type SavedRule = { id?: string; category?: string; text: string; on: boolean };

function readAssistantAnswer(value: unknown): { ok: boolean; error?: string; reply?: string; actions?: Action[]; played?: boolean; detail?: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "Sorry, something went wrong — please try again." };
  const row = value as Record<string, unknown>;
  const actions = Array.isArray(row.actions) ? row.actions.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const action = item as Record<string, unknown>;
    if (typeof action.kind !== "string") return [];
    const id = typeof action.id === "number" ? action.id : Number(action.id);
    if (!Number.isFinite(id)) return [];
    return [{
      id,
      kind: action.kind,
      summary: typeof action.summary === "string" ? action.summary : "",
      status: typeof action.status === "string" ? action.status : undefined,
      canSend: typeof action.canSend === "boolean" ? action.canSend : undefined,
      preview: typeof action.preview === "string" ? action.preview : undefined,
      previewHtml: typeof action.previewHtml === "string" ? action.previewHtml : undefined,
      previewImage: typeof action.previewImage === "string" ? action.previewImage : undefined,
    }];
  }) : undefined;
  return {
    ok: row.ok === true,
    error: typeof row.error === "string" ? row.error : undefined,
    reply: typeof row.reply === "string" ? row.reply : undefined,
    actions,
    played: row.played === true,
    detail: typeof row.detail === "string" ? row.detail : undefined,
  };
}

function previewAllowsSend(action: Action) {
  return previewCanSend(action);
}

function MailPreview({ action, busy, onApprove, onDiscard }: { action: Action; busy: boolean; onApprove: (id: number) => void; onDiscard: (id: number) => void }) {
  const sendable = previewAllowsSend(action);
  const historical = Boolean(action.status && action.status !== "pending");
  return (
    <article className="ua-mail-preview rounded-lg border p-3" data-preview-id={action.id} data-can-send={sendable ? "yes" : "no"} data-preview-status={action.status || "pending"} style={{ borderColor: sendable ? "#b42318" : "#d5e4f2", background: sendable ? "#fff8f6" : "#f7fbfe" }}>
      <p className="text-sm font-extrabold" style={{ color: sendable ? "#b42318" : "#0f4c81" }}>{previewTitle(action.kind)}</p>
      <p className="mt-1 text-sm font-semibold">{action.summary}</p>
      {historical && <p className="mt-2 text-sm" style={{ color: "#5a6a7a" }}>Earlier preview kept with this message. Nothing can be sent from it.</p>}
      {sendable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="ua-btn" disabled={busy} onClick={() => onApprove(action.id)}>{action.kind === "campaign" ? "Run the campaign" : action.kind === "signature" || action.kind === "card" || action.kind === "eletter" || action.kind === "newsletter" ? "Approve and send" : "Approve"}</button>
          <button type="button" className="ua-btn-line" disabled={busy} onClick={() => onDiscard(action.id)}>Discard</button>
        </div>
      )}
      {action.previewImage && (
        <img src={action.previewImage} alt="" className="mt-3 w-full rounded-lg border bg-white" style={{ borderColor: "#e1e8ef" }} />
      )}
      {action.previewHtml ? (
        <iframe
          title={`Mail preview ${action.id}`}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={action.previewHtml}
          className="mt-3 w-full rounded-lg border bg-white"
          style={{ height: 320, borderColor: "#e1e8ef" }}
          onLoad={(event) => {
            const frame = event.currentTarget;
            const height = frame.contentDocument?.documentElement?.scrollHeight || 0;
            if (height > 0) frame.style.height = `${height}px`;
          }}
        />
      ) : (
        action.preview && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-white p-4 text-sm">{action.preview}</p>
      )}
    </article>
  );
}

function asRules(value: unknown): SavedRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { text: item.trim(), on: true, category: "My rules" };
      const record = item as { id?: unknown; category?: unknown; text?: unknown; on?: unknown };
      return { id: String(record?.id || ""), category: String(record?.category || "My rules"), text: String(record?.text ?? "").trim(), on: record?.on !== false };
    })
    .filter((item) => item.text);
}

export function ClientDatabase({ code, desk }: { code: string; desk: DeskData }) {
  const [clientSource, setClientSource] = useState<"" | "desk" | "dropbox">("");
  const [dropboxFile, setDropboxFile] = useState("/Unique Advisor/clients.csv");
  const [sourceNote, setSourceNote] = useState("");
  const [birthdayCards, setBirthdayCards] = useState(true);
  const [newsletterReminder, setNewsletterReminder] = useState(true);
  const [showBirthday, setShowBirthday] = useState(true);
  const [showNewsletter, setShowNewsletter] = useState(true);

  useEffect(() => {
    void listAssistantMessages({ data: { slug: desk.slug, code } }).then((history) => {
      if (!history.ok) return;
      setClientSource(history.rules.clientSource === "dropbox" || history.rules.clientSource === "desk" ? history.rules.clientSource : "");
      if (history.rules.dropboxFile) setDropboxFile(history.rules.dropboxFile);
      setBirthdayCards(history.rules.birthdayCards);
      setNewsletterReminder(history.rules.newsletterReminder);
      setShowBirthday(history.rules.showBirthday !== false);
      setShowNewsletter(history.rules.showNewsletter !== false);
    });
  }, [desk.slug, code]);

  async function chooseSource(next: "desk" | "dropbox") {
    const file = dropboxFile.trim() || "/Unique Advisor/clients.csv";
    if (next === "dropbox" && (!file.startsWith("/") || file.includes(".."))) {
      setSourceNote("The Dropbox path must start with / , such as /Unique Advisor/clients.csv.");
      return;
    }
    setClientSource(next);
    setDropboxFile(file);
    const result = await saveAssistantRules({
      data: {
        slug: desk.slug,
        code,
        birthdayCards: showBirthday ? birthdayCards : false,
        newsletterReminder: showNewsletter ? newsletterReminder : false,
        showBirthday,
        showNewsletter,
        clientSource: next,
        dropboxFile: file,
      },
    });
    setSourceNote(result.ok ? (next === "desk" ? "Unique Advisor is now the client database." : `Dropbox file ${file} is now the client database.`) : result.error);
  }

  return (
    <section className="ua-panel mb-5 p-6" style={{ border: "2px solid #0f4c81" }}>
      <h2 className="text-lg font-semibold">Choose client database</h2>
      <p className="mt-2 text-sm" style={{ color: "#5a6a7a" }}>
        Pick the main source the assistant uses for who to call, yearly KYC, and upsell or cross-sell. This does not mix one advisor’s clients with another’s.
      </p>
      <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
        <button type="button" className={clientSource === "desk" ? "ua-btn" : "ua-btn-line"} onClick={() => void chooseSource("desk")}>Unique Advisor</button>
        <button type="button" className={clientSource === "dropbox" ? "ua-btn" : "ua-btn-line"} onClick={() => setClientSource("dropbox")}>Dropbox file</button>
      </div>
      {clientSource === "" && <p className="mt-3 text-sm font-extrabold" style={{ color: "#b42318" }}>Choose one before asking the assistant about clients.</p>}
      {clientSource === "desk" && <p className="mt-3 text-sm font-semibold" style={{ color: "#0d7a4f" }}>Using the contacts saved in Unique Advisor.</p>}
      {clientSource === "dropbox" && (
        <label className="mt-4 grid gap-1 text-sm font-semibold">
          Path of the CSV or JSON file in Dropbox
          <input value={dropboxFile} onChange={(event) => setDropboxFile(event.target.value)} className="ua-field font-normal" placeholder="/Unique Advisor/clients.csv" />
          <span className="font-normal" style={{ color: "#5a6a7a" }}>Columns: name, email, phone, dob, kyc, products, last contact. Separate products with semicolons. Connect Dropbox in Settings first.</span>
          <button type="button" className="ua-btn" style={{ width: "fit-content", padding: "8px 12px" }} onClick={() => void chooseSource("dropbox")}>Use this Dropbox file</button>
        </label>
      )}
      {sourceNote && <p className="mt-3 text-sm font-semibold" style={{ color: sourceNote.includes("now the client") ? "#0d7a4f" : "#b42318" }}>{sourceNote}</p>}
    </section>
  );
}

function stamp(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export type VoicePhase = "off" | "listening" | "processing" | "speaking" | "error";
export type VoiceStatus = { phase: VoicePhase; error: string; listening: boolean; speaking: boolean };

type Heard = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex?: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

let sharedStream: MediaStream | null = null;
let keepListening = false;
let voiceStopping = false;
let spokenAudio: HTMLAudioElement | null = null;
let listenTimer = 0;
let speakToken = 0;
let browserSpeechGen = 0;
let advisorSpeaking = false;
let recognition: Heard | null = null;
let recorder: MediaRecorder | null = null;
let liveWords = true;
const chunks: Blob[] = [];
let restartListening: (() => void) | null = null;
let listenDuringSpeech: (() => void) | null = null;
let finishSpeech: (() => void) | null = null;
let voicePauseTimer = 0;
let latestDraft = "";
let speechGeneration = 0;
let playQueue: Promise<void> = Promise.resolve();
let clipsPlaying = 0;
let playbackGeneration = 0;
let lastSpokenLine = "";
let dropAudio = false;
let releasePlayback: (() => void) | null = null;
let voiceSending = false;
const voiceListeners = new Set<(status: VoiceStatus) => void>();
const draftListeners = new Set<(text: string) => void>();
let lastStatus: VoiceStatus = { phase: "off", error: "", listening: false, speaking: false };

function voiceLog(step: string, extra = "") {
  console.info(`[voice] ${step}${extra ? ` ${extra}` : ""} t=${Date.now()}`);
}

type VoiceTraceEvent = { at: string; type: "start" | "result" | "end" | "error" | "restart"; resultIndex?: number; results?: Array<{ transcript: string; isFinal: boolean }>; error?: string };
let voiceTrace: { slug: string; code: string; key: string; queue: VoiceTraceEvent[]; timer: number; chain: Promise<void> } | null = null;

function flushVoiceLog(sentText = "") {
  const current = voiceTrace;
  if (!current) return;
  window.clearTimeout(current.timer);
  const events = current.queue.splice(0);
  if (!events.length && !sentText) return;
  current.chain = current.chain
    .then(() => appendVoiceLog({ data: { slug: current.slug, code: current.code, sessionKey: current.key, events, sentText } }))
    .then(() => undefined)
    .catch(() => undefined);
}

function pushVoiceEvent(event: VoiceTraceEvent, sentText = "") {
  if (!voiceTrace) return;
  voiceTrace.queue.push(event);
  window.clearTimeout(voiceTrace.timer);
  voiceTrace.timer = window.setTimeout(() => flushVoiceLog(sentText), 300);
}

function beginVoiceLog(slug: string, code: string) {
  if (voiceTrace) {
    voiceTrace.queue.push({ at: new Date().toISOString(), type: "end" });
    flushVoiceLog();
  }
  voiceTrace = { slug, code, key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, queue: [], timer: 0, chain: Promise.resolve() };
  pushVoiceEvent({ at: new Date().toISOString(), type: "start" });
}

function endVoiceLog() {
  if (!voiceTrace) return;
  voiceTrace.queue.push({ at: new Date().toISOString(), type: "end" });
  flushVoiceLog();
  voiceTrace = null;
}

export function advisorVoiceOn() {
  return keepListening || lastStatus.phase === "listening" || lastStatus.phase === "processing" || lastStatus.phase === "speaking";
}

function emitVoice(status: VoiceStatus) {
  lastStatus = status;
  voiceListeners.forEach((listener) => listener(status));
}

export function subscribeAdvisorVoice(listener: (status: VoiceStatus) => void) {
  listener(lastStatus);
  voiceListeners.add(listener);
  return () => {
    voiceListeners.delete(listener);
  };
}

export function subscribeAdvisorDraft(listener: (text: string) => void) {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

function emitDraft(text: string) {
  latestDraft = text;
  draftListeners.forEach((listener) => listener(text));
}

export function voiceLabel(phase: string, error = "") {
  if (phase === "listening" && !liveWords) return "Listening. Tap Stop when you finish.";
  if (phase === "listening") return "Listening";
  if (phase === "processing") return "Thinking";
  if (phase === "speaking") return "Speaking";
  if (phase === "error") return `Error: ${error || "The microphone stopped."}`;
  return "";
}

async function openCommandMic() {
  sharedStream?.getTracks().forEach((track) => track.stop());
  sharedStream = null;
  try {
    sharedStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    sharedStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  return sharedStream;
}

function micError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  return micFailureMessage(name) || "The microphone could not be started. Check the site permission and the selected input, then try again.";
}

function recognitionError(code: string) {
  return micFailureMessage(code) || (code === "network" ? "The speech recognizer lost the network. Still listening." : code === "no-speech" ? "" : "Speech recognition stopped. Still listening.");
}

function voiceLanguage() {
  return "en-CA";
}

export function markAdvisorSpeaking(on: boolean) {
  advisorSpeaking = on;
  if (on) {
    try { recognition?.abort?.(); } catch { /* do not hear the reply */ }
    recognition = null;
    window.clearTimeout(voicePauseTimer);
    window.clearTimeout(listenTimer);
    emitVoice({ phase: "speaking", error: "", listening: false, speaking: true });
    return;
  }
  emitVoice({ phase: "off", error: "", listening: false, speaking: false });
}

function invalidatePlayback() {
  playbackGeneration += 1;
  dropAudio = true;
  speakToken += 1;
  browserSpeechGen += 1;
  window.clearTimeout(listenTimer);
  window.clearTimeout(voicePauseTimer);
  const audio = spokenAudio;
  spokenAudio = null;
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    try { audio.pause(); } catch { /* already stopped */ }
    try { audio.src = ""; } catch { /* already released */ }
  }
  try { window.speechSynthesis?.cancel(); } catch { /* no browser voice */ }
  advisorSpeaking = false;
  clipsPlaying = 0;
  const release = releasePlayback;
  releasePlayback = null;
  release?.();
}

function haltVoice() {
  voiceStopping = true;
  keepListening = false;
  voiceSending = false;
  finishSpeech = null;
  speechGeneration += 1;
  window.clearTimeout(voicePauseTimer);
  window.clearTimeout(listenTimer);
  invalidatePlayback();
  const current = recognition;
  try { current?.abort?.(); } catch { /* already stopped */ }
  try { current?.stop?.(); } catch { /* already stopped */ }
  recognition = null;
  try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch { /* already stopped */ }
  recorder = null;
  spokenAudio?.pause();
  spokenAudio = null;
  window.speechSynthesis?.cancel();
  advisorSpeaking = false;
  emitVoice({ phase: "off", error: "", listening: false, speaking: false });
  voiceLog("stop");
  endVoiceLog();
}

function takeRecording() {
  const current = recorder;
  const mime = current?.mimeType || "audio/webm";
  if (!current || current.state === "inactive") {
    const mine = chunks.splice(0);
    recorder = null;
    return Promise.resolve(mine.length ? new Blob(mine, { type: mime }) : null);
  }
  return new Promise<Blob | null>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      const mine = chunks.splice(0);
      recorder = null;
      resolve(mine.length ? new Blob(mine, { type: current.mimeType || mime }) : null);
    };
    current.addEventListener("stop", () => {
      window.setTimeout(done, 50);
    }, { once: true });
    try { current.stop(); } catch { done(); }
  });
}

export function stopAdvisorSpeech() {
  const send = finishSpeech;
  if (send) {
    send();
    return;
  }
  haltVoice();
}

export function playVoiceClip(base64: string, mime = "audio/mpeg", onStart?: () => void, owner = playbackGeneration): Promise<ClipPlay> {
  const run = playQueue.then(() => new Promise<ClipPlay>((resolve) => {
    if (dropAudio || owner !== playbackGeneration) {
      resolve({ started: false, dropped: true, blocked: false });
      return;
    }
    const audio = new Audio(`data:${mime};base64,${base64}`);
    spokenAudio = audio;
    clipsPlaying += 1;
    let settled = false;
    let started = false;
    const finish = (result: ClipPlay) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(startTimer);
      window.clearTimeout(endTimer);
      if (releasePlayback === release) releasePlayback = null;
      clipsPlaying = Math.max(0, clipsPlaying - 1);
      if (spokenAudio === audio) spokenAudio = null;
      try { audio.pause(); } catch { /* already stopped */ }
      if (!result.started) {
        try { audio.src = ""; } catch { /* already released */ }
      }
      if (clipsPlaying === 0 && !result.started) advisorSpeaking = false;
      if (clipsPlaying === 0 && owner === playbackGeneration && result.started && !result.dropped) {
        markAdvisorSpeaking(false);
      }
      resolve(result);
    };
    const release = () => finish({ started, dropped: true, blocked: false });
    const startTimer = window.setTimeout(() => {
      if (started) return;
      try { audio.pause(); } catch { /* not playing */ }
      try { audio.src = ""; } catch { /* already released */ }
      finish({ started: false, dropped: false, blocked: true });
    }, 6000);
    const endTimer = window.setTimeout(() => {
      try { audio.pause(); } catch { /* already stopped */ }
      finish(started ? { started: true, dropped: true, blocked: false } : { started: false, dropped: false, blocked: true });
    }, 120000);
    releasePlayback = release;
    audio.onended = () => finish({ started: true, dropped: false, blocked: false });
    audio.onerror = () => finish({ started: false, dropped: false, blocked: true });
    audio.play().then(() => {
      if (settled || dropAudio || owner !== playbackGeneration || spokenAudio !== audio) {
        try { audio.pause(); } catch { /* interrupted */ }
        try { audio.src = ""; } catch { /* already released */ }
        if (!settled) finish({ started: false, dropped: true, blocked: false });
        return;
      }
      started = true;
      window.clearTimeout(startTimer);
      onStart?.();
      markAdvisorSpeaking(true);
      voiceLog("playback-start");
    }).catch(() => {
      if (settled) return;
      try { audio.pause(); } catch { /* not playing */ }
      finish({ started: false, dropped: false, blocked: true });
    });
  }));
  playQueue = run.then(() => undefined, () => undefined);
  return run;
}

/** Speak an on-screen reply without the language model. Success is playback start, not the text itself. */
export function speakInBrowser(line: string, onStart?: () => void, owner = playbackGeneration): Promise<ClipPlay> {
  const text = String(line || "").trim();
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!text || !synth || typeof SpeechSynthesisUtterance === "undefined") {
    return Promise.resolve({ started: false, dropped: false, blocked: true });
  }
  const speech = synth;
  const generation = ++browserSpeechGen;
  return (async () => {
    let voices = speech.getVoices();
    if (!voices.length) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(done, 800);
        function done() {
          window.clearTimeout(timer);
          speech.removeEventListener("voiceschanged", done);
          resolve();
        }
        speech.addEventListener("voiceschanged", done);
      });
      voices = speech.getVoices();
    }
    if (generation !== browserSpeechGen || owner !== playbackGeneration) return { started: false, dropped: true, blocked: false };
    if (speech.speaking || speech.pending) speech.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    const chosen = preferredBrowserVoice(voices.map((voice) => ({ lang: voice.lang, name: voice.name })));
    if (chosen) {
      const match = voices.find((voice) => voice.lang === chosen.lang && voice.name === chosen.name);
      if (match) utterance.voice = match;
    }
    return new Promise<ClipPlay>((resolve) => {
      let settled = false;
      let started = false;
      const finish = (result: ClipPlay) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(startTimer);
        window.clearTimeout(endTimer);
        resolve(result);
      };
      const startTimer = window.setTimeout(() => {
        if (!started) finish({ started: false, dropped: generation !== browserSpeechGen, blocked: generation === browserSpeechGen });
      }, 4000);
      const endTimer = window.setTimeout(() => {
        try { speech.cancel(); } catch { /* already stopped */ }
        finish(started ? { started: true, dropped: true, blocked: false } : { started: false, dropped: false, blocked: true });
      }, 20000);
      utterance.onstart = () => {
        if (generation !== browserSpeechGen || owner !== playbackGeneration) {
          try { speech.cancel(); } catch { /* replaced */ }
          finish({ started: false, dropped: true, blocked: false });
          return;
        }
        started = true;
        window.clearTimeout(startTimer);
        onStart?.();
        markAdvisorSpeaking(true);
      };
      utterance.onend = () => {
        if (started) markAdvisorSpeaking(false);
        if (generation !== browserSpeechGen) finish({ started, dropped: true, blocked: false });
        else finish(started ? { started: true, dropped: false, blocked: false } : { started: false, dropped: false, blocked: true });
      };
      utterance.onerror = (event) => {
        const reason = event.error;
        if (started) markAdvisorSpeaking(false);
        if (reason === "interrupted" || reason === "canceled" || generation !== browserSpeechGen) finish({ started, dropped: true, blocked: false });
        else finish({ started: false, dropped: false, blocked: true });
      };
      try { speech.resume(); } catch { /* already running */ }
      speech.speak(utterance);
    });
  })();
}

function interruptAdvisorSpeech() {
  invalidatePlayback();
  voiceSending = false;
  emitVoice({ phase: keepListening ? "listening" : "off", error: "", listening: keepListening, speaking: false });
}

export function startAdvisorSpeech(
  onText: (text: string) => void,
  onStatus: (status: { listening: boolean; error: string; phase?: VoicePhase }) => void,
  options?: { slug: string; code: string; names?: string[]; onDraft?: (text: string) => void },
) {
  const generation = ++speechGeneration;
  voiceStopping = false;
  keepListening = true;
  voiceSending = false;
  advisorSpeaking = false;
  chunks.splice(0);
  speakToken += 1;
  window.clearTimeout(listenTimer);
  try { recognition?.abort?.(); } catch { /* restarting */ }
  recognition = null;
  emitVoice({ phase: "listening", error: "", listening: true, speaking: false });
  onStatus({ listening: true, error: "", phase: "listening" });
  voiceLog("listen-start");
  if (!options?.slug || !options.code) {
    endVoiceLog();
    const error = "Voice is not ready. Open the assistant and tap Talk again.";
    keepListening = false;
    emitVoice({ phase: "error", error, listening: false, speaking: false });
    onStatus({ listening: false, error, phase: "error" });
    return;
  }
  beginVoiceLog(options.slug, options.code);
  void warmAssistantVoice({ data: { slug: options.slug, code: options.code } }).catch((error) => {
    voiceLog("warm-error", error instanceof Error ? error.message : "failed");
  });
  let lastSent = "";
  let lastAt = 0;
  let turn: TurnState = emptyTurn();
  let session = 0;
  const autoSend = readVoiceAutoSend();
  const names = (options.names || []).map((name) => name.trim()).filter(Boolean).slice(0, 100);
  const prompt = transcriptionPrompt(names);

  const draft = (text: string) => {
    emitDraft(text);
    options.onDraft?.(text);
  };

  const fail = (error: string, recover: boolean) => {
    voiceLog("error", error);
    emitVoice({ phase: "error", error, listening: false, speaking: false });
    onStatus({ listening: false, error, phase: "error" });
    if (recover && keepListening && !voiceStopping) listenTimer = window.setTimeout(() => restartListening?.(), 500);
  };

  const releaseCapture = (message: string) => {
    voiceSending = false;
    keepListening = false;
    finishSpeech = null;
    draft("");
    if (message) fail(message, false);
    else {
      emitVoice({ phase: "off", error: "", listening: false, speaking: false });
      onStatus({ listening: false, error: "", phase: "off" });
    }
  };

  const sendFinal = (text: string) => {
    window.clearTimeout(voicePauseTimer);
    const said = text.replace(/\s+/g, " ").trim();
    const key = said.toLowerCase();
    if (!said || transcriptEchoesPrompt(said, prompt, names)) {
      releaseCapture(said ? "Nothing was heard. Tap Voice command, speak, then tap Stop." : "");
      return;
    }
    if (key === lastSent && Date.now() - lastAt < 4000) {
      releaseCapture("");
      return;
    }
    lastSent = key;
    lastAt = Date.now();
    turn = emptyTurn();
    latestDraft = "";
    voiceSending = true;
    finishSpeech = null;
    try { recognition?.abort?.(); } catch { /* pause until the reply starts */ }
    recognition = null;
    emitVoice({ phase: "processing", error: "", listening: false, speaking: false });
    onStatus({ listening: false, error: "", phase: "processing" });
    draft(said);
    voiceLog("send", said.slice(0, 80));
    flushVoiceLog(said);
    onText(said);
  };

  const correct = async (fallback: string, blob: Blob | null) => {
    const capture = generation;
    const heard = transcriptEchoesPrompt(fallback, prompt, names) ? "" : fallback.replace(/\s+/g, " ").trim();
    const bytes = blob?.size || 0;
    const mime = blob?.type || "audio/webm";
    if (capture !== speechGeneration) return;
    const giveUp = (serverError: string) => {
      const decision = decideTranscript({ audioBytes: bytes, prompt, names, browserText: heard, serverText: "", serverOk: false, serverError });
      if (!decision.post) releaseCapture(decision.message || serverError);
      else sendFinal(decision.text);
    };
    if (!blob || bytes < 200) {
      giveUp(`Nothing was heard. The recording was ${bytes} bytes. Tap Voice command, speak, then tap Stop.`);
      return;
    }
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled || capture !== speechGeneration) return;
      settled = true;
      voiceLog("stt-timeout", mime);
      giveUp(publicTranscriptionError({ stage: "timeout", mime, bytes }));
    }, 35000);
    try {
      const audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || "").slice(String(reader.result || "").indexOf(",") + 1));
        reader.onerror = () => reject(new Error(publicTranscriptionError({ stage: "unreadable", mime, bytes })));
        reader.readAsDataURL(blob);
      });
      if (capture !== speechGeneration) return;
      const result = await transcribeAssistant({ data: { slug: options.slug, code: options.code, audio, mime, names, language: "en" } });
      if (settled || capture !== speechGeneration) return;
      settled = true;
      window.clearTimeout(timer);
      const serverText = result.ok ? result.text : "";
      const serverError = result.ok ? "" : result.error;
      const decision = decideTranscript({
        audioBytes: bytes,
        prompt,
        names,
        browserText: heard,
        serverText,
        serverOk: result.ok,
        serverError,
      });
      voiceLog(result.ok ? "server-correct" : "stt-error", (serverText || serverError).slice(0, 160));
      if (!decision.post) releaseCapture(serverError || decision.message);
      else sendFinal(decision.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : publicTranscriptionError({ stage: "provider", mime, bytes, detail: "The recording could not be sent." });
      voiceLog("stt-error", message.slice(0, 160));
      if (!settled && capture === speechGeneration) {
        settled = true;
        window.clearTimeout(timer);
        giveUp(message);
      }
    }
  };

  let stopCapture: (() => Promise<Blob | null>) | null = null;
  const armCapture = (stream: MediaStream) => {
    armRecorder(stream);
    stopCapture = () => takeRecording();
  };
  const armRecorder = (stream: MediaStream) => {
    if (recorder && recorder.state === "recording") return;
    if (typeof MediaRecorder === "undefined") return;
    let mime = "";
    if (typeof MediaRecorder.isTypeSupported === "function") {
      for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
        try {
          if (MediaRecorder.isTypeSupported(type)) {
            mime = type;
            break;
          }
        } catch { /* try the next type */ }
      }
    }
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    try { recorder.start(250); } catch { try { recorder.start(); } catch { /* this browser will not record */ } }
  };

  const armRecognition = (duringSpeech = false) => {
    if (voiceStopping || generation !== speechGeneration || !keepListening) return;
    if (advisorSpeaking && !duringSpeech) return;
    try { recognition?.abort?.(); } catch { /* one listener only */ }
    recognition = null;
    session += 1;
    if (session > 1) pushVoiceEvent({ at: new Date().toISOString(), type: "restart" });
    const speech = window as unknown as { SpeechRecognition?: new () => Heard; webkitSpeechRecognition?: new () => Heard };
    const Recognition = speech.SpeechRecognition || speech.webkitSpeechRecognition;
    if (!Recognition) return;
    const heard = new Recognition();
    heard.lang = voiceLanguage();
    heard.continuous = true;
    heard.interimResults = true;
    const grammarHost = window as unknown as { SpeechGrammarList?: new () => { addFromString: (grammar: string, weight: number) => void }; webkitSpeechGrammarList?: new () => { addFromString: (grammar: string, weight: number) => void } };
    const Grammar = grammarHost.SpeechGrammarList || grammarHost.webkitSpeechGrammarList;
    if (Grammar && names.length > 0) {
      try {
        const list = new Grammar();
        const spoken = names.map((name) => name.replace(/[^a-z0-9' -]/gi, "")).filter(Boolean).slice(0, 40).join(" | ");
        if (spoken) {
          list.addFromString(`#JSGF V1.0; grammar contacts; public <contact> = ${spoken};`, 1);
          (heard as Heard & { grammars?: unknown }).grammars = list;
        }
      } catch { /* this browser has no name hints */ }
    }
    heard.onresult = (event) => {
      const pieces: { transcript: string; isFinal: boolean }[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const piece = event.results[index];
        pieces.push({ transcript: piece?.[0]?.transcript || "", isFinal: Boolean(piece?.isFinal) });
      }
      if (recognition === heard) pushVoiceEvent({ at: new Date().toISOString(), type: "result", resultIndex: Number(event.resultIndex || 0), results: pieces });
      if (generation !== speechGeneration || !keepListening || recognition !== heard) return;
      if (voiceDebugEnabled()) console.info("[voice-stt]", { session, pieces });
      const next = pushRecognition(turn, session, pieces);
      if (advisorSpeaking && (isEcho(next.text, lastSpokenLine) || repeatsRequest(next.text, lastSent))) return;
      if (advisorSpeaking && shouldBargeIn(next.text, lastSpokenLine, lastSent)) interruptAdvisorSpeech();
      turn = next.state;
      if (next.text) {
        draft(next.text);
        voiceLog("interim", next.text.slice(0, 80));
      }
      window.clearTimeout(voicePauseTimer);
      if (!autoSend) return;
      voicePauseTimer = window.setTimeout(() => {
        if (!shouldCaptureSpeech({ explicitListen: keepListening, speaking: advisorSpeaking || clipsPlaying > 0, preparing: false })) return;
        if (!shouldAutoSend(true, 3000)) return;
        const raw = turnText(turn).trim();
        const line = transcriptEchoesPrompt(raw, prompt, names) ? "" : raw;
        if (line) {
          const said = line;
          void takeRecording().then((blob) => correct(said, blob));
        }
      }, 3000);
    };
    heard.onerror = (event) => {
      if (recognition === heard) pushVoiceEvent({ at: new Date().toISOString(), type: "error", error: event.error || "error" });
      if (generation !== speechGeneration || !keepListening || recognition !== heard) return;
      const reason = recognitionError(event.error || "");
      if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "audio-capture") {
        keepListening = false;
        fail(reason || "The microphone could not be used.", false);
        return;
      }
      if (reason) fail(reason, true);
    };
    heard.onend = () => {
      if (recognition === heard) pushVoiceEvent({ at: new Date().toISOString(), type: "end" });
      if (voiceStopping || generation !== speechGeneration || !shouldCaptureSpeech({ explicitListen: keepListening, speaking: advisorSpeaking, preparing: false }) || voiceSending) return;
      if (recognition !== heard) return;
      listenTimer = window.setTimeout(() => {
        if (voiceStopping || !shouldCaptureSpeech({ explicitListen: keepListening, speaking: advisorSpeaking || clipsPlaying > 0, preparing: false }) || voiceSending) return;
        armRecognition(false);
      }, 200);
    };
    recognition = heard;
    try {
      heard.start();
      const phase = advisorSpeaking ? "speaking" : "listening";
      emitVoice({ phase, error: "", listening: true, speaking: advisorSpeaking });
      onStatus({ listening: true, error: "", phase });
    } catch {
      pushVoiceEvent({ at: new Date().toISOString(), type: "error", error: "Speech recognition did not start." });
      if (voiceStopping || !keepListening) return;
      listenTimer = window.setTimeout(() => {
        if (voiceStopping || !keepListening) return;
        armRecognition();
      }, 300);
    }
  };
  finishSpeech = () => {
    window.clearTimeout(voicePauseTimer);
    keepListening = false;
    voiceStopping = true;
    finishSpeech = null;
    const heardNow = recognition;
    try { heardNow?.stop?.(); } catch { try { heardNow?.abort?.(); } catch { /* already stopped */ } }
    if (voiceSending) {
      haltVoice();
      return;
    }
    emitVoice({ phase: "processing", error: "", listening: false, speaking: false });
    onStatus({ listening: false, error: "", phase: "processing" });
    voiceLog("stop-send");
    window.setTimeout(() => {
      if (generation !== speechGeneration) return;
      recognition = null;
      const raw = turnText(turn).trim();
      const line = transcriptEchoesPrompt(raw, prompt, names) ? "" : raw;
      void (stopCapture ? stopCapture() : takeRecording()).then((blob) => correct(line, blob));
    }, 500);
  };
  listenDuringSpeech = () => {
    try { recognition?.abort?.(); } catch { /* the reply is not a command */ }
    recognition = null;
  };
  restartListening = () => {
    if (!keepListening || advisorSpeaking) return;
    voiceSending = false;
    armRecognition(false);
  };

  void (async () => {
    try {
      const stream = await openCommandMic();
      if (generation !== speechGeneration || !keepListening || !stream) {
        if (generation === speechGeneration && keepListening) fail("The microphone could not be started.", false);
        return;
      }
      armCapture(stream);
      const speech = window as unknown as { SpeechRecognition?: new () => Heard; webkitSpeechRecognition?: new () => Heard };
      const canRecognize = Boolean(speech.SpeechRecognition || speech.webkitSpeechRecognition);
      if (typeof MediaRecorder !== "undefined") {
        liveWords = false;
        voiceLog("record-only");
        emitVoice({ phase: "listening", error: "", listening: true, speaking: false });
        onStatus({ listening: true, error: "", phase: "listening" });
        return;
      }
      liveWords = canRecognize;
      if (!liveWords) {
        fail("This browser cannot record speech. Use Chrome or Safari, then tap Voice command again.", false);
        return;
      }
      armRecognition();
    } catch (error) {
      keepListening = false;
      fail(micError(error), false);
    }
  })();
}

export function resumeAdvisorListening() {
  if (voiceStopping || !keepListening) return;
  restartListening?.();
  emitVoice({ phase: "listening", error: "", listening: true, speaking: false });
}


function nameChoicesFrom(message: string) {
  const line = message.match(/Did you mean (.+)\?/i);
  if (!line) return [];
  return line[1].split(/\s*,\s*|\s+\bor\b\s+/i).map((name) => name.trim()).filter((name) => name.length > 1);
}

function AssistantText({ text }: { text: string }) {
  return assistantPieces(text).map((piece, index) => "href" in piece
    ? <a key={index} href={piece.href} target="_blank" rel="noreferrer">Join Zoom meeting</a>
    : <span key={index}>{piece.text}</span>);
}

export function AssistantDesk({ code, desk, spoken = null, assistFrom = null, hearing = false, freshChat = 0, voiceCue = 0, onVoice, onOpenSettings }: { code: string; desk: DeskData; spoken?: { id: number; text: string; page?: string } | null; assistFrom?: { page: string; id: number } | null; hearing?: boolean; freshChat?: number; voiceCue?: number; onVoice?: (status: { listening: boolean; speaking: boolean }) => void; onOpenSettings?: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [wideDesk, setWideDesk] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [birthdayCards, setBirthdayCards] = useState(true);
  const [newsletterReminder, setNewsletterReminder] = useState(true);
  const [showBirthday, setShowBirthday] = useState(true);
  const [showNewsletter, setShowNewsletter] = useState(true);
  const [ruleNote, setRuleNote] = useState("");
  const [savedRules, setSavedRules] = useState<SavedRule[]>([]);
  const [openRule, setOpenRule] = useState<number | null>(null);
  const [editingRule, setEditingRule] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [rulesSaved, setRulesSaved] = useState("");
  const [heard, setHeard] = useState("");
  const [pageCue, setPageCue] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [choices, setChoices] = useState<string[]>([]);
  const [choiceNote, setChoiceNote] = useState("");
  const [correction, setCorrection] = useState("");
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("off");
  const [voiceError, setVoiceError] = useState("");
  const phaseRef = useRef<VoicePhase>("off");
  const request = useRef(0);
  const asked = useRef(0);
  const freshSeen = useRef(0);
  const rulesOpenRef = useRef(false);
  const askRef = useRef<(line?: string, options?: { confirmed?: boolean }) => Promise<void>>(async () => {});
  const newChatRef = useRef<() => Promise<void>>(async () => {});
  const chatIdRef = useRef(0);
  const busyRef = useRef(false);
  const nameChoice = useRef<{ text: string; start: number; end: number } | null>(null);
  const transcriptChoice = useRef<{ suggestion: string } | null>(null);
  const pendingVoice = useRef<Array<{ text: string; confirmed?: boolean }>>([]);
  const activeNewsletterId = useRef(0);
  const lastQuestion = useRef("");
  const replayClips = useRef<Array<{ audio: string; mime: string }>>([]);
  const [replayReady, setReplayReady] = useState(false);
  const [playableLine, setPlayableLine] = useState("");
  const [playingReply, setPlayingReply] = useState(false);
  const playbackToken = useRef(0);
  const [micTest, setMicTest] = useState("");
  const [playbackNote, setPlaybackNote] = useState("");
  const generation = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const pinningRef = useRef(false);
  rulesOpenRef.current = rulesOpen;
  chatIdRef.current = chatId;
  phaseRef.current = voicePhase;

  useEffect(() => subscribeAdvisorVoice((status) => {
    setVoicePhase(status.phase);
    setVoiceError(status.error);
    setListening(status.phase === "listening" || status.phase === "processing");
    setSpeaking(status.phase === "speaking");
    if (status.phase === "listening" || status.phase === "processing") setError("");
    else if (status.error) setError(status.error);
  }), [onVoice]);

  useEffect(() => {
    const onDraft = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; id?: number }>).detail;
      if (detail?.kind === "newsletter") activeNewsletterId.current = Number(detail.id) || 0;
    };
    window.addEventListener("ua-active-draft", onDraft);
    return () => window.removeEventListener("ua-active-draft", onDraft);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 900px)");
    const apply = () => {
      setWideDesk(query.matches);
      setHistoryOpen(query.matches);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => subscribeAdvisorDraft((said) => {
    setText(said);
    setHeard(said);
  }), []);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log || !stickRef.current) {
      if (log && log.scrollHeight - log.scrollTop - log.clientHeight > 80) setShowJump(true);
      return;
    }
    pinningRef.current = true;
    log.scrollTop = log.scrollHeight;
    setShowJump(false);
    const frame = requestAnimationFrame(() => {
      const node = logRef.current;
      if (node && stickRef.current) node.scrollTop = node.scrollHeight;
      pinningRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [turns, busy, chatId, rulesOpen, actions.length]);

  function onLogScroll() {
    if (pinningRef.current) return;
    const log = logRef.current;
    if (!log) return;
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    stickRef.current = near;
    setShowJump(!near && log.scrollHeight > log.clientHeight + 8);
  }

  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector(".ua-assist-row.on");
    if (!list || !(row instanceof HTMLElement)) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, top - 8);
  }, [chatId, chats]);

  async function refresh(nextChatId = chatId) {
    const token = ++request.current;
    const [result, pending, history] = await Promise.all([
      listAssistantDrafts({ data: { slug: desk.slug, code } }),
      listAssistantActions({ data: { slug: desk.slug, code } }),
      listAssistantMessages({ data: { slug: desk.slug, code, chatId: nextChatId || undefined } }),
    ]);
    if (token !== request.current) return;
    if (result.ok) setDrafts(result.drafts);
    else setError(result.error);
    if (pending.ok) setActions((pending.actions as Action[]).filter((item) => previewCanSend(item)));
    if (history.ok) {
      setTurns(history.messages.map((message) => ({
        id: message.id,
        role: message.role === "assistant" ? "assistant" as const : "user" as const,
        content: message.content,
        at: message.at,
        previews: (message.previews || []).map((item) => ({
          id: item.id,
          kind: item.kind,
          summary: item.summary || "",
          status: item.status,
          canSend: item.canSend,
          preview: item.preview,
          previewHtml: item.previewHtml,
          previewImage: item.previewImage,
        })),
      })));
      setChats(history.chats);
      setChatId(history.chatId);
      if (!rulesOpenRef.current) {
        setBirthdayCards(history.rules.birthdayCards);
        setNewsletterReminder(history.rules.newsletterReminder);
      }
      setSavedRules(asRules(history.rules.rules));
      setShowBirthday(history.rules.showBirthday !== false);
      setShowNewsletter(history.rules.showNewsletter !== false);
      const lastAssistant = [...history.messages].reverse().find((turn) => turn.role === "assistant" && String(turn.content || "").trim());
      const restored = lastAssistant ? playableReplyLine(lastAssistant.content) : "";
      if (restored) setPlayableLine(restored);
      const lastLine = [...history.messages].reverse().find((turn) => turn.role === "assistant")?.content || "";
      if (!/just to confirm:/i.test(lastLine)) {
        const morning = await runMorningCheck({ data: { slug: desk.slug, code, chatId: history.chatId } });
        if (token !== request.current) return;
        if (morning.ok && morning.note) {
          setTurns((current) => current.some((turn) => turn.content === morning.note) ? current : [...current, { role: "assistant", content: morning.note }]);
        }
      }
    } else setError(history.error);
  }

  useEffect(() => {
    setTurns([]);
    setChats([]);
    setChatId(0);
    setDrafts([]);
    setActions([]);
    setText("");
    setError("");
    void refresh(0);
  }, [desk.slug, code]);

  useEffect(() => {
    if (!assistFrom?.id) return;
    setPageCue(assistFrom.page);
    const frame = window.setTimeout(() => {
      document.getElementById("ai-assistant-input")?.focus();
    }, 40);
    return () => window.clearTimeout(frame);
  }, [assistFrom?.id]);

  useEffect(() => {
    if (!spoken?.id || !spoken.text || asked.current === spoken.id) return;
    asked.current = spoken.id;
    if (spoken.page) setPageCue(spoken.page);
    hear(spoken.text);
  }, [spoken]);

  function choiceList(message: string) {
    const quoted = [...message.matchAll(/"([^"]{2,48})"|'([^']{2,48})'/g)].map((hit) => (hit[1] || hit[2] || "").trim()).filter(Boolean);
    if (quoted.length >= 2) return quoted.slice(0, 3);
    if (/\b(yes|confirm|book|time)\b/i.test(message)) return ["Yes", "No", "Change the time"];
    return ["Yes", "No"];
  }

  function quiet() {
    voiceStopping = true;
    keepListening = false;
    window.clearTimeout(listenTimer);
    window.clearTimeout(voicePauseTimer);
    finishSpeech = null;
    stopAdvisorSpeech();
    setListening(false);
    setSpeaking(false);
    onVoice?.({ listening: false, speaking: false });
  }

  function cancelPlayback() {
    playbackToken.current += 1;
    invalidatePlayback();
    setPlayingReply(false);
    setPlaybackNote("");
    setSpeaking(false);
    emitVoice({ phase: "off", error: "", listening: false, speaking: false });
  }

  async function replaySpoken() {
    const line = playableLine || lastSpokenLine;
    if (!line || playingReply) return;
    const mine = ++playbackToken.current;
    invalidatePlayback();
    dropAudio = false;
    const owner = playbackGeneration;
    setPlayingReply(false);
    setPlaybackNote("Preparing the reply…");
    setError("");
    const markStarted = () => {
      if (mine !== playbackToken.current || owner !== playbackGeneration) return;
      setPlayingReply(true);
      setPlaybackNote("");
    };
    try {
      const result = await playStoredReply({
        line,
        speakServer: async (text) => {
          if (owner !== playbackGeneration) return { started: false, dropped: true, blocked: false };
          const spoken = await speakAssistant({ data: { slug: desk.slug, code, text } }).catch((error: unknown) => ({
            ok: false as const,
            error: error instanceof Error ? error.message : "No spoken audio came back. Press Play reply.",
          }));
          if (mine !== playbackToken.current || owner !== playbackGeneration) return { started: false, dropped: true, blocked: false };
          if (spoken && "audio" in spoken && spoken.ok && spoken.audio) {
            const clip = { audio: spoken.audio, mime: spoken.mime || "audio/mpeg" };
            replayClips.current = [clip];
            return playVoiceClip(clip.audio, clip.mime, markStarted, owner);
          }
          const error = spoken && "error" in spoken ? String(spoken.error || "") : "No spoken audio came back. Press Play reply.";
          return { started: false, dropped: false, blocked: true, error };
        },
        speakBrowser: (text) => owner === playbackGeneration ? speakInBrowser(text, markStarted, owner) : Promise.resolve({ started: false, dropped: true, blocked: false }),
      });
      if (mine !== playbackToken.current) return;
      setPlayableLine(line);
      setReplayReady(true);
      setPlaybackNote(result.spoke && !result.usedBrowser ? "" : result.note || "Press Play reply to try again.");
      if (result.spoke) setError("");
    } finally {
      if (mine === playbackToken.current) setPlayingReply(false);
    }
  }

  async function askByVoice(content: string, id: number, mine: number, confirmed = false) {
    invalidatePlayback();
    dropAudio = false;
    const owner = playbackGeneration;
    pendingVoice.current = [];
    setTurns((current) => [...current, { role: "assistant", content: "", at: new Date().toISOString() }]);
    const clips: Array<{ audio: string; mime: string }> = [];
    const pending: Promise<ClipPlay>[] = [];
    let reply = "";
    let actions: Action[] = [];
    let finished = false;
    let ttsError = "";
    const settled = async () => {
      const outcomes = await Promise.all(pending);
      return {
        played: voiceAudible(outcomes),
        started: outcomes.some((item) => item.started),
        blocked: outcomes.some((item) => item.blocked),
        dropped: outcomes.some((item) => item.dropped),
      };
    };
    try {
      const response = await fetch("/api/assistant/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: desk.slug, code, chatId: id, page: pageCue, content, transcriptConfirmed: confirmed, activeNewsletterId: activeNewsletterId.current }),
      });
      if (!response.ok || !response.body) {
        const missed = response.status ? `The voice reply did not start (${response.status}). Press Play reply.` : "The voice reply did not start. Press Play reply.";
        return { ok: false as const, error: "The assistant could not answer.", accepted: true as const, played: false, reply: "", actions: [] as Action[], clips, ttsError: missed, blocked: false, dropped: false };
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      while (true) {
        const step = await reader.read();
        if (mine !== generation.current) {
          dropAudio = true;
          return { ok: true as const, reply, actions: [] as Action[], played: false, accepted: true as const, clips, ttsError, blocked: false, dropped: true };
        }
        if (step.done) break;
        raw += decoder.decode(step.value, { stream: true });
        const lines = raw.split("\n");
        raw = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          let event: { type?: string; text?: string; audio?: string; mime?: string; error?: string; reply?: string; actions?: Action[] };
          try {
            event = JSON.parse(trimmed.slice(5)) as typeof event;
          } catch {
            continue;
          }
          if (event.type === "delta" && event.text) {
            reply += event.text;
            const piece = event.text;
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, content: `${last.content}${piece}` };
              return next;
            });
          } else if (event.type === "speak" && event.text) {
            lastSpokenLine = event.text;
          } else if (event.type === "audio" && event.audio) {
            const clip = { audio: event.audio, mime: event.mime || "audio/mpeg" };
            clips.push(clip);
            pending.push(playVoiceClip(clip.audio, clip.mime, () => {
              if (owner !== playbackGeneration) return;
              setPlayingReply(true);
              setPlaybackNote("");
            }, owner));
          } else if (event.type === "error") {
            const playback = await settled();
            return { ok: false as const, error: event.error || "The assistant could not answer.", ...playback, accepted: true as const, clips, ttsError, reply: event.error || reply };
          } else if (event.type === "tts-error") {
            ttsError = event.error || "The spoken reply could not be played.";
          } else if (event.type === "done") {
            reply = event.reply || reply;
            actions = event.actions || [];
            finished = true;
            lastSpokenLine = spokenBrief(reply, content) || lastSpokenLine;
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, content: reply };
              return next;
            });
          }
        }
      }
      const playback = await settled();
      return reply || finished
        ? { ok: true as const, reply, actions, ...playback, accepted: true as const, clips, ttsError }
        : { ok: false as const, error: "The assistant did not answer.", reply, actions, ...playback, accepted: true as const, clips, ttsError };
    } catch {
      return null;
    }
  }

  function contactNames() {
    return (desk.contacts || []).map((contact) => ({ id: contact.id, name: contact.fullName }));
  }

  function showNameChoices(original: string, names: string[], question: string, start: number, end: number) {
    transcriptChoice.current = null;
    nameChoice.current = { text: original, start, end };
    setCorrection("");
    setChoiceNote(question);
    setChoices([...names.filter((name) => name !== "Use what I said"), "Use what I said"]);
  }

  function offerNames(original: string, names: string[], question: string, start: number, end: number) {
    showNameChoices(original, names, question, start, end);
    setHeard(original);
    setText(original);
    const at = new Date().toISOString();
    setTurns((current) => [...current, { role: "user", content: original, at }, { role: "assistant", content: question, at }]);
  }

  function holdTranscript(original: string, question: string, suggestion: string) {
    nameChoice.current = null;
    transcriptChoice.current = { suggestion };
    setCorrection(suggestion);
    setChoiceNote(question);
    setChoices(["Use this transcript"]);
    setHeard(original);
    setText(suggestion);
    const at = new Date().toISOString();
    setTurns((current) => [...current, { role: "user", content: original, at }, { role: "assistant", content: `${question}\nTranscript: ${original}\nNothing was sent.`, at }]);
    void speakInBrowser(question);
  }

  function hear(text: string) {
    voiceSending = false;
    keepListening = false;
    window.clearTimeout(listenTimer);
    window.clearTimeout(voicePauseTimer);
    try { recognition?.abort?.(); } catch { /* the command is already captured */ }
    recognition = null;
    setListening(false);
    setSpeaking(false);
    onVoice?.({ listening: false, speaking: false });
    emitVoice({ phase: "off", error: "", listening: false, speaking: false });
    if (soundsLikeNoise(text)) {
      nameChoice.current = null;
      transcriptChoice.current = null;
      setHeard("");
      setText("");
      setChoices([]);
      setChoiceNote("");
      setError("That was microphone noise, not a command. Tap Voice command and try again.");
      return;
    }
    if (isOnboardingDemo(text) || refersToAppointment(text)) {
      nameChoice.current = null;
      transcriptChoice.current = null;
      setHeard(text);
      setText(text);
      void askRef.current(text);
      return;
    }
    if (isHearingCheck(text)) {
      const reply = "Yes. I can hear you.";
      nameChoice.current = null;
      transcriptChoice.current = null;
      setChoices([]);
      setChoiceNote("");
      setHeard(text);
      setText("");
      const at = new Date().toISOString();
      setTurns((current) => [...current, { role: "user", content: text, at }, { role: "assistant", content: reply, at }]);
      void speakInBrowser(reply);
      return;
    }
    const contacts = contactNames();
    const hit: SpokenMatch = resolveSpokenContact(text, contacts);
    if (hit.kind === "many") {
      const options = spokenNameOptions(text, contacts);
      offerNames(text, [...new Set([...hit.names, ...options.names])].slice(0, 6), hit.question, hit.start, hit.end);
      return;
    }
    if (hit.kind === "one" && !text.toLowerCase().includes(hit.name.toLowerCase())) {
      const options = spokenNameOptions(text, contacts);
      const names = [...new Set([hit.name, ...options.names])].slice(0, 6);
      offerNames(text, names, names.length > 1 ? `That name was not exact. ${hit.name} is the closest. Pick the right contact, or type it.` : `That name was not exact. Did you mean ${hit.name}?`, options.start || hit.start, options.end || hit.end);
      return;
    }
    if (hit.kind === "ask") {
      offerNames(text, contacts.map((contact) => contact.name).slice(0, 8), hit.question, text.length, text.length);
      return;
    }
    nameChoice.current = null;
    transcriptChoice.current = null;
    const line = hit.kind === "one" ? hit.text : text;
    setHeard(line);
    setText(line);
    void askRef.current(line);
  }

  async function ask(spoken?: string, options?: { confirmed?: boolean }) {
    const content = (spoken ?? text).trim();
    if (!content) return;
    if (spoken && !options?.confirmed) {
      const held = transcriptHold(content);
      if (held && !isOnboardingDemo(content)) {
        holdTranscript(content, held.question, held.suggestion);
        return;
      }
    }
    if (spoken) {
      setText(content);
      setHeard(content);
    }
    if (busyRef.current) {
      if (spoken) pendingVoice.current.push({ text: content, confirmed: options?.confirmed });
      return;
    }
    busyRef.current = true;
    const mine = generation.current;
    setChoices([]);
    setChoiceNote("");
    transcriptChoice.current = null;
    nameChoice.current = null;
    setTurns((current) => [...current, { role: "user", content, at: new Date().toISOString() }]);
    setHeard("");
    stickRef.current = true;
    if (spoken) setText(content);
    else setText("");
    setBusy(true);
    setError("");
    const id = chatIdRef.current;
    const failed = (message: string) => {
      const line = message || "Sorry, something went wrong — please try again.";
      setError(line);
      setTurns((current) => [...current, { role: "assistant", content: line, at: new Date().toISOString() }]);
      const playable = playableReplyLine(line);
      if (playable) setPlayableLine(playable);
    };
    try {
      setChats((current) => current.map((chat) => chat.id === id && (chat.title === "New chat" || !chat.title.trim()) ? { ...chat, title: content.replace(/\s+/g, " ").slice(0, 42), at: new Date().toISOString() } : chat));
      const streamed = spoken ? await askByVoice(content, id, mine, Boolean(options?.confirmed)) : null;
      const result = readAssistantAnswer(streamed || await askAssistant({ data: { slug: desk.slug, code, chatId: id, page: pageCue, transcriptConfirmed: Boolean(options?.confirmed), activeNewsletterId: activeNewsletterId.current, messages: [{ role: "user", content }] } }));
      if (mine !== generation.current) return;
      if (spoken) setText("");
      busyRef.current = false;
      setBusy(false);
      const started = Boolean(streamed && "started" in streamed && streamed.started);
      const showReply = (line: string) => {
        const playable = playableReplyLine(line, content);
        if (playable) {
          lastSpokenLine = playable;
          setPlayableLine(playable);
          setReplayReady(true);
        }
      };
      const offerSpeech = async (line: string) => {
        if (!spoken) return;
        showReply(line);
        voiceSending = false;
        keepListening = false;
        window.clearTimeout(listenTimer);
        try { recognition?.abort?.(); } catch { /* already closed */ }
        recognition = null;
        setListening(false);
        if (!playableReplyLine(line, content)) return;
        if (spoken && started) {
          setPlayingReply(false);
          return;
        }
        const minePlay = ++playbackToken.current;
        invalidatePlayback();
        dropAudio = false;
        const owner = playbackGeneration;
        setPlaybackNote("Preparing the reply…");
        const markStarted = () => {
          if (minePlay !== playbackToken.current || owner !== playbackGeneration) return;
          setPlayingReply(true);
          setPlaybackNote("");
        };
        const outcome = await playStoredReply({
          line: playableReplyLine(line, content),
          speakServer: async (text) => {
            if (owner !== playbackGeneration) return { started: false, dropped: true, blocked: false };
            const audio = await speakAssistant({ data: { slug: desk.slug, code, text } }).catch((error: unknown) => ({
              ok: false as const,
              error: error instanceof Error ? error.message : "No spoken audio came back. Press Play reply.",
            }));
            if (owner !== playbackGeneration) return { started: false, dropped: true, blocked: false };
            if (audio && "audio" in audio && audio.ok && audio.audio) return playVoiceClip(audio.audio, audio.mime || "audio/mpeg", markStarted, owner);
            const error = audio && "error" in audio ? String(audio.error || "") : "No spoken audio came back. Press Play reply.";
            return { started: false, dropped: false, blocked: true, error };
          },
          speakBrowser: (text) => owner === playbackGeneration ? speakInBrowser(text, markStarted, owner) : Promise.resolve({ started: false, dropped: true, blocked: false }),
        });
        if (minePlay === playbackToken.current) {
          setPlayingReply(false);
          setPlaybackNote(outcome.spoke && !outcome.usedBrowser ? "" : outcome.note);
        }
      };
      if (!result?.ok) {
        const failure = result && "error" in result && typeof result.error === "string" ? result.error : "";
        const names = nameChoicesFrom(failure);
        if (names.length) {
          const hit = resolveSpokenContact(content, names.map((name, index) => ({ id: index, name })));
          showNameChoices(content, names, failure || "Which contact?", hit.kind === "one" || hit.kind === "many" ? hit.start : content.length, hit.kind === "one" || hit.kind === "many" ? hit.end : content.length);
          setError("");
        } else failed(failure || "Sorry, something went wrong — please try again.");
        await offerSpeech(failure || String(result?.reply || ""));
      } else if (!result.reply?.trim()) {
        failed("Sorry, something went wrong — please try again.");
      } else {
        const reply = String(result.reply || "");
        if (/did not open or change/i.test(reply)) activeNewsletterId.current = 0;
        else if (result.actions?.some((item) => String(item.kind || "").includes("newsletter"))) {
          const ids = [...reply.matchAll(/\bsaved copy #(\d+)\b/gi)].map((match) => Number(match[1]));
          const unique = [...new Set(ids)];
          if (unique.length === 1) {
            activeNewsletterId.current = unique[0];
            window.dispatchEvent(new CustomEvent("ua-active-draft", { detail: { kind: "newsletter", id: unique[0] } }));
          }
        }
        const bookingAsk = /shall i book it\?/i.test(result.reply);
        const cardAsk = /just to confirm:/i.test(result.reply);
        const repeated = showUnclearChoice(content, lastQuestion.current, result.reply);
        if (bookingAsk) {
          lastQuestion.current = result.reply;
          setChoiceNote("");
          setChoices(["Yes", "Change time"]);
        } else if (cardAsk) {
          lastQuestion.current = result.reply;
          setChoiceNote("");
          setChoices(["Yes", "No"]);
        } else if (repeated) {
          setChoiceNote("That was not clear. Choose one:");
          setChoices(choiceList(result.reply));
        } else {
          lastQuestion.current = result.reply;
          setChoices([]);
          setChoiceNote("");
        }
        await offerSpeech(reply);
        await refresh(id);
        if (mine !== generation.current) return;
        setTurns((current) => current.some((turn) => turn.role === "assistant" && turn.content === reply) ? current : [...current, { role: "user" as const, content, at: new Date().toISOString() }, { role: "assistant" as const, content: reply, at: new Date().toISOString() }]);
        const userCancels = /^(?:please\s+)?(?:cancel|stop)\b/i.test(content)
          || (/لغو|کنسل/.test(content) && /ارسال نکن|نفرست/.test(content));
        const routed = prepareDeskCommand(content);
        const replacePreview = shouldReplacePreview(content) || shouldReplacePreview(routed);
        if (userCancels) setActions([]);
        else if (result.actions?.length || replacePreview) {
          const fresh = (result.actions || []).filter((item) => previewCanSend(item));
          setActions((current) => [
            ...fresh,
            ...current.filter((item) => !fresh.some((next) => next.id === item.id) && previewCanSend(item) && item.kind !== "signature"),
          ]);
          if (fresh.some((item) => item.kind === "newsletter-preview" || item.kind === "eletter-preview" || item.kind === "card-preview" || item.kind === "campaign-preview")) {
            window.dispatchEvent(new Event("ua-newsletter"));
          }
        }
        if (/zoom\.us\/j\//i.test(result.reply) && !/\bnot booked\b/i.test(result.reply)) window.dispatchEvent(new Event("ua-meetings"));
      }
    } catch (error) {
      console.error("[assistant]", error);
      if (mine === generation.current) failed("Sorry, something went wrong — please try again.");
    } finally {
      if (mine === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
    const next = pendingVoice.current.shift();
    if (next && mine === generation.current) void ask(next.text, { confirmed: next.confirmed });
  }

  askRef.current = ask;

  function listen() {
    if (hearing || listening || speaking || playingReply || advisorVoiceOn()) {
      pendingVoice.current = [];
      generation.current += 1;
      busyRef.current = false;
      setBusy(false);
      cancelPlayback();
      stopAdvisorSpeech();
      return;
    }
    setMicTest("");
    setHeard("");
    startAdvisorSpeech(
      (said) => hear(said),
      (status) => {
        setListening(status.phase === "listening" || status.phase === "processing");
        if (status.error) setError(status.error);
        if (status.phase === "error" || status.phase === "off") setListening(false);
      },
      { slug: desk.slug, code, names: (desk.contacts || []).map((contact) => contact.fullName) },
    );
  }

  async function runMicTest() {
    setError("");
    setMicTest("Checking the microphone…");
    const recognition = typeof window !== "undefined" && Boolean((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicTest(microphoneTestReport({ errorName: "unsupported", recognition }).message);
      return;
    }
    let stream: MediaStream | null = null;
    try {
      let permission = "unknown";
      try {
        const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
        permission = status?.state || "unknown";
      } catch { /* this browser does not report microphone permission */ }
      if (permission === "denied") {
        setMicTest(microphoneTestReport({ permission, recognition }).message);
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const track = stream.getAudioTracks()[0];
      const deviceLabel = track?.label || "";
      const trackState = track?.readyState || "";
      let level: number | null = null;
      const audioContext = typeof AudioContext !== "undefined" ? new AudioContext() : null;
      if (audioContext && track) {
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const started = performance.now();
        while (performance.now() - started < 700) {
          analyser.getByteTimeDomainData(samples);
          let peak = 0;
          for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
          level = Math.max(level || 0, peak);
          await new Promise((resolve) => window.setTimeout(resolve, 50));
        }
        await audioContext.close().catch(() => undefined);
      }
      let bytes = 0;
      let mime = "";
      if (typeof MediaRecorder !== "undefined" && trackState === "live") {
        const recorded = await new Promise<Blob>((resolve) => {
          const rec = new MediaRecorder(stream as MediaStream);
          const parts: Blob[] = [];
          rec.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
          rec.onstop = () => resolve(new Blob(parts, { type: rec.mimeType || "audio/webm" }));
          rec.start();
          window.setTimeout(() => { try { rec.stop(); } catch { resolve(new Blob()); } }, 500);
        });
        bytes = recorded.size;
        mime = recorded.type || "audio/webm";
      }
      setMicTest(microphoneTestReport({ permission, deviceLabel, trackState, bytes, mime, level, recognition }).message);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setMicTest(microphoneTestReport({ errorName: name || "NotFoundError", recognition }).message);
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  const voiceSeen = useRef(0);
  useEffect(() => {
    if (!voiceCue || voiceSeen.current === voiceCue) return;
    voiceSeen.current = voiceCue;
  }, [voiceCue]);

  async function removeChat(id: number) {
    setError("");
    const result = await deleteAssistantChat({ data: { slug: desk.slug, code, chatId: id } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (id === chatId) {
      setTurns([]);
      setChatId(0);
      await refresh(0);
      return;
    }
    setChats((current) => current.filter((chat) => chat.id !== id));
  }

  async function newChat() {
    generation.current += 1;
    request.current += 1;
    pendingVoice.current = [];
    busyRef.current = false;
    lastQuestion.current = "";
    setBusy(false);
    cancelPlayback();
    stopAdvisorSpeech();
    setRulesOpen(false);
    setText("");
    setHeard("");
    setTurns([]);
    setActions([]);
    setChoices([]);
    setChoiceNote("");
    setError("");
    resumeAdvisorListening();
    try {
      const result = await startAssistantChat({ data: { slug: desk.slug, code } });
      if (request.current < 0) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      chatIdRef.current = result.chatId;
      setChatId(result.chatId);
      setChats((current) => [{ id: result.chatId, title: "New chat", at: new Date().toISOString() }, ...current.filter((chat) => chat.id !== result.chatId)]);
      setError("");
      window.setTimeout(() => document.getElementById("ai-assistant-input")?.focus(), 30);
    } catch {
      setError("New chat could not be started. Try again.");
    }
  }

  newChatRef.current = newChat;

  useEffect(() => {
    if (!freshChat || freshSeen.current === freshChat) return;
    freshSeen.current = freshChat;
    void newChatRef.current();
  }, [freshChat]);

  async function saveRules(event: React.FormEvent) {
    event.preventDefault();
    let list = savedRules;
    if (editingRule !== null) {
      const edited = editDraft.replace(/\s+$/g, "").trim();
      if (edited) list = list.map((item, index) => index === editingRule ? { ...item, text: edited.slice(0, 2000) } : item);
    }
    const added = ruleNote.trim();
    const next = added ? [...list, { text: added.slice(0, 2000), on: true, category: "My rules" }] : list;
    const ok = await storeRules({ rules: next });
    if (!ok) return;
    setRuleNote("");
    setEditingRule(null);
    setOpenRule(added ? next.length - 1 : openRule);
  }

  async function storeRules(next: { birthdayCards?: boolean; newsletterReminder?: boolean; showBirthday?: boolean; showNewsletter?: boolean; rules?: SavedRule[] }) {
    const cards = next.birthdayCards ?? birthdayCards;
    const reminder = next.newsletterReminder ?? newsletterReminder;
    const showCards = next.showBirthday ?? showBirthday;
    const showLetters = next.showNewsletter ?? showNewsletter;
    const list = next.rules ?? savedRules;
    const result = await saveAssistantRules({
      data: {
        slug: desk.slug,
        code,
        birthdayCards: showCards ? cards : false,
        newsletterReminder: showLetters ? reminder : false,
        showBirthday: showCards,
        showNewsletter: showLetters,
        rules: list,
      },
    });
    if (!result.ok) {
      setError(result.error);
      setRulesSaved("");
      return false;
    }
    setBirthdayCards(showCards ? cards : false);
    setNewsletterReminder(showLetters ? reminder : false);
    setShowBirthday(showCards);
    setShowNewsletter(showLetters);
    setSavedRules(list);
    setError("");
    setRulesSaved("Saved.");
    return true;
  }

  function openRules() {
    setRulesOpen(true);
    setRulesSaved("");
    setRuleNote("");
  }

  async function approve(id: number) {
    setBusy(true);
    setError("");
    const result = await approveAssistantDraft({ data: { slug: desk.slug, code, draftId: id } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTurns((current) => [...current, { role: "assistant", content: "The email was sent from your mailbox." }]);
    await refresh();
  }

  async function discard(id: number) {
    const result = await discardAssistantDraft({ data: { slug: desk.slug, code, draftId: id } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refresh();
  }

  async function approveAction(id: number) {
    setBusy(true);
    setError("");
    const result = await approveAssistantAction({ data: { slug: desk.slug, code, actionId: id, chatId: chatIdRef.current } });
    setBusy(false);
    if (!result.ok) setError(result.error);
    await refresh(chatIdRef.current);
    const line = result.ok && "detail" in result && typeof result.detail === "string" ? result.detail : "error" in result && typeof result.error === "string" ? result.error : "";
    if (line) {
      setTurns((current) => current.some((turn) => turn.role === "assistant" && turn.content === line) ? current : [...current, { role: "assistant", content: line }]);
    }
  }

  async function discardAction(id: number) {
    const result = await discardAssistantAction({ data: { slug: desk.slug, code, actionId: id } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await refresh();
  }

  const linkedPreviewIds = new Set(turns.flatMap((turn) => (turn.previews || []).map((item) => item.id)));
  const trayActions = actions.filter((item) => trayOffers(item, linkedPreviewIds));
  const liveState = playingReply || voicePhase === "speaking"
    ? "Speaking"
    : voicePhase === "listening"
      ? voiceLabel(voicePhase, "")
      : playbackNote
        ? ""
        : busy || voicePhase === "processing"
          ? "Thinking"
          : "";
  const historyPane = (drawer: boolean) => (
    <aside className={drawer ? "ua-assist-list ua-history-drawer" : "ua-assist-list"} aria-label="Previous chats" onClick={drawer ? (event) => event.stopPropagation() : undefined}>
      <p className="ua-assist-head">Previous chats</p>
      <div className="ua-assist-chats" ref={listRef}>
        {chats.length === 0 && <p className="px-3 py-3 text-sm" style={{ color: "#5a6a7a" }}>No earlier chats.</p>}
        {chats.map((chat) => (
          <div key={chat.id} className={`ua-assist-row ${chat.id === chatId ? "on" : ""}`}>
            <button type="button" className="title" onClick={() => { void refresh(chat.id); if (drawer) setHistoryOpen(false); }}>
              <span className="name">{chat.title && chat.title !== "New chat" ? chat.title : "Untitled"}</span>
              {stamp(chat.at) && <span className="when">{stamp(chat.at)}</span>}
            </button>
            <button type="button" className="remove" onClick={() => void removeChat(chat.id)}>Remove</button>
          </div>
        ))}
      </div>
    </aside>
  );
  return (
    <div className="ua-assist-stage">
      <section id="ai-assistant" className="ua-panel ua-assist-panel">
        <div className="ua-assist-tools flex flex-wrap items-center gap-2">
          <button type="button" className="ua-btn-line" data-history style={{ padding: "6px 12px" }} aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)}>{historyOpen ? "Close history" : "History"}</button>
          <button type="button" className="ua-btn" data-new-chat style={{ padding: "6px 12px" }} onClick={() => void newChat()}>New chat</button>
          <button type="button" className={rulesOpen ? "ua-btn" : "ua-btn-line"} style={{ padding: "6px 12px" }} onClick={() => { if (rulesOpen) setRulesOpen(false); else openRules(); }}>Rules</button>
          <span className="ua-live-state" role="status" data-assistant-state>{liveState}</span>
        </div>
        {rulesOpen ? (
          <form onSubmit={(event) => void saveRules(event)} className="ua-assist-rules mt-4 grid gap-3 rounded-lg border p-4" style={{ borderColor: "#e1e8ef" }}>
            <h3 className="font-semibold">Secretary tasks</h3>
            <ClientDatabase code={code} desk={desk} />
            <p className="text-sm" style={{ color: "#5a6a7a" }}>Each task is a rule. Turn one off and the assistant will not do that job. Edit changes the wording. You can still add your own rule below.</p>
            {savedRules.length === 0 && <p className="text-sm" style={{ color: "#5a6a7a" }}>No rules saved yet.</p>}
            {[...new Set(savedRules.map((rule) => rule.category || "My rules"))].map((category) => (
              <div key={category} className="grid gap-2">
                <h4 className="text-sm font-extrabold" style={{ color: "#1c3d36" }}>{category}</h4>
                {savedRules.map((rule, index) => {
                  if ((rule.category || "My rules") !== category) return null;
                  const open = openRule === index;
                  const editing = editingRule === index;
                  const words = rule.text.replace(/\s+/g, " ").trim().split(" ");
                  const short = words.length > 8 || rule.text.length > 60 ? `${words.slice(0, 8).join(" ")}…` : words.join(" ");
                  if (editing) {
                    return (
                      <div key={`${index}-edit`} className="grid gap-2">
                        <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} maxLength={2000} rows={4} className="ua-field font-normal" />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="ua-btn"
                            style={{ padding: "8px 12px" }}
                            onClick={() => {
                              const text = editDraft.replace(/\s+$/g, "").trim();
                              if (!text) return;
                              const next = savedRules.map((item, itemIndex) => itemIndex === index ? { ...item, text: text.slice(0, 2000) } : item);
                              void storeRules({ rules: next }).then((ok) => {
                                if (ok) setEditingRule(null);
                              });
                            }}
                          >
                            Save
                          </button>
                          <button type="button" className="ua-btn-line" style={{ padding: "8px 12px" }} onClick={() => setEditingRule(null)}>Cancel</button>
                        </div>
                      </div>
                    );
                  }
                  return (
                  <div key={`${index}-${short}`} className="flex flex-wrap items-start gap-2">
                    <button type="button" className={rule.on ? "ua-btn" : "ua-btn-line"} style={{ flex: "1 1 180px", textAlign: "left", padding: "8px 12px" }} onClick={() => setOpenRule(open ? null : index)}>
                      {open ? <span className="whitespace-pre-wrap font-normal">{rule.text}</span> : short}
                    </button>
                    <button
                      type="button"
                      className={rule.on ? "ua-btn" : "ua-btn-line"}
                      style={{ flex: "0 0 auto", padding: "8px 12px" }}
                      onClick={() => {
                        const next = savedRules.map((item, itemIndex) => itemIndex === index ? { ...item, on: !item.on } : item);
                        void storeRules({ rules: next });
                      }}
                    >
                      {rule.on ? "On" : "Off"}
                    </button>
                    <button
                      type="button"
                      className="ua-btn-line"
                      style={{ flex: "0 0 auto", padding: "8px 12px" }}
                      onClick={() => {
                        setEditingRule(index);
                        setEditDraft(rule.text);
                        setOpenRule(index);
                        setRulesSaved("");
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ua-btn-line"
                      style={{ flex: "0 0 auto", padding: "8px 12px" }}
                      onClick={() => {
                        const next = savedRules.filter((_, itemIndex) => itemIndex !== index);
                        setOpenRule(null);
                        setEditingRule(null);
                        void storeRules({ rules: next });
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  );
                })}
              </div>
            ))}
            {showBirthday && (
            <div className="flex items-start gap-2">
              <button type="button" className={birthdayCards ? "ua-btn" : "ua-btn-line"} style={{ flex: "1 1 auto", textAlign: "left", padding: "8px 12px" }}>
                Birthday cards each morning
              </button>
              <button type="button" className={birthdayCards ? "ua-btn" : "ua-btn-line"} style={{ flex: "0 0 auto", padding: "8px 12px" }} onClick={() => void storeRules({ birthdayCards: !birthdayCards })}>
                {birthdayCards ? "On" : "Off"}
              </button>
              <button type="button" className="ua-btn-line" style={{ flex: "0 0 auto", padding: "8px 12px" }} onClick={() => void storeRules({ showBirthday: false, birthdayCards: false })}>
                Remove
              </button>
            </div>
            )}
            {showNewsletter && (
            <div className="flex items-start gap-2">
              <button type="button" className={newsletterReminder ? "ua-btn" : "ua-btn-line"} style={{ flex: "1 1 auto", textAlign: "left", padding: "8px 12px" }}>
                Newsletter reminder after 30 days
              </button>
              <button type="button" className={newsletterReminder ? "ua-btn" : "ua-btn-line"} style={{ flex: "0 0 auto", padding: "8px 12px" }} onClick={() => void storeRules({ newsletterReminder: !newsletterReminder })}>
                {newsletterReminder ? "On" : "Off"}
              </button>
              <button type="button" className="ua-btn-line" style={{ flex: "0 0 auto", padding: "8px 12px" }} onClick={() => void storeRules({ showNewsletter: false, newsletterReminder: false })}>
                Remove
              </button>
            </div>
            )}
            <label className="grid gap-1 text-sm font-semibold">
              New rule
              <textarea value={ruleNote} onChange={(event) => { setRuleNote(event.target.value); setRulesSaved(""); }} maxLength={2000} rows={5} className="ua-field font-normal" placeholder="Write a new rule. The box stays empty after you save." />
            </label>
            <button type="submit" className="ua-btn" style={{ padding: "8px 12px", width: "fit-content" }}>Save rules</button>
            {rulesSaved && <p className="text-sm font-semibold" style={{ color: "#0d7a4f" }}>{rulesSaved}</p>}
          </form>
        ) : (
        <div className={`ua-assist${wideDesk && historyOpen ? " history-open" : ""}`}>
          {wideDesk && historyOpen && historyPane(false)}
          <div className="ua-assist-talk" id="ai-assistant-chat">
            <div className="ua-log-wrap">
            <div className="ua-assist-log" ref={logRef} onScroll={onLogScroll}>
              {turns.map((turn, index) => (
                <div key={`${turn.role}-${turn.id || index}`} className="rounded-lg px-4 py-3 text-sm" style={{ background: turn.role === "user" ? "#e8f4fd" : "#f7f9fc" }}>
                  <div className="flex items-baseline justify-between gap-3">
                    <strong>{turn.role === "user" ? "You" : "AI assistant"}</strong>
                    {stamp(turn.at) && <span className="text-xs" style={{ color: "#5a6a7a" }}>{stamp(turn.at)}</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{turn.role === "assistant" ? <AssistantText text={turn.content} /> : turn.content}</p>
                  {turn.previews && turn.previews.length > 0 && (
                    <div className="mt-3 grid gap-3">
                      {turn.previews.map((action) => (
                        <MailPreview key={action.id} action={action} busy={busy} onApprove={(id) => void approveAction(id)} onDiscard={(id) => void discardAction(id)} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {turns.length === 0 && <p className="text-sm" style={{ color: "#5a6a7a" }}>Ask who needs a call, whose yearly KYC is due, or where an upsell or cross-sell may exist.</p>}
            </div>
            {showJump && <button type="button" className="ua-btn ua-jump-latest" data-jump-latest onClick={() => {
              const log = logRef.current;
              stickRef.current = true;
              if (log) log.scrollTop = log.scrollHeight;
              setShowJump(false);
            }}>Latest</button>}
            </div>
            {trayActions.length > 0 && (
              <div className="ua-assist-tray grid gap-3 border-t p-3" style={{ borderColor: "#e1e8ef" }}>
                {trayActions.map((action) => (
                  <MailPreview key={action.id} action={action} busy={busy} onApprove={(id) => void approveAction(id)} onDiscard={(id) => void discardAction(id)} />
                ))}
              </div>
            )}
            {drafts.length > 0 && (
              <div className="ua-assist-drafts">
                <h2 className="text-lg font-semibold">Drafts waiting for approval</h2>
                <div className="mt-2 grid gap-3">
                  {drafts.map((draft) => (
                    <article key={draft.id} className="rounded-lg border p-3" style={{ borderColor: "#e1e8ef" }}>
                      <p className="text-sm font-semibold">To {draft.name || draft.to}</p>
                      <p className="text-sm" style={{ color: "#5a6a7a" }}>{draft.to}</p>
                      <p className="mt-2 font-semibold">{draft.subject}</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm">{draft.body}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" className="ua-btn" disabled={busy} onClick={() => void approve(draft.id)}>Approve and send</button>
                        <button type="button" className="ua-btn-line" disabled={busy} onClick={() => void discard(draft.id)}>Discard</button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
            <form onSubmit={(event) => {
              event.preventDefault();
              finishSpeech = null;
              stopAdvisorSpeech();
              void ask();
            }} className="ua-assist-compose" data-command-bar>
              {playbackNote && <p className="ua-playback-note" role="status" data-playback-note>{playbackNote}</p>}
              {voicePhase !== "error" && voiceLabel(voicePhase, voiceError) && <p className="text-sm font-extrabold" style={{ color: "#0f4c81" }}>{voiceLabel(voicePhase, "")}</p>}
              {choices.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {choiceNote ? <p className="w-full text-sm font-semibold" style={{ color: "#8a3a12" }}>{choiceNote}</p> : null}
                  {choices.map((choice) => (
                    <button key={choice} type="button" className="ua-btn-line" style={{ padding: "6px 12px" }} onClick={() => {
                      const transcript = transcriptChoice.current;
                      const pending = nameChoice.current;
                      if (transcript && choice === "Use this transcript") {
                        const line = correction.trim() || transcript.suggestion;
                        setChoices([]);
                        setChoiceNote("");
                        setCorrection("");
                        transcriptChoice.current = null;
                        setText(line);
                        void ask(line, { confirmed: true });
                        return;
                      }
                      setChoices([]);
                      setChoiceNote("");
                      setCorrection("");
                      nameChoice.current = null;
                      const line = !pending ? choice : choice === "Use what I said" ? pending.text : applyChosenName(pending.text, pending.start, pending.end, choice);
                      setText(line);
                      void ask(line);
                    }}>{choice}</button>
                  ))}
                  <input
                    value={correction}
                    onChange={(event) => setCorrection(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      event.stopPropagation();
                      const typed = correction.trim();
                      const transcript = transcriptChoice.current;
                      const pending = nameChoice.current;
                      if (transcript) {
                        const line = typed || transcript.suggestion;
                        if (!line) return;
                        setChoices([]);
                        setChoiceNote("");
                        setCorrection("");
                        transcriptChoice.current = null;
                        setText(line);
                        void ask(line, { confirmed: true });
                        return;
                      }
                      if (!typed || !pending) return;
                      setChoices([]);
                      setChoiceNote("");
                      setCorrection("");
                      nameChoice.current = null;
                      const line = applyChosenName(pending.text, pending.start, pending.end, typed);
                      setText(line);
                      void ask(line);
                    }}
                    placeholder={transcriptChoice.current ? "Correct the transcript" : "Type the correct name"}
                    className="ua-field"
                    style={{ maxWidth: transcriptChoice.current ? 420 : 220, padding: "6px 10px" }}
                  />
                  <button type="button" className="ua-btn" style={{ padding: "6px 12px" }} onClick={() => {
                    const typed = correction.trim();
                    const transcript = transcriptChoice.current;
                    const pending = nameChoice.current;
                    if (transcript) {
                      const line = typed || transcript.suggestion;
                      setChoices([]);
                      setChoiceNote("");
                      setCorrection("");
                      transcriptChoice.current = null;
                      setText(line);
                      void ask(line, { confirmed: true });
                      return;
                    }
                    if (!typed || !pending) return;
                    setChoices([]);
                    setChoiceNote("");
                    setCorrection("");
                    nameChoice.current = null;
                    const line = applyChosenName(pending.text, pending.start, pending.end, typed);
                    setText(line);
                    void ask(line);
                  }}>{transcriptChoice.current ? "Use this transcript" : "Use this name"}</button>
                </div>
              )}
              {pageCue && <p className="text-sm" style={{ color: "#5a6a7a" }}>Opened from {pageCue}.</p>}
              <textarea
                id="ai-assistant-input"
                value={text}
                onChange={(event) => setText(event.target.value)}
                onInput={(event) => {
                  const node = event.currentTarget;
                  node.style.height = "auto";
                  const limit = Number.parseFloat(getComputedStyle(node).maxHeight) || 132;
                  node.style.height = `${Math.min(node.scrollHeight, limit)}px`;
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.key === "Process") return;
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void ask();
                  }
                }}
                rows={2}
                maxLength={2000}
                placeholder="Ask the AI assistant"
                className="ua-field font-normal"
              />
              {error && <p className="ua-assist-note text-sm font-semibold" style={{ color: "#b42318" }}>{error}</p>}
              {playbackNote && <p className="ua-playback-note" data-playback-note>{playbackNote}</p>}
              <div className="ua-command-row">
                <span className="text-sm font-extrabold" style={{ color: "#0f4c81" }}>Grok 4.7</span>
                <button type="submit" className="ua-btn ua-ask" data-ask disabled={busy}>{busy ? "Thinking…" : "Ask"}</button>
                <button type="button" className="ua-btn-line" style={{ padding: "8px 12px" }} disabled={busy} onClick={() => void ask("List who has not been contacted for a long time, whose yearly KYC is due, and any upsell or cross-sell opportunities.")}>Review clients</button>
              </div>
            </form>
          </div>
        </div>
        )}
        {!wideDesk && historyOpen && !rulesOpen && (
          <div className="ua-history-backdrop" onClick={() => setHistoryOpen(false)}>
            {historyPane(true)}
          </div>
        )}
        {connectionNeeded(`${error} ${[...turns].reverse().find((turn) => turn.role === "assistant")?.content || ""}`) && (
          <p className="mt-3 text-sm font-semibold">
            That account is not connected.{" "}
            <button type="button" className="underline" style={{ color: "#0f4c81", fontWeight: 700 }} onClick={() => onOpenSettings?.()}>Connect in Settings</button>
          </p>
        )}
      </section>
    </div>
  );
}

function connectionNeeded(text: string) {
  return /not connected|not signed in|sign in with|no calendar is connected|no mailbox is connected/i.test(text);
}
