import { useState } from "react";
import { copyLibraryIntoNewsletter, searchLibrary } from "@/lib/platform.functions";

export function ArticleLibraryDesk({ slug, code, ping }: { slug: string; code: string; ping: (text: string) => void }) {
  const [text, setText] = useState("");
  const [topic, setTopic] = useState("");
  const [language, setLanguage] = useState("");
  const [rows, setRows] = useState<Array<{ id: number; title: string; bodyText: string; topics: string; language: string; version: number }>>([]);
  const [picked, setPicked] = useState<number[]>([]);
  async function search() {
    const result = await searchLibrary({ data: { slug, code, text, topic, language } });
    if (!result.ok) { ping(result.error); return; }
    setRows(result.articles);
  }
  async function copySelected() {
    const result = await copyLibraryIntoNewsletter({ data: { slug, code, articleIds: picked, title: "Library selection", mode: "new" } });
    if (!result.ok) { ping(result.error); return; }
    ping(`Saved newsletter ${result.newsletterId} with ${result.articles.length} articles. No recipients. Nothing was sent.`);
  }
  return (
    <section style={{ padding: 16 }}>
      <h2>Article library</h2>
      <p>Published articles only. Saving a copy does not change the library, does not email anyone, and a later library edit does not change the saved copy.</p>
      <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Search title or text" aria-label="Search articles" />
      <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Topic" aria-label="Topic" />
      <input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="Language" aria-label="Language" />
      <button type="button" onClick={() => void search()}>Search</button>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <label>
              <input type="checkbox" checked={picked.includes(row.id)} onChange={() => setPicked((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} />
              {row.title} ({row.language}, v{row.version})
            </label>
            <p>{row.bodyText}</p>
            {picked.includes(row.id) && (
              <span>
                <button type="button" onClick={() => setPicked((current) => {
                  const index = current.indexOf(row.id);
                  if (index <= 0) return current;
                  const next = current.slice();
                  const [item] = next.splice(index, 1);
                  next.splice(index - 1, 0, item);
                  return next;
                })}>Up</button>
                <button type="button" onClick={() => setPicked((current) => {
                  const index = current.indexOf(row.id);
                  if (index < 0 || index >= current.length - 1) return current;
                  const next = current.slice();
                  const [item] = next.splice(index, 1);
                  next.splice(index + 1, 0, item);
                  return next;
                })}>Down</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => void copySelected()} disabled={picked.length === 0}>Copy into a new newsletter</button>
    </section>
  );
}
