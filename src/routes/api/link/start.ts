import { createFileRoute } from "@tanstack/react-router";
import { gateAdvisor } from "@/lib/advisor-db";
import { createLinkAuthorization, isLinkProvider, linkLabel } from "@/lib/advisor-links";

export const Route = createFileRoute("/api/link/start")({
  server: {
    handlers: {
      POST: async ({ request }) => startLink(request),
    },
  },
});

function deskBack(request: Request, slug: string, result: string, detail = "") {
  const current = new URL(request.url);
  const next = new URL(`/a/${encodeURIComponent(slug || "unknown")}/desk`, `${current.protocol}//${current.host}`);
  next.searchParams.set("link", result);
  if (detail) next.searchParams.set("detail", detail.replace(/\s+/g, " ").slice(0, 240));
  next.hash = "connections";
  return next;
}

function crossSite(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  return Boolean(site && site !== "same-origin" && site !== "none");
}

export async function startLink(request: Request) {
  const form = await request.formData().catch(() => null);
  const slug = String(form?.get("slug") || "").trim();
  const code = String(form?.get("code") || "");
  const provider = String(form?.get("provider") || "");
  const redirectUri = String(form?.get("redirectUri") || "");
  const label = isLinkProvider(provider) ? linkLabel(provider) : "That account";
  if (crossSite(request)) {
    return Response.redirect(deskBack(request, slug, "error", `${label} sign-in was blocked because it did not come from this site.`), 303);
  }
  try {
    const gate = await gateAdvisor(slug, code);
    if (!gate.ok) return Response.redirect(deskBack(request, slug, "error", gate.error), 303);
    if (!isLinkProvider(provider)) {
      return Response.redirect(deskBack(request, gate.row.slug, "error", "That connection is not available."), 303);
    }
    const started = await createLinkAuthorization({
      advisorId: gate.row.id,
      slug: gate.row.slug,
      provider,
      redirectUri,
      request,
    });
    if (!started.ok || !started.url) {
      return Response.redirect(deskBack(request, gate.row.slug, "error", started.error || `${label} sign-in could not be started.`), 303);
    }
    return Response.redirect(started.url, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : `${label} sign-in could not be started.`;
    return Response.redirect(deskBack(request, slug, "error", message), 303);
  }
}
