import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { hostedDataPlane, redactPrivate } from "@/lib/hosted-runtime";
import { modelTransportOpen } from "@/lib/outbound-guard";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const plane = hostedDataPlane() ? "postgres" : "local";
        if (plane === "postgres" && !process.env.DATABASE_URL?.trim()) {
          return Response.json({ ok: false, plane, database: "missing" }, { status: 503 });
        }
        try {
          const sql = await getSql();
          await sql.query("select 1 as ok");
          const model = modelTransportOpen();
          return Response.json({
            ok: true,
            plane,
            database: "up",
            hostEnv: process.env.UA_HOST_ENV || "",
            modelTransport: model.ok ? "open" : "closed",
            modelReason: model.ok ? "" : model.reason,
            openAiEnvKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "database down";
          console.info(`[health] ${redactPrivate(message)}`);
          return Response.json({ ok: false, plane, database: "down" }, { status: 503 });
        }
      },
    },
  },
});
