import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { sanitizeArticleHtml } from "@/lib/article-library";
import { saveLibraryArticle, searchLibrary } from "@/lib/platform.functions";

export const Route = createFileRoute("/library-admin")({
  component: AdminArticles,
});

function AdminArticles() {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [authorNote, setAuthorNote] = useState("");
  const [topics, setTopics] = useState("");
  const [language, setLanguage] = useState("en");
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState<Array<{ id: number; title: string; status: string; language: string }>>([]);
  async function save(publish: boolean, archive = false) {
    const result = await saveLibraryArticle({ data: { code, title, bodyHtml, imageUrl, imageAlt, sourceNote, authorNote, topics, language, publish, archive } });
    setMessage(result.ok ? `Saved ${result.status} version ${result.version}.` : result.error);
  }
  return (
    <main style={{ maxWidth: 760, margin: "24px auto", padding: 16 }}>
      <h1>Article library</h1>
      <p>Superadmin only. Publishing adds the article to the internal library. It does not email anyone.</p>
      <input value={code} onChange={(event) => setCode(event.target.value)} type="password" placeholder="Superadmin password" aria-label="Superadmin password" />
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" aria-label="Title" />
      <textarea value={bodyHtml} onChange={(event) => setBodyHtml(event.target.value)} placeholder="Article HTML" aria-label="Article HTML" rows={8} style={{ width: "100%" }} />
      <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="Optional https image" aria-label="Image" />
      <input value={imageAlt} onChange={(event) => setImageAlt(event.target.value)} placeholder="Image description" aria-label="Alt text" />
      <input value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} placeholder="Source" aria-label="Source" />
      <input value={authorNote} onChange={(event) => setAuthorNote(event.target.value)} placeholder="Author" aria-label="Author" />
      <input value={topics} onChange={(event) => setTopics(event.target.value)} placeholder="Topics" aria-label="Topics" />
      <input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="Language" aria-label="Language" />
      <button type="button" onClick={() => setPreview(sanitizeArticleHtml(bodyHtml))}>Preview</button>
      <button type="button" onClick={() => void save(false)}>Save draft</button>
      <button type="button" onClick={() => void save(true)}>Publish internally</button>
      <button type="button" onClick={() => void searchLibrary({ data: { code, superadmin: true, text: title } }).then((result) => result.ok && setRows(result.articles))}>Search</button>
      {preview && <article dangerouslySetInnerHTML={{ __html: preview }} />}
      {message && <p>{message}</p>}
      <ul>{rows.map((row) => <li key={row.id}>{row.title} — {row.status} — {row.language}</li>)}</ul>
    </main>
  );
}
