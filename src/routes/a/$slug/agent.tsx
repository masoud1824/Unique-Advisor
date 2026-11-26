import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { transcribeAssistant } from "@/lib/assistant.functions";
import { ASSISTANT_CAPABILITIES, ASSISTANT_NAME } from "@/lib/agent/assistant-capabilities";
import { echoesAssistantReply, phaseAfterStop, sameTurnGuard, type VoicePhase } from "@/lib/agent/voice-bridge";
import { decideTranscript, microphoneTestReport, transcriptionPrompt } from "@/lib/transcript-guard";
import { beginPlayback, emptyPlayback, shouldCaptureSpeech, shouldResumeAfterSpeech, stopPlayback, type PlaybackState } from "@/lib/voice-desk";

type Approval = { hash: string; payload: { advisorId: string; clientName: string; formCode: string; destination: string; factsHash: string } };
type Turn = {
  ok?: boolean;
  reply?: string;
  reason?: string;
  error?: string;
  runId?: string;
  sessionToken?: string;
  missing?: string[];
  readBack?: Record<string, string>;
  approval?: Approval | null;
  approvalStatus?: string;
  preview?: boolean;
  formTitle?: string;
  formHref?: string;
  dropbox?: { connected: boolean; uploaded: boolean; reason: string };
  calledModel?: boolean;
  code?: string;
  requestedModel?: string;
  returnedModel?: string;
};
type Line = { role: "user" | "assistant"; text: string };
type AuthState = "locked" | "checking" | "open" | "error";

const fieldStyle = {
  display: "block",
  width: "100%",
  maxWidth: "36rem",
  boxSizing: "border-box" as const,
  border: "1px solid #8a8175",
  background: "#fff",
  color: "#1d1b16",
  borderRadius: 8,
  padding: "10px 12px",
  minHeight: 44,
  font: "16px/1.4 Georgia, serif",
};
const buttonStyle = {
  appearance: "auto" as const,
  border: "1px solid #14324f",
  borderRadius: 8,
  background: "#14324f",
  color: "#fff",
  padding: "10px 16px",
  minHeight: 44,
  font: "600 16px/1 system-ui, sans-serif",
  cursor: "pointer",
};

const NAMES = ["Avery Example", "Blake Example"];

export const Route = createFileRoute("/a/$slug/agent")({
  component: AgentPreview,
});

export function DeskAssistant({ slug, code }: { slug: string; code: string }) {
  return <AgentPanel slug={slug} initialCode={code} embedded />;
}

function AgentPreview() {
  const { slug } = Route.useParams();
  return <AgentPanel slug={slug} />;
}

function AgentPanel({ slug, initialCode = "", embedded = false }: { slug: string; initialCode?: string; embedded?: boolean }) {
  const [code, setCode] = useState(initialCode);
  const [sessionToken, setSessionToken] = useState("");
  const [auth, setAuth] = useState<AuthState>(embedded && initialCode ? "checking" : "locked");
  const [text, setText] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [note, setNote] = useState("");
  const [usage, setUsage] = useState<{ planLabel?: string; measuredTokens?: number; stopped?: boolean; warnings?: number[]; paymentNote?: string; checkout?: string } | null>(null);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const phaseRef = useRef<VoicePhase>("idle");
  const playRef = useRef<PlaybackState>(emptyPlayback());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const busyRef = useRef(false);
  const lastSent = useRef({ text: "", at: 0 });
  const finishRef = useRef<(() => Promise<void>) | null>(null);
  const cancelListen = useRef(false);
  const runId = turn?.runId || "";

  function setLive(next: VoicePhase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function stopAll() {
    playRef.current = stopPlayback(playRef.current);
    audioRef.current?.pause();
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    window.speechSynthesis?.cancel();
    abortRef.current?.abort();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    busyRef.current = false;
    setNote("Stopped. Nothing else was started.");
    setLive(phaseAfterStop());
    if (shouldResumeAfterSpeech()) setNote("Listening resumed.");
  }

  async function refreshPreview(next: Turn, access: string, token: string) {
    if (!next.preview || !next.runId) {
      setPreviewUrl("");
      return;
    }
    const response = await fetch("/api/agent/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, code: access, sessionToken: token, runId: next.runId }),
    });
    if (!response.ok || !(response.headers.get("content-type") || "").includes("pdf")) {
      setNote("The draft preview was not ready.");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return url;
    });
  }

  async function playLine(line: string, manual: boolean) {
    const spoken = line.replace(/\s+/g, " ").trim();
    if (!spoken) return;
    const next = beginPlayback(playRef.current, { replyKey: spoken, manual });
    playRef.current = next.state;
    if (!next.accept) return;
    const owner = next.owner;
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    setLive("preparing");
    setNote("");
    try {
      const response = await fetch("/api/agent/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, code, sessionToken, runId, line: spoken }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string; voice?: string; parts?: string[] };
      if (playRef.current.owner !== owner) return;
      if (!response.ok || result.ok === false || !result.parts?.length) {
        setNote(result.error || "The selected voice did not finish. Press Play reply. A different voice was not used.");
        setLive("error");
        return;
      }
      for (const part of result.parts) {
        if (playRef.current.owner !== owner) return;
        const bytes = Uint8Array.from(atob(part), (char) => char.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
        const audio = new Audio(url);
        audioRef.current = audio;
        setLive("speaking");
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("The selected voice stopped before the reply finished."));
          audio.play().catch(reject);
        });
        URL.revokeObjectURL(url);
      }
      if (playRef.current.owner === owner) setLive("idle");
    } catch (error) {
      if (playRef.current.owner !== owner) return;
      audioRef.current?.pause();
      setNote(error instanceof Error ? error.message : "The selected voice did not finish. Press Play reply. A different voice was not used.");
      setLive("error");
    }
  }

  async function openAssistant(event?: FormEvent) {
    event?.preventDefault();
    if (!code.trim()) {
      setAuth("error");
      setNote("Enter the advisor access code, then press Open assistant.");
      return;
    }
    setAuth("checking");
    setNote("Checking the access code…");
    try {
      const response = await fetch("/api/agent/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, code, sessionToken, intent: "open" }),
      });
      const result = (await response.json()) as Turn;
      if (!response.ok || result.ok === false) {
        setSessionToken("");
        setAuth("error");
        setNote(result.error || result.reason || "That access code is not right.");
        return;
      }
      if (result.sessionToken) setSessionToken(result.sessionToken);
      setAuth("open");
      setNote("Signed in. Type a request and press Send.");
      void fetch("/api/agent/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, code, sessionToken: result.sessionToken, intent: "usage" }),
      }).then((item) => item.json()).then((item) => setUsage(item.usage || null)).catch(() => setUsage(null));
    } catch {
      setAuth("error");
      setNote("The access code could not be checked. Nothing was changed.");
    }
  }

  const deskCode = useRef(initialCode);
  useEffect(() => {
    if (!embedded || !deskCode.current) return;
    void openAssistant();
  }, [embedded]);

  function onRequestKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send(text, "typed");
  }

  async function send(message: string, source: "typed" | "voice") {
    const clean = message.replace(/\s+/g, " ").trim();
    const guard = sameTurnGuard({ busy: busyRef.current, previous: lastSent.current.text, text: clean, elapsedMs: Date.now() - lastSent.current.at });
    if (!clean || !guard.accept) {
      if (guard.reason === "duplicate") setNote("That was already sent. I did not run it again.");
      return;
    }
    if (auth !== "open") {
      setNote("The request box is locked until the access code is accepted.");
      return;
    }
    busyRef.current = true;
    lastSent.current = { text: clean, at: Date.now() };
    setLines((current) => [...current, { role: "user", text: clean }]);
    setLive("thinking");
    setNote("");
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const response = await fetch("/api/agent/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, code, sessionToken, runId, text: clean, source }),
        signal: abort.signal,
      });
      const result = (await response.json()) as Turn;
      if (result.sessionToken) setSessionToken(result.sessionToken);
      if (result.runId) setTurn(result);
      else setTurn(result);
      const reply = String(result.reply || result.reason || result.error || "").trim();
      if (!response.ok || result.ok === false) {
        setNote(reply || "The agent did not answer. Nothing was changed.");
        setLive("error");
        return;
      }
      if (reply) setLines((current) => [...current, { role: "assistant", text: reply }]);
      await refreshPreview(result, code, result.sessionToken || sessionToken);
      if (reply) void playLine(reply, false);
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        setNote("Stopped. Nothing else was started.");
        setLive("idle");
        return;
      }
      setNote("The request did not finish. The draft was not changed. You can type it again.");
      setLive("error");
    } finally {
      busyRef.current = false;
    }
  }

  function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  async function listen() {
    if (!shouldCaptureSpeech({ explicitListen: true, speaking: phaseRef.current === "speaking", preparing: phaseRef.current === "preparing" || phaseRef.current === "thinking" })) {
      setNote("Wait until speaking finishes, then tap Voice command.");
      return;
    }
    setNote("");
    cancelListen.current = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const name = (error as { name?: string }).name || "";
      const decision = decideTranscript({ audioBytes: 0, prompt: transcriptionPrompt(NAMES), permissionDenied: name === "NotAllowedError" || name === "SecurityError", noDevice: name === "NotFoundError" });
      setNote(decision.post ? "" : decision.message);
      setLive("error");
      return;
    }
    streamRef.current = stream;
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start();
    setLive("listening");
    finishRef.current = async () => {
      finishRef.current = null;
      if (recorder.state !== "inactive") recorder.stop();
      stream.getTracks().forEach((track) => track.stop());
      await stopped;
      if (cancelListen.current) {
        setNote("Stopped. Nothing was sent.");
        setLive("idle");
        return;
      }
      setLive("transcribing");
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let serverText = "";
      let serverOk = false;
      let serverError = "";
      try {
        const result = await transcribeAssistant({ data: { slug, code, audio: bytesToBase64(bytes), mime: blob.type || "audio/webm", names: NAMES, language: "en" } });
        serverOk = Boolean(result && "ok" in result && result.ok);
        serverText = serverOk && result && "text" in result ? String(result.text || "") : "";
        serverError = !serverOk && result && "error" in result ? String(result.error || "") : "";
      } catch {
        serverError = "The recording could not be transcribed. Try again.";
      }
      const decision = decideTranscript({
        audioBytes: bytes.length,
        prompt: transcriptionPrompt(NAMES),
        names: NAMES,
        serverText,
        serverOk,
        serverError,
        cancelled: cancelListen.current,
      });
      if (!decision.post) {
        setNote(decision.message);
        setLive(decision.message ? "error" : "idle");
        return;
      }
      const last = [...lines].reverse().find((line) => line.role === "assistant")?.text || "";
      if (echoesAssistantReply(decision.text, last)) {
        setNote("That matched the reply that was just spoken. I did not treat it as a new command.");
        setLive("idle");
        return;
      }
      setText(decision.text);
      await send(decision.text, "voice");
    };
  }

  async function testMic() {
    setNote("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.start();
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      recorder.stop();
      await new Promise((resolve) => { recorder.onstop = () => resolve(null); });
      const size = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
      stream.getTracks().forEach((item) => item.stop());
      const report = microphoneTestReport({
        deviceLabel: track?.label,
        trackState: track?.readyState,
        bytes: size,
        mime: recorder.mimeType,
        level: size > 1000 ? 0.05 : 0,
        recognition: typeof window !== "undefined" && "MediaRecorder" in window,
      });
      setNote(report.message);
      setLive("idle");
    } catch (error) {
      const report = microphoneTestReport({ errorName: (error as { name?: string }).name || "NotAllowedError" });
      setNote(report.message);
      setLive("error");
    }
  }

  async function decide(decision: "approve" | "deny") {
    if (!turn?.approval) return;
    setLive("thinking");
    const response = await fetch("/api/agent/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, code, sessionToken, runId: turn.runId, decision, payload: turn.approval.payload }),
    });
    const result = (await response.json()) as Turn;
    setTurn(result);
    const reply = String(result.reply || result.reason || result.error || "");
    if (reply) setLines((current) => [...current, { role: "assistant", text: reply }]);
    setLive("idle");
  }

  const missing = turn?.missing || [];
  const readBack = Object.entries(turn?.readBack || {});
  return (
    <main className={embedded ? "agent-preview agent-embedded" : "agent-preview"}>
      <style>{`
        .agent-preview { min-height: 100vh; box-sizing: border-box; padding: 16px; background: #f4f1ea; color: #1d1b16; font: 16px/1.45 Georgia, serif; }
        .agent-preview.agent-embedded { min-height: 0; padding: 0; background: transparent; }
        .agent-preview * { box-sizing: border-box; }
        .agent-preview h1 { font-size: 1.3rem; margin: 0 0 4px; }
        .agent-preview .eyebrow { margin: 0; font: 600 0.75rem/1.2 system-ui, sans-serif; letter-spacing: 0.04em; text-transform: uppercase; color: #6b6458; }
        .agent-preview .caps { background: white; border: 1px solid #d9d2c5; border-radius: 12px; padding: 8px 12px; margin: 8px 0 12px; }
        .agent-preview .caps li { margin: 4px 0; }
        .agent-preview .testing { color: #6a4b16; }
        .agent-preview .unavailable { color: #6b6458; }
        .agent-preview .status { font-weight: 700; text-transform: capitalize; }
        .agent-preview .note { color: #8a2b1f; min-height: 1.2em; }
        .agent-preview .log { background: white; border: 1px solid #d9d2c5; border-radius: 12px; min-height: 180px; max-height: 36vh; overflow: auto; padding: 12px; }
        .agent-preview .row { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
        .agent-preview button, .agent-preview textarea, .agent-preview input { font: inherit; }
        .agent-preview input, .agent-preview textarea { display: block; width: 100%; max-width: 36rem; border: 1px solid #8a8175; background: #fff; color: #1d1b16; border-radius: 8px; padding: 10px 12px; min-height: 44px; }
        .agent-preview textarea { min-height: 96px; }
        .agent-preview button { appearance: auto; border: 1px solid #14324f; border-radius: 8px; background: #14324f; color: #fff; padding: 10px 16px; min-height: 44px; }
        .agent-preview button:disabled, .agent-preview textarea:disabled, .agent-preview input:disabled { opacity: 0.7; }
        .agent-preview label { display: block; font-weight: 700; margin: 10px 0 4px; }
        .agent-preview iframe { width: 100%; height: 480px; border: 1px solid #d9d2c5; background: white; }
        .agent-preview .you { color: #3d4a3a; }
      `}</style>
      <p className="eyebrow">Agent Preview</p>
      <h1>{ASSISTANT_NAME}</h1>
      <p className="status" role="status">{auth === "checking" ? "Checking the access code" : auth === "open" ? "Signed in" : auth === "error" ? "Access code was not accepted" : "Locked"}</p>
      <p className="status" aria-live="polite">{phase === "idle" ? "Idle" : phase}</p>
      <p className="note" aria-live="polite">{note}</p>
      {(turn?.requestedModel || turn?.returnedModel) && (
        <p>Requested model: {turn.requestedModel || "not recorded"}. Returned model: {turn.returnedModel || "not in provider metadata"}.</p>
      )}
      {!embedded && (
      <form aria-label="Advisor access" onSubmit={(event) => void openAssistant(event)}>
        <label htmlFor="advisor-access-code">Advisor access code</label>
        <input
          id="advisor-access-code"
          name="advisor-access-code"
          aria-label="Advisor access code"
          aria-invalid={auth === "error"}
          placeholder="Advisor access code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            if (auth === "open") {
              setSessionToken("");
              setAuth("locked");
              setNote("The code changed. Press Open assistant again.");
            }
          }}
          type="password"
          autoComplete="current-password"
          style={fieldStyle}
        />
        <div className="row">
          <button type="submit" style={buttonStyle} disabled={auth === "checking"}>{auth === "checking" ? "Checking…" : "Open assistant"}</button>
        </div>
      </form>
      )}
      <p>{auth === "open" ? "The request box is ready." : embedded ? "Opening the assistant with this desk sign-in." : "The request box is locked until the access code is accepted."}</p>
      <ul className="caps">
        {ASSISTANT_CAPABILITIES.map((item) => (
          <li key={item.id} className={item.status === "testing" ? "testing" : "unavailable"}>
            <strong>{item.status === "testing" ? "Testing" : item.status === "premium-deferred" ? "Premium, not in v1" : item.status === "connection-required" ? "Connection required" : "Not connected"}: </strong>{item.label}. {item.note}
          </li>
        ))}
      </ul>
      {auth === "open" && usage && (
        <section className="caps" aria-label="Usage and billing">
          <h2>Usage</h2>
          <p>{usage.paymentNote}</p>
          <p>Measured tokens this period: {usage.measuredTokens ?? 0}. This is not a price or an allowance.</p>
          {usage.stopped && <p>A technical safety limit paused new AI replies. The desk stays open. Checkout is off, and nothing is charged.</p>}
        </section>
      )}
      <div className="log" aria-live="polite">
        {lines.map((line, index) => (
          <p key={index} className={line.role === "user" ? "you" : ""}>
            <strong>{line.role === "user" ? "You said" : "Reply"}: </strong>{line.text}
          </p>
        ))}
      </div>
      <form aria-label="Request" onSubmit={(event) => { event.preventDefault(); void send(text, "typed"); }}>
        <label htmlFor="agent-request">Request</label>
        <textarea id="agent-request" aria-label="Typed request" value={text} disabled={auth !== "open"} onChange={(event) => setText(event.target.value)} onKeyDown={onRequestKeyDown} placeholder="Type a request. Voice uses the same assistant." style={fieldStyle} />
        <div className="row">
          <button type="submit" style={buttonStyle} disabled={auth !== "open"}>Send</button>
          <button type="button" style={buttonStyle} disabled={auth !== "open"} onClick={() => void listen()}>Voice command</button>
          <button type="button" style={buttonStyle} disabled={auth !== "open"} onClick={() => void finishRef.current?.()}>Done speaking</button>
          <button type="button" style={buttonStyle} onClick={() => { cancelListen.current = true; finishRef.current = null; stopAll(); }}>Stop</button>
          <button type="button" style={buttonStyle} disabled={auth !== "open"} onClick={() => void testMic()}>Test mic</button>
          <button type="button" style={buttonStyle} disabled={auth !== "open"} onClick={() => void playLine([...lines].reverse().find((line) => line.role === "assistant")?.text || "", true)}>Play reply</button>
        </div>
      </form>
      {missing.length > 0 && (
        <section>
          <h2>Still needed</h2>
          <ul>{missing.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      )}
      {readBack.length > 0 && (
        <section>
          <h2>Draft read-back</h2>
          <ul>{readBack.map(([field, value]) => <li key={field}><strong>{field}: </strong>{value}</li>)}</ul>
          <p>Signatures are unsigned.</p>
        </section>
      )}
      {turn?.formHref && <p>{turn.formTitle}<br /><a href={turn.formHref}>{turn.formHref}</a></p>}
      {turn?.dropbox && <p>{turn.dropbox.reason}</p>}
      {turn?.approval && (
        <div className="row">
          <button type="button" onClick={() => void decide("approve")}>Approve this save</button>
          <button type="button" onClick={() => void decide("deny")}>Deny</button>
        </div>
      )}
      {previewUrl && <iframe title="Draft preview" src={previewUrl} />}
    </main>
  );
}
