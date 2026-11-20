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
