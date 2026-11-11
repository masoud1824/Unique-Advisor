export const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"] as const;

export function openAiVoice(value: unknown) {
  const name = String(value || "").trim().toLowerCase();
  return (OPENAI_VOICES as readonly string[]).includes(name) ? name : "coral";
}

export function isPlayableMp3(bytes: Uint8Array) {
  if (bytes.length < 100) return false;
  const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const frame = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  return id3 || frame;
}
