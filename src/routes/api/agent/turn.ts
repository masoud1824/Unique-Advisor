import { createFileRoute } from "@tanstack/react-router";
import { previewTurn } from "@/lib/agent/preview-server";

export const Route = createFileRoute("/api/agent/turn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const result = await previewTurn(body);
        return Response.json(result);
      },
    },
  },
});
