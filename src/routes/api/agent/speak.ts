import { createFileRoute } from "@tanstack/react-router";
import { previewSpeech } from "@/lib/agent/preview-server";

export const Route = createFileRoute("/api/agent/speak")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const result = await previewSpeech(body);
        if (!result.ok) return Response.json(result);
        return new Response(result.audio, {
          headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
        });
      },
    },
  },
});
