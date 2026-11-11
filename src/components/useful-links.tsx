import { useEffect, useState } from "react";
import { deleteUsefulLink, listUsefulLinks, saveUsefulLink } from "@/lib/advisor.functions";

type LinkItem = { id: number; label: string; url: string };

export function UsefulLinks({
  code,
  slug,
  ping,
}: {
  code: string;
  slug: string;
  ping: (text: string) => void;
}) {
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const result = await listUsefulLinks({ data: { slug, code } });
    if (!result.ok) {
      ping(result.error);
      return;
    }
    setLinks(result.links);
  }

  useEffect(() => {
    void refresh();
  }, [slug, code]);

  return (
    <section className="ua-panel p-6">
      <h2 className="text-lg font-semibold">Useful links</h2>
      <p className="mt-1 mb-4 text-sm" style={{ color: "#5a6a7a" }}>
        Save the websites you use often. They stay on this desk, and only you can see them. Press a link to open it.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void saveUsefulLink({ data: { slug, code, label, url } }).then(async (result) => {
            setBusy(false);
            if (!result.ok) return ping(result.error);
            setLabel("");
            setUrl("");
            ping("Link saved.");
            await refresh();
          });
        }}
      >
        <label className="grid gap-1 text-sm font-semibold">
          Name
          <input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} className="ua-field font-normal" placeholder="Carrier portal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Web address
          <input value={url} maxLength={500} onChange={(event) => setUrl(event.target.value)} className="ua-field font-normal" placeholder="https://" />
        </label>
        <button type="submit" disabled={busy} className="ua-btn self-end">{busy ? "Saving…" : "Save link"}</button>
      </form>
      <div className="mt-5 grid gap-2">
        {links.length === 0 && <p className="text-sm" style={{ color: "#5a6a7a" }}>No links saved yet.</p>}
        {links.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="ua-btn" style={{ flex: "1 1 auto", textAlign: "left", textDecoration: "none" }}>
              {item.label}
              <span className="mt-1 block text-xs font-normal" style={{ opacity: 0.85 }}>{item.url}</span>
            </a>
            <button
              type="button"
              className="ua-btn-line"
              onClick={() => {
                if (!window.confirm(`Remove ${item.label}?`)) return;
                void deleteUsefulLink({ data: { slug, code, id: item.id } }).then(async (result) => {
                  if (!result.ok) return ping(result.error);
                  ping("Link removed.");
                  await refresh();
                });
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
