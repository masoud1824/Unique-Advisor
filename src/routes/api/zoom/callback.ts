import { createFileRoute } from "@tanstack/react-router";
import { completeZoomSignIn } from "@/lib/zoom-oauth";

export const Route = createFileRoute("/api/zoom/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => completeZoomSignIn(request),
    },
  },
});
