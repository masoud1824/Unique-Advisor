import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { runDeskTurn } from "@/lib/assistant.functions";
import { resetAcceptanceDrafts, removeChecklistEchoes } from "@/lib/acceptance-records";
import { unpackNewsletter } from "@/lib/newsletter";
import { unpackEletter } from "@/lib/eletter";
import { replyClaimsDelivery } from "@/lib/workspace-policy";

const PHRASES = [
  "Move “Time Value of Money” to the second position. Keep every article’s wording unchanged and show the updated preview. Do not send.",
  "Preview the Acceptance — Retirement Note. Do not send.",
  "Change the second paragraph of the Acceptance — Retirement Note to This paragraph was revised on its own.",
  "Preview the Thank You card. Do not send.",
  "Preview the Acceptance — Welcome Drip. Do not start it.",
  "Preview the form from the Useful Link “Acceptance — ivari forms”. Do not send.",
  "Show the Assistant Test document for client id C-1001. Do not send.",
  "Preview the signature request. Do not send.",
  "Show the test email preview. Do not send.",
  "Who can receive mail among life insurance clients? Do not send.",
  "Show my calendar. Do not book a meeting.",
];

export const Route = createFileRoute("/api/acceptance-check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
        const url = new URL(request.url);
        if (url.searchParams.get("cleanup") === "1") {
          const removed = await removeChecklistEchoes(34);
          await resetAcceptanceDrafts(34);
          return Response.json({ removed, restored: true });
        }
        await resetAcceptanceDrafts(34);
        const sql = await getSql();
        const beforeSent = Number((await sql`select count(*)::int as n from messages where advisor_id = 34`)[0]?.n || 0);
        const beforeLetters = Number((await sql`select count(*)::int as n from saved_letters where advisor_id = 34`)[0]?.n || 0);
        const chat = (await sql<{ chat_id: string }>`select chat_id from assistant_messages where advisor_id = 34 order by id desc limit 1`)[0];
        const chatId = Number(chat?.chat_id || 0);
        const turns: Array<{ phrase: string; asks: unknown; sent: unknown; reply: unknown } | { phrase: string; error: unknown }> = [];
        for (const phrase of PHRASES) {
          try {
            const result = await runDeskTurn(34, "masoud-zangeneh-2", "", chatId, phrase);
            const reply = String(result?.reply || "");
            turns.push({
              phrase,
              asks: /who should i send|who is it for|which contact should i send|name the contact|group tag/i.test(reply),
              sent: replyClaimsDelivery(reply),
              reply: reply.slice(0, 1800),
            });
          } catch (error) {
            turns.push({ phrase, error: error instanceof Error ? error.message : String(error) });
          }
        }
        const newsletter = unpackNewsletter(String((await sql<{ body: string }>`select body from saved_letters where advisor_id = 34 and title = ${"Test Newsletter"} order by id desc limit 1`)[0]?.body || ""));
        const letterRow = (await sql<{ id: number; body: string }>`select id, body from saved_letters where advisor_id = 34 and title = ${"Acceptance — Retirement Note"} limit 1`)[0];
        const letter = unpackEletter(String(letterRow?.body || ""));
        const campaign = (await sql<{ name: string; active: string | boolean }>`select name, active from drip_campaigns where advisor_id = 34 and name = ${"Acceptance — Welcome Drip"} limit 1`)[0];
        const contacts = await sql<{ full_name: string }>`select full_name from contacts where advisor_id = 34 and tags like ${"%Acceptance%"} order by full_name`;
        const sent = Number((await sql`select count(*)::int as n from messages where advisor_id = 34`)[0]?.n || 0);
        const letters = Number((await sql`select count(*)::int as n from saved_letters where advisor_id = 34`)[0]?.n || 0);
        const snapshot = {
          turns,
          newsletter: newsletter?.articles.map((item) => item.title) || [],
          letterParagraphs: String(letter?.body || "").split(/\n\n/),
          campaignActive: campaign?.active === true || campaign?.active === "t",
          contacts: contacts.map((row) => row.full_name),
          sentSame: sent === beforeSent,
          lettersSame: letters === beforeLetters,
        };
        await resetAcceptanceDrafts(34);
        const removed = await removeChecklistEchoes(34);
        return Response.json({ ...snapshot, restored: true, removed });
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
  },
});