import { useEffect, useState } from "react";
import { archiveMessages, deleteLetter, listTemplates, saveLetter } from "@/lib/advisor.functions";
import {
  ELETTER_DESIGNS,
  ELETTER_SWATCH,
  isEletterPack,
  packEletter,
  plainEletter,
  renderEletter,
  starterEletter,
  unpackEletter,
  ELETTER_GREETING,
  type Eletter,
} from "@/lib/eletter";
import { type NewsletterContact } from "@/lib/newsletter";
import { type DeskData } from "@/lib/site-types";
import { turnPhoto } from "@/lib/turn-photo";

export function EletterDesk({
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
  const [letter, setLetter] = useState<Eletter>(() => starterEletter());
  const [selected, setSelected] = useState<number[]>([]);
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState<{ id: number; name: string; body: string }[]>([]);
  const people = tag ? desk.contacts.filter((contact) => contact.tags.includes(tag)) : desk.contacts;
  const contact = contactFromDesk(desk);
  const brand = brandingFromDesk(desk);
  const [logoSrc, setLogoSrc] = useState(brand.photo);
  const saved = desk.letters.filter((item) => isEletterPack(item.body));
  const preview = renderEletter({
    letter: { ...letter, social: brand.social },
    contact,
    logoSrc,
  });

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

  useEffect(() => {
    void listTemplates().then((rows: Array<{ id: number; kind: string; name: string; body: string }>) =>
      setShared(rows.filter((row) => row.kind === "eletter").map((row) => ({ id: row.id, name: row.name, body: row.body }))),
    );
  }, [desk.slug]);

  function load(next: Eletter) {
    setLetter(next);
  }

  function loadPacked(title: string, subject: string, body: string) {
    const packed = unpackEletter(body);
    if (packed) {
      load(packed);
      return;
    }
    load({ ...starterEletter(), title: title || "Letter", subject: subject || title || "Letter", body });
  }

  async function send() {
    if (letter.title.trim().length < 2) return ping("Add a letter title.");
    if (letter.body.trim().length < 2 || letterRest(letter.body).length < 2) return ping("Write the letter.");
    if (selected.length === 0) return ping("Choose at least one contact.");
    const current = { ...letter, social: brand.social };
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
        body: plainEletter(current).slice(0, 3900),
        contactIds: selected,
        newsletter: JSON.stringify({ letter: current, contact }),
        logo,
      },
    });
    setBusy(false);
    if (!result.ok) return ping(result.error);
    ping(`E-letter sent from your email to ${result.count} recipient(s).`);
    setSelected([]);
    await reload();
  }

  return (
    <>
      <section className="ua-panel p-6">
        <h2 className="text-lg font-semibold">E-letter design</h2>
        <p className="mt-1 mb-4 text-sm" style={{ color: "#5a6a7a" }}>
          One letter, not a set of articles. Pick a style. The whole letter shows in the email. Old Lined Paper looks like stationery with a red margin.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ELETTER_DESIGNS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="ua-cardart p-4 text-left"
              style={{ borderColor: letter.design === item.id ? "#c9a227" : undefined }}
              onClick={() => setLetter((current) => ({ ...current, design: item.id }))}
            >
              <span className="mb-2 block h-2 rounded-full" style={{ background: ELETTER_SWATCH[item.id] }} />
              <h3 className="font-semibold">{item.name}</h3>
              <p className="text-sm" style={{ color: "#5a6a7a" }}>{item.detail}</p>
            </button>
          ))}
        </div>
        {shared.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {shared.map((item) => (
              <button key={item.id} type="button" className="ua-btn-line" onClick={() => loadPacked(item.name, "", item.body)}>
                {item.name}
              </button>
            ))}
          </div>
        )}
        {saved.length > 0 && (
          <div className="mt-4 grid gap-2">
            <p className="text-sm font-semibold">Saved e-letters</p>
            {saved.map((item) => (
              <div key={item.id} className="flex items-center gap-2">
                <button type="button" className="ua-btn-line" style={{ flex: "1 1 auto", textAlign: "left" }} onClick={() => loadPacked(item.title, item.subject, item.body)}>
                  {item.title}
                </button>
                <button
                  type="button"
                  className="ua-btn-line"
                  onClick={() => {
                    if (!window.confirm(`Remove ${item.title}?`)) return;
                    void deleteLetter({ data: { slug: desk.slug, code, id: item.id } }).then(async (result: { ok: boolean; error?: string }) => {
                      if (!result.ok) return ping(result.error || "Could not remove that letter.");
                      ping("E-letter removed");
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
        <h2 className="mb-4 text-lg font-semibold">This letter</h2>
        <label className="mb-3 grid gap-1 text-sm font-semibold">
          Small heading
          <input value={letter.kicker} maxLength={40} onChange={(event) => setLetter({ ...letter, kicker: event.target.value })} className="ua-field font-normal" />
        </label>
        <label className="mb-3 grid gap-1 text-sm font-semibold">
          Letter title
          <input value={letter.title} maxLength={120} onChange={(event) => setLetter({ ...letter, title: event.target.value, subject: event.target.value })} className="ua-field font-normal" />
        </label>
        <label className="mb-3 grid gap-1 text-sm font-semibold">
          Email subject
          <input value={letter.subject} maxLength={120} onChange={(event) => setLetter({ ...letter, subject: event.target.value })} className="ua-field font-normal" />
        </label>
        <label className="mb-4 grid gap-1 text-sm font-semibold">
          Letter
          <span className="relative block font-normal">
            <textarea value={letter.body} maxLength={8000} onChange={(event) => setLetter({ ...letter, body: event.target.value })} rows={10} className="ua-field font-normal" style={{ lineHeight: 1.5 }} />
            {letterHint(letter.body) && (
              <span className="pointer-events-none absolute" style={{ top: 34, left: 13, color: "#9aa6b2", fontSize: "0.95rem", lineHeight: 1.5 }}>
                write here
              </span>
            )}
          </span>
        </label>
        <button
          type="button"
          className="ua-btn"
          onClick={() => {
            if (letter.title.trim().length < 2) return ping("Add a letter title.");
            if (letter.body.trim().length < 2 || letterRest(letter.body).length < 2) return ping("Write the letter.");
            const body = packEletter(letter);
            if (body.length > 50000) return ping("Shorten the letter before saving.");
            void saveLetter({ data: { slug: desk.slug, code, title: letter.title.trim(), subject: (letter.subject || letter.title).trim(), body } }).then(async (result: { ok: boolean; error?: string }) => {
              if (!result.ok) return ping(result.error || "Could not save that letter.");
              ping("E-letter saved.");
              await reload();
            });
          }}
        >
          Save e-letter
        </button>
      </section>
      <section className="ua-panel mt-6 p-6">
        <h2 className="mb-3 text-lg font-semibold">Preview</h2>
        <iframe title="E-letter preview" sandbox="" srcDoc={preview} className="w-full rounded-lg border" style={{ height: 720, borderColor: "#e1e8ef", background: "#fff" }} />
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
        <button type="button" disabled={busy} className="ua-btn mt-4" onClick={() => void send()}>{busy ? "Sending…" : "Send e-letter"}</button>
      </section>
    </>
  );
}

function letterRest(body: string) {
  return body.replace(/^Dear \[Contact Name\],?\s*/i, "").trim();
}

function letterHint(body: string) {
  return body === ELETTER_GREETING || body === `${ELETTER_GREETING}\n`;
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
  let photo = desk.photoOnEletter ? desk.photo : "";
  try {
    const saved = JSON.parse(localStorage.getItem(`ua-profile:${desk.slug}`) || "") as {
      linkedin?: string;
      linkedinShow?: boolean;
      instagram?: string;
      instagramShow?: boolean;
      facebook?: string;
      facebookShow?: boolean;
      photo?: string;
      photoOnEletter?: boolean;
      flipEletter?: boolean;
    };
    if (saved && typeof saved === "object") {
      linkedin = (saved.linkedinShow ?? desk.linkedinShow) ? saved.linkedin || desk.linkedin : "";
      instagram = (saved.instagramShow ?? desk.instagramShow) ? saved.instagram || desk.instagram : "";
      facebook = (saved.facebookShow ?? desk.facebookShow) ? saved.facebook || desk.facebook : "";
      photo = saved.photoOnEletter ? saved.photo || desk.photo : "";
      return { social: { linkedin, instagram, facebook, youtube: "" }, photo, flip: Boolean(saved.flipEletter) };
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
