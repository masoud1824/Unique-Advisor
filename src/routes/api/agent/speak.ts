import { createFileRoute } from "@tanstack/react-router";
import { previewSpeech } from "@/lib/agent/preview-server";

export const Route = createFileRoute("/api/agent/speak")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const result = await previewSpeech(body);
        return Response.json(result);
      },
    },
  },
});
