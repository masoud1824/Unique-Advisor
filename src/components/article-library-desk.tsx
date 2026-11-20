import { useState } from "react";
import { RichTextEditor } from "@/components/rich-text-editor";
import { copyLibraryIntoNewsletter, searchLibrary } from "@/lib/platform.functions";

export function ArticleLibraryDesk({ slug, code, ping }: { slug: string; code: string; ping: (text: string) => void }) {
  const [text, setText] = useState("");
  const [topic, setTopic] = useState("");
  const [language, setLanguage] = useState("");
  const [rows, setRows] = useState<Array<{ id: number; title: string; bodyHtml: string; bodyText: string; topics: string; language: string; version: number }>>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [copyTitle, setCopyTitle] = useState("");
  const [copyHtml, setCopyHtml] = useState("");
  const [existingId, setExistingId] = useState("");
  async function search() {
    const result = await searchLibrary({ data: { slug, code, text, topic, language } });
    if (!result.ok) { ping(result.error); return; }
    setRows(result.articles);
  }
  async function copySelected() {
    const one = picked.length === 1 ? rows.find((row) => row.id === picked[0]) : undefined;
    const edits = one && (copyHtml || copyTitle) ? [{ id: one.id, title: copyTitle || undefined, bodyHtml: copyHtml || undefined }] : [];
    const result = await copyLibraryIntoNewsletter({
      data: {
        slug,
        code,
        articleIds: picked,
        title: "Library selection",
        mode: existingId ? "append" : "new",
        newsletterId: existingId ? Number(existingId) : undefined,
        edits,
      },
    });
    if (!result.ok) { ping(result.error); return; }
    ping(`Saved newsletter ${result.newsletterId} with ${result.articles.length} articles. No recipients. Nothing was sent.`);
  }
  return (
    <section style={{ padding: 16 }}>
      <h2>Article library</h2>
      <p>Published articles only. You can change the wording of one selected copy before saving. That does not change the library, does not add recipients, and does not email anyone.</p>
      <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Search title or text" aria-label="Search articles" />
      <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Topic" aria-label="Topic" />
      <input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="Language" aria-label="Language" />
      <button type="button" onClick={() => void search()}>Search</button>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <label>
              <input type="checkbox" checked={picked.includes(row.id)} onChange={() => {
                const next = picked.includes(row.id) ? picked.filter((id) => id !== row.id) : [...picked, row.id];
                setPicked(next);
                if (next.length === 1) {
                  const chosen = rows.find((item) => item.id === next[0]);
                  setCopyTitle(chosen?.title || "");
                  setCopyHtml(chosen?.bodyHtml || "");
                }
              }} />
              {row.title} ({row.language}, v{row.version})
            </label>
            <p>{row.bodyText}</p>
          </li>
        ))}
      </ul>
      {picked.length === 1 && (
        <div>
          <label>Your copy of the title <input value={copyTitle} onChange={(event) => setCopyTitle(event.target.value)} aria-label="Your copy of the title" /></label>
          <RichTextEditor value={copyHtml} onChange={setCopyHtml} label="Your copy of the article" />
        </div>
      )}
      <label>Existing newsletter number, if you are adding to one <input value={existingId} onChange={(event) => setExistingId(event.target.value)} aria-label="Existing newsletter number" /></label>
      <button type="button" onClick={() => void copySelected()} disabled={picked.length === 0}>Save newsletter with no recipients</button>
    </section>
  );
}
