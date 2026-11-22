import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { hostedDataPlane, redactPrivate } from "@/lib/hosted-runtime";

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
          return Response.json({
            ok: true,
            plane,
            database: "up",
            hostEnv: process.env.UA_HOST_ENV || "",
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
