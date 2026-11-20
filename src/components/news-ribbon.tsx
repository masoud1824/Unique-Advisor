import { useEffect, useState } from "react";
import { listDeskAnnouncements } from "@/lib/platform.functions";
import { ribbonDirection } from "@/lib/news-ribbon";

export function NewsRibbon({ slug, code, language = "en" }: { slug: string; code: string; language?: string }) {
  const [items, setItems] = useState<Array<{ id: number; title: string; text: string; link: string; language: string }>>([]);
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void listDeskAnnouncements({ data: { slug, code, language } }).then((result) => {
      if (result.ok) setItems(result.items);
    }).catch(() => undefined);
  }, [slug, code, language]);
  if (items.length === 0) return null;
  const dir = ribbonDirection(items.some((item) => item.language === "fa") ? "fa" : language);
  return (
    <section className="ua-ribbon" dir={dir} aria-label="Practice news" style={{ background: "#14324f", color: "#f7f3ea" }}>
      <style>{`
        .ua-ribbon-track { display: flex; gap: 2rem; width: max-content; animation: ua-ribbon 28s linear infinite; }
        .ua-ribbon.is-paused .ua-ribbon-track { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) { .ua-ribbon-track { animation: none; } }
        @keyframes ua-ribbon { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (max-width: 720px) { .ua-ribbon { font-size: 14px; } }
      `}</style>
      <div className={paused ? "ua-ribbon is-paused" : "ua-ribbon"} style={{ display: "flex", alignItems: "center", gap: 12, overflow: "hidden", padding: "8px 12px" }}>
        <div style={{ overflow: "hidden", flex: 1 }}>
          <div className="ua-ribbon-track">
            {[0, 1].map((copy) => (
              <span key={copy} style={{ display: "inline-flex", gap: "2rem" }}>
                {items.map((item) => (
                  <span key={`${copy}-${item.id}`}>{item.link ? <a href={item.link} style={{ color: "#f7f3ea" }}>{item.title}</a> : item.title}</span>
                ))}
              </span>
            ))}
          </div>
        </div>
        <button type="button" onClick={() => setPaused((value) => !value)} style={{ background: "transparent", color: "#f7f3ea", border: "1px solid #f7f3ea" }}>{paused ? "Run" : "Pause"}</button>
        <button type="button" onClick={() => setOpen((value) => !value)} style={{ background: "transparent", color: "#f7f3ea", border: "1px solid #f7f3ea" }}>{open ? "Hide" : "List"}</button>
      </div>
      {open && (
        <ul style={{ margin: 0, padding: "8px 20px 12px", background: "#fff", color: "#14324f" }}>
          {items.map((item) => (
            <li key={item.id} dir={ribbonDirection(item.language)}><strong>{item.title}</strong> {item.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
