import { useEffect, useRef, useState } from "react";
import { loadAdvisorVoice, previewAdvisorVoice, saveAdvisorVoice } from "@/lib/assistant.functions";
import { isPlayableMp3, OPENAI_VOICES } from "@/lib/openai-voices";

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

  useEffect(() => {
    void loadAdvisorVoice({ data: { slug, code } }).then((result) => {
      if (result?.ok) setCurrent(result.voice);
    }).catch(() => setNote("The saved voice could not be loaded."));
  }, [slug, code]);

  async function preview(voice: string) {
    setNote("");
    setBusy(voice);
    const audio = players.current[voice];
    try {
      const result = await previewAdvisorVoice({ data: { slug, code, voice } });
      if (!result?.ok || !("audio" in result) || !result.audio) {
        setNote(result && "error" in result && result.error ? result.error : "Preview did not return audio.");
        return;
      }
      if (result.mime && !result.mime.includes("audio") && !result.mime.includes("mpeg")) {
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
      <button type="button" className="ua-btn-line" style={{ padding: "6px 12px", fontSize: "0.85rem" }} onClick={() => setOpen((value) => !value)}>
        Voice: {current}
      </button>
      {open && (
        <div className="mt-2 grid gap-2 rounded-lg border p-3" style={{ borderColor: "#e1e8ef", background: "#fff" }}>
          <p className="text-sm" style={{ color: "#5a6a7a" }}>Press Preview to hear that voice. The assistant keeps the voice marked In use.</p>
          {OPENAI_VOICES.map((voice) => (
            <div key={voice} className="flex flex-wrap items-center gap-2">
              <strong className="w-20 text-sm">{voice}</strong>
              {voice === current && <span className="text-xs font-semibold" style={{ color: "#0d7a4f" }}>In use</span>}
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
              <button type="button" className="ua-btn-line" style={{ padding: "4px 10px", fontSize: "0.8rem" }} disabled={busy === voice} onClick={() => void preview(voice)}>
                {busy === voice ? "Loading…" : "Preview"}
              </button>
              <button
                type="button"
                className="ua-btn"
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
          {note && <p className="text-sm font-semibold" style={{ color: "#b42318" }}>{note}</p>}
        </div>
      )}
    </div>
  );
}
