export const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"] as const;

export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";

/** Delivery request for the speech model. It is not a measured accent of any named voice. */
export const NEUTRAL_NORTH_AMERICAN_DELIVERY = "Use a neutral North American English delivery. Do not imitate a British accent. If the text is Farsi, speak the Farsi naturally and do not translate it.";

export function openAiVoice(value: unknown) {
  const name = String(value || "").trim().toLowerCase();
  return (OPENAI_VOICES as readonly string[]).includes(name) ? name : "coral";
}

export function speechRequest(text: string, voice: unknown) {
  return JSON.stringify({
    model: OPENAI_TTS_MODEL,
    input: String(text || ""),
    voice: openAiVoice(voice),
    response_format: "mp3",
    instructions: NEUTRAL_NORTH_AMERICAN_DELIVERY,
  });
}

export function isPlayableMp3(bytes: Uint8Array) {
  if (bytes.length < 100) return false;
  const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const frame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  return id3 || frame;
}
