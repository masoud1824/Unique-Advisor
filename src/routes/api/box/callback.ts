import { createFileRoute } from "@tanstack/react-router";
import { completeLink } from "@/routes/api/link/callback";

export const Route = createFileRoute("/api/box/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => completeLink(request),
    },
  },
});
