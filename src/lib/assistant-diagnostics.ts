export type ProviderCall = {
  provider: string;
  model: string;
  requestId: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  at: string;
  status?: number | null;
  detail?: string;
  reference?: string;
};

function numberOrNull(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function cleanLabel(value: unknown) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || /sk-|bearer\s|api[_-]?key/i.test(text)) return "";
  return text.slice(0, 160);
}

function chunksFrom(body: unknown, raw: string) {
  const chunks: Record<string, unknown>[] = [];
  if (body && typeof body === "object" && !Array.isArray(body)) chunks.push(body as Record<string, unknown>);
  const text = String(raw || "");
  if (text.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) chunks.push(parsed as Record<string, unknown>);
    } catch {
      /* not one JSON object */
    }
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) chunks.push(parsed as Record<string, unknown>);
    } catch {
      /* skip a broken event */
    }
  }
  return chunks;
}

export function factsFromModelPayload(input: { url?: string; requestId?: string; body?: unknown; raw?: string; at?: string }): ProviderCall {
  let provider = "";
  if (input.url) {
    try {
      provider = cleanLabel(new URL(input.url).hostname);
    } catch {
      provider = "";
    }
  }
  let model = "";
  let requestId = cleanLabel(input.requestId);
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let totalTokens: number | null = null;
  for (const chunk of chunksFrom(input.body, input.raw || "")) {
    if (!requestId) requestId = cleanLabel(chunk.id);
    const reported = cleanLabel(chunk.model);
    if (reported) model = reported;
    const usage = chunk.usage;
    if (!usage || typeof usage !== "object") continue;
    const row = usage as Record<string, unknown>;
    const prompt = numberOrNull(row.prompt_tokens ?? row.input_tokens);
    const completion = numberOrNull(row.completion_tokens ?? row.output_tokens);
    const total = numberOrNull(row.total_tokens);
    if (prompt != null) promptTokens = prompt;
    if (completion != null) completionTokens = completion;
    if (total != null) totalTokens = total;
  }
  if (totalTokens == null && promptTokens != null && completionTokens != null) totalTokens = promptTokens + completionTokens;
  return {
    provider,
    model,
    requestId,
    promptTokens,
    completionTokens,
    totalTokens,
    at: input.at || new Date().toISOString(),
  };
}

export function factsFromResponse(
  response: { url?: string; headers?: { get(name: string): string | null } },
  body?: unknown,
  raw = "",
  at?: string,
  sent?: { url?: string; model?: string },
): ProviderCall {
  const headers = response.headers;
  const requestId = headers?.get("x-request-id") || headers?.get("openai-request-id") || headers?.get("X-Request-Id") || "";
  const facts = factsFromModelPayload({ url: response.url || sent?.url, requestId, body, raw, at });
  const model = facts.model || cleanLabel(sent?.model);
  return { ...facts, model };
}

export function publicAssistantError(status: number, raw: string) {
  const reference = `A-${Date.now().toString(36).slice(-6)}`;
  const detail = String(raw || "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[key]")
    .replace(/Bearer\s+\S+/gi, "Bearer [key]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return { reference, status, detail, error: `The assistant could not answer. Try again. Reference ${reference}.` };
}
