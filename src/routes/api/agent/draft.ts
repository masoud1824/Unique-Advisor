import { createFileRoute } from "@tanstack/react-router";
import { previewPdf } from "@/lib/agent/preview-server";

export const Route = createFileRoute("/api/agent/draft")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const result = await previewPdf(body);
        if (!result.ok) return Response.json(result, { status: result.error === "That access code is not right." ? 401 : 404 });
        return new Response(Buffer.from(result.bytes), {
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `inline; filename="${result.filename}"`,
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
