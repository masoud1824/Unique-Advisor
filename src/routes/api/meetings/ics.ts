import { createFileRoute } from "@tanstack/react-router";
import { meetingCalendarFile } from "@/lib/zoom-bookings";

export const Route = createFileRoute("/api/meetings/ics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("token") || "";
        const body = await meetingCalendarFile(token);
        if (!body) return new Response("Not found", { status: 404 });
        return new Response(body, {
          headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": "attachment; filename=\"meeting.ics\"",
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});
