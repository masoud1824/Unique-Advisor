import { createFileRoute } from "@tanstack/react-router";
import { gateAdvisor } from "@/lib/advisor-db";
import { openAiSpeech } from "@/lib/assistant.functions";

const SAMPLE = "Hello. This is your assistant. Your meeting is ready, and the letter is waiting for your approval.";

async function sampleResponse(slug: string, code: string, voice: string) {
  const gate = await gateAdvisor(slug, code);
  if (!gate.ok) return Response.json({ error: gate.error }, { status: 401 });
  const spoken = await openAiSpeech(SAMPLE, voice || "coral");
  if (!spoken.ok) return Response.json({ error: spoken.error }, { status: 400 });
  return new Response(spoken.audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/assistant/voice-sample")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        return sampleResponse(url.searchParams.get("slug") || "", "", url.searchParams.get("voice") || "coral");
      },
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { slug?: string; code?: string; voice?: string } | null;
        return sampleResponse(body?.slug || "", body?.code || "", body?.voice || "coral");
      },
    },
  },
});
