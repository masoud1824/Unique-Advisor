import { useEffect, useState } from "react";
import { dismissDeskNotices, loadDeskNotices } from "@/lib/advisor-links.functions";

function splitJoin(body: string) {
  const match = body.match(/https:\/\/[\w.-]*zoom\.us\/[^\s)]+/i);
  const url = match?.[0] || "";
  const text = body.replace(url, "").replace(/\bJoin:?\s*/gi, "").replace(/\s+/g, " ").trim();
  return { text: text || "Your Zoom meeting is booked.", url };
}

export function DeskNotices({ code, slug }: { code: string; slug: string }) {
  const [notes, setNotes] = useState<{ id: number; body: string }[]>([]);
  function load() {
    void loadDeskNotices({ data: { slug, code } }).then((result) => {
      if (result.ok) setNotes(result.notices.slice(0, 1));
    }).catch(() => undefined);
  }
  function dismiss() {
    setNotes([]);
    void dismissDeskNotices({ data: { slug, code } });
  }
  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener("ua-meetings", refresh);
    return () => window.removeEventListener("ua-meetings", refresh);
  }, [slug, code]);
  useEffect(() => {
    if (notes.length === 0) return;
    const timer = window.setTimeout(dismiss, 20000);
    return () => window.clearTimeout(timer);
  }, [notes, slug, code]);
  if (notes.length === 0) return null;
  const note = notes[0];
  const view = splitJoin(note.body);
  return (
    <div className="mb-4 rounded-lg border px-4 py-3" style={{ borderColor: "#c9a227", background: "#fff8e8" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">{view.text}</p>
        <div className="flex flex-wrap gap-2">
          {view.url ? <a className="ua-btn" style={{ padding: "6px 12px" }} href={view.url} target="_blank" rel="noreferrer">Join Zoom</a> : null}
          <button type="button" className="ua-btn-line" style={{ padding: "6px 12px" }} onClick={dismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}
