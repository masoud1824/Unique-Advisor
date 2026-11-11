import { useEffect, useState } from "react";
import { archiveMessages, deleteLetter, listTemplates, saveLetter } from "@/lib/advisor.functions";
import { LETTERS } from "@/lib/catalog";
import { isEletterPack } from "@/lib/eletter";
import {
  NEWSLETTER_DESIGNS,
  packNewsletter,
  plainNewsletter,
  renderNewsletter,
  starterIssue,
  unpackNewsletter,
  type NewsletterArticle,
  type NewsletterContact,
  type NewsletterIssue,
} from "@/lib/newsletter";
import { type DeskData } from "@/lib/site-types";
import { turnPhoto } from "@/lib/turn-photo";

type Story = NewsletterArticle & { id: string };

export function NewsletterDesk({
  code,
  desk,
  reload,
  ping,
}: {
  code: string;
  desk: DeskData;
  reload: () => Promise<void>;
  ping: (text: string) => void;
}) {
  const [issue, setIssue] = useState<NewsletterIssue>(() => starterIssue());
  const [stories, setStories] = useState<Story[]>(() => starterIssue().articles.map(story));
  const [selected, setSelected] = useState<number[]>([]);
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState<{ id: number; name: string; detail: string; body: string }[]>([]);
  const people = tag ? desk.contacts.filter((contact) => contact.tags.includes(tag)) : desk.contacts;
  const contact = contactFromDesk(desk);
  const brand = brandingFromDesk(desk);
  const [logoSrc, setLogoSrc] = useState(brand.photo);
  useEffect(() => {
    let stop = false;
    void (async () => {
      if (!brand.photo) {
        if (!stop) setLogoSrc("");
        return;
      }
      const next = brand.flip ? await turnPhoto(brand.photo) : brand.photo;
      if (!stop) setLogoSrc(next);
    })();
    return () => {
      stop = true;
    };
  }, [brand.photo, brand.flip]);
  const preview = renderNewsletter({
    issue: { ...issue, articles: stories, social: brand.social },
    contact,
    logoSrc,
  });

  useEffect(() => {
    void listTemplates().then((rows: any[]) => setShared(rows.filter((row) => row.kind === "letter")));
  }, [desk.slug]);

  function apply(next: NewsletterIssue) {
    setIssue(next);
    setStories(next.articles.length ? next.articles.map(story) : [story({ title: "", body: "" })]);
  }

  function loadPlain(title: string, subject: string, body: string) {
    const packed = unpackNewsletter(body);
    if (packed) {
      apply(packed);
      return;
    }
    apply({
      ...starterIssue(),
      title: title || "Newsletter",
      subject: subject || title || "Newsletter",
      articles: [{ title: title || "Update", body }],
    });
  }

  async function send() {
    const articles = stories.map(({ title, body }) => ({ title: title.trim(), body: body.trim() }));
    const ready = articles.filter((item) => item.title || item.body);
    if (issue.title.trim().length < 2) return ping("Add a newsletter title.");
    if (ready.length === 0) return ping("Add at least one article title.");
    if (selected.length === 0) return ping("Choose at least one contact.");
    const current: NewsletterIssue = { ...issue, articles: ready, social: brand.social };
    setBusy(true);
    const source = brand.flip && brand.photo ? await turnPhoto(brand.photo) : brand.photo;
    const logo = source ? await fitLogo(source) : "";
    if (brand.photo && !logo) {
      setBusy(false);
      return ping("That picture could not be used. Choose a smaller photo in Profile.");
    }
    const result = await archiveMessages({
      data: {
        slug: desk.slug,
        code,
        kind: "letter",
        title: current.title.trim(),
        subject: (current.subject || current.title).trim(),
        body: plainNewsletter(current).slice(0, 3900),
        contactIds: selected,
        newsletter: JSON.stringify({ issue: current, contact }),
        logo,
      },
    });
    setBusy(false);
    if (!result.ok) return ping(result.error);
    ping(`Newsletter sent from your email to ${result.count} recipient(s).`);
    setSelected([]);
    await reload();
  }

  return (
    <>
      <section className="ua-panel p-6">
        <h2 className="text-lg font-semibold">Newsletter design</h2>
        <p className="mt-1 mb-4 text-sm" style={{ color: "#5a6a7a" }}>
          Pick a layout, then choose how many articles this issue has. The matching boxes open below. Every article shows in full in the editor, the preview, and the email. Your picture is included only when Show profile picture on newsletters is ticked in Profile and you save.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {NEWSLETTER_DESIGNS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="ua-cardart p-4 text-left"
              style={{ borderColor: issue.design === item.id ? "#c9a227" : undefined }}
              onClick={() => setIssue((current) => ({ ...current, design: item.id }))}
            >
              <span className="mb-2 block h-2 rounded-full" style={{ background: SWATCH[item.id] }} />
              <h3 className="font-semibold">{item.name}</h3>
              <p className="text-sm" style={{ color: "#5a6a7a" }}>{item.detail}</p>
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {LETTERS.map((letter) => (
            <button key={letter.id} type="button" className="ua-btn-line" onClick={() => loadPlain(letter.title, letter.subject, letter.body)}>
              {letter.title}
            </button>
          ))}
          {shared.map((letter) => (
            <button key={letter.id} type="button" className="ua-btn-line" onClick={() => loadPlain(letter.name, letter.detail, letter.body || letter.detail)}>
              {letter.name}
            </button>
          ))}
        </div>
        {desk.letters.filter((letter) => !isEletterPack(letter.body)).length > 0 && (
          <div className="mt-4 grid gap-2">
            <p className="text-sm font-semibold">Saved newsletters</p>
            {desk.letters.filter((letter) => !isEletterPack(letter.body)).map((letter) => (
              <div key={letter.id} className="flex items-center gap-2">
                <button type="button" className="ua-btn-line" style={{ flex: "1 1 auto", textAlign: "left" }} onClick={() => loadPlain(letter.title, letter.subject, letter.body)}>
                  {letter.title}
                </button>
                <button
                  type="button"
                  className="ua-btn-line"
                  onClick={() => {
                    if (!window.confirm(`Remove ${letter.title}?`)) return;
                    void deleteLetter({ data: { slug: desk.slug, code, id: letter.id } }).then(async (result: any) => {
                      if (!result.ok) return ping(result.error);
                      ping("Newsletter removed");
                      await reload();
                    });
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="ua-panel mt-6 p-6">
        <h2 className="mb-4 text-lg font-semibold">This issue</h2>
        <label className="mb-3 grid gap-1 text-sm font-semibold">
          Word in the header
          <input value={issue.kicker} maxLength={40} onChange={(event) => setIssue({ ...issue, kicker: event.target.value })} className="ua-field font-normal" />
        </label>
        <label className="mb-3 grid gap-1 text-sm font-semibold">
          Newsletter title
          <input value={issue.title} maxLength={120} onChange={(event) => setIssue({ ...issue, title: event.target.value, subject: event.target.value })} className="ua-field font-normal" />
        </label>
        <label className="mb-4 grid gap-1 text-sm font-semibold">
          Email subject
          <input value={issue.subject} maxLength={120} onChange={(event) => setIssue({ ...issue, subject: event.target.value })} className="ua-field font-normal" />
        </label>
        <label className="mb-4 grid gap-1 text-sm font-semibold">
          Number of articles
          <select
            value={stories.length}
            onChange={(event) => setStories((current) => setCount(current, Number(event.target.value)))}
            className="ua-field font-normal"
          >
            {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>{count}</option>
            ))}
          </select>
        </label>
        <p className="mb-4 text-sm" style={{ color: "#5a6a7a" }}>
          Phone, email, and company come from Profile. The picture, LinkedIn, Instagram, and Facebook appear only if their boxes are ticked there and you save. The full article is shown. Nothing is cut off.
        </p>
        {stories.map((item, index) => (
          <div key={item.id} className="mb-4 rounded-lg border p-3" style={{ borderColor: "#e1e8ef" }}>
            <strong className="mb-2 block">Article {index + 1}</strong>
            <input value={item.title} maxLength={140} onChange={(event) => setStories(editStory(stories, item.id, { title: event.target.value }))} placeholder="Article title" className="ua-field mb-2 font-normal" />
            <textarea value={item.body} maxLength={8000} onChange={(event) => setStories(editStory(stories, item.id, { body: event.target.value }))} rows={6} placeholder="Full article. Only the first five lines show until Read more." className="ua-field font-normal" />
          </div>
        ))}
        <button
          type="button"
          className="ua-btn mt-4"
          onClick={() => {
            const current = { ...issue, articles: stories.map(({ title, body }) => ({ title, body })) };
            const ready = current.articles.filter((item) => item.title.trim() || item.body.trim());
            if (current.title.trim().length < 2) return ping("Add a newsletter title.");
            if (ready.length === 0) return ping("Add at least one article title.");
            const body = packNewsletter({ ...current, articles: ready });
            if (body.length > 50000) return ping("Shorten the articles before saving.");
            void saveLetter({ data: { slug: desk.slug, code, title: current.title.trim(), subject: (current.subject || current.title).trim(), body } }).then(async (result: any) => {
              if (!result.ok) return ping(result.error);
              ping("Newsletter saved. Ask the assistant to send it when you are ready.");
              await reload();
            });
          }}
        >
          Save newsletter
        </button>
      </section>
      <section className="ua-panel mt-6 p-6">
        <h2 className="mb-3 text-lg font-semibold">Preview</h2>
        <iframe title="Newsletter preview" sandbox="" srcDoc={preview} className="w-full rounded-lg border" style={{ height: Math.max(960, 520 + stories.reduce((sum, item) => sum + 140 + item.body.length, 0)), borderColor: "#e1e8ef", background: "#fff" }} />
        <select value={tag} onChange={(event) => setTag(event.target.value)} className="ua-field mb-3 mt-4">
          <option value="">All Contacts</option>
          {desk.tags.map((item) => <option key={item}>{item}</option>)}
        </select>
        <ul className="max-h-64 overflow-auto rounded-lg border" style={{ borderColor: "#e1e8ef" }}>
          {people.map((person) => (
            <li key={person.id} className="flex gap-3 border-b px-3 py-2">
              <input type="checkbox" checked={selected.includes(person.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, person.id] : selected.filter((id) => id !== person.id))} />
              <span>{person.fullName}</span>
            </li>
          ))}
        </ul>
        <button type="button" disabled={busy} className="ua-btn mt-4" onClick={() => void send()}>{busy ? "Sending…" : "Send newsletter"}</button>
      </section>
    </>
  );
}

const SWATCH: Record<string, string> = {
  navy: "linear-gradient(90deg,#0c2f6b,#d4a017)",
  pine: "linear-gradient(90deg,#1C3D36,#c4a574)",
  ink: "linear-gradient(90deg,#1A1916,#c4a574)",
  sand: "linear-gradient(90deg,#8c4a32,#e7c7a1)",
  brief: "linear-gradient(90deg,#1f4d3a,#8fbfa8)",
  slate: "linear-gradient(90deg,#1e293b,#2563eb)",
};

function story(article: NewsletterArticle): Story {
  return { ...article, id: Math.random().toString(36).slice(2) };
}

function setCount(current: Story[], count: number) {
  const next = current.slice(0, count);
  while (next.length < count) next.push(story({ title: "", body: "" }));
  return next;
}

function editStory(stories: Story[], id: string, patch: Partial<NewsletterArticle>) {
  return stories.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

function contactFromDesk(desk: DeskData): NewsletterContact {
  const base: NewsletterContact = {
    name: desk.advisorName,
    title: desk.contactTitle || "",
    phone: desk.contactPhone || "",
    email: desk.contactEmail || "",
    place: desk.contactCompany || "",
    website: desk.contactWebsite || "",
  };
  try {
    const saved = JSON.parse(localStorage.getItem(`ua-profile:${desk.slug}`) || "") as {
      name?: string;
      title?: string;
      titleShow?: boolean;
      phone?: string;
      email?: string;
      company?: string;
      website?: string;
      websiteShow?: boolean;
    };
    return {
      name: saved.name || base.name,
      title: saved.titleShow === false ? "" : saved.title || base.title || "",
      phone: saved.phone || base.phone,
      email: saved.email || base.email,
      place: saved.company || base.place,
      website: (desk.contactWebsite || "").trim() || (desk.siteMode === "own" && desk.siteUrl?.trim() ? desk.siteUrl.trim() : base.website),
    };
  } catch {
    return base;
  }
}

function brandingFromDesk(desk: DeskData) {
  let linkedin = desk.linkedinShow ? desk.linkedin : "";
  let instagram = desk.instagramShow ? desk.instagram : "";
  let facebook = desk.facebookShow ? desk.facebook : "";
  let photo = desk.photoOnNewsletter ? desk.photo : "";
  try {
    const saved = JSON.parse(localStorage.getItem(`ua-profile:${desk.slug}`) || "") as {
      linkedin?: string;
      linkedinShow?: boolean;
      instagram?: string;
      instagramShow?: boolean;
      facebook?: string;
      facebookShow?: boolean;
      photo?: string;
      photoOnNewsletter?: boolean;
      flipNewsletter?: boolean;
    };
    if (saved && typeof saved === "object") {
      linkedin = (saved.linkedinShow ?? desk.linkedinShow) ? saved.linkedin || desk.linkedin : "";
      instagram = (saved.instagramShow ?? desk.instagramShow) ? saved.instagram || desk.instagram : "";
      facebook = (saved.facebookShow ?? desk.facebookShow) ? saved.facebook || desk.facebook : "";
      const showPhoto = Boolean(saved.photoOnNewsletter ?? desk.photoOnNewsletter);
      photo = showPhoto ? saved.photo || desk.photo : "";
      return { social: { linkedin, instagram, facebook, youtube: "" }, photo, flip: Boolean(saved.flipNewsletter) };
    }
  } catch {
    /* use the saved profile on the desk */
  }
  return { social: { linkedin, instagram, facebook, youtube: "" }, photo, flip: false };
}

function fitLogo(src: string) {
  if (!src.startsWith("data:image/")) return Promise.resolve("");
  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 640;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return resolve("");
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => resolve("");
    img.src = src;
  });
}
