const KEY = "ua-phone";

export type PhoneLogin = { slug: string; code: string };

export function readPhoneLogin(): PhoneLogin | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PhoneLogin>;
    const slug = String(parsed.slug ?? "").trim();
    const code = String(parsed.code ?? "").trim();
    if (!slug || !code) return null;
    return { slug, code };
  } catch {
    return null;
  }
}

export function savePhoneLogin(login: PhoneLogin) {
  localStorage.setItem(KEY, JSON.stringify({ slug: login.slug, code: login.code }));
  sessionStorage.setItem(`ua:${login.slug}`, login.code);
}

export function clearPhoneLogin(slug?: string) {
  const saved = readPhoneLogin();
  if (!slug || saved?.slug === slug) localStorage.removeItem(KEY);
  if (slug) sessionStorage.removeItem(`ua:${slug}`);
}
