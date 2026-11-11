import { createServerFn } from "@tanstack/react-start";
import { gateAdvisor, gateOperator } from "@/lib/advisor-db";
import { appendVoiceSession, listVoiceAdvisors, listVoiceSessions } from "@/lib/voice-log";
import { cleanVoiceEvents } from "@/lib/voice-log-events";

export const appendVoiceLog = createServerFn({ method: "POST" })
  .validator((input: { slug?: string; code?: string; sessionKey?: string; events?: unknown; sentText?: string }) => input)
  .handler(async ({ data }) => {
    const gate = await gateAdvisor(data.slug || "", data.code || "");
    if (!gate.ok) return gate;
    await appendVoiceSession(gate.row.id, String(data.sessionKey || ""), cleanVoiceEvents(data.events), String(data.sentText || ""));
    return { ok: true as const };
  });

export const listVoiceLogs = createServerFn({ method: "POST" })
  .validator((input: { code?: string; advisorId?: number }) => input)
  .handler(async ({ data }) => {
    const gate = await gateOperator(data.code || "");
    if (!gate.ok) return gate;
    const advisors = await listVoiceAdvisors();
    const advisorId = Number(data.advisorId) || advisors[0]?.id || 0;
    const sessions = advisorId ? await listVoiceSessions(advisorId) : [];
    return { ok: true as const, advisors, advisorId, sessions };
  });
