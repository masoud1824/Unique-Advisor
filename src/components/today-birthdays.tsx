import { useEffect, useState } from "react";
import { loadTodaysBirthdays } from "@/lib/birthday-desk.functions";

function msUntilZoneMidnight(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const num = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const left = ((23 - num("hour")) * 3600 + (59 - num("minute")) * 60 + (60 - num("second"))) * 1000;
  return Math.min(Math.max(left, 1000), 24 * 60 * 60 * 1000);
}
type Row = { contactId: string; name: string; card: "accepted" | "delivered" | "failed" | "uncertain" | "not sent" | "unavailable" };
type Report = { date: string; timeZone: string; records: "read" | "unavailable"; people: Row[] };

export function TodayBirthdays({ slug, code, onSettings }: { slug: string; code: string; onSettings?: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let gone = false;
    let midnight = 0;
    const load = () => {
      void loadTodaysBirthdays({ data: { slug, code } }).then((result) => {
        if (gone) return;
        if (!result?.ok) {
          setError("error" in result && result.error ? result.error : "Today's birthdays could not be read.");
          return;
        }
        setError("");
        setReport({ date: result.date, timeZone: result.timeZone, records: result.records, people: result.people });
        window.clearTimeout(midnight);
        midnight = window.setTimeout(load, msUntilZoneMidnight(result.timeZone));
      }).catch(() => {
        if (!gone) setError("Today's birthdays could not be read.");
      });
    };
    load();
    const timer = window.setInterval(load, 15 * 60 * 1000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      gone = true;
      window.clearInterval(timer);
      window.clearTimeout(midnight);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [slug, code]);

  return (
    <section className="ua-panel mb-6 p-6" data-todays-birthdays>
      <h2 className="text-lg font-semibold">Today's birthdays</h2>
      <p className="mt-1 text-sm" style={{ color: "#5a6a7a" }}>
        {report ? `${report.date} in ${report.timeZone}. ` : ""}
        This reports saved contacts and birthday-card records. It does not send a card.
      </p>
      {error && <p className="mt-3 text-sm font-semibold" style={{ color: "#b42318" }}>{error}</p>}
      {report?.records === "unavailable" && <p className="mt-3 text-sm font-semibold">Birthday card records could not be read, so sent or not sent is unavailable.</p>}
      {report && report.people.length === 0 && <p className="mt-3 text-sm">No birthdays today.</p>}
      {report && report.people.length > 0 && (
        <ul className="mt-3">
          {report.people.map((person) => (
            <li key={person.contactId} className="border-b py-2 text-sm" style={{ borderColor: "#e1e8ef" }}>
              <strong>{person.name}</strong>
              <span className="block" style={{ color: "#5a6a7a" }}>Birthday card: {person.card}</span>
            </li>
          ))}
        </ul>
      )}
      {onSettings && <button type="button" className="ua-btn-line mt-3" onClick={onSettings}>Birthday settings</button>}
    </section>
  );
}
