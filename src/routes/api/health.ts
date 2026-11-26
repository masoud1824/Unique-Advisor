import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { hostedDataPlane, redactPrivate } from "@/lib/hosted-runtime";
import { modelTransportOpen } from "@/lib/outbound-guard";
import { configuredModelId, verifyModelAccess } from "@/lib/agent/model-config";

let modelCache: { at: number; model: string; access: string; blocker: string } | null = null;

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
          let modelAccess = modelCache && Date.now() - modelCache.at < 600_000 ? modelCache : null;
          if (!modelAccess) {
            const configured = configuredModelId();
            try {
              if (!model.ok) modelAccess = { at: Date.now(), model: configured, access: "not-called", blocker: model.reason };
              else {
                const row = (await sql.query<{ openai_api_key: string }>("select openai_api_key from operators where id = 1"))[0];
                const apiKey = String(row?.openai_api_key || "").trim() || String(process.env.OPENAI_API_KEY || "").trim();
                const verified = await verifyModelAccess(apiKey);
                modelAccess = { at: Date.now(), model: verified.model, access: verified.ok ? "accepted" : "blocked", blocker: verified.ok ? "" : verified.blocker };
              }
            } catch (error) {
              modelAccess = { at: Date.now(), model: configured, access: "blocked", blocker: redactPrivate(error instanceof Error ? error.message : "The model could not be checked. No fallback model was used.") };
            }
            modelCache = modelAccess;
          }
          return Response.json({
            ok: true,
            plane,
            database: "up",
            hostEnv: process.env.UA_HOST_ENV || "",
            modelTransport: model.ok ? "open" : "closed",
            modelReason: model.ok ? "" : model.reason,
            modelId: modelAccess.model,
            modelAccess: modelAccess.access,
            modelBlocker: modelAccess.blocker,
            openAiEnvKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
            billing: "test-values-only",
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
