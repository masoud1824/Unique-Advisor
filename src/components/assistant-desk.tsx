import { useEffect, useRef, useState } from "react";
import { approveAssistantAction, approveAssistantDraft, askAssistant, deleteAssistantChat, discardAssistantAction, discardAssistantDraft, listAssistantActions, listAssistantDrafts, listAssistantMessages, runMorningCheck, saveAssistantRules, speakAssistant, startAssistantChat, transcribeAssistant, warmAssistantVoice } from "@/lib/assistant.functions";
import { assistantPieces, spokenReply } from "@/lib/assistant-reply";
import { spokenSummary } from "@/lib/assistant-operating";
import { applyChosenName, resolveSpokenContact, spokenNameOptions, type SpokenMatch } from "@/lib/contact-match";
import { isOnboardingDemo, showUnclearChoice } from "@/lib/advisor-intent";
import { refersToAppointment } from "@/lib/calendar-span";
import { keepUtterance } from "@/lib/speech-utterance";
import { AdvisorVoiceChooser } from "@/components/advisor-voice";
import { emptyTurn, pushRecognition, readVoiceAutoSend, shouldAutoSend, turnText, voiceDebugEnabled, type TurnState } from "@/lib/voice-turn";
import { appendVoiceLog } from "@/lib/voice-log.functions";
import type { DeskData } from "@/lib/site-types";

type Turn = { role: "user" | "assistant"; content: string; at?: string };
type Draft = { id: number; to: string; name: string; subject: string; body: string };
type Action = { id: number; kind: string; summary: string; preview?: string; previewHtml?: string; previewImage?: string };
type Chat = { id: number; title: string; at?: string };
type SavedRule = { id?: string; category?: string; text: string; on: boolean };

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
let advisorSpeaking = false;
let recognition: Heard | null = null;
let recorder: MediaRecorder | null = null;
let liveWords = true;
const chunks: Blob[] = [];
let restartListening: (() => void) | null = null;
let finishSpeech: (() => void) | null = null;
let voicePauseTimer = 0;
let latestDraft = "";
let speechGeneration = 0;
let playQueue: Promise<void> = Promise.resolve();
let clipsPlaying = 0;
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
  if (phase === "processing") return "Processing";
  if (phase === "speaking") return "Speaking";
  if (phase === "error") return `Error: ${error || "The microphone stopped."}`;
  return "";
}

function liveMic() {
  return Boolean(sharedStream?.getAudioTracks().some((track) => track.readyState === "live"));
}

async function ensureMic() {
  if (liveMic()) return sharedStream;
  voiceLog("mic-request");
  try {
    sharedStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    sharedStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  voiceLog("mic-ready");
  return sharedStream;
}

function micError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "Microphone permission was denied.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No microphone was found.";
  if (name === "NotReadableError") return "The microphone is in use by another app.";
  return "The microphone could not be started.";
}

function recognitionError(code: string) {
  if (code === "not-allowed" || code === "service-not-allowed") return "Microphone permission was denied.";
  if (code === "audio-capture") return "No microphone was found.";
  if (code === "network") return "The speech recognizer lost the network. Still listening.";
  if (code === "no-speech") return "";
  return "Speech recognition stopped. Still listening.";
}

export function markAdvisorSpeaking(on: boolean) {
  advisorSpeaking = on;
  if (on) {
    try { recognition?.abort?.(); } catch { /* paused while the assistant speaks */ }
    emitVoice({ phase: "speaking", error: "", listening: false, speaking: true });
    return;
  }
  if (keepListening) {
    emitVoice({ phase: "listening", error: "", listening: true, speaking: false });
    restartListening?.();
    return;
  }
  emitVoice({ phase: "off", error: "", listening: false, speaking: false });
}

function haltVoice() {
  voiceStopping = true;
  keepListening = false;
  finishSpeech = null;
  speechGeneration += 1;
  window.clearTimeout(voicePauseTimer);
  window.clearTimeout(listenTimer);
  speakToken += 1;
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
      window.setTimeout(done, 200);
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

export function playVoiceClip(base64: string, mime = "audio/mpeg") {
  clipsPlaying += 1;
  advisorSpeaking = true;
  try { recognition?.abort?.(); } catch { /* paused while the assistant speaks */ }
  emitVoice({ phase: "speaking", error: "", listening: false, speaking: true });
  playQueue = playQueue.then(() => new Promise<void>((resolve) => {
    const audio = new Audio(`data:${mime};base64,${base64}`);
    spokenAudio = audio;
    const finish = () => {
      clipsPlaying = Math.max(0, clipsPlaying - 1);
      if (clipsPlaying === 0) {
        advisorSpeaking = false;
        if (spokenAudio === audio) spokenAudio = null;
        if (keepListening) {
          emitVoice({ phase: "listening", error: "", listening: true, speaking: false });
          restartListening?.();
          voiceLog("resume-after-speech");
        } else emitVoice({ phase: "off", error: "", listening: false, speaking: false });
      }
      resolve();
    };
    audio.onended = finish;
    audio.onerror = () => {
      emitVoice({ phase: "error", error: "The spoken reply could not be played.", listening: false, speaking: false });
      finish();
    };
    audio.play().then(() => voiceLog("playback-start")).catch(() => {
      emitVoice({ phase: "error", error: "The spoken reply could not be played.", listening: false, speaking: false });
      finish();
    });
  }));
}

export function startAdvisorSpeech(
  onText: (text: string) => void,
  onStatus: (status: { listening: boolean; error: string; phase?: VoicePhase }) => void,
  options?: { slug: string; code: string; names?: string[]; onDraft?: (text: string) => void },
) {
  const generation = ++speechGeneration;
  voiceStopping = false;
  keepListening = true;
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
  let sending = false;
  const autoSend = readVoiceAutoSend();
  const names = (options.names || []).map((name) => name.trim()).filter(Boolean).slice(0, 100);

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

  const sendFinal = (text: string) => {
    window.clearTimeout(voicePauseTimer);
    const said = text.replace(/\s+/g, " ").trim();
    const key = said.toLowerCase();
    if (!said || (key === lastSent && Date.now() - lastAt < 4000)) return;
    lastSent = key;
    lastAt = Date.now();
    turn = emptyTurn();
    latestDraft = "";
    sending = true;
    keepListening = false;
    finishSpeech = null;
    emitVoice({ phase: "processing", error: "", listening: false, speaking: false });
    onStatus({ listening: false, error: "", phase: "processing" });
    draft(said);
    voiceLog("send", said.slice(0, 80));
    flushVoiceLog(said);
    onText(said);
  };

  const correct = async (fallback: string, blob: Blob | null) => {
    if (!blob || blob.size < 200) {
      if (fallback) sendFinal(fallback);
      else fail("Nothing was heard. Tap Talk, speak, then tap Stop.", false);
      return;
    }
    let sent = false;
    const timer = window.setTimeout(() => {
      if (sent) return;
      sent = true;
      voiceLog("send-browser");
      if (fallback) sendFinal(fallback);
      else fail("The recording could not be transcribed. Try again.", false);
    }, 8000);
    try {
      const audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || "").slice(String(reader.result || "").indexOf(",") + 1));
        reader.onerror = () => reject(new Error("The recording could not be read."));
        reader.readAsDataURL(blob);
      });
      const mime = blob.type.split(";")[0].trim() || (/iPhone|iPad|iPod/i.test(navigator.userAgent) ? "audio/mp4" : "audio/webm");
      const result = await transcribeAssistant({ data: { slug: options.slug, code: options.code, audio, mime, names } });
      if (!result.ok) {
        voiceLog("stt-error", result.error);
        if (!sent) {
          sent = true;
          window.clearTimeout(timer);
          if (fallback) sendFinal(fallback);
          else fail(result.error || "The recording could not be transcribed.", false);
        }
        return;
      }
      const combined = keepUtterance(fallback, result.text);
      voiceLog("server-correct", combined.slice(0, 80));
      draft(combined);
      if (!sent) {
        sent = true;
        window.clearTimeout(timer);
        sendFinal(combined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The recording could not be transcribed.";
      voiceLog("stt-error", message);
      if (!sent) {
        sent = true;
        window.clearTimeout(timer);
        if (fallback) sendFinal(fallback);
        else fail(message, false);
      }
    }
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
      if (event.data.size > 0 && !advisorSpeaking) chunks.push(event.data);
    };
    try { recorder.start(250); } catch { recorder.start(); }
  };

  const armRecognition = () => {
    if (voiceStopping || generation !== speechGeneration || !keepListening || advisorSpeaking) return;
    try { recognition?.abort?.(); } catch { /* one listener only */ }
    recognition = null;
    session += 1;
    if (session > 1) pushVoiceEvent({ at: new Date().toISOString(), type: "restart" });
    const speech = window as unknown as { SpeechRecognition?: new () => Heard; webkitSpeechRecognition?: new () => Heard };
    const Recognition = speech.SpeechRecognition || speech.webkitSpeechRecognition;
    if (!Recognition) return;
    const heard = new Recognition();
    heard.lang = "en-CA";
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
      const pieces = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const piece = event.results[index];
        pieces.push({ transcript: piece?.[0]?.transcript || "", isFinal: Boolean(piece?.isFinal) });
      }
      if (recognition === heard) pushVoiceEvent({ at: new Date().toISOString(), type: "result", resultIndex: Number(event.resultIndex || 0), results: pieces });
      if (generation !== speechGeneration || !keepListening || advisorSpeaking || recognition !== heard) return;
      if (voiceDebugEnabled()) console.info("[voice-stt]", { session, pieces });
      const next = pushRecognition(turn, session, pieces);
      turn = next.state;
      if (next.text) {
        draft(next.text);
        voiceLog("interim", next.text.slice(0, 80));
      }
      window.clearTimeout(voicePauseTimer);
      if (!autoSend) return;
      voicePauseTimer = window.setTimeout(() => {
        if (!keepListening || advisorSpeaking || sending) return;
        if (!shouldAutoSend(true, 3000)) return;
        const line = turnText(turn).trim();
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
      if (voiceStopping || generation !== speechGeneration || !keepListening || advisorSpeaking) return;
      if (recognition !== heard) return;
      listenTimer = window.setTimeout(() => {
        if (voiceStopping || !keepListening) return;
        armRecognition();
      }, 200);
    };
    recognition = heard;
    try {
      heard.start();
      emitVoice({ phase: "listening", error: "", listening: true, speaking: false });
      onStatus({ listening: true, error: "", phase: "listening" });
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
    const line = turnText(turn).trim();
    keepListening = false;
    voiceStopping = true;
    finishSpeech = null;
    try { recognition?.abort?.(); } catch { /* stopping */ }
    recognition = null;
    if (sending) {
      haltVoice();
      return;
    }
    emitVoice({ phase: "processing", error: "", listening: false, speaking: false });
    onStatus({ listening: false, error: "", phase: "processing" });
    voiceLog("stop-send");
    void takeRecording().then((blob) => correct(line, blob));
  };
  restartListening = () => {
    if (!keepListening || advisorSpeaking) return;
    sending = false;
    armRecognition();
  };

  void (async () => {
    try {
      const stream = await ensureMic();
      if (generation !== speechGeneration || !keepListening || !stream) {
        if (generation === speechGeneration && keepListening) fail("The microphone could not be started.", false);
        return;
      }
      armRecorder(stream);
      const speech = window as unknown as { SpeechRecognition?: new () => Heard; webkitSpeechRecognition?: new () => Heard };
      liveWords = Boolean(speech.SpeechRecognition || speech.webkitSpeechRecognition);
      if (!liveWords && typeof MediaRecorder === "undefined") {
        fail("This browser cannot record speech. Use Safari or Chrome, then tap Talk again.", false);
        return;
      }
      if (liveWords) armRecognition();
      else {
        voiceLog("record-only");
        emitVoice({ phase: "listening", error: "", listening: true, speaking: false });
        onStatus({ listening: true, error: "", phase: "listening" });
      }
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
  const askRef = useRef<(line?: string) => Promise<void>>(async () => {});
  const newChatRef = useRef<() => Promise<void>>(async () => {});
  const chatIdRef = useRef(0);
  const busyRef = useRef(false);
  const nameChoice = useRef<{ text: string; start: number; end: number } | null>(null);
  const pendingVoice = useRef<string[]>([]);
  const lastQuestion = useRef("");
  const generation = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => subscribeAdvisorDraft((said) => {
    setText(said);
    setHeard(said);
  }), []);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const pin = () => {
      const preview = log.querySelector(".ua-mail-preview");
      if (preview instanceof HTMLElement) {
        log.scrollTop = Math.max(0, preview.offsetTop - 8);
        return;
      }
      log.scrollTop = log.scrollHeight;
    };
    pin();
    const frame = requestAnimationFrame(pin);
    return () => cancelAnimationFrame(frame);
  }, [turns, busy, chatId, rulesOpen, actions.length]);

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
    if (pending.ok) setActions(pending.actions);
    if (history.ok) {
      setTurns(history.messages);
      setChats(history.chats);
      setChatId(history.chatId);
      if (!rulesOpenRef.current) {
        setBirthdayCards(history.rules.birthdayCards);
        setNewsletterReminder(history.rules.newsletterReminder);
      }
      setSavedRules(asRules(history.rules.rules));
      setShowBirthday(history.rules.showBirthday !== false);
      setShowNewsletter(history.rules.showNewsletter !== false);
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
      document.getElementById("ai-assistant-chat")?.scrollIntoView({ block: "start" });
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

  function friendlyLine(message: string) {
    return spokenSummary(spokenReply(message));
  }

  function choiceList(message: string) {
    const quoted = [...message.matchAll(/"([^"]{2,48})"|'([^']{2,48})'/g)].map((hit) => (hit[1] || hit[2] || "").trim()).filter(Boolean);
    if (quoted.length >= 2) return quoted.slice(0, 3);
    if (/\b(yes|confirm|book|time)\b/i.test(message)) return ["Yes", "No", "Change the time"];
    return ["Yes", "No"];
  }

  function browserVoice(message: string) {
    const voice = window.speechSynthesis;
    if (!voice) {
      markAdvisorSpeaking(false);
      setSpeaking(false);
      onVoice?.({ listening, speaking: false });
      return;
    }
    voice.cancel();
    const line = new SpeechSynthesisUtterance(message);
    line.lang = "en-CA";
    line.rate = 0.96;
    line.pitch = 1.04;
    const warm = voice.getVoices().find((item) => /google uk english female|samantha|moira|karen|female/i.test(`${item.name} ${item.lang}`));
    if (warm) line.voice = warm;
    const done = () => {
      markAdvisorSpeaking(false);
      setSpeaking(false);
      onVoice?.({ listening, speaking: false });
    };
    line.onend = done;
    line.onerror = done;
    voice.speak(line);
  }

  async function speak(message: string) {
    const line = friendlyLine(message);
    if (!line) return;
    spokenAudio?.pause();
    const token = ++speakToken;
    markAdvisorSpeaking(true);
    setSpeaking(true);
    onVoice?.({ listening, speaking: true });
    const result = await speakAssistant({ data: { slug: desk.slug, code, text: line } }).catch(() => null);
    if (token !== speakToken) {
      markAdvisorSpeaking(false);
      return;
    }
    if (result?.ok && result.audio) {
      const audio = new Audio(`data:${result.mime};base64,${result.audio}`);
      spokenAudio = audio;
      const done = () => {
        if (spokenAudio === audio) spokenAudio = null;
        markAdvisorSpeaking(false);
        setSpeaking(false);
        onVoice?.({ listening, speaking: false });
      };
      audio.onended = done;
      audio.onerror = () => browserVoice(line);
      try {
        await audio.play();
        return;
      } catch {
        /* fall through to the browser voice */
      }
    }
    browserVoice(line);
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

  async function askByVoice(content: string, id: number, mine: number) {
    setTurns((current) => [...current, { role: "assistant", content: "", at: new Date().toISOString() }]);
    let played = false;
    let reply = "";
    let actions: Action[] = [];
    let finished = false;
    try {
      const response = await fetch("/api/assistant/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: desk.slug, code, chatId: id, page: pageCue, content }),
      });
      if (!response.ok || !response.body) return null;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      while (true) {
        const step = await reader.read();
        if (mine !== generation.current) return { ok: true as const, reply, actions: [] as Action[], played: true };
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
          } else if (event.type === "audio" && event.audio) {
            played = true;
            playVoiceClip(event.audio, event.mime || "audio/mpeg");
          } else if (event.type === "error") {
            return { ok: false as const, error: event.error || "The assistant could not answer.", played };
          } else if (event.type === "tts-error") {
            setError(event.error || "The spoken reply could not be played.");
          } else if (event.type === "done") {
            reply = event.reply || reply;
            actions = event.actions || [];
            finished = true;
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, content: reply };
              return next;
            });
          }
        }
      }
      return reply || finished ? { ok: true as const, reply, actions, played } : null;
    } catch (error) {
      setError(error instanceof Error ? error.message : "The assistant could not answer.");
      return null;
    }
  }

  function contactNames() {
    return (desk.contacts || []).map((contact) => ({ id: contact.id, name: contact.fullName }));
  }

  function showNameChoices(original: string, names: string[], question: string, start: number, end: number) {
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

  function hear(text: string) {
    if (isOnboardingDemo(text) || refersToAppointment(text)) {
      nameChoice.current = null;
      setHeard(text);
      setText(text);
      void askRef.current(text);
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
    const line = hit.kind === "one" ? hit.text : text;
    setHeard(line);
    setText(line);
    void askRef.current(line);
  }

  async function ask(spoken?: string) {
    const content = (spoken ?? text).trim();
    if (!content) return;
    if (spoken) {
      setText(content);
      setHeard(content);
    }
    if (busyRef.current) {
      if (spoken) pendingVoice.current.push(content);
      return;
    }
    busyRef.current = true;
    const mine = generation.current;
    setChoices([]);
    setChoiceNote("");
    setTurns((current) => [...current, { role: "user", content, at: new Date().toISOString() }]);
    if (spoken) setText(content);
    else setText("");
    setBusy(true);
    setError("");
    const id = chatIdRef.current;
    const failed = (message: string) => {
      const line = message || "Sorry, something went wrong — please try again.";
      setError(line);
      setTurns((current) => [...current, { role: "assistant", content: line, at: new Date().toISOString() }]);
    };
    try {
      setChats((current) => current.map((chat) => chat.id === id && (chat.title === "New chat" || !chat.title.trim()) ? { ...chat, title: content.replace(/\s+/g, " ").slice(0, 42), at: new Date().toISOString() } : chat));
      const streamed = spoken ? await askByVoice(content, id, mine) : null;
      const result = streamed || await askAssistant({ data: { slug: desk.slug, code, chatId: id, page: pageCue, messages: [{ role: "user", content }] } });
      if (mine !== generation.current) return;
      if (spoken) setText("");
      if (!result?.ok) {
        const names = nameChoicesFrom(result?.error || "");
        if (names.length) {
          const hit = resolveSpokenContact(content, names.map((name, index) => ({ id: index, name })));
          showNameChoices(content, names, result?.error || "Which contact?", hit.kind === "one" || hit.kind === "many" ? hit.start : content.length, hit.kind === "one" || hit.kind === "many" ? hit.end : content.length);
          setError("");
        } else failed(result?.error || "Sorry, something went wrong — please try again.");
        resumeAdvisorListening();
      } else if (!result.reply?.trim()) {
        failed("Sorry, something went wrong — please try again.");
      } else {
        const bookingAsk = /shall i book it\?/i.test(result.reply);
        const cardAsk = /just to confirm:/i.test(result.reply);
        const repeated = showUnclearChoice(content, lastQuestion.current, result.reply);
        if (bookingAsk) {
          lastQuestion.current = result.reply;
          setChoiceNote("");
          setChoices(["Yes", "Change time"]);
          if (spoken && !streamed?.played) speak(result.reply);
        } else if (cardAsk) {
          lastQuestion.current = result.reply;
          setChoiceNote("");
          setChoices(["Yes", "No"]);
          if (spoken && !streamed?.played) speak(result.reply);
        } else if (repeated) {
          setChoiceNote("That was not clear. Choose one:");
          setChoices(choiceList(result.reply));
        } else {
          lastQuestion.current = result.reply;
          setChoices([]);
          setChoiceNote("");
          if (spoken && !streamed?.played) speak(result.reply);
        }
        await refresh(id);
        if (mine !== generation.current) return;
        if (result.actions?.length) {
          const fresh = result.actions;
          setActions((current) => [...fresh, ...current.filter((item) => !fresh.some((next) => next.id === item.id))]);
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
    if (next && mine === generation.current) void ask(next);
  }

  askRef.current = ask;

  function listen() {
    if (hearing || listening || advisorVoiceOn()) {
      stopAdvisorSpeech();
      return;
    }
    startAdvisorSpeech(
      (said) => hear(said),
      (status) => {
        setListening(status.phase === "listening" || status.phase === "processing");
        if (status.error) setError(status.error);
      },
      { slug: desk.slug, code, names: (desk.contacts || []).map((contact) => contact.fullName) },
    );
  }

  const voiceSeen = useRef(0);
  useEffect(() => {
    if (!voiceCue || voiceSeen.current === voiceCue) return;
    voiceSeen.current = voiceCue;
    listen();
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
    const line = result.ok ? result.detail : result.error;
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

  return (
    <div className="grid gap-4">
      <section id="ai-assistant" className="ua-panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">AI assistant</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={rulesOpen ? "ua-btn-line" : "ua-btn"} style={{ padding: "6px 12px" }} onClick={() => setRulesOpen(false)}>Chats</button>
            <button type="button" className={rulesOpen ? "ua-btn" : "ua-btn-line"} style={{ padding: "6px 12px" }} onClick={openRules}>Rules</button>
          </div>
        </div>
        {rulesOpen ? (
          <form onSubmit={(event) => void saveRules(event)} className="mt-4 grid gap-3 rounded-lg border p-4" style={{ borderColor: "#e1e8ef" }}>
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
        <div className="ua-assist">
          <aside className="ua-assist-list">
            <p className="ua-assist-head">Previous chats</p>
            <div className="ua-assist-chats" ref={listRef}>
              {chats.length === 0 && <p className="px-3 py-3 text-sm" style={{ color: "#5a6a7a" }}>No earlier chats.</p>}
              {chats.map((chat) => (
                <div key={chat.id} className={`ua-assist-row ${chat.id === chatId ? "on" : ""}`}>
                  <button type="button" className="title" onClick={() => void refresh(chat.id)}>
                    <span className="name">{chat.title && chat.title !== "New chat" ? chat.title : "Untitled"}</span>
                    {stamp(chat.at) && <span className="when">{stamp(chat.at)}</span>}
                  </button>
                  <button type="button" className="remove" onClick={() => void removeChat(chat.id)}>Remove</button>
                </div>
              ))}
            </div>
          </aside>
          <div className="ua-assist-talk" id="ai-assistant-chat" style={actions.length > 0 ? { height: "auto", overflow: "visible" } : undefined}>
            <p className="ua-assist-head">This chat</p>
            <div className="ua-assist-log" ref={logRef} style={actions.length > 0 ? { maxHeight: 220, flex: "none" } : undefined}>
              {turns.map((turn, index) => (
                <div key={`${turn.role}-${index}`} className="rounded-lg px-4 py-3 text-sm" style={{ background: turn.role === "user" ? "#e8f4fd" : "#f7f9fc" }}>
                  <div className="flex items-baseline justify-between gap-3">
                    <strong>{turn.role === "user" ? "You" : "AI assistant"}</strong>
                    {stamp(turn.at) && <span className="text-xs" style={{ color: "#5a6a7a" }}>{stamp(turn.at)}</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{turn.role === "assistant" ? <AssistantText text={turn.content} /> : turn.content}</p>
                </div>
              ))}
              {turns.length === 0 && <p className="text-sm" style={{ color: "#5a6a7a" }}>Ask who needs a call, whose yearly KYC is due, or where an upsell or cross-sell may exist.</p>}
            </div>
            {actions.length > 0 && (
              <div ref={(node) => { if (node) node.scrollIntoView({ block: "nearest" }); }} className="ua-mail-preview grid gap-3 border-t p-3" style={{ borderColor: "#e1e8ef" }}>
                {actions.map((action) => (
                  <article key={action.id} className="rounded-lg border p-3" style={{ borderColor: "#b42318", background: "#fff8f6" }}>
                    <p className="text-sm font-extrabold" style={{ color: "#b42318" }}>{action.kind === "card" ? "E-card preview" : action.kind === "eletter" ? "E-letter preview" : action.kind === "newsletter" ? "Newsletter preview" : action.kind === "campaign" ? "Campaign preview" : "Waiting for approval"}</p>
                    <p className="mt-1 text-sm font-semibold">{action.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className="ua-btn" disabled={busy} onClick={() => void approveAction(action.id)}>{action.kind === "campaign" ? "Run the campaign" : action.kind === "card" || action.kind === "eletter" || action.kind === "newsletter" ? "Approve and send" : "Approve"}</button>
                      <button type="button" className="ua-btn-line" disabled={busy} onClick={() => void discardAction(action.id)}>Discard</button>
                    </div>
                    {action.previewImage && (
                      <img src={action.previewImage} alt="" className="mt-3 w-full rounded-lg border bg-white" style={{ borderColor: "#e1e8ef" }} />
                    )}
                    {action.previewHtml ? (
                      <iframe title="Mail preview" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={action.previewHtml} className="mt-3 w-full rounded-lg border bg-white" style={{ height: 640, borderColor: "#e1e8ef" }} />
                    ) : (
                      action.preview && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-white p-4 text-sm">{action.preview}</p>
                    )}
                  </article>
                ))}
              </div>
            )}
            <form onSubmit={(event) => {
              event.preventDefault();
              finishSpeech = null;
              stopAdvisorSpeech();
              void ask();
            }} className="ua-assist-compose">
              {voiceLabel(voicePhase, voiceError) && <p className="text-sm font-extrabold" style={{ color: voicePhase === "error" ? "#b42318" : "#0f4c81" }}>{voiceLabel(voicePhase, voiceError)}</p>}
              {choices.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {choiceNote ? <p className="w-full text-sm font-semibold" style={{ color: "#8a3a12" }}>{choiceNote}</p> : null}
                  {choices.map((choice) => (
                    <button key={choice} type="button" className="ua-btn-line" style={{ padding: "6px 12px" }} onClick={() => {
                      const pending = nameChoice.current;
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
                      const pending = nameChoice.current;
                      if (!typed || !pending) return;
                      setChoices([]);
                      setChoiceNote("");
                      setCorrection("");
                      nameChoice.current = null;
                      const line = applyChosenName(pending.text, pending.start, pending.end, typed);
                      setText(line);
                      void ask(line);
                    }}
                    placeholder="Type the correct name"
                    className="ua-field"
                    style={{ maxWidth: 220, padding: "6px 10px" }}
                  />
                  <button type="button" className="ua-btn" style={{ padding: "6px 12px" }} onClick={() => {
                    const typed = correction.trim();
                    const pending = nameChoice.current;
                    if (!typed || !pending) return;
                    setChoices([]);
                    setChoiceNote("");
                    setCorrection("");
                    nameChoice.current = null;
                    const line = applyChosenName(pending.text, pending.start, pending.end, typed);
                    setText(line);
                    void ask(line);
                  }}>Use this name</button>
                </div>
              )}
              {pageCue && <p className="text-sm" style={{ color: "#5a6a7a" }}>Opened from {pageCue}.</p>}
              {heard && <p className="text-sm" style={{ color: "#5a6a7a" }}>You said: {heard}</p>}
              <AdvisorVoiceChooser slug={desk.slug} code={code} />
              <textarea
                id="ai-assistant-input"
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void ask();
                  }
                }}
                rows={3}
                maxLength={2000}
                placeholder="Ask the AI assistant"
                className="ua-field font-normal"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="ua-btn" style={{ padding: "6px 12px", fontSize: "0.85rem", background: listening ? "#b42318" : "#0f4c81" }} onClick={() => listen()}>{listening ? "Stop" : "Voice command"}</button>
                <button type="button" className="ua-btn-line" style={{ padding: "6px 12px", fontSize: "0.85rem" }} disabled={busy} onClick={() => void ask("List who has not been contacted for a long time, whose yearly KYC is due, and any upsell or cross-sell opportunities.")}>Review clients</button>
                <button type="submit" className="ua-btn" style={{ padding: "6px 12px", fontSize: "0.85rem" }} disabled={busy}>{busy ? "Working…" : "Ask"}</button>
                <button type="button" className="ua-btn-line" style={{ padding: "6px 12px", fontSize: "0.85rem" }} onClick={() => void newChat()}>New chat</button>
              </div>
            </form>
          </div>
        </div>
        )}
        {error && <p className="mt-3 text-sm font-semibold" style={{ color: "#b42318" }}>{error}</p>}
        {connectionNeeded(`${error} ${[...turns].reverse().find((turn) => turn.role === "assistant")?.content || ""}`) && (
          <p className="mt-3 text-sm font-semibold">
            That account is not connected.{" "}
            <button type="button" className="underline" style={{ color: "#0f4c81", fontWeight: 700 }} onClick={() => onOpenSettings?.()}>Connect in Settings</button>
          </p>
        )}
      </section>
      {drafts.length > 0 && (
        <section className="ua-panel p-6">
          <h2 className="text-lg font-semibold">Drafts waiting for approval</h2>
          <div className="mt-4 grid gap-4">
            {drafts.map((draft) => (
              <article key={draft.id} className="rounded-lg border p-4" style={{ borderColor: "#e1e8ef" }}>
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
        </section>
      )}
    </div>
  );
}

function connectionNeeded(text: string) {
  return /not connected|not signed in|sign in with|no calendar is connected|no mailbox is connected/i.test(text);
}
