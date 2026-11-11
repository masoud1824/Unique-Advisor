import { useState } from "react";
import { readVoiceAutoSend, writeVoiceAutoSend } from "@/lib/voice-turn";

export function VoiceSendSetting() {
  const [on, setOn] = useState(() => readVoiceAutoSend());
  return (
    <section id="voice-settings" className="ua-panel mb-5 p-6" style={{ border: "2px solid #c9a227" }}>
      <h2 className="text-lg font-semibold">Voice</h2>
      <label className="mt-3 flex items-start gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={on}
          onChange={(event) => {
            const next = event.target.checked;
            setOn(next);
            writeVoiceAutoSend(next);
          }}
        />
        <span>Send the sentence after 3 seconds of silence. Off by default. While this is off, voice keeps listening through pauses until you press Stop.</span>
      </label>
    </section>
  );
}
