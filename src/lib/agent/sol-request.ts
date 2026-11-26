/** Chat Completions shape for gpt-6.2-sol. Responses keeps max_output_tokens. */

export const SOL_MODEL = "gpt-6.2-sol";

const CHAT_UNSUPPORTED = ["temperature", "top_p", "logprobs", "top_logprobs"] as const;

export function isSolModel(model: unknown) {
  const name = String(model || "").trim();
  return name === SOL_MODEL || name.startsWith(`${SOL_MODEL}-`);
}

export function solChatCompletionBody(body: Record<string, unknown>) {
  if (!isSolModel(body.model)) return body;
  const next: Record<string, unknown> = { ...body };
  const stated = Number(next.max_completion_tokens ?? next.max_tokens);
  delete next.max_tokens;
  for (const key of CHAT_UNSUPPORTED) delete next[key];
  if (Number.isFinite(stated) && stated > 0) next.max_completion_tokens = stated;
  const effort = String(next.reasoning_effort || "");
  if (!effort || effort === "none" || effort === "minimal") next.reasoning_effort = "low";
  return next;
}

export function solResponsesBody(body: Record<string, unknown>) {
  if (!isSolModel(body.model)) return body;
  const next: Record<string, unknown> = { ...body };
  delete next.temperature;
  delete next.top_p;
  delete next.top_logprobs;
  delete next.max_tokens;
  delete next.max_completion_tokens;
  const reasoning = next.reasoning && typeof next.reasoning === "object" ? { ...(next.reasoning as Record<string, unknown>) } : {};
  const effort = String(reasoning.effort || "");
  if (!effort || effort === "none" || effort === "minimal") reasoning.effort = "low";
  next.reasoning = reasoning;
  return next;
}

function rewriteJson(url: string, raw: string) {
  if (!url.includes("api.openai.com")) return raw;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return raw;
  }
  const next = url.includes("/chat/completions")
    ? solChatCompletionBody(body)
    : url.includes("/responses")
      ? solResponsesBody(body)
      : body;
  return next === body ? raw : JSON.stringify(next);
}

/** Rewrites only Sol Chat Completions and Responses bodies. Other models are unchanged. */
export function solAwareFetch(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (typeof init?.body === "string") {
      const body = rewriteJson(url, init.body);
      if (body !== init.body) init = { ...init, body };
    } else if (typeof Request !== "undefined" && input instanceof Request) {
      const raw = await input.clone().text();
      const body = rewriteJson(input.url, raw);
      if (body !== raw) input = new Request(input, { body });
    }
    return base(input, init);
  };
}
