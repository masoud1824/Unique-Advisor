import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { beginMicrosoftConnect } from "@/lib/advisor.functions";
import { browserPublicUrl } from "@/lib/preview-path-prefix";
import { signInConnection } from "@/lib/advisor-links.functions";
import { loadAdvisorCalendar, saveAdvisorCalendarEvent, syncAdvisorCalendar, cancelAdvisorMeeting } from "@/lib/advisor-links.functions";
import { tidyMeetingTitle } from "@/lib/meeting-time";

type EventRow = { id: number; source: string; title: string; start: string; minutes: number };
type Accounts = { google: boolean; outlook: boolean; icloud: boolean; googleAccount: string; outlookAccount: string; icloudAccount: string };
type Source = "outlook" | "google" | "desk";

const SOURCES: Array<{ id: Source; label: string; hint: string }> = [
  { id: "outlook", label: "Outlook", hint: "Microsoft blocks a typed password. Sign in with Microsoft opens Microsoft’s own page." },
  { id: "google", label: "Google", hint: "Gmail address and a Google app password." },
];

export function CalendarDesk({ code, slug, ping }: { code: string; slug: string; ping: (text: string) => void }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [events, setEvents] = useState<EventRow[]>([]);
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [source, setSource] = useState<Source>("outlook");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [view, setView] = useState<"day" | "week" | "month">("week");
  useLayoutEffect(() => {
    setView("week");
    try {
      const drop = ["ua-calendar-view", `ua-calendar-view:${slug}`];
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index) || "";
        if (/calendar/i.test(key) && /view/i.test(key)) drop.push(key);
      }
      for (const key of drop) localStorage.removeItem(key);
    } catch { /* this browser is not storing a view */ }
  }, [slug]);
  const [focus, setFocus] = useState(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [picked, setPicked] = useState<EventRow | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [notifyClient, setNotifyClient] = useState(true);
  const [zone, setZone] = useState("America/Toronto");
  const weekBox = useRef<HTMLDivElement | null>(null);
  const monthBox = useRef<HTMLDivElement | null>(null);
  const [weekWide, setWeekWide] = useState(true);
  const [monthWide, setMonthWide] = useState(true);

  async function load(year = cursor.year, month = cursor.month) {
    const result = await loadAdvisorCalendar({ data: { slug, code, year, month } });
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setEvents(result.events);
    setAccounts(result.accounts);
    if ("timeZone" in result && result.timeZone) setZone(result.timeZone);
  }

  useEffect(() => {
    void load(cursor.year, cursor.month);
  }, [cursor.year, cursor.month, slug, code]);

  useLayoutEffect(() => {
    const node = weekBox.current;
    if (!node || view !== "week") return;
    const apply = () => setWeekWide(node.clientWidth >= 1100);
    apply();
    const watch = new ResizeObserver(apply);
    watch.observe(node);
    return () => watch.disconnect();
  }, [view]);

  useLayoutEffect(() => {
    const node = monthBox.current;
    if (!node || view !== "month") return;
    const apply = () => setMonthWide(node.clientWidth >= 700);
    apply();
    const watch = new ResizeObserver(apply);
    watch.observe(node);
    return () => watch.disconnect();
  }, [view]);

  function sameDay(date: Date, iso: string) {
    const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    const day = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
    return day(noon) === day(new Date(iso));
  }

  function clock(iso: string, withDay = false) {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: zone,
      weekday: withDay ? "long" : undefined,
      month: withDay ? "long" : undefined,
      day: withDay ? "numeric" : undefined,
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function range(iso: string, minutes: number) {
    const start = new Date(iso);
    const end = new Date(start.getTime() + Math.max(1, Number(minutes) || 30) * 60_000);
    const piece = (date: Date) => {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(date);
      const hour = parts.find((part) => part.type === "hour")?.value || "";
      const minute = parts.find((part) => part.type === "minute")?.value || "00";
      const period = parts.find((part) => part.type === "dayPeriod")?.value || "";
      return { clock: `${hour}:${minute}`, period };
    };
    const open = piece(start);
    const close = piece(end);
    if (open.period === close.period) return `${open.clock}–${close.clock} ${open.period}`;
    return `${open.clock} ${open.period}–${close.clock} ${close.period}`;
  }

  function shortTime(iso: string) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso));
    const hour = parts.find((part) => part.type === "hour")?.value || "";
    const minute = parts.find((part) => part.type === "minute")?.value || "00";
    const period = (parts.find((part) => part.type === "dayPeriod")?.value || "").toLowerCase().startsWith("p") ? "p" : "a";
    return minute === "00" ? `${hour}${period}` : `${hour}:${minute}${period}`;
  }

  function eventsOn(date: Date) {
    return events.filter((event) => sameDay(date, event.start));
  }

  function go(next: Date) {
    const day = new Date(next.getFullYear(), next.getMonth(), next.getDate());
    setFocus(day);
    setPicked(null);
    setConfirmRemove(false);
    if (day.getFullYear() !== cursor.year || day.getMonth() !== cursor.month) setCursor({ year: day.getFullYear(), month: day.getMonth() });
  }

  function step(direction: number) {
    const next = new Date(focus);
    if (view === "day") next.setDate(next.getDate() + direction);
    else if (view === "week") next.setDate(next.getDate() + direction * 7);
    else next.setMonth(next.getMonth() + direction);
    go(next);
  }

  function openDay(date: Date) {
    go(date);
    setView("day");
  }

  async function signIn() {
    if (source === "desk") return;
    setBusy("sign");
    setNote("");
    if (source === "outlook") {
      const result = await beginMicrosoftConnect({
        data: { slug, code, redirectUri: browserPublicUrl("/api/microsoft/callback"), displayName: "" },
      });
      setBusy("");
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      window.location.assign(result.url);
      return;
    }
    const result = await signInConnection({ data: { slug, code, provider: "google", username: email, password } });
    setBusy("");
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setPassword("");
    setNote("Signed in.");
    await sync(source);
  }

  async function sync(chosen: Source = source) {
    if (chosen === "desk") return;
    setBusy("sync");
    setNote("");
    const result = await syncAdvisorCalendar({ data: { slug, code, source: chosen, year: cursor.year, month: cursor.month } });
    setBusy("");
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setEvents(result.events);
    setAccounts(result.accounts);
    const label = chosen === "google" ? "Google" : "Outlook";
    const text = `Synced ${result.count} event${result.count === 1 ? "" : "s"} from ${label}.`;
    setNote(text);
    ping(text);
  }

  async function addEvent() {
    if (!when) return ping("Choose the date and time.");
    setBusy("add");
    setNote("");
    const result = await saveAdvisorCalendarEvent({
      data: { slug, code, title, start: new Date(when).toISOString(), minutes, source },
    });
    setBusy("");
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setTitle("");
    setWhen("");
    ping("Event added.");
    await load();
  }

  async function removePicked() {
    if (!picked) return;
    setBusy("remove");
    setNote("");
    const result = await cancelAdvisorMeeting({
      data: { slug, code, eventId: picked.id, notify: picked.source === "Zoom" ? notifyClient : false },
    });
    setBusy("");
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    const text = result.warning ? `Cancelled. ${result.warning}` : picked.source === "Zoom" ? "Meeting cancelled." : "Event removed.";
    setPicked(null);
    setConfirmRemove(false);
    setNote(text);
    ping(text);
    window.dispatchEvent(new Event("ua-meetings"));
    await load();
  }

  const first = new Date(cursor.year, cursor.month, 1);
  const days = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const monthLead = first.getDay();
  const monthCount = Math.ceil((monthLead + days) / 7) * 7;
  const monthStart = new Date(cursor.year, cursor.month, 1 - monthLead);
  const monthDates = Array.from({ length: monthCount }, (_, index) => new Date(monthStart.getFullYear(), monthStart.getMonth(), monthStart.getDate() + index));
  const weekStart = new Date(focus);
  weekStart.setDate(focus.getDate() - focus.getDay());
  const week = Array.from({ length: 7 }, (_, index) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index));
  const heading = view === "day"
    ? focus.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : view === "week"
      ? `${week[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${week[6].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
      : first.toLocaleString(undefined, { month: "long", year: "numeric" });
  const connected = source === "google" ? accounts?.google : source === "outlook" ? accounts?.outlook : false;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <aside className="order-1 grid gap-4 xl:order-2">
        <section className="ua-panel p-4">
          <h2 className="text-base font-semibold">Sync a calendar</h2>
          <p className="mt-1 mb-3 text-sm" style={{ color: "#5a6a7a" }}>Choose Outlook or Google. Sign in once, then sync this month.</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {SOURCES.map((item) => (
              <button key={item.id} type="button" className={source === item.id ? "ua-btn" : "ua-btn-line"} onClick={() => { setSource(item.id); setNote(""); }}>{item.label}</button>
            ))}
          </div>
          <p className="mb-3 text-sm" style={{ color: "#5a6a7a" }}>
            {source === "desk"
              ? "This event stays on the desk calendar only."
              : connected
                ? `Connected${source === "outlook" && accounts?.outlookAccount ? ` as ${accounts.outlookAccount}` : source === "google" && accounts?.googleAccount ? ` as ${accounts.googleAccount}` : ""}.`
                : source === "outlook"
                  ? "Outlook is not signed in. Press Sign in with Microsoft. The same Microsoft email in Settings is used for this calendar. Meetings already on this desk still show."
                  : "Sign in with the Gmail address and a Google app password."}
          </p>
          {source === "outlook" && (
            <button type="button" className="ua-btn" disabled={busy !== ""} onClick={() => void signIn()}>{busy === "sign" ? "Opening Microsoft…" : "Sign in with Microsoft"}</button>
          )}
          {source !== "desk" && source !== "outlook" && (
            <div className="grid gap-2">
              <label className="grid gap-1 text-sm font-semibold">
                Email
                <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" className="ua-field font-normal" autoComplete="off" />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Password
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className="ua-field font-normal" autoComplete="off" />
              </label>
              <button type="button" className="ua-btn" disabled={busy !== ""} onClick={() => void signIn()}>{busy === "sign" ? "Checking…" : "Sign in and sync"}</button>
            </div>
          )}
          {connected && source !== "desk" && (
            <button type="button" className="ua-btn-line mt-2" disabled={busy !== ""} onClick={() => void sync()}>{busy === "sync" ? "Syncing…" : "Sync this month"}</button>
          )}
        </section>
        <section className="ua-panel p-4">
          <h2 className="text-base font-semibold">Add an event</h2>
          <label className="mt-3 grid gap-1 text-sm font-semibold">
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="ua-field font-normal" />
          </label>
          <label className="mt-3 grid gap-1 text-sm font-semibold">
            Date and time
            <input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} className="ua-field font-normal" />
          </label>
          <label className="mt-3 mb-3 grid gap-1 text-sm font-semibold">
            Minutes
            <input type="number" min={15} max={480} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} className="ua-field font-normal" />
          </label>
          <button type="button" className="ua-btn" disabled={busy !== ""} onClick={() => void addEvent()}>{busy === "add" ? "Saving…" : source === "desk" ? "Save on this desk" : `Add to ${SOURCES.find((item) => item.id === source)?.label}`}</button>
          <button type="button" className="ua-btn-line mt-2" onClick={() => setSource("desk")}>Save on this desk only</button>
        </section>
        {note && <p className="text-sm font-semibold" style={{ color: /^(Synced|Signed|Event|Meeting|Removed|Cancelled)/.test(note) ? "#0d7a4f" : "#b42318" }}>{note}</p>}
      </aside>
      <section className="ua-panel order-2 p-4 xl:order-1">
        <div className="mb-3 flex flex-wrap gap-2">
          {(["day", "week", "month"] as const).map((item) => (
            <button key={item} type="button" className={view === item ? "ua-btn" : "ua-btn-line"} onClick={() => { setView(item); setPicked(null); setConfirmRemove(false); }}>{item === "day" ? "Day" : item === "week" ? "Week" : "Month"}</button>
          ))}
        </div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <button type="button" className="ua-btn-line" onClick={() => step(-1)}>Previous</button>
          <h2 className="text-lg font-semibold">{heading}</h2>
          <button type="button" className="ua-btn-line" onClick={() => step(1)}>Next</button>
        </div>
        {picked && (
          <div className="mb-4 rounded-lg border p-4" style={{ borderColor: "#0f4c81", background: "#f4f9fd" }}>
            <p className="text-lg font-semibold">{tidyMeetingTitle(picked.title)}</p>
            <p className="mt-1 text-sm">{clock(picked.start, true)}</p>
            <p className="text-sm">{picked.minutes} minutes · {picked.source}</p>
            {!confirmRemove ? (
              <button type="button" className="ua-btn-line mt-3" onClick={() => { setConfirmRemove(true); setNotifyClient(true); }}>Remove</button>
            ) : (
              <div className="mt-3 grid gap-2">
                <p className="font-semibold">{picked.source === "Zoom" ? "Cancel this meeting?" : "Remove this event?"}</p>
                {picked.source === "Zoom" && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={notifyClient} onChange={(event) => setNotifyClient(event.target.checked)} />
                    Email the client a cancellation notice
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="ua-btn" disabled={busy !== ""} onClick={() => void removePicked()}>{busy === "remove" ? "Cancelling…" : picked.source === "Zoom" ? "Cancel meeting" : "Remove event"}</button>
                  <button type="button" className="ua-btn-line" disabled={busy !== ""} onClick={() => setConfirmRemove(false)}>Keep</button>
                </div>
              </div>
            )}
            <button type="button" className="ua-btn-line mt-3" onClick={() => { setPicked(null); setConfirmRemove(false); }}>Close</button>
          </div>
        )}
        {view === "day" && (
          <div className="grid gap-2">
            {eventsOn(focus).length === 0 && <p className="text-sm" style={{ color: "#5a6a7a" }}>Nothing is booked on this day.</p>}
            {eventsOn(focus).map((event, index) => (
              <div key={`${event.id}-${index}`} className="flex items-center gap-2 rounded-lg border px-3 py-3" style={{ borderColor: "#e1e8ef" }}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setPicked(event); setConfirmRemove(false); }}>
                  <p className="font-semibold">{tidyMeetingTitle(event.title)}</p>
                  <p className="text-sm" style={{ color: "#5a6a7a" }}>{clock(event.start)} · {event.minutes} minutes · {event.source}</p>
                </button>
                <button type="button" className="ua-btn-line" onClick={() => { setPicked(event); setConfirmRemove(true); setNotifyClient(event.source === "Zoom"); }}>Remove</button>
              </div>
            ))}
          </div>
        )}
        {view === "week" && (
          <div ref={weekBox}>
            {weekWide ? (
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(7, minmax(150px, 1fr))" }}>
                {week.map((date) => {
                  const items = [...eventsOn(date)].sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
                  const todayMark = sameDay(date, new Date().toISOString());
                  return (
                    <div key={date.toISOString()} className="min-h-[400px] rounded-lg border p-2" style={{ minWidth: 150, borderColor: todayMark ? "#0f4c81" : "#e1e8ef", background: todayMark ? "#f4f9fd" : "#fff" }}>
                      <button type="button" className="text-xs font-semibold" onClick={() => openDay(date)}>{date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}</button>
                      {items.map((event, index) => (
                        <div key={`${event.id}-${index}`} className="relative mt-2 rounded-md border px-2 py-1.5 pr-6" style={{ borderColor: "#d5e4f2", background: "#f7fbfe", color: "#0f4c81" }}>
                          <button type="button" className="w-full text-left text-xs leading-snug" style={{ wordBreak: "normal" }} onClick={() => { setPicked(event); setConfirmRemove(false); }}>
                            <span className="block font-semibold" style={{ color: "#5a6a7a", whiteSpace: "nowrap" }}>{range(event.start, event.minutes)}</span>
                            <span className="mt-0.5 block font-semibold" style={{ wordBreak: "normal", overflowWrap: "break-word" }}>{tidyMeetingTitle(event.title)}</span>
                          </button>
                          <button type="button" className="absolute right-1 top-1 px-1 text-sm font-bold leading-none" aria-label="Remove event" title="Remove event" style={{ color: "#5a6a7a" }} onClick={() => { setPicked(event); setConfirmRemove(true); setNotifyClient(event.source === "Zoom"); }}>×</button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid gap-2">
                {week.map((date) => {
                  const items = [...eventsOn(date)].sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
                  const todayMark = sameDay(date, new Date().toISOString());
                  return (
                    <div key={date.toISOString()} className="rounded-lg border px-3 py-3" style={{ borderColor: todayMark ? "#0f4c81" : "#e1e8ef", background: todayMark ? "#f4f9fd" : "#fff" }}>
                      <button type="button" className="text-sm font-semibold" onClick={() => openDay(date)}>{date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</button>
                      {items.length === 0 && <p className="mt-2 text-sm" style={{ color: "#8a97a6" }}>No events</p>}
                      {items.map((event, index) => (
                        <div key={`${event.id}-${index}`} className="mt-2 flex items-start gap-2 rounded-md border px-3 py-2" style={{ borderColor: "#d5e4f2", background: "#f7fbfe" }}>
                          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setPicked(event); setConfirmRemove(false); }}>
                            <span className="flex items-start gap-3">
                              <span className="shrink-0 text-xs font-semibold" style={{ color: "#5a6a7a", whiteSpace: "nowrap" }}>{range(event.start, event.minutes)}</span>
                              <span className="min-w-0 flex-1 text-sm font-semibold" style={{ color: "#0f4c81", wordBreak: "normal", overflowWrap: "break-word" }}>{tidyMeetingTitle(event.title)}</span>
                            </span>
                          </button>
                          <button type="button" className="shrink-0 px-1 text-sm font-bold leading-none" aria-label="Remove event" title="Remove event" style={{ color: "#5a6a7a" }} onClick={() => { setPicked(event); setConfirmRemove(true); setNotifyClient(event.source === "Zoom"); }}>×</button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {view === "month" && (
          <div ref={monthBox}>
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold" style={{ color: "#5a6a7a" }}>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day}>{day}</div>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {monthDates.map((date) => {
                const outside = date.getMonth() !== cursor.month;
                const items = [...eventsOn(date)].sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
                const todayMark = sameDay(date, new Date().toISOString());
                const shown = items.slice(0, 3);
                const extra = items.length - shown.length;
                return (
                  <div key={date.toISOString()} className="min-h-[110px] overflow-hidden rounded-lg border p-1.5 text-left" style={{ borderColor: "#e1e8ef", background: outside ? "#f7f9fc" : "#fff" }}>
                    {monthWide ? (
                      <>
                        <button type="button" className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold" style={todayMark ? { background: "#0f4c81", color: "#fff" } : { color: outside ? "#8a97a6" : "#16324f" }} onClick={() => openDay(date)}>{date.getDate()}</button>
                        {shown.map((event, eventIndex) => (
                          <button key={`${event.id}-${eventIndex}`} type="button" className="mt-0.5 flex w-full min-w-0 items-center gap-1 text-left text-xs" title={`${tidyMeetingTitle(event.title)} · ${range(event.start, event.minutes)}`} onClick={() => { setPicked(event); setConfirmRemove(false); }}>
                            <span className="shrink-0 rounded-full" style={{ width: 6, height: 6, background: "#0f4c81" }} />
                            <span className="shrink-0 font-semibold" style={{ color: "#5a6a7a", whiteSpace: "nowrap" }}>{shortTime(event.start)}</span>
                            <span className="min-w-0 flex-1 truncate" style={{ color: outside ? "#8a97a6" : "#16324f" }}>{tidyMeetingTitle(event.title)}</span>
                          </button>
                        ))}
                        {extra > 0 && <button type="button" className="mt-0.5 text-xs font-semibold" style={{ color: "#0f4c81" }} onClick={() => openDay(date)}>+{extra} more</button>}
                      </>
                    ) : (
                      <button type="button" className="flex min-h-[96px] w-full flex-col items-center" onClick={() => openDay(date)}>
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold" style={todayMark ? { background: "#0f4c81", color: "#fff" } : { color: outside ? "#8a97a6" : "#16324f" }}>{date.getDate()}</span>
                        {items.length > 0 && (
                          <span className="mt-1 flex max-w-full flex-wrap justify-center gap-1">
                            {items.slice(0, 6).map((event, dot) => <span key={`${event.id}-${dot}`} className="rounded-full" style={{ width: 6, height: 6, background: "#0f4c81" }} />)}
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
