import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { listDeskAnnouncements } from "@/lib/platform.functions";
import { newsHeadlineLink, ribbonTravel } from "@/lib/news-ribbon";

type Item = { id: number; title: string; text: string; link: string; language: string };

function Headline({ item }: { item: Item }) {
  const link = newsHeadlineLink(item.link);
  if (!link) return <span className="ua-ribbon-item" data-news-id={item.id}>{item.title}</span>;
  return (
    <a
      className="ua-ribbon-item"
      href={link.href}
      data-news-id={item.id}
      aria-label={item.text ? `${item.title}. ${item.text}` : item.title}
      target={link.target || undefined}
      rel={link.rel || undefined}
    >
      {item.title}
    </a>
  );
}

export function NewsRibbon({ slug, code }: { slug: string; code: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [paused, setPaused] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [motion, setMotion] = useState({ startPx: 0, durationMs: 0 });

  useEffect(() => {
    let alive = true;
    void listDeskAnnouncements({ data: { slug, code, language: "en" } }).then((result) => {
      if (!alive || !result.ok) return;
      setItems(result.items);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slug, code]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    const measure = () => {
      const next = ribbonTravel(viewport.clientWidth, track.scrollWidth);
      setMotion((current) => current.startPx === next.startPx && current.durationMs === next.durationMs ? current : { startPx: next.startPx, durationMs: next.durationMs });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(track);
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;
  const style: CSSProperties | undefined = motion.startPx > 0
    ? ({ animationDuration: `${motion.durationMs}ms`, "--ua-ribbon-start": `${motion.startPx}px` } as CSSProperties)
    : undefined;
  return (
    <section className="ua-ribbon" dir="ltr" lang="en" aria-label="Practice news" data-ribbon-language="en">
      <div className="ua-ribbon-bar">
        <div className="ua-ribbon-viewport" ref={viewportRef} data-ticker-viewport>
          <div ref={trackRef} className={paused ? "ua-ribbon-track is-paused" : "ua-ribbon-track"} data-ticker-track style={style}>
            {items.map((item) => <Headline key={item.id} item={item} />)}
          </div>
        </div>
        <div className="ua-ribbon-tools" role="toolbar" aria-label="News controls">
          <button type="button" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? "Run" : "Pause"}</button>
        </div>
      </div>
    </section>
  );
}
