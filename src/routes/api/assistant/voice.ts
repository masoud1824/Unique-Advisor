import { createFileRoute } from "@tanstack/react-router";
import { answerAdvisor, speakSentence, warmVoiceLink } from "@/lib/assistant.functions";
import { gateAdvisor } from "@/lib/advisor-db";
import { spokenReply } from "@/lib/assistant-reply";
import { takeSentences } from "@/lib/voice-stream";

export const Route = createFileRoute("/api/assistant/voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { slug?: string; code?: string; chatId?: number; page?: string; content?: string } | null;
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
            let pending = "";
            let chain = Promise.resolve();
            let spoken = 0;
            const queue = (sentence: string) => {
              const line = spokenReply(sentence).trim();
              if (line.length < 2) return;
              spoken += 1;
              chain = chain.then(async () => {
                const parts: Buffer[] = [];
                await speakSentence(line, (chunk) => parts.push(chunk), advisorId);
                const audio = Buffer.concat(parts).toString("base64");
                if (audio) send({ type: "audio", mime: "audio/mpeg", audio });
              }).catch((error) => {
                const message = error instanceof Error ? error.message : "The voice could not be spoken.";
                console.info(`[voice] tts-error ${message}`);
                send({ type: "tts-error", error: message });
              });
            };
            try {
              const result = await answerAdvisor(
                { slug: body?.slug, code: body?.code, chatId: body?.chatId, page: body?.page, messages: [{ role: "user", content: String(body?.content || "") }] },
                (text) => {
                  send({ type: "delta", text });
                  pending += text;
                  const pulled = takeSentences(pending);
                  pending = pulled.rest;
                  pulled.sentences.forEach(queue);
                },
              );
              if (!result.ok) {
                send({ type: "error", error: result.error });
              } else {
                if (spoken === 0 && result.reply) queue(takeSentences(`${result.reply.trim()} `).sentences[0] || result.reply.trim());
                else if (pending.trim()) queue(pending.trim());
                await Promise.race([chain, new Promise((resolve) => setTimeout(resolve, 12000))]);
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
