import { useEffect, useMemo, useState } from "react";
import { groupLibraryArticles } from "@/lib/article-library";
import { searchLibrary } from "@/lib/platform.functions";

const TITLE_COLORS = ["#0c2f6b", "#1C3D36", "#8c4a32", "#1f4d3a", "#6b3a2a", "#1e4d8c"];

function topicColor(topic: string) {
  let n = 0;
  for (const ch of topic) n = (n + ch.charCodeAt(0)) % TITLE_COLORS.length;
  return TITLE_COLORS[n];
}

type Row = { id: number; title: string; bodyHtml: string; bodyText: string; topics: string; language: string; version: number };

export function ArticleLibraryDesk({
  slug,
  code,
  ping,
  onClose,
  onUse,
}: {
  slug: string;
  code: string;
  ping: (text: string) => void;
  onClose?: () => void;
  onUse?: (article: { title: string; body: string }) => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let stop = false;
    void searchLibrary({ data: { slug, code, text: "", topic: "" } }).then((result) => {
      if (stop) return;
      if (!result.ok) { ping(result.error); return; }
      setRows(result.articles);
    });
    return () => { stop = true; };
  }, [slug, code]);
  const shown = useMemo(() => {
    const needle = text.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((row) => `${row.title}\n${row.bodyText}\n${row.topics}`.toLowerCase().includes(needle))
      : rows;
    return groupLibraryArticles(filtered);
  }, [rows, text]);
  function choose(row: Row) {
    if (!onUse) {
      setNotice("Open this library from Newsletters. A click there puts the article in the newsletter body.");
      return;
    }
    onUse({ title: row.title, body: row.bodyText });
    setNotice(`Added “${row.title}” to this newsletter.`);
  }
  const panel = (
    <div className="ua-library-window" role="dialog" aria-label="Article library">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Article library</h2>
        {onClose && <button type="button" className="ua-btn-line" onClick={onClose}>Close</button>}
      </div>
      <p className="mb-3 text-sm" style={{ color: "#5a6a7a" }}>
        These lists are published by Superadmin. Click an article to put it in the body of this newsletter.
      </p>
      <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Search title or text" aria-label="Search articles" className="ua-field mb-4" />
      {notice && <p className="mb-3 text-sm font-semibold">{notice}</p>}
      <div className="ua-library-scroll">
        {shown.length === 0 && <p className="text-sm" style={{ color: "#5a6a7a" }}>No published articles match.</p>}
        {shown.map((group) => {
          const color = topicColor(group.topic);
          return (
          <section key={group.title} className="mb-5">
            <h3 className="mb-2 text-base font-semibold" style={{ color }}>{group.title}</h3>
            <ul className="grid gap-2">
              {group.articles.map((row) => (
                <li key={row.id}>
                  <button type="button" className="ua-library-article" onClick={() => choose(row)}>
                    <strong style={{ color }}>{row.title}</strong>
                    <span>{row.bodyText}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          );
        })}
      </div>
    </div>
  );
  if (!onClose) return panel;
  return <div className="ua-modal" onClick={onClose}><div onClick={(event) => event.stopPropagation()}>{panel}</div></div>;
}