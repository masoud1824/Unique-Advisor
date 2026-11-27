/** Written assistant model. OpenAI is not a fallback. */
export const V1_MAIN_MODEL = "grok-4.7";
export const XAI_BASE = "https://api.x.ai/v1";

export function configuredModelId() {
  const chosen = String(process.env.UA_AGENT_MODEL || "").trim();
  if (chosen === V1_MAIN_MODEL || chosen.startsWith(`${V1_MAIN_MODEL}-`)) return chosen;
  return V1_MAIN_MODEL;
}

export function grokEnvKey() {
  return String(process.env.XAI_API_KEY || "").trim();
}

export function rejectedModelReason(requested: string, returned: string) {
  const want = String(requested || "").trim();
  const got = String(returned || "").trim();
  if (want && got.startsWith(want)) return "";
  return `The provider returned ${got || "no model id"} instead of ${want || "the requested model"}. That reply was not used. No fallback model was used.`;
}

export type ModelAccess = { ok: true; model: string } | { ok: false; model: string; blocker: string };

/** Confirms Grok on this account. A failure does not switch models. */
export async function verifyModelAccess(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<ModelAccess> {
  const model = configuredModelId();
  if (!apiKey.trim()) return { ok: false, model, blocker: `${model} was not called. The Grok key is not configured, and no fallback model was used.` };
  let response: Response;
  try {
    response = await fetchImpl(`${XAI_BASE}/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { ok: false, model, blocker: `${model} could not be reached. No fallback model was used.` };
  }
  if (response.status === 404) return { ok: false, model, blocker: `${model} is not available on this account. No fallback model was used.` };
  if (!response.ok) return { ok: false, model, blocker: `This account did not accept ${model} (${response.status}). No fallback model was used.` };
  return { ok: true, model };
}
