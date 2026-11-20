export type VoiceLogEvent = {
  at: string;
  type: "start" | "result" | "end" | "error" | "restart";
  resultIndex?: number;
  results?: Array<{ transcript: string; isFinal: boolean }>;
  error?: string;
};

const TYPES = new Set(["start", "result", "end", "error", "restart"]);

export function cleanVoiceEvents(value: unknown): VoiceLogEvent[] {
  if (!Array.isArray(value)) return [];
  const events: VoiceLogEvent[] = [];
  for (const item of value.slice(0, 40)) {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const type = TYPES.has(String(row.type)) ? String(row.type) as VoiceLogEvent["type"] : "result";
    const results = Array.isArray(row.results)
      ? row.results.slice(0, 30).map((piece) => {
        const heard = piece && typeof piece === "object" ? piece as Record<string, unknown> : {};
        return { transcript: String(heard.transcript || "").replace(/\s+/g, " ").trim().slice(0, 500), isFinal: Boolean(heard.isFinal) };
      }).filter((piece) => piece.transcript)
      : [];
    const index = Number(row.resultIndex);
    events.push({
      at: String(row.at || new Date().toISOString()).slice(0, 40),
      type,
      ...(Number.isFinite(index) ? { resultIndex: index } : {}),
      ...(results.length ? { results } : {}),
      ...(row.error ? { error: String(row.error).slice(0, 300) } : {}),
    });
  }
  return events;
}
