import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { transcribeAssistant } from "@/lib/assistant.functions";
import { echoesAssistantReply, phaseAfterStop, sameTurnGuard, type VoicePhase } from "@/lib/agent/voice-bridge";
import { decideTranscript, microphoneTestReport, transcriptionPrompt } from "@/lib/transcript-guard";
import { beginPlayback, browserFallbackAllowed, emptyPlayback, shouldCaptureSpeech, shouldResumeAfterSpeech, stopPlayback, type PlaybackState } from "@/lib/voice-desk";

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
};
type Line = { role: "user" | "assistant"; text: string };

const NAMES = ["Avery Example", "Blake Example"];

export const Route = createFileRoute("/a/$slug/agent")({
  component: AgentPreview,
});

function AgentPreview() {
  const { slug } = Route.useParams();
  const [code, setCode] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [text, setText] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [note, setNote] = useState("");
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
    setLive("preparing");
    let serverStarted = false;
    try {
      const response = await fetch("/api/agent/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, code, sessionToken, runId, line: spoken.slice(0, 500) }),
      });
      if (playRef.current.owner !== owner) return;
      if ((response.headers.get("content-type") || "").includes("audio")) {
        const url = URL.createObjectURL(await response.blob());
        const audio = new Audio(url);
        audioRef.current = audio;
        serverStarted = true;
        setLive("speaking");
        audio.onended = () => {
          if (playRef.current.owner === owner) setLive("idle");
        };
        await audio.play();
        return;
      }
    } catch {
      serverStarted = false;
    }
    if (!browserFallbackAllowed({ owner, activeOwner: playRef.current.owner, serverStarted }) || !window.speechSynthesis) {
      setNote("The reply is on screen. Press Play reply to hear it.");
      setLive("idle");
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(spoken.slice(0, 500));
    utter.lang = "en-CA";
    utter.onend = () => {
      if (playRef.current.owner === owner) setLive("idle");
    };
    setNote("A browser English voice is speaking because the saved voice clip was not ready. The full reply is on screen.");
    setLive("speaking");
    window.speechSynthesis.speak(utter);
  }

  async function send(message: string, source: "typed" | "voice") {
    const clean = message.replace(/\s+/g, " ").trim();
    const guard = sameTurnGuard({ busy: busyRef.current, previous: lastSent.current.text, text: clean, elapsedMs: Date.now() - lastSent.current.at });
    if (!clean || !guard.accept) {
      if (guard.reason === "duplicate") setNote("That was already sent. I did not run it again.");
      return;
    }
    if (!code.trim()) {
      setNote("Enter the access code first. You can still type the request.");
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
    <main className="agent-preview">
      <style>{`
        .agent-preview { min-height: 100vh; box-sizing: border-box; padding: 16px; background: #f4f1ea; color: #1d1b16; font: 16px/1.45 Georgia, serif; }
        .agent-preview * { box-sizing: border-box; }
        .agent-preview h1 { font-size: 1.3rem; margin: 0 0 4px; }
        .agent-preview .status { font-weight: 700; text-transform: capitalize; }
        .agent-preview .note { color: #8a2b1f; min-height: 1.2em; }
        .agent-preview .log { background: white; border: 1px solid #d9d2c5; border-radius: 12px; min-height: 180px; max-height: 36vh; overflow: auto; padding: 12px; }
        .agent-preview .row { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
        .agent-preview button, .agent-preview textarea, .agent-preview input { font: inherit; }
        .agent-preview textarea { width: 100%; min-height: 64px; }
        .agent-preview iframe { width: 100%; height: 480px; border: 1px solid #d9d2c5; background: white; }
        .agent-preview .you { color: #3d4a3a; }
      `}</style>
      <p>Agent preview. The desk is unchanged. Nothing is emailed, booked, or uploaded.</p>
      <h1>Equitable draft</h1>
      <p className="status" aria-live="polite">{phase === "idle" ? "Idle" : phase}</p>
      <p className="note" aria-live="polite">{note}</p>
      <div className="row">
        <input aria-label="Access code" placeholder="Access code" value={code} onChange={(event) => setCode(event.target.value)} type="password" />
      </div>
      <div className="log" aria-live="polite">
        {lines.map((line, index) => (
          <p key={index} className={line.role === "user" ? "you" : ""}>
            <strong>{line.role === "user" ? "You said" : "Reply"}: </strong>{line.text}
          </p>
        ))}
      </div>
      <textarea aria-label="Typed request" value={text} onChange={(event) => setText(event.target.value)} placeholder="Type a request. Voice uses this same draft." />
      <div className="row">
        <button type="button" onClick={() => void send(text, "typed")}>Send</button>
        <button type="button" onClick={() => void listen()}>Voice command</button>
        <button type="button" onClick={() => void finishRef.current?.()}>Done speaking</button>
        <button type="button" onClick={() => { cancelListen.current = true; finishRef.current = null; stopAll(); }}>Stop</button>
        <button type="button" onClick={() => void testMic()}>Test mic</button>
        <button type="button" onClick={() => void playLine([...lines].reverse().find((line) => line.role === "assistant")?.text || "", true)}>Play reply</button>
      </div>
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
