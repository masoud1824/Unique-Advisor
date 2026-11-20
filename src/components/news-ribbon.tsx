import { useEffect, useState } from "react";
import { listDeskAnnouncements, setDeskLanguage } from "@/lib/platform.functions";
import { ribbonDirection } from "@/lib/news-ribbon";

export function NewsRibbon({ slug, code }: { slug: string; code: string }) {
  const [items, setItems] = useState<Array<{ id: number; title: string; text: string; link: string; language: string }>>([]);
  const [language, setLanguage] = useState("en");
  const [fallback, setFallback] = useState("");
  const [paused, setPaused] = useState(false);
  const [open, setOpen] = useState(false);
  async function load(next?: string) {
    const result = await listDeskAnnouncements({ data: { slug, code, language: next } });
    if (!result.ok) return;
    setItems(result.items);
    setLanguage(result.language);
    setFallback(result.fallback);
  }
  useEffect(() => {
    void load().catch(() => undefined);
  }, [slug, code]);
  async function choose(next: "en" | "fa") {
    const saved = await setDeskLanguage({ data: { slug, code, language: next } });
    if (!saved.ok) return;
    await load(saved.language);
  }
  if (items.length === 0 && !fallback) return null;
  const dir = ribbonDirection(language === "fa" || items.some((item) => item.language === "fa") ? "fa" : language);
  return (
    <section className="ua-ribbon" dir={dir} aria-label="Practice news" data-ribbon-language={language} style={{ background: "#14324f", color: "#f7f3ea" }}>
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
        <button type="button" onClick={() => void choose("en")} style={{ background: "transparent", color: "#f7f3ea", border: "1px solid #f7f3ea" }}>English</button>
        <button type="button" onClick={() => void choose("fa")} style={{ background: "transparent", color: "#f7f3ea", border: "1px solid #f7f3ea" }}>فارسی</button>
        <button type="button" onClick={() => setPaused((value) => !value)} style={{ background: "transparent", color: "#f7f3ea", border: "1px solid #f7f3ea" }}>{paused ? "Run" : "Pause"}</button>
        <button type="button" onClick={() => setOpen((value) => !value)} style={{ background: "transparent", color: "#f7f3ea", border: "1px solid #f7f3ea" }}>{open ? "Hide" : "List"}</button>
      </div>
      {open && (
        <div style={{ margin: 0, padding: "8px 20px 12px", background: "#fff", color: "#14324f" }}>
          <p>{fallback}</p>
          <ul style={{ margin: 0, padding: "8px 20px 12px" }}>
            {items.map((item) => (
              <li key={item.id} dir={ribbonDirection(item.language)}><strong>{item.title}</strong> {item.text}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
