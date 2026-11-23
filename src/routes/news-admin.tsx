import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { saveAnnouncement } from "@/lib/platform.functions";

export const Route = createFileRoute("/news-admin")({
  component: AdminAnnouncements,
});

function AdminAnnouncements() {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [priority, setPriority] = useState("10");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [message, setMessage] = useState("");
  async function save(status: "draft" | "published" | "archived") {
    const result = await saveAnnouncement({ data: { code, title, text, link, priority: Number(priority), language: "en", status, startsAt, endsAt } });
    setMessage(result.ok ? `Saved announcement ${result.id} as ${status}.` : result.error);
  }
  return (
    <main style={{ maxWidth: 720, margin: "24px auto", padding: 16 }} dir="ltr" lang="en">
      <h1>Desk news</h1>
      <p>This appears on advisor desks only. It is not emailed and it is not placed on the public site.</p>
      <input value={code} onChange={(event) => setCode(event.target.value)} type="password" aria-label="Superadmin password" placeholder="Superadmin password" />
      <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Title" placeholder="Title" />
      <textarea value={text} onChange={(event) => setText(event.target.value)} aria-label="Text" placeholder="Text" />
      <input value={link} onChange={(event) => setLink(event.target.value)} aria-label="Link" placeholder="Optional link" />
      <input value={priority} onChange={(event) => setPriority(event.target.value)} aria-label="Order" />
      <input value={startsAt} onChange={(event) => setStartsAt(event.target.value)} aria-label="Starts" placeholder="Start ISO date" />
      <input value={endsAt} onChange={(event) => setEndsAt(event.target.value)} aria-label="Ends" placeholder="End ISO date" />
      <button type="button" onClick={() => setMessage(`${title}: ${text}`)}>Preview</button>
      <button type="button" onClick={() => void save("draft")}>Save draft</button>
      <button type="button" onClick={() => void save("published")}>Publish to desks</button>
      <button type="button" onClick={() => void save("archived")}>Archive</button>
      {message && <p>{message}</p>}
    </main>
  );
}
