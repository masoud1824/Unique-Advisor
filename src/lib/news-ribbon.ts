export type Announcement = {
  id: number;
  title: string;
  text: string;
  link: string;
  priority: number;
  language: string;
  status: "draft" | "published" | "archived";
  startsAt: string;
  endsAt: string;
};

export function cleanAnnouncementLink(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw.slice(0, 500);
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString().slice(0, 500);
  } catch {
    return "";
  }
}

export function visibleAnnouncements(items: Announcement[], now: Date, language?: string) {
  const instant = now.getTime();
  return items
    .filter((item) => item.status === "published")
    .filter((item) => !language || item.language === language || item.language === "both")
    .filter((item) => {
      const start = item.startsAt ? Date.parse(item.startsAt) : Number.NEGATIVE_INFINITY;
      const end = item.endsAt ? Date.parse(item.endsAt) : Number.POSITIVE_INFINITY;
      return instant >= start && instant <= end;
    })
    .sort((a, b) => a.priority - b.priority || a.id - b.id);
}

export function ribbonDirection(language: string) {
  return language === "fa" ? "rtl" : "ltr";
}

/** Empty or unknown values use English. Only Farsi selects the Farsi ribbon. */
export function advisorRibbonLanguage(value: string): "en" | "fa" {
  const raw = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  if (raw === "fa" || raw === "fa-ir" || raw === "farsi" || raw === "persian") return "fa";
  return "en";
}

/**
 * The desk, assistant, and ribbon are English-only for now.
 * A stored Farsi preference is ignored, not deleted, so it can be restored later.
 */
export function displayedDeskLanguage(_stored?: string): "en" {
  return "en";
}

export const RIBBON_PIXELS_PER_SECOND = 72;

/** Start off the right edge of the viewport and finish off the left edge. */
export function ribbonTravel(viewportWidth: number, trackWidth: number) {
  const viewport = Math.max(0, Math.round(Number(viewportWidth) || 0));
  const track = Math.max(1, Math.round(Number(trackWidth) || 0));
  const distancePx = viewport + track;
  return {
    startPx: viewport,
    end: "-100%" as const,
    distancePx,
    durationMs: Math.max(8000, Math.round((distancePx / RIBBON_PIXELS_PER_SECOND) * 1000)),
  };
}

/** Configured http(s) or same-site path only. Never invents a destination. */
export function newsHeadlineLink(value: string): { href: string; external: boolean; target: "_blank" | ""; rel: "noopener noreferrer" | "" } | null {
  const href = cleanAnnouncementLink(value);
  if (!href) return null;
  if (/^https?:/i.test(href)) return { href, external: true, target: "_blank", rel: "noopener noreferrer" };
  return { href, external: false, target: "", rel: "" };
}

export const RIBBON_LANGUAGE_FALLBACK =
  "If the desk language is empty or not English or Farsi, the ribbon uses English. English shows English items and items marked both. Farsi shows Farsi items and items marked both. Expired, draft, and archived items stay hidden.";

