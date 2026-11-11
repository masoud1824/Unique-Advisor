import { factsFromResponse, type ProviderCall } from "./assistant-diagnostics.ts";

export function takeSentences(buffer: string) {
  const sentences: string[] = [];
  let rest = buffer;
  while (rest) {
    const match = rest.match(/^([\s\S]*?[.!?])(?=\s|$)/);
    if (!match) break;
    const sentence = match[1].trim();
    if (sentence.length > 1) sentences.push(sentence);
    rest = rest.slice(match[0].length).replace(/^\s+/, "");
  }
  return { sentences, rest };
}

type ToolPiece = { id: string; name: string; arguments: string };

export function assembleModelStream(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const body = JSON.parse(trimmed) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }> };
      const message = body.choices?.[0]?.message;
      if (message) {
        return {
          content: String(message.content || ""),
          tool_calls: (message.tool_calls || []).map((call) => ({ id: call.id || "", type: "function" as const, function: { name: call.function?.name || "", arguments: call.function?.arguments || "" } })),
        };
      }
    } catch {
      /* the body is an event stream, not one JSON object */
    }
  }
  let content = "";
  const tools: ToolPiece[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let json: { choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }> };
    try {
      json = JSON.parse(data) as typeof json;
    } catch {
      continue;
    }
    const choice = json.choices?.[0] as { delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }; message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } } | undefined;
    const delta = choice?.delta;
    if (!delta && !choice?.message) continue;
    if (typeof delta?.content === "string" && delta.content) content += delta.content;
    if (!delta && choice?.message?.content) content += String(choice.message.content);
    for (const call of delta?.tool_calls || []) {
      const index = call.index ?? 0;
      if (!tools[index]) tools[index] = { id: "", name: "", arguments: "" };
      if (call.id) tools[index].id = call.id;
      if (call.function?.name) tools[index].name += call.function.name;
      if (call.function?.arguments) tools[index].arguments += call.function.arguments;
    }
    if ((!delta || !(delta.tool_calls || []).length) && choice?.message?.tool_calls?.length && tools.length === 0) {
      choice.message.tool_calls.forEach((call, index) => {
        tools[index] = { id: call.id || "", name: call.function?.name || "", arguments: call.function?.arguments || "" };
      });
    }
  }
  return {
    content,
    tool_calls: tools.filter(Boolean).map((call) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: call.arguments } })),
  };
}

export type ModelMessage = {
  content?: string | null;
  tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
  providerFacts?: ProviderCall;
};

export function assistantHistoryMessage(message: ModelMessage) {
  const calls = (message.tool_calls || [])
    .filter((call) => call?.function?.name)
    .map((call) => ({
      id: String(call.id || ""),
      type: "function" as const,
      function: { name: String(call.function?.name || ""), arguments: String(call.function?.arguments || "{}") },
    }));
  return {
    role: "assistant" as const,
    content: String(message.content || ""),
    ...(calls.length ? { tool_calls: calls } : {}),
  };
}

export async function readCompletionMessage(response: Response, onDelta?: (text: string) => void, sent?: { url?: string; model?: string }): Promise<ModelMessage | undefined> {
  const type = response.headers.get("content-type") || "";
  const at = new Date().toISOString();
  if (type.includes("application/json")) {
    const body = (await response.json()) as { choices?: Array<{ message?: ModelMessage }> };
    const message = body.choices?.[0]?.message;
    const facts = factsFromResponse(response, body, "", at, sent);
    if (!message) return { providerFacts: facts };
    if (message.content && onDelta && !(message.tool_calls || []).length) onDelta(String(message.content));
    message.providerFacts = facts;
    return message;
  }
  if (!response.body) return { providerFacts: factsFromResponse(response, undefined, "", at, sent) };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    raw += decoder.decode(step.value, { stream: true });
  }
  const message = assembleModelStream(raw);
  const withFacts: ModelMessage = { ...message, providerFacts: factsFromResponse(response, undefined, raw, at, sent) };
  if (withFacts.content && onDelta && (withFacts.tool_calls || []).length === 0) onDelta(withFacts.content);
  return withFacts;
}
