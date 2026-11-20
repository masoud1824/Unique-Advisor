import { useEffect, useState } from "react";
import { confirmBirthdayDesk, loadBirthdayDesk, pauseBirthdayDesk, previewBirthdayDeskPlan, saveBirthdayDesk } from "@/lib/birthday-desk.functions";

type Desk = Awaited<ReturnType<typeof loadBirthdayDesk>>;

export function BirthdayDesk({ slug, code, ping }: { slug: string; code: string; ping: (text: string) => void }) {
  const [desk, setDesk] = useState<Extract<Desk, { ok: true }> | null>(null);
  const [source, setSource] = useState<"desk" | "dropbox" | "">("desk");
  const [sourceRef, setSourceRef] = useState("");
  const [timezone, setTimezone] = useState("America/Toronto");
  const [feb29, setFeb29] = useState<"skip" | "march1">("skip");
  const [cardTitle, setCardTitle] = useState("");
  const [preview, setPreview] = useState("");

  async function load() {
    const result = await loadBirthdayDesk({ data: { slug, code } });
    if (!result.ok) { ping(result.error); return; }
    setDesk(result);
    setSource(result.source);
    setSourceRef(result.sourceRef);
    setTimezone(result.timezone);
    setFeb29(result.feb29);
    setCardTitle(result.cardTitle);
  }

  useEffect(() => { void load(); }, [slug, code]);

  async function save() {
    const result = await saveBirthdayDesk({ data: { slug, code, source, sourceRef, timezone, feb29, cardTitle, enabled: false } });
    if (!result.ok) { ping(result.error); return; }
    setDesk(result);
    ping(result.reconfirm ? "Saved. Confirm the card again before any future check. Automation stays off." : "Saved. Automation stays off.");
  }

  async function confirm() {
    const saved = await saveBirthdayDesk({ data: { slug, code, source, sourceRef, timezone, feb29, cardTitle, enabled: false } });
    if (!saved.ok) { ping(saved.error); return; }
    const result = await confirmBirthdayDesk({ data: { slug, code } });
    if (!result.ok) { ping(result.error); return; }
    setDesk(result);
    ping("This card is confirmed for a future check. The check is still off, and nothing was sent.");
  }

  async function pause() {
    const result = await pauseBirthdayDesk({ data: { slug, code } });
    if (!result.ok) { ping(result.error); return; }
    setDesk(result);
    ping("Birthday check paused. Nothing was sent.");
  }

  async function previewPlan() {
    const result = await previewBirthdayDeskPlan({ data: { slug, code } });
    if (!result.ok) { ping(result.error); return; }
    const sample = result.samples.map((item) => item.text).join(" ");
    setPreview(`${result.offNotice} Preview only. The saved check stays off. Pretend clock: ${result.pretendNotice} Sample card wording, not a send: ${sample} No provider was called.`);
  }

  async function refuseOn() {
    const result = await saveBirthdayDesk({ data: { slug, code, enabled: true } });
    ping(result.ok ? "The check unexpectedly turned on." : result.error);
  }

  if (!desk) return <p>Opening birthday settings…</p>;
  return (
    <section style={{ padding: 16, maxWidth: 760 }}>
      <h2>Birthday cards</h2>
      <p>{desk.readiness.note}</p>
      <p>Code ready: {desk.readiness.codeReady ? "yes" : "no"}. Scheduler ready: {desk.readiness.schedulerReady ? "yes" : "no"}. Provider ready: {desk.readiness.providerReady ? "yes" : "no"}.</p>
      <p>Saved automation: {desk.storedEnabled ? "marked on" : "off"}. {desk.needsConfirmation ? "The card needs confirmation again." : "The saved card matches the confirmed version."}</p>
      <label>People
        <select aria-label="Birthday source" value={source} onChange={(event) => setSource(event.target.value as "desk" | "dropbox" | "")}>
          <option value="desk">Unique Advisor contacts</option>
          <option value="dropbox">One Dropbox file</option>
          <option value="">No source yet</option>
        </select>
      </label>
      {source === "dropbox" && (
        <p>{desk.dropbox.reason}</p>
      )}
      <label>Dropbox file name, if one is chosen later
        <input aria-label="Dropbox file" value={sourceRef} onChange={(event) => setSourceRef(event.target.value)} />
      </label>
      <label>Time zone
        <select aria-label="Time zone" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
          {desk.zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
        </select>
      </label>
      <label>February 29
        <select aria-label="February 29" value={feb29} onChange={(event) => setFeb29(event.target.value === "march1" ? "march1" : "skip")}>
          <option value="skip">Skip in a year that is not a leap year</option>
          <option value="march1">Use March 1 in a year that is not a leap year</option>
        </select>
      </label>
      <label>Card
        <select aria-label="Birthday card" value={cardTitle} onChange={(event) => setCardTitle(event.target.value)}>
          <option value="">Choose a card</option>
          {desk.cards.map((card) => <option key={card.id} value={card.message}>{card.title}</option>)}
          {cardTitle && !desk.cards.some((card) => card.message === cardTitle) && <option value={cardTitle}>Current wording</option>}
        </select>
      </label>
      <label>Card wording
        <textarea aria-label="Card wording" value={cardTitle} onChange={(event) => setCardTitle(event.target.value)} rows={3} />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }}>
        <button type="button" onClick={() => void save()}>Save settings</button>
        <button type="button" onClick={() => void confirm()}>Confirm this card</button>
        <button type="button" onClick={() => void pause()}>Pause</button>
        <button type="button" onClick={() => void previewPlan()}>Preview with a fake clock</button>
        <button type="button" onClick={() => void refuseOn()}>Try to turn automation on</button>
      </div>
      {preview && <p>{preview}</p>}
      <h3>Missing birthday dates</h3>
      {desk.missingDates.length === 0 ? <p>Every contact has a birthday date.</p> : (
        <ul>{desk.missingDates.map((person) => <li key={person.id}>{person.name} has no birthday date. None was guessed.</li>)}</ul>
      )}
      <h3>Notices</h3>
      {desk.notices.length === 0 ? <p>No birthday notices yet.</p> : (
        <ul>{desk.notices.map((notice) => <li key={notice.id}>{notice.body}</li>)}</ul>
      )}
    </section>
  );
}
