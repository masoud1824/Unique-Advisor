import { createFileRoute } from "@tanstack/react-router";
import { appointmentPage, bookAppointmentChoice } from "@/lib/appointments";

export const Route = createFileRoute("/api/book/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => appointmentPage(String(params.token || "")),
      POST: async ({ request, params }) => {
        const form = await request.formData().catch(() => null);
        const start = String(form?.get("start") || "");
        const mode = String(form?.get("mode") || "");
        return bookAppointmentChoice(String(params.token || ""), start, mode);
      },
    },
  },
});
