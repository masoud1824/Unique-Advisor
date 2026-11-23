import { createFileRoute } from "@tanstack/react-router";
import { answerAdvisor, speakSentence, warmVoiceLink } from "@/lib/assistant.functions";
import { gateAdvisor } from "@/lib/advisor-db";
import { spokenReply } from "@/lib/assistant-reply";
import { spokenBrief } from "@/lib/voice-desk";
import { takeSentences } from "@/lib/voice-stream";

export const Route = createFileRoute("/api/assistant/voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { slug?: string; code?: string; chatId?: number; page?: string; content?: string; transcriptConfirmed?: boolean; activeNewsletterId?: number } | null;
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            let open = true;
            const send = (event: Record<string, unknown>) => {
              if (!open) return;
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              } catch {
                open = false;
              }
            };
            void warmVoiceLink();
            const gate = await gateAdvisor(body?.slug || "", body?.code || "").catch(() => null);
            const advisorId = gate && "ok" in gate && gate.ok ? gate.row.id : 0;
            let chain = Promise.resolve();
            let sentAudio = false;
            const queue = (sentence: string) => {
              const line = spokenReply(sentence).trim();
              if (line.length < 2) return;
              chain = chain.then(async () => {
                const parts: Buffer[] = [];
                await speakSentence(line, (chunk: Buffer) => parts.push(chunk), advisorId);
                const audio = Buffer.concat(parts).toString("base64");
                if (audio) {
                  sentAudio = true;
                  send({ type: "audio", mime: "audio/mpeg", audio });
                }
              }).catch((error) => {
                const message = error instanceof Error ? error.message : "The voice could not be spoken.";
                console.info(`[voice] tts-error ${message}`);
                send({ type: "tts-error", error: message });
              });
            };
            try {
              const result = await answerAdvisor(
                { slug: String(body?.slug || ""), code: String(body?.code || ""), chatId: Number(body?.chatId) || 0, page: Number(body?.page) || 0, transcriptConfirmed: Boolean(body?.transcriptConfirmed), activeNewsletterId: Number(body?.activeNewsletterId) || 0, messages: [{ role: "user", content: String(body?.content || "") }] },
                (text: string) => {
                  send({ type: "delta", text });
                },
              );
              if (!result.ok) {
                const message = "error" in result && typeof result.error === "string" ? result.error : "The assistant could not answer.";
                send({ type: "error", error: message });
              } else {
                const brief = spokenBrief(String(result.reply || ""), String(body?.content || ""));
                send({ type: "speak", text: brief });
                const pieces = takeSentences(`${brief.trim()} `).sentences;
                (pieces.length ? pieces : [brief.trim()]).filter(Boolean).forEach((line) => queue(line));
                let timedOut = false;
                await Promise.race([
                  chain.then(() => undefined),
                  new Promise((resolve) => setTimeout(() => {
                    timedOut = true;
                    resolve(undefined);
                  }, 12000)),
                ]);
                if (timedOut && !sentAudio) send({ type: "tts-error", error: "The spoken reply was not ready in time. Press Play reply." });
                send({ type: "done", reply: result.reply, drafts: result.drafts || [], actions: result.actions || [] });
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : "The assistant could not answer.";
              console.info(`[voice] ask-error ${message}`);
              send({ type: "error", error: message });
            } finally {
              open = false;
              try { controller.close(); } catch { /* already closed */ }
            }
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
