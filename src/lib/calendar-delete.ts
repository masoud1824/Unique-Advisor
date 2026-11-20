export type CalendarProvider = "outlook" | "google";

export type ListedEvent = { id: string; title: string; start: string; body: string };

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<Response>;

export function pickCalendarEvent(items: ListedEvent[], wanted: { title: string; start: string; join?: string }) {
  const join = (wanted.join || "").trim();
  if (join) {
    const byJoin = items.find((item) => item.body.includes(join));
    if (byJoin) return byJoin.id;
  }
  const title = wanted.title.trim().toLowerCase();
  const titled = items.filter((item) => item.title.trim().toLowerCase() === title);
  if (titled.length === 1) return titled[0].id;
  const target = new Date(wanted.start).getTime();
  const close = titled.filter((item) => Math.abs(new Date(item.start).getTime() - target) <= 3 * 60 * 1000);
  if (close.length === 1) return close[0].id;
  const anyClose = items.filter((item) => Number.isFinite(target) && Math.abs(new Date(item.start).getTime() - target) <= 2 * 60 * 1000);
  if (anyClose.length === 1) return anyClose[0].id;
  return "";
}

function windowFor(start: string) {
  const at = new Date(start).getTime();
  const from = new Date((Number.isFinite(at) ? at : Date.now()) - 3 * 60 * 60 * 1000).toISOString();
  const to = new Date((Number.isFinite(at) ? at : Date.now()) + 3 * 60 * 60 * 1000).toISOString();
  return { from, to };
}

async function failure(response: Response, label: string) {
  const text = (await response.text()).replace(/\s+/g, " ").slice(0, 180);
  return `${label} did not delete the event: ${text || response.status}`;
}

export async function deleteConnectedEvent(input: {
  provider: CalendarProvider;
  token: string;
  eventId?: string;
  title: string;
  start: string;
  join?: string;
  fetchImpl?: FetchLike;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const call = input.fetchImpl || fetch;
  const label = input.provider === "google" ? "Google Calendar" : "Outlook";
  const headers = { Authorization: `Bearer ${input.token}` };
  let eventId = (input.eventId || "").trim();
  if (!eventId) {
    const span = windowFor(input.start);
    const url = input.provider === "google"
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(span.from)}&timeMax=${encodeURIComponent(span.to)}&singleEvents=true&orderBy=startTime&maxResults=20`
      : `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(span.from)}&endDateTime=${encodeURIComponent(span.to)}&$select=id,subject,start,location,bodyPreview&$top=20`;
    const listed = await call(url, { headers: input.provider === "outlook" ? { ...headers, Prefer: 'outlook.timezone="UTC"' } : headers });
    if (!listed.ok) return { ok: false, error: await failure(listed, label) };
    const json = (await listed.json()) as {
      items?: Array<{ id?: string; summary?: string; description?: string; location?: string; start?: { dateTime?: string; date?: string } }>;
      value?: Array<{ id?: string; subject?: string; bodyPreview?: string; location?: { displayName?: string }; start?: { dateTime?: string } }>;
    };
    const items: ListedEvent[] = input.provider === "google"
      ? (json.items || []).map((item) => ({ id: String(item.id || ""), title: item.summary || "", start: item.start?.dateTime || item.start?.date || "", body: `${item.location || ""} ${item.description || ""}` }))
      : (json.value || []).map((item) => ({ id: String(item.id || ""), title: item.subject || "", start: item.start?.dateTime || "", body: `${item.location?.displayName || ""} ${item.bodyPreview || ""}` }));
    eventId = pickCalendarEvent(items.filter((item) => item.id), { title: input.title, start: input.start, join: input.join });
    if (!eventId) return { ok: true };
  }
  const url = input.provider === "google"
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`
    : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`;
  const removed = await call(url, { method: "DELETE", headers });
  if (removed.status === 204 || removed.status === 404 || removed.status === 410) return { ok: true };
  return { ok: false, error: await failure(removed, label) };
}
