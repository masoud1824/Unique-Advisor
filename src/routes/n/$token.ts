import { createFileRoute } from "@tanstack/react-router";
import { shownWebsite } from "@/lib/advisor-website";
import { getSql } from "@/lib/db";
import { readEletterSend, renderEletter } from "@/lib/eletter";
import { readNewsletterPayload, renderNewsletter } from "@/lib/newsletter";

export const Route = createFileRoute("/n/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const fromPath = new URL(request.url).pathname.split("/").filter(Boolean).pop() ?? "";
        const token = String(params.token || fromPath).replace(/[^a-f0-9]/gi, "");
        if (token.length < 16) return new Response("Not found", { status: 404 });
        const sql = await getSql();
        const rows = await sql<{ payload: string; logo_data: string; site_mode: string | null; site_url: string | null; public_website: string | null; slug: string | null }>`
          select n.payload, n.logo_data, a.site_mode, a.site_url, a.public_website, a.slug
          from newsletters n
          left join advisors a on a.id = n.advisor_id
          where n.token = ${token}
        `;
        const row = rows[0];
        const raw = row?.payload ?? "";
        const website = shownWebsite({
          siteMode: row?.site_mode || "",
          siteUrl: row?.site_url || "",
          publicWebsite: row?.public_website || "",
          slug: row?.slug || "",
        });
        const eletter = raw ? readEletterSend(raw) : null;
        if (eletter) {
          if (website) eletter.contact.website = website;
          const html = renderEletter({
            letter: eletter.letter,
            contact: eletter.contact,
            logoSrc: row?.logo_data || "",
            mode: "page",
          });
          return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
        const stored = raw ? readNewsletterPayload(raw) : null;
        if (!stored) return new Response("Not found", { status: 404 });
        if (website) stored.contact.website = website;
        const html = renderNewsletter({
          issue: stored.issue,
          contact: stored.contact,
          logoSrc: row?.logo_data || "",
          mode: "page",
        });
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      },
    },
  },
});
