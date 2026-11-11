import { useEffect, useRef, useState, type ReactNode } from "react";
import { getPublicSite, saveAdvisorSite, saveAdvisorWebsite } from "@/lib/site.functions";
import { browserPublicUrl } from "@/lib/preview-path-prefix";
import { PALETTE_COLORS, PALETTE_LABELS, PALETTE_NOTES, PALETTES, type Palette } from "@/lib/site-types";
import type { DeskData } from "@/lib/site-types";
import { turnPhoto } from "@/lib/turn-photo";
import { FileDrop } from "@/components/file-drop";
import { defaultWebsite, BANNER_FRAME, BANNER_LIBRARY, LAYOUT_LABELS, LAYOUT_NOTES, newId, readWebsite, safeHttp, SITE_LAYOUTS, type SiteLayout, type WebBlock, type WebLink, type WebSite, type WebTab } from "@/lib/website";
import { listTemplates } from "@/lib/advisor.functions";

function rememberSite(desk: DeskData, own: boolean, url: string) {
  try {
    const key = `ua-profile:${desk.slug}`;
    const saved = JSON.parse(localStorage.getItem(key) || "{}") as Record<string, unknown>;
    const website = own ? url.trim() : browserPublicUrl(`/a/${desk.slug}/site`);
    localStorage.setItem(key, JSON.stringify({ ...saved, website, websiteShow: saved.websiteShow !== false }));
  } catch {
    /* the desk still reads the saved choice from the server */
  }
}

export function WebsiteDesk({
  code,
  desk,
  ping,
  reload,
}: {
  code: string;
  desk: DeskData;
  ping: (text: string) => void;
  reload?: () => void | Promise<void>;
}) {
  const [own, setOwn] = useState(false);
  const [siteUrl, setSiteUrl] = useState("");
  const [web, setWeb] = useState<WebSite>(() => defaultWebsite());
  const [theme, setTheme] = useState<Palette>(desk.palette);
  const [selected, setSelected] = useState(web.tabs[0]?.id ?? "");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sharedBanners, setSharedBanners] = useState<{ id: number; name: string }[]>([]);
  const [saved, setSaved] = useState<{ own: boolean; siteUrl: string; theme: Palette; web: string } | null>(null);
  const [touched, setTouched] = useState(false);
  const page = browserPublicUrl(`/a/${desk.slug}/site`);
  const tab = web.tabs.find((item) => item.id === selected) ?? web.tabs[0];
  const webPack = JSON.stringify(web);
  const choiceChanged = saved !== null && (own !== saved.own || siteUrl !== saved.siteUrl);
  const pagesChanged = saved !== null && (theme !== saved.theme || webPack !== saved.web);
  const unsaved = touched || choiceChanged || pagesChanged;

  useEffect(() => {
    setTouched(false);
    setReady(false);
    void getPublicSite({ data: { slug: desk.slug } }).then((site) => {
      const loaded = readWebsite(site?.siteContent ?? "") ?? defaultWebsite();
      const nextTheme = (loaded.palette || site?.palette || desk.palette) as Palette;
      const nextOwn = site?.siteMode === "own";
      const nextUrl = site?.siteUrl || "";
      setOwn(nextOwn);
      setSiteUrl(nextUrl);
      setWeb(loaded);
      setSelected(loaded.tabs[0]?.id ?? "");
      setTheme(nextTheme);
      setSaved({
        own: nextOwn,
        siteUrl: nextUrl,
        theme: nextTheme,
        web: JSON.stringify(loaded),
      });
      setTouched(false);
      setReady(true);
    });
    void listTemplates().then((rows: { id: number; kind: string; name: string }[]) =>
      setSharedBanners(rows.filter((row) => row.kind === "banner").map((row) => ({ id: row.id, name: row.name }))),
    );
  }, [desk.slug]);

  function patchTab(id: string, next: Partial<WebTab>) {
    setWeb((current) => ({
      ...current,
      tabs: current.tabs.map((item) => (item.id === id ? { ...item, ...next } : item)),
    }));
  }

  function move(id: string, direction: -1 | 1) {
    setWeb((current) => {
      const index = current.tabs.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.tabs.length) return current;
      const tabs = current.tabs.slice();
      const [item] = tabs.splice(index, 1);
      tabs.splice(target, 0, item);
      return { ...current, tabs };
    });
  }

  async function saveMode(event: React.FormEvent) {
    event.preventDefault();
    const result = await saveAdvisorWebsite({
      data: { slug: desk.slug, code, mode: own ? "own" : "builtin", url: siteUrl },
    });
    if (!result.ok) return ping(result.error);
    rememberSite(desk, own, siteUrl);
    void reload?.();
    setSaved((current) => current ? { ...current, own, siteUrl } : { own, siteUrl, theme, web: webPack });
    setTouched(false);
    ping(own ? "Your own website is the one visitors will use." : "Your system website is the one visitors will use.");
  }

  async function saveTheme() {
    if (!ready) return ping("Wait until your website has loaded, then save the look.");
    const next = { ...web, layout: web.layout || "classic", palette: theme };
    const pages = await saveAdvisorSite({ data: { slug: desk.slug, code, website: next } });
    if (!pages.ok) return ping(pages.error);
    setWeb(next);
    setSaved((current) => current ? { ...current, theme, web: JSON.stringify(next) } : current);
    setTouched(false);
    ping(`${PALETTE_LABELS[theme]} is saved. Open your website to see ${PALETTE_LABELS[theme]}.`);
  }

  async function saveAll() {
    const broken = web.tabs.find((item) => item.kind === "link" && item.visible && !safeHttp(item.url));
    if (broken) return ping(`Add a full https link for the “${broken.label || "link"}” tab.`);
    setBusy(true);
    const mode = await saveAdvisorWebsite({
      data: { slug: desk.slug, code, mode: own ? "own" : "builtin", url: siteUrl },
    });
    if (!mode.ok) {
      setBusy(false);
      return ping(mode.error);
    }
    const next = { ...web, layout: web.layout || "classic", palette: theme };
    const pages = await saveAdvisorSite({ data: { slug: desk.slug, code, website: next } });
    setBusy(false);
    if (!pages.ok) return ping(pages.error);
    rememberSite(desk, own, siteUrl);
    void reload?.();
    setWeb(next);
    setSaved({ own, siteUrl, theme, web: JSON.stringify(next) });
    setTouched(false);
    ping("Website saved.");
  }

  async function saveContent() {
    const broken = web.tabs.find((item) => item.kind === "link" && item.visible && !safeHttp(item.url));
    if (broken) return ping(`Add a full https link for the “${broken.label || "link"}” tab.`);
    setBusy(true);
    const result = await saveAdvisorSite({ data: { slug: desk.slug, code, website: web } });
    setBusy(false);
    if (!result.ok) return ping(result.error);
    setSaved((current) => current ? { ...current, theme, web: webPack } : { own, siteUrl, theme, web: webPack });
    setTouched(false);
    ping("Website saved.");
  }

  return (
    <div className="grid gap-6 pb-24" onInput={() => setTouched(true)}>
      {unsaved && (
        <div className="fixed inset-x-0 z-50 px-4 py-3 text-center text-base font-extrabold md:left-[260px]" style={{ top: 0, background: "#b42318", color: "#ffffff" }}>
          You have unsaved changes. Press Save. Visitors will not see them until you do.
          {choiceChanged ? " Save this choice." : ""}
          {pagesChanged || touched ? " Save website." : ""}
        </div>
      )}
      <section className="ua-panel p-6">
        <h2 className="text-lg font-semibold">Which website visitors see</h2>
        <p className="mt-1 mb-4 text-sm" style={{ color: "#5a6a7a" }}>
          Use the system website to write your own pages here. Or send people to a site you already have.
        </p>
        <form onSubmit={(event) => void saveMode(event)}>
          <label className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <input type="radio" name="site-mode" checked={!own} onChange={() => setOwn(false)} />
            Use the system website
          </label>
          <label className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <input type="radio" name="site-mode" checked={own} onChange={() => setOwn(true)} />
            Use my own website
          </label>
          {own ? (
            <label className="mb-4 grid gap-1 text-sm font-semibold">
              Your website link
              <input value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} placeholder="https://" className="ua-field font-normal" />
            </label>
          ) : (
            <p className="mb-4 text-sm">
              Visitors open{" "}
              <a href={page} className="font-semibold" style={{ color: "#0f4c81" }}>{page}</a>
            </p>
          )}
          <button type="submit" className="ua-btn">Save this choice</button>
          {choiceChanged && <p className="mt-3 text-base font-extrabold" style={{ color: "#b42318" }}>Save your changes. This choice is not on your website yet.</p>}
        </form>
      </section>

      {own && (
        <p className="text-sm" style={{ color: "#5a6a7a" }}>
          Your own link is what visitors see. The pages below are saved for when you switch back to the system website.
        </p>
      )}

      <section className="ua-panel p-6">
        <h2 className="text-lg font-semibold">Top banner</h2>
        <p className="mt-1 mb-4 text-sm" style={{ color: "#5a6a7a" }}>
          Tick the box to show a wide picture across the top of the website. Upload your own, or choose one from the library. Then save the website.
        </p>
        <label className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={web.bannerOn !== false} onChange={(event) => setWeb({ ...web, bannerOn: event.target.checked })} />
          Show banner on top of the website
        </label>
        <Picture
          label={web.heroImage ? "Upload a different banner" : "Upload banner"}
          hint="Your own picture. The frame follows the picture."
          src={web.heroImage}
          wide
          onPick={(heroImage) => setWeb({ ...web, heroImage, bannerOn: true })}
          onClear={() => setWeb({ ...web, heroImage: "", bannerOn: false })}
          ping={ping}
        />
        <h3 className="mb-3 mt-5 text-base font-semibold">Banner library</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {BANNER_LIBRARY.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setWeb({ ...web, heroImage: item.src, bannerOn: true })}
              className="overflow-hidden rounded-lg border text-left"
              style={{ borderColor: web.heroImage === item.src ? "#0f4c81" : "#e1e8ef", borderWidth: web.heroImage === item.src ? 3 : 1 }}
            >
              <img src={`${item.src}?v=5`} alt="" style={BANNER_FRAME} />
              <span className="block px-2 py-2 text-sm font-semibold">{item.name}</span>
            </button>
          ))}
          {sharedBanners.map((item) => {
            const src = `/api/platform-banners/${item.id}`;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setWeb({ ...web, heroImage: src, bannerOn: true })}
                className="overflow-hidden rounded-lg border text-left"
                style={{ borderColor: web.heroImage === src ? "#0f4c81" : "#e1e8ef", borderWidth: web.heroImage === src ? 3 : 1 }}
              >
                <img src={src} alt="" style={BANNER_FRAME} />
                <span className="block px-2 py-2 text-sm font-semibold">{item.name}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="ua-btn mt-4" disabled={busy} onClick={() => void saveContent()}>{busy ? "Saving…" : "Save banner"}</button>
      </section>

      <section className="ua-panel p-6">
        <h2 className="text-lg font-semibold">Theme and colors</h2>
        <p className="mt-1 mb-4 text-sm" style={{ color: "#5a6a7a" }}>
          Click a color. The large sample changes at once. Then press Save this look and open your website.
        </p>
        <h3 className="mb-3 text-base font-semibold">Color combinations</h3>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {PALETTES.map((palette) => (
            <div key={palette} className={`ua-cardart ${theme === palette ? "selected" : ""}`}>
              <button type="button" className="block w-full text-left" onClick={() => { setTheme(palette); setWeb((current) => ({ ...current, palette })); }}>
                <div style={{ height: 72, background: PALETTE_COLORS[palette].primary }} />
                <div style={{ height: 10, background: PALETTE_COLORS[palette].accent }} />
                <SiteThumb layout={web.layout || "classic"} palette={palette} />
                <div className="p-3" style={{ background: "#fff", color: "#1a2332" }}>
                  <h3 className="font-semibold">{PALETTE_LABELS[palette]}</h3>
                  <p className="text-sm" style={{ color: "#5a6a7a" }}>{PALETTE_NOTES[palette]}</p>
                </div>
              </button>
            </div>
          ))}
        </div>
        <h3 className="mt-8 mb-3 text-base font-semibold">Themes</h3>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {SITE_LAYOUTS.map((layout) => (
            <div key={layout} className={`ua-cardart ${(web.layout || "classic") === layout ? "selected" : ""}`}>
              <button type="button" className="block w-full text-left" onClick={() => setWeb((current) => ({ ...current, layout }))}>
                <SiteThumb layout={layout} palette={theme} />
                <div className="p-3" style={{ background: "#fff", color: "#1a2332" }}>
                  <h3 className="font-semibold">{LAYOUT_LABELS[layout]}</h3>
                  <p className="text-sm" style={{ color: "#5a6a7a" }}>{LAYOUT_NOTES[layout]}</p>
                </div>
              </button>
            </div>
          ))}
        </div>
        <h3 className="mt-8 mb-3 text-base font-semibold">Selected look · {PALETTE_LABELS[theme]}</h3>
        <ColorSample palette={theme} title={web.heroTitle || "Your headline"} name={desk.advisorName} />
        <div className="flex flex-wrap gap-3">
          <button type="button" className="ua-btn" onClick={() => void saveTheme()}>Save this look</button>
          <a className="ua-btn-line" href={page} target="_blank" rel="noreferrer">Open website</a>
        </div>
        {pagesChanged && <p className="mt-3 text-base font-extrabold" style={{ color: "#b42318" }}>Save your changes. The colors and pages are not on your website yet.</p>}
      </section>

      <section className="ua-panel p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Pages and tabs</h2>
            <p className="mt-1 text-sm" style={{ color: "#5a6a7a" }}>
              Rename a tab in the list. Remove deletes it. Drag changes the order. Then save.
            </p>
          </div>
          <button
            type="button"
            className="ua-btn"
            onClick={() => {
              const id = newId();
              setWeb((current) => ({
                ...current,
                tabs: [...current.tabs, { id, label: "New page", visible: true, kind: "page", url: "", headline: "New page", intro: "", image: "", blocks: [], links: [] }],
              }));
              setSelected(id);
            }}
          >
            Add a tab
          </button>
        </div>
        {!ready && <p className="text-sm" style={{ color: "#5a6a7a" }}>Loading your website…</p>}
        <div className="mb-4">
          <DragRows
            items={web.tabs}
            onReorder={(tabs) => setWeb((current) => ({ ...current, tabs }))}
            render={(item) => (
              <div
                className="flex flex-wrap items-center gap-2"
                style={{ outline: tab?.id === item.id ? "2px solid #c9a227" : undefined, borderRadius: 8, padding: 4 }}
              >
                <input
                  value={item.label}
                  maxLength={40}
                  aria-label="Tab name"
                  placeholder="Tab name"
                  onFocus={() => setSelected(item.id)}
                  onChange={(event) => patchTab(item.id, { label: event.target.value })}
                  className="ua-field min-w-40 flex-1 font-normal"
                />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={item.visible} onChange={(event) => patchTab(item.id, { visible: event.target.checked })} />
                  Show
                </label>
                <button type="button" className="ua-btn-line" onClick={() => setSelected(item.id)}>Edit</button>
                <button
                  type="button"
                  className="ua-btn-line"
                  onClick={() => {
                    const tabs = web.tabs.filter((tabItem) => tabItem.id !== item.id);
                    setWeb({ ...web, tabs });
                    if (tab?.id === item.id) setSelected(tabs[0]?.id ?? "");
                  }}
                >
                  Remove
                </button>
              </div>
            )}
          />
          {web.tabs.length === 0 && <p className="text-sm" style={{ color: "#5a6a7a" }}>No tabs yet. Add a tab to create a page.</p>}
        </div>

        <label className="mb-3 grid gap-1 text-sm font-semibold">
          Opening headline
          <input value={web.heroTitle} maxLength={140} onChange={(event) => setWeb({ ...web, heroTitle: event.target.value })} className="ua-field font-normal" />
        </label>
        <label className="mb-3 grid gap-1 text-sm font-semibold">
          Opening text
          <textarea value={web.heroText} maxLength={800} rows={4} onChange={(event) => setWeb({ ...web, heroText: event.target.value })} className="ua-field font-normal" />
        </label>
        <Picture
          label={web.logo ? "Change logo" : "Upload logo"}
          hint="This logo appears at the top of your website. The frame follows the picture."
          src={web.logo || ""}
          logo
          onPick={(logo) => setWeb({ ...web, logo })}
          onClear={() => setWeb({ ...web, logo: "" })}
          ping={ping}
        />
        <label className="mb-4 grid gap-1 text-sm font-semibold">
          Footer note
          <textarea value={web.footer} maxLength={500} rows={3} onChange={(event) => setWeb({ ...web, footer: event.target.value })} className="ua-field font-normal" />
        </label>

        {tab && (
          <div className="rounded-lg border p-4" style={{ borderColor: "#e1e8ef" }}>
            <div className="mb-3 flex flex-wrap gap-2">
              <button type="button" className="ua-btn-line" onClick={() => move(tab.id, -1)}>Move up</button>
              <button type="button" className="ua-btn-line" onClick={() => move(tab.id, 1)}>Move down</button>
              <button
                type="button"
                className="ua-btn-line"
                onClick={() => {
                  const tabs = web.tabs.filter((item) => item.id !== tab.id);
                  setWeb({ ...web, tabs });
                  setSelected(tabs[0]?.id ?? "");
                }}
              >
                Remove this tab
              </button>
            </div>
            <label className="mb-3 grid gap-1 text-sm font-semibold">
              Tab name
              <input value={tab.label} maxLength={40} onChange={(event) => patchTab(tab.id, { label: event.target.value })} className="ua-field font-normal" />
            </label>
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={tab.visible} onChange={(event) => patchTab(tab.id, { visible: event.target.checked })} />
              Show this tab
            </label>
            <label className="mb-3 grid gap-1 text-sm font-semibold">
              This tab opens
              <select
                value={tab.kind}
                onChange={(event) => patchTab(tab.id, { kind: event.target.value === "link" ? "link" : "page" })}
                className="ua-field font-normal"
              >
                <option value="page">A page you write here</option>
                <option value="link">A link to another website</option>
              </select>
            </label>
            {tab.kind === "link" ? (
              <label className="grid gap-1 text-sm font-semibold">
                Link
                <input value={tab.url} onChange={(event) => patchTab(tab.id, { url: event.target.value })} placeholder="https://" className="ua-field font-normal" />
              </label>
            ) : (
              <PageFields tab={tab} onChange={(next) => patchTab(tab.id, next)} ping={ping} />
            )}
          </div>
        )}
        <button type="button" className="ua-btn mt-4" disabled={busy} onClick={() => void saveContent()}>
          {busy ? "Saving…" : "Save website content"}
        </button>
        {pagesChanged && <p className="mt-3 text-base font-extrabold" style={{ color: "#b42318" }}>Save your changes. Nothing new shows on your website until you press Save website content.</p>}
      </section>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3 md:left-[260px]" style={{ background: "#ffffff", boxShadow: "0 -6px 18px rgba(15,76,129,0.12)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-extrabold" style={{ color: unsaved ? "#b42318" : "#0d7a4f" }}>
            {unsaved ? "You have unsaved changes. This button saves the banner, colors, pages, and which website visitors see." : "Everything on this tab is saved."}
          </p>
          <button type="button" className="ua-btn" disabled={busy || !ready} onClick={() => void saveAll()}>
            {busy ? "Saving…" : "Save website"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PageFields({
  tab,
  onChange,
  ping,
}: {
  tab: WebTab;
  onChange: (next: Partial<WebTab>) => void;
  ping: (text: string) => void;
}) {
  function setBlocks(blocks: WebBlock[]) {
    onChange({ blocks });
  }
  function setLinks(links: WebLink[]) {
    onChange({ links });
  }
  return (
    <div>
      <label className="mb-3 grid gap-1 text-sm font-semibold">
        Page headline
        <input value={tab.headline} maxLength={140} onChange={(event) => onChange({ headline: event.target.value })} className="ua-field font-normal" />
      </label>
      <label className="mb-3 grid gap-1 text-sm font-semibold">
        Page text
        <textarea value={tab.intro} maxLength={800} rows={4} onChange={(event) => onChange({ intro: event.target.value })} className="ua-field font-normal" />
      </label>
      <Picture
        label={tab.image ? "Change the page banner" : "Add a page banner"}
        hint="Wide picture beside this page’s headline."
        src={tab.image}
        wide
        onPick={(image) => onChange({ image })}
        onClear={() => onChange({ image: "" })}
        ping={ping}
      />
      <h3 className="mb-2 mt-4 text-sm font-semibold">Sections</h3>
      <p className="mb-2 text-sm" style={{ color: "#5a6a7a" }}>Drag a section by the handle to change its order. Each section can have its own picture.</p>
      <DragRows
        items={tab.blocks}
        onReorder={setBlocks}
        render={(block) => (
          <div>
            <input value={block.heading} maxLength={120} placeholder="Section heading" onChange={(event) => setBlocks(tab.blocks.map((item) => item.id === block.id ? { ...item, heading: event.target.value } : item))} className="ua-field mb-2 font-normal" />
            <textarea value={block.body} maxLength={1200} rows={3} placeholder="Section text" onChange={(event) => setBlocks(tab.blocks.map((item) => item.id === block.id ? { ...item, body: event.target.value } : item))} className="ua-field font-normal" />
            <Picture
              label={block.image ? "Change this picture" : "Add a picture"}
              src={block.image}
              onPick={(image) => setBlocks(tab.blocks.map((item) => item.id === block.id ? { ...item, image } : item))}
              onClear={() => setBlocks(tab.blocks.map((item) => item.id === block.id ? { ...item, image: "" } : item))}
              ping={ping}
            />
            <button type="button" className="ua-btn-line mt-2" onClick={() => setBlocks(tab.blocks.filter((item) => item.id !== block.id))}>Remove section</button>
          </div>
        )}
      />
      <button
        type="button"
        className="ua-btn-line"
        onClick={() => {
          if (tab.blocks.length >= 8) return ping("Eight sections is the limit on one page.");
          setBlocks([...tab.blocks, { id: newId(), heading: "", body: "", image: "" }]);
        }}
      >
        Add a section
      </button>
      <h3 className="mb-2 mt-5 text-sm font-semibold">Links on this page</h3>
      {tab.links.map((link) => (
        <div key={link.id} className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input value={link.label} maxLength={60} placeholder="Link name" onChange={(event) => setLinks(editLink(tab.links, link.id, { label: event.target.value }))} className="ua-field font-normal" />
          <input value={link.url} placeholder="https://" onChange={(event) => setLinks(editLink(tab.links, link.id, { url: event.target.value }))} className="ua-field font-normal" />
          <button type="button" className="ua-btn-line" onClick={() => setLinks(tab.links.filter((item) => item.id !== link.id))}>Remove</button>
        </div>
      ))}
      <button
        type="button"
        className="ua-btn-line mt-2"
        onClick={() => {
          if (tab.links.length >= 6) return ping("Six links is the limit on one page.");
          setLinks([...tab.links, { id: newId(), label: "", url: "" }]);
        }}
      >
        Add a link
      </button>
    </div>
  );
}

function Picture({
  label,
  hint,
  src,
  wide,
  logo,
  onPick,
  onClear,
  ping,
}: {
  label: string;
  hint?: string;
  src: string;
  wide?: boolean;
  logo?: boolean;
  onPick: (image: string) => void;
  onClear: () => void;
  ping: (text: string) => void;
}) {
  return (
    <div className="mt-3">
      <FileDrop
        label={label}
        accept="image/*"
        hint={hint || "Or drop a picture here."}
        preview={src}
        previewName={logo ? "Logo" : wide ? "Banner" : "Picture"}
        shape={logo ? "logo" : wide ? "wide" : "photo"}
        onClearPreview={src ? onClear : undefined}
        onFiles={(picked) => {
          const file = picked[0];
          if (!file) return;
          void fitImage(file, Boolean(wide), Boolean(logo)).then(onPick).catch((reason: unknown) => ping(reason instanceof Error ? reason.message : "Choose a JPG or PNG picture."));
        }}
      />
      {src ? (
        <button type="button" className="ua-btn-line mt-2" onClick={() => void turnPhoto(src).then(onPick).catch((reason: unknown) => ping(reason instanceof Error ? reason.message : "Could not flip that picture."))}>Flip</button>
      ) : null}
    </div>
  );
}

function editLink(links: WebLink[], id: string, next: Partial<WebLink>) {
  return links.map((item) => (item.id === id ? { ...item, ...next } : item));
}

function fitImage(file: File, wide = false, logo = false) {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxW = logo ? 480 : wide ? 1400 : 960;
      const maxH = logo ? 200 : wide ? 700 : 960;
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      URL.revokeObjectURL(url);
      if (!ctx) return reject(new Error("Could not read that picture."));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let quality = 0.82;
      let data = canvas.toDataURL("image/jpeg", quality);
      while (data.length > 180_000 && quality > 0.45) {
        quality -= 0.08;
        data = canvas.toDataURL("image/jpeg", quality);
      }
      if (data.length > 180_000) return reject(new Error("That picture is too large. Choose a smaller one."));
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Choose a JPG or PNG picture."));
    };
    img.src = url;
  });
}

function reorder<T>(list: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function DragRows<T extends { id: string }>({
  items,
  onReorder,
  render,
  axis = "y",
  className = "grid gap-3",
}: {
  items: T[];
  onReorder: (items: T[]) => void;
  render: (item: T) => ReactNode;
  axis?: "x" | "y";
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);
  const itemsRef = useRef(items);
  const reorderRef = useRef(onReorder);
  itemsRef.current = items;
  reorderRef.current = onReorder;
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => {
    function place(point: number) {
      const fromId = dragId.current;
      const host = root.current;
      if (!fromId || !host) return;
      const list = itemsRef.current;
      const rows = [...host.querySelectorAll<HTMLElement>("[data-row]")];
      let passed = 0;
      for (const row of rows) {
        if (row.dataset.row === fromId) continue;
        const box = row.getBoundingClientRect();
        const mid = axis === "x" ? box.left + box.width / 2 : box.top + box.height / 2;
        if (point > mid) passed += 1;
      }
      const from = list.findIndex((item) => item.id === fromId);
      if (from < 0 || passed === from) return;
      const next = reorder(list, from, passed);
      itemsRef.current = next;
      reorderRef.current(next);
    }
    function onMove(event: PointerEvent) {
      if (!dragId.current) return;
      event.preventDefault();
      place(axis === "x" ? event.clientX : event.clientY);
    }
    function onUp() {
      if (!dragId.current) return;
      dragId.current = null;
      setDragging(null);
    }
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [axis]);

  return (
    <div ref={root} className={className}>
      {items.map((item) => (
        <div
          key={item.id}
          data-row={item.id}
          className="rounded-lg border p-3"
          style={{ borderColor: dragging === item.id ? "#c9a227" : "#e1e8ef", opacity: dragging === item.id ? 0.75 : 1 }}
        >
          <button
            type="button"
            className="mb-2 cursor-grab touch-none text-xs font-semibold"
            style={{ color: "#5a6a7a" }}
            aria-label="Drag to reorder"
            onPointerDown={(event) => {
              dragId.current = item.id;
              setDragging(item.id);
              event.preventDefault();
            }}
          >
            Drag
          </button>
          {render(item)}
        </div>
      ))}
    </div>
  );
}

function ColorSample({ palette, title, name }: { palette: Palette; title: string; name: string }) {
  const c = PALETTE_COLORS[palette];
  return (
    <div className="mb-6 overflow-hidden rounded-xl border" style={{ borderColor: c.line, background: c.bg, color: c.fg }}>
      <div style={{ background: c.primary, color: c.primaryFg, padding: "28px 24px" }}>
        <div style={{ color: c.accent, fontSize: 13, fontWeight: 700, letterSpacing: "0.04em" }}>{PALETTE_LABELS[palette]}</div>
        <div style={{ marginTop: 8, fontSize: 32, lineHeight: 1.15, fontWeight: 700 }}>{title}</div>
        <div style={{ marginTop: 8, fontSize: 16 }}>{name}</div>
        <div style={{ marginTop: 16, display: "inline-block", background: c.accent, color: "#fff", borderRadius: 999, padding: "8px 16px", fontWeight: 700 }}>
          Ask a question
        </div>
      </div>
      <div style={{ padding: "16px 24px", color: c.muted }}>Page background, headlines, and buttons use this set.</div>
    </div>
  );
}

function SiteThumb({ layout, palette, tall = false }: { layout: SiteLayout; palette: Palette; tall?: boolean }) {
  const c = PALETTE_COLORS[palette];
  const height = tall ? 220 : 168;
  const bar = (color: string, width: string | number, h = 10) => (
    <div style={{ height: h, width, background: color, borderRadius: 4 }} />
  );
  return (
    <div style={{ height, background: c.bg, color: c.fg, overflow: "hidden" }}>
      <div style={{ display: "flex", height: 18 }}>
        <div style={{ flex: 2, background: c.primary }} />
        <div style={{ flex: 1, background: c.accent }} />
        <div style={{ flex: 1, background: c.surface }} />
      </div>
      {layout === "classic" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.7fr", height: height - 18 }}>
          <div style={{ padding: 12 }}>
            {bar(c.accent, 36, 6)}
            <div style={{ marginTop: 10 }}>{bar(c.primary, "92%", 12)}</div>
            <div style={{ marginTop: 6 }}>{bar(c.primary, "70%", 12)}</div>
            <div style={{ marginTop: 14, height: 22, width: 72, borderRadius: 99, background: c.primary }} />
          </div>
          <div style={{ margin: 10, borderRadius: 8, background: c.primary }} />
        </div>
      )}
      {layout === "banner" && (
        <div style={{ display: "flex", flexDirection: "column", height: height - 18 }}>
          <div style={{ position: "relative", height: "46%", background: c.primary }}>
            <div style={{ position: "absolute", left: 12, bottom: 10, right: 12 }}>
              {bar(c.accent, 36, 6)}
              <div style={{ marginTop: 6 }}>{bar("#ffffff", "62%", 12)}</div>
            </div>
          </div>
          <div style={{ padding: 12 }}>
            {bar(c.line, "100%", 6)}
            <div style={{ marginTop: 8, height: 28, borderRadius: 8, background: c.surface, border: `1px solid ${c.line}` }} />
          </div>
        </div>
      )}
      {layout === "editorial" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 16 }}>
          {bar(c.accent, 40, 6)}
          <div style={{ marginTop: 12 }}>{bar(c.primary, 160, 14)}</div>
          <div style={{ marginTop: 6 }}>{bar(c.primary, 110, 14)}</div>
          <div style={{ marginTop: 12, height: 4, width: 36, background: c.accent }} />
        </div>
      )}
      {layout === "sidebar" && (
        <div style={{ display: "grid", gridTemplateColumns: "34% 1fr", height: height - 18 }}>
          <div style={{ background: c.primary, padding: 8 }}>
            <div style={{ height: 36, borderRadius: 6, background: "rgba(255,255,255,0.35)" }} />
            <div style={{ marginTop: 8 }}>{bar("#ffffff", "80%", 6)}</div>
            <div style={{ marginTop: 8 }}>{bar(c.accent, "100%", 4)}</div>
          </div>
          <div style={{ padding: 10 }}>
            {bar(c.primary, "80%", 12)}
            <div style={{ marginTop: 8 }}>{bar(c.line, "100%", 6)}</div>
            <div style={{ marginTop: 10, height: 36, borderRadius: 8, background: c.surface, border: `1px solid ${c.line}` }} />
          </div>
        </div>
      )}
      {layout === "cards" && (
        <div style={{ display: "flex", flexDirection: "column", height: height - 18 }}>
          <div style={{ background: c.primary, padding: "10px 12px" }}>
            {bar(c.accent, 36, 6)}
            <div style={{ marginTop: 8 }}>{bar("#ffffff", "48%", 12)}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 8, flex: 1 }}>
            <div style={{ overflow: "hidden", borderRadius: 6, background: c.surface, border: `1px solid ${c.line}` }}>
              <div style={{ height: "55%", background: c.accent }} />
            </div>
            <div style={{ overflow: "hidden", borderRadius: 6, background: c.surface, border: `1px solid ${c.line}` }}>
              <div style={{ height: "55%", background: c.primary }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
