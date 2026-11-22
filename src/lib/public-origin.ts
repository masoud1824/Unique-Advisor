/** Public origin for a new host. Never invents a Grok domain. */

export function configuredPublicOrigin() {
  const raw = (process.env.PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local) return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function absoluteAppUrl(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const origin = configuredPublicOrigin();
  return origin ? `${origin}${normalized}` : normalized;
}

/** Zoom's redirect must be the configured https origin. Empty means sign-in does not start. */
export function zoomRedirectUri() {
  const origin = configuredPublicOrigin();
  return origin ? `${origin}/api/zoom/callback` : "";
}
