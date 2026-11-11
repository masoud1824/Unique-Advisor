import { createFileRoute } from "@tanstack/react-router";
import { exchangeCode, explainMicrosoftError, graphMe, saveMicrosoftConnection, takeOAuthState } from "@/lib/microsoft-mail";
import { saveAdvisorLink } from "@/lib/advisor-links";

export const Route = createFileRoute("/api/microsoft/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => completeMicrosoftSignIn(request),
    },
  },
});

function deskUrl(request: Request, redirectUri: string | undefined, slug: string, mail: string, detail = "") {
  if (redirectUri) {
    try {
      const callback = new URL(redirectUri);
      const prefix = callback.pathname.replace(/\/api\/microsoft\/callback$/i, "");
      const next = new URL(`${prefix}/a/${encodeURIComponent(slug)}/desk`, callback.origin);
      next.searchParams.set("mail", mail);
      if (detail) next.searchParams.set("detail", detail.slice(0, 280));
      return next.toString();
    } catch {
      /* use the incoming request if the stored address is unusable */
    }
  }
  const current = new URL(request.url);
  const prefix = current.pathname.replace(/\/api\/microsoft\/callback$/i, "");
  const proto = (request.headers.get("x-forwarded-proto") || current.protocol.replace(":", "")).split(",")[0]?.trim() || "https";
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || current.host).split(",")[0]?.trim() || current.host;
  const next = new URL(`${prefix}/a/${encodeURIComponent(slug)}/desk`, `${proto}://${host}`);
  next.searchParams.set("mail", mail);
  if (detail) next.searchParams.set("detail", detail.slice(0, 280));
  return next.toString();
}

async function completeMicrosoftSignIn(request: Request) {
  const current = new URL(request.url);
  const state = current.searchParams.get("state") ?? "";
  const oauthError = current.searchParams.get("error_description") || current.searchParams.get("error") || "";
  const saved = state ? await takeOAuthState(state).catch(() => null) : null;
  if (!saved) {
    return Response.redirect(deskUrl(request, undefined, "unknown", "error", "This Microsoft sign-in link expired. Connect again from Settings."), 302);
  }
  if (oauthError) {
    return Response.redirect(deskUrl(request, saved.redirect_uri, saved.slug, "error", explainMicrosoftError(400, oauthError)), 302);
  }
  const code = current.searchParams.get("code") ?? "";
  if (!code) {
    return Response.redirect(deskUrl(request, saved.redirect_uri, saved.slug, "error", "Microsoft did not return a sign-in code."), 302);
  }
  try {
    const tokens = await exchangeCode({ code, verifier: saved.verifier, redirectUri: saved.redirect_uri });
    const profile = await graphMe(tokens.access_token as string);
    await saveMicrosoftConnection({
      advisorId: saved.advisor_id,
      email: profile.email,
      name: saved.display_name || profile.name,
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || "",
      expiresIn: Number(tokens.expires_in) || 3600,
    });
    await saveAdvisorLink({
      advisorId: saved.advisor_id,
      provider: "outlook_calendar",
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string) || "",
      expiresIn: Number(tokens.expires_in) || 3600,
    }).catch(() => null);
    return Response.redirect(deskUrl(request, saved.redirect_uri, saved.slug, "connected"), 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Microsoft sign-in failed.";
    return Response.redirect(deskUrl(request, saved.redirect_uri, saved.slug, "error", message), 302);
  }
}
