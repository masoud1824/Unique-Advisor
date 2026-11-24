import { createFileRoute } from "@tanstack/react-router";
import { previewDecide } from "@/lib/agent/preview-server";

export const Route = createFileRoute("/api/agent/decide")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const result = await previewDecide(body);
        return Response.json(result);
      },
    },
  },
});
