import { createFileRoute } from "@tanstack/react-router";
import { listAllTickets, supportKeyMatches } from "@/lib/support";

export const Route = createFileRoute("/api/support/tickets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await supportKeyMatches(request.headers.get("authorization") || ""))) {
          return Response.json({ error: "The support API key was not accepted." }, { status: 401 });
        }
        const url = new URL(request.url);
        const tickets = await listAllTickets({
          status: url.searchParams.get("status") || "",
          priority: url.searchParams.get("priority") || "",
          category: url.searchParams.get("category") || "",
          advisor: url.searchParams.get("advisor") || "",
          search: url.searchParams.get("q") || "",
        });
        return Response.json({ tickets });
      },
    },
  },
});
