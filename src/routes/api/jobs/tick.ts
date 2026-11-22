import { createFileRoute } from "@tanstack/react-router";
import { handleJobTick } from "@/lib/hosted-tick";

export const Route = createFileRoute("/api/jobs/tick")({
  server: {
    handlers: {
      GET: async ({ request }) => handleJobTick(request),
    },
  },
});
