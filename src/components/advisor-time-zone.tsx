import { useEffect, useState } from "react";
import { ADVISOR_ZONES } from "@/lib/meeting-time";
import { loadAdvisorZone, saveTimeZone } from "@/lib/advisor-links.functions";

export function AdvisorTimeZone({ code, slug }: { code: string; slug: string }) {
  const [zone, setZone] = useState("America/Toronto");
  const [note, setNote] = useState("");
  useEffect(() => {
    void loadAdvisorZone({ data: { slug, code } }).then((result) => {
      if (result.ok) setZone(result.timeZone);
    }).catch(() => undefined);
  }, [slug, code]);
  return (
    <section className="ua-panel mb-5 p-6">
      <h2 className="text-lg font-semibold">Time zone</h2>
      <p className="mt-2 mb-4 text-sm" style={{ color: "#5a6a7a" }}>
        Zoom meetings, the calendar, and reminders use this time zone. The default is Toronto.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="ua-field font-normal"
          value={zone}
          onChange={(event) => {
            const next = event.target.value;
            setZone(next);
            void saveTimeZone({ data: { slug, code, timeZone: next } }).then((result) => {
              setNote(result.ok ? "Time zone saved." : result.error);
            });
          }}
        >
          {ADVISOR_ZONES.map((item) => <option key={item[0]} value={item[0]}>{item[1]}</option>)}
        </select>
        {note && <p className="text-sm font-semibold" style={{ color: note.includes("saved") ? "#0d7a4f" : "#b42318" }}>{note}</p>}
      </div>
    </section>
  );
}
