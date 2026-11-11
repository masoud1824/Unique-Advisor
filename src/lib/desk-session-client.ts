const KEY = "ua-desk-session";

export type StoredDeskSession = { slug: string; token: string };

export function readDeskToken(slug?: string): string {
  if (typeof window === "undefined") return "";
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "") as Partial<StoredDeskSession>;
    const token = String(parsed.token || "").trim();
    const saved = String(parsed.slug || "").trim();
    if (token.length < 32) return "";
    if (slug && saved !== slug) return "";
    return token;
  } catch {
    return "";
  }
}

export function saveDeskToken(slug: string, token: string) {
  if (typeof window === "undefined" || !slug || token.length < 32) return;
  localStorage.setItem(KEY, JSON.stringify({ slug, token }));
}

export function clearDeskToken(slug?: string) {
  if (typeof window === "undefined") return;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "{}") as { slug?: string };
    if (!slug || parsed.slug === slug) localStorage.removeItem(KEY);
  } catch {
    localStorage.removeItem(KEY);
  }
}

export function installDeskSessionFetch() {
  if (typeof window === "undefined") return;
  const marker = window as Window & { __uaDeskFetch?: boolean };
  if (marker.__uaDeskFetch) return;
  marker.__uaDeskFetch = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const token = readDeskToken();
    if (!token) return original(input, init);
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const resolved = new URL(raw, window.location.href);
      if (resolved.origin !== window.location.origin) return original(input, init);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has("x-ua-desk")) headers.set("x-ua-desk", token);
      return original(input, { ...init, headers, credentials: init?.credentials ?? "include" });
    } catch {
      return original(input, init);
    }
  };
}
