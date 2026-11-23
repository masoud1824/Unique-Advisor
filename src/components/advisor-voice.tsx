import { useEffect, useRef, useState } from "react";
import { loadAdvisorVoice, previewAdvisorVoice, saveAdvisorVoice } from "@/lib/assistant.functions";
import { isPlayableMp3, OPENAI_VOICES } from "@/lib/openai-voices";

type VoicePreview = { ok: true; audio: string; mime: string } | { ok: false; error: string };

function readVoicePreview(value: unknown): VoicePreview {
  if (!value || typeof value !== "object") return { ok: false, error: "Preview did not return audio." };
  const record = value as Record<string, unknown>;
  if (record.ok === true && typeof record.audio === "string" && record.audio.length > 0) {
    return { ok: true, audio: record.audio, mime: typeof record.mime === "string" ? record.mime : "audio/mpeg" };
  }
  return { ok: false, error: typeof record.error === "string" && record.error ? record.error : "Preview did not return audio." };
}

function readSavedVoice(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return record.ok === true && typeof record.voice === "string" ? record.voice : "";
}

function clipUrl(audio: string) {
  const binary = atob(audio);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (!isPlayableMp3(bytes)) throw new Error("The server did not return a playable audio file.");
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}

export function AdvisorVoiceChooser({ slug, code }: { slug: string; code: string }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("coral");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [clips, setClips] = useState<Record<string, string>>({});
  const players = useRef<Record<string, HTMLAudioElement | null>>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void loadAdvisorVoice({ data: { slug, code } }).then((result) => {
      const voice = readSavedVoice(result);
      if (voice) setCurrent(voice);
    }).catch(() => setNote("The saved voice could not be loaded."));
  }, [slug, code]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const back = previous instanceof HTMLElement ? previous : triggerRef.current;
      back?.focus();
    };
  }, [open]);

  async function preview(voice: string) {
    setNote("");
    setBusy(voice);
    const audio = players.current[voice];
    try {
      const result = readVoicePreview(await previewAdvisorVoice({ data: { slug, code, voice } }));
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      if (!result.mime.includes("audio") && !result.mime.includes("mpeg")) {
        setNote(`Preview returned ${result.mime} instead of audio.`);
        return;
      }
      const url = clipUrl(result.audio);
      setClips((currentClips) => {
        const previous = currentClips[voice];
        if (previous) URL.revokeObjectURL(previous);
        return { ...currentClips, [voice]: url };
      });
      if (!audio) {
        setNote("The player is not on the page.");
        return;
      }
      audio.src = url;
      audio.load();
      try {
        await audio.play();
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        setNote(name === "NotAllowedError" ? "The browser blocked autoplay. Press the play bar on this row." : `The browser could not play ${voice}${name ? ` (${name})` : ""}.`);
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Preview failed before any audio was returned.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="w-full">
      <button ref={triggerRef} type="button" className="ua-btn-line" data-voice-chooser aria-haspopup="dialog" aria-expanded={open} style={{ padding: "6px 12px", fontSize: "0.85rem" }} onClick={() => setOpen(true)}>
        Voice: {current}
      </button>
      {open && (
        <div className="ua-modal" role="presentation" onClick={() => setOpen(false)}>
          <div className="ua-voice-dialog" role="dialog" aria-modal="true" aria-label="Assistant voice" onClick={(event) => event.stopPropagation()}>
            <div className="ua-voice-dialog-bar">
              <h2>Assistant voice</h2>
              <button ref={closeRef} type="button" className="ua-btn-line" data-voice-close style={{ padding: "6px 12px" }} onClick={() => setOpen(false)}>Close</button>
            </div>
            <p className="ua-voice-note">Press Preview to hear a voice. The voice marked In use is saved for this advisor. These voices are optimized for English. This desk asks for a neutral North American English delivery and does not label an accent.</p>
            <div className="ua-voice-list">
            {OPENAI_VOICES.map((voice) => (
              <div key={voice} className="ua-voice-row" data-voice={voice} data-in-use={voice === current ? "true" : undefined}>
                <span className="ua-voice-name">
                  <strong className="text-sm">{voice}</strong>
                  {voice === current && <span className="ua-voice-used">In use</span>}
                </span>
                <audio
                  controls
                  preload="none"
                  src={clips[voice] || undefined}
                  ref={(node) => { players.current[voice] = node; }}
                  onError={(event) => {
                    const player = event.currentTarget;
                    if (!player.src) return;
                    setNote(`The browser rejected the ${voice} sample${player.error ? ` (code ${player.error.code})` : ""}.`);
                  }}
                />
                <button type="button" className="ua-btn-line ua-voice-preview" style={{ padding: "4px 10px", fontSize: "0.8rem" }} disabled={busy === voice} onClick={() => void preview(voice)}>
                  {busy === voice ? "Loading…" : "Preview"}
                </button>
                <button
                  type="button"
                  className="ua-btn ua-voice-use"
                  data-action="use"
                  style={{ padding: "4px 10px", fontSize: "0.8rem" }}
                  onClick={() => {
                    void saveAdvisorVoice({ data: { slug, code, voice } }).then((result) => {
                      if (!result?.ok) {
                        setNote(result && "error" in result ? result.error : "That voice was not saved.");
                        return;
                      }
                      setCurrent(result.voice);
                      setNote(`${result.voice} is now the assistant voice.`);
                    }).catch(() => setNote("That voice was not saved."));
                  }}
                >
                  Use
                </button>
              </div>
            ))}
            </div>
            {note && <p className="text-sm font-semibold" style={{ color: "#b42318" }}>{note}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
