import { createFileRoute } from "@tanstack/react-router";
import { exchangeLinkCode, isLinkProvider, saveAdvisorLink, takeLinkState } from "@/lib/advisor-links";

export const Route = createFileRoute("/api/link/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => completeLink(request),
    },
  },
});

function deskUrl(request: Request, redirectUri: string | undefined, slug: string, result: string, detail = "") {
  const current = new URL(request.url);
  let origin = `${current.protocol}//${current.host}`;
  let prefix = current.pathname.replace(/\/api\/(?:link|box|google)\/callback$/i, "");
  if (redirectUri) {
    try {
      const callback = new URL(redirectUri);
      origin = callback.origin;
      prefix = callback.pathname.replace(/\/api\/(?:link|box|google)\/callback$/i, "");
    } catch {
      /* use the incoming request */
    }
  }
  const next = new URL(`${prefix}/a/${encodeURIComponent(slug)}/desk`, origin);
  next.searchParams.set("link", result);
  if (detail) next.searchParams.set("detail", detail.slice(0, 280));
  return next.toString();
}

export async function completeLink(request: Request) {
  const current = new URL(request.url);
  const state = current.searchParams.get("state") ?? "";
  const saved = state ? await takeLinkState(state).catch(() => null) : null;
  if (!saved || !isLinkProvider(saved.provider)) {
    return Response.redirect(deskUrl(request, undefined, "unknown", "error", "That connection link expired. Connect again from Settings."), 302);
  }
  const providerError = current.searchParams.get("error_description") || current.searchParams.get("error") || "";
  if (providerError) {
    return Response.redirect(deskUrl(request, saved.redirect_uri, saved.slug, "error", providerError), 302);
  }
  const code = current.searchParams.get("code") ?? "";
  if (!code) return Response.redirect(deskUrl(request, saved.redirect_uri, saved.slug, "error", "The account did not return a sign-in code."), 302);
  try {
    const tokens = await exchangeLinkCode({
      provider: saved.provider,
      code,
      verifier: saved.verifier,
      redirectUri: saved.redirect_uri,
    });
    await saveAdvisorLink({
      advisorId: saved.advisor_id,
      provider: saved.provider,
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || "",
      expiresIn: Number(tokens.expires_in) || 3600,
    });
    return Response.redirect(deskUrl(request, saved.redirect_uri, saved.slug, "connected"), 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The connection failed.";
    return Response.redirect(deskUrl(request, saved.redirect_uri, saved.slug, "error", message), 302);
  }
}
