import { createFileRoute } from "@tanstack/react-router";
import { answerAdvisor, speakSentence, warmVoiceLink } from "@/lib/assistant.functions";
import { gateAdvisor } from "@/lib/advisor-db";
import { spokenBrief, deliverSpokenLines } from "@/lib/voice-desk";
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
            const speakLine = async (line: string) => {
              const parts: Buffer[] = [];
              await speakSentence(line, (chunk: Buffer) => parts.push(chunk), advisorId);
              return Buffer.concat(parts).toString("base64");
            };
            const speakVisible = async (text: string) => {
              const brief = spokenBrief(text, String(body?.content || ""));
              if (brief.trim().length < 2) return;
              send({ type: "speak", text: brief });
              const pieces = takeSentences(`${brief.trim()} `).sentences;
              const lines = (pieces.length ? pieces : [brief.trim()]).filter((line) => line.trim().length >= 2);
              await deliverSpokenLines(lines, speakLine, (event) => {
                if (event.type === "tts-error") console.info(`[voice] tts-error ${event.error}`);
                send(event);
              });
            };
            try {
              const result = await answerAdvisor(
                { slug: String(body?.slug || ""), code: String(body?.code || ""), chatId: Number(body?.chatId) || 0, page: Number(body?.page) || 0, transcriptConfirmed: Boolean(body?.transcriptConfirmed), activeNewsletterId: Number(body?.activeNewsletterId) || 0, source: "voice", messages: [{ role: "user", content: String(body?.content || "") }] },
                (text: string) => {
                  send({ type: "delta", text });
                },
              );
              if (!result.ok) {
                const message = "error" in result && typeof result.error === "string" ? result.error : "The assistant could not answer.";
                await speakVisible(message);
                send({ type: "error", error: message });
              } else {
                await speakVisible(String(result.reply || ""));
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
