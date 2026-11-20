import { useEffect, useState } from "react";
import { beginMicrosoftConnect, getMailSettings, saveMailSettings } from "@/lib/advisor.functions";
import { beginZoomConnect, checkSignatureStatus, disconnectConnection, listConnectionStatus, loadFileStore, loadSignatureTest, saveFileStore, saveTestSigners } from "@/lib/advisor-links.functions";
import { browserPublicUrl } from "@/lib/preview-path-prefix";
import { SIGNATURE_TEST } from "@/lib/signature-test-preview";
import type { DeskData } from "@/lib/site-types";

type LinkRow = { provider: string; label: string; connected: boolean; account: string; ready: boolean };
type MailKind = "gmail" | "yahoo" | "icloud" | "other";

const MAILBOXES: Array<{ id: MailKind; label: string; host: string; hint: string }> = [
  { id: "gmail", label: "Gmail", host: "smtp.gmail.com", hint: "Use a Google app password, not your normal Gmail password." },
  { id: "yahoo", label: "Yahoo", host: "smtp.mail.yahoo.com", hint: "Use a Yahoo app password." },
  { id: "icloud", label: "iCloud", host: "smtp.mail.me.com", hint: "Use an Apple app-specific password." },
  { id: "other", label: "Other email", host: "", hint: "Ask your email provider for the outgoing mail server." },
];

export function ConnectionsDesk({ code, desk, home }: { code: string; desk: DeskData; home?: "settings" }) {
  if (home !== "settings") return null;
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [mailFrom, setMailFrom] = useState("");
  const [mailName, setMailName] = useState("");
  const [microsoft, setMicrosoft] = useState(false);
  const [kind, setKind] = useState<MailKind | "">("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [host, setHost] = useState("");
  const [store, setStore] = useState("dropbox");
  const [saveRecordings, setSaveRecordings] = useState(true);
  const [testSigners, setTestSigners] = useState("");
  const [sentTest, setSentTest] = useState<{ requestId: string; status: string } | null>(null);

  async function refresh() {
    const [accounts, mail, files] = await Promise.all([
      listConnectionStatus({ data: { slug: desk.slug, code } }).catch(() => ({ ok: false as const, error: "The account list could not be loaded." })),
      getMailSettings({ data: { slug: desk.slug, code } }).catch(() => null),
      loadFileStore({ data: { slug: desk.slug, code } }).catch(() => null),
    ]);
    if (accounts.ok) setLinks(accounts.links);
    else setNote(accounts.error);
    if (mail && mail.ok) {
      setMailFrom(mail.fromEmail || "");
      setMailName(mail.fromName || "");
      setMicrosoft(Boolean(mail.microsoftConnected));
      setEmail(mail.fromEmail || "");
    }
    if (files && files.ok) {
      setStore(files.store);
      setSaveRecordings(files.saveRecordings);
    }
    if (desk.slug === SIGNATURE_TEST.advisorSlug) {
      const sent = await loadSignatureTest({ data: { slug: desk.slug, code } }).catch(() => null);
      setSentTest(sent && sent.ok && sent.sent ? { requestId: sent.requestId, status: sent.status } : null);
    }
  }

  useEffect(() => {
    void refresh();
    const params = new URLSearchParams(window.location.search);
    const link = params.get("link");
    if (link === "connected") setNote("That account is connected. Only this advisor can use it.");
    if (link === "error") setNote(params.get("detail") || "Sign-in did not finish. Nothing was sent.");
    if (link === "connected" || link === "error") document.getElementById("connections")?.scrollIntoView({ block: "start" });
  }, [desk.slug, code]);

  async function connectZoom() {
    setBusy("zoom");
    setNote("");
    const result = await beginZoomConnect({ data: { slug: desk.slug, code } });
    setBusy("");
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    window.location.assign(result.url);
  }

  async function connectOutlook() {
    setBusy("outlook-mail");
    setNote("");
    const result = await beginMicrosoftConnect({
      data: { slug: desk.slug, code, redirectUri: browserPublicUrl("/api/microsoft/callback"), displayName: mailName },
    });
    setBusy("");
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    window.location.assign(result.url);
  }

  async function saveMailbox(event: React.FormEvent) {
    event.preventDefault();
    const chosen = MAILBOXES.find((item) => item.id === kind);
    if (!chosen) return;
    setBusy("mail");
    setNote("");
    const result = await saveMailSettings({
      data: {
        slug: desk.slug,
        code,
        fromEmail: email,
        fromName: mailName,
        host: chosen.id === "other" ? host : chosen.host,
        port: 587,
        password,
      },
    });
    setBusy("");
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setPassword("");
    setKind("");
    setNote(result.warning || `${chosen.label} is connected for sending.`);
    await refresh();
  }

  return (
    <section id="connections" className="ua-panel mb-5 p-6">
      <h2 className="text-lg font-semibold">Connected accounts</h2>
      <p className="mt-2 mb-4 text-sm" style={{ color: "#5a6a7a" }}>
        Connect only this advisor’s accounts. The assistant can use them, and it still waits for approval before it sends, books, or saves a file.
      </p>
      {desk.slug === SIGNATURE_TEST.advisorSlug && (
        <div id="signature-test-preview" className="mb-5 rounded-lg border p-4" style={{ borderColor: "#9C5A38" }}>
          <h3 className="font-semibold">Signature test preview</h3>
          <p className="mt-1 mb-3 text-sm" style={{ color: "#9a3412" }}>
            {sentTest
              ? `Sent once in Dropbox Sign test mode. Request ${sentTest.requestId} is ${sentTest.status.replaceAll("_", " ")}. It will not be sent again.`
              : "Nothing has been sent. This request stays here until you approve this exact preview."}
          </p>
          <div className="mx-auto mb-4 bg-white p-8 shadow-sm" style={{ maxWidth: 460, minHeight: 560, color: "#1A1916", border: "1px solid #e7e1d8" }}>
            <p className="text-2xl font-bold">{SIGNATURE_TEST.title}</p>
            <p className="mt-4 text-sm">{SIGNATURE_TEST.statement}</p>
            <div className="mt-48 border px-2 py-2 text-xs" style={{ width: 200, height: 36, borderColor: "#1A1916" }}>Signature</div>
            <p className="mt-2 text-xs" style={{ color: "#6B655C" }}>Page 1 of 1. One signature field.</p>
          </div>
          <ul className="grid gap-1 text-sm">
            <li>Signer: {SIGNATURE_TEST.signerName}, {SIGNATURE_TEST.signerEmail}</li>
            <li>Mode: Dropbox Sign test mode</li>
            <li>Destination: {SIGNATURE_TEST.folder}</li>
            <li>After signing, new files only: test-only-signed and test-only-audit, each including the Dropbox Sign request id. Existing files are not replaced.</li>
          </ul>
        </div>
      )}

      <h3 className="mb-2 font-semibold">Email</h3>
      <p className="mb-3 text-sm" style={{ color: "#5a6a7a" }}>
        {microsoft ? `Outlook is connected as ${mailFrom}.` : mailFrom ? `Sending from ${mailFrom}.` : "No mailbox is connected yet."} Connect Outlook and Connect Microsoft Email still ask for Mail.Send, Mail.Read, and Calendars.ReadWrite, because sending cards and creating events use those. Do not use them for the read-only calendar test. Use Calendar, then Sign in with Microsoft. This preview blocks sending and booking either way.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className="ua-btn" disabled={busy !== ""} onClick={() => void connectOutlook()}>
          {busy === "outlook-mail" ? "Opening…" : microsoft ? "Reconnect Outlook" : "Connect Outlook"}
        </button>
        {MAILBOXES.map((item) => (
          <button key={item.id} type="button" className={kind === item.id ? "ua-btn" : "ua-btn-line"} onClick={() => { setKind(item.id); setHost(item.host); setNote(""); }}>
            {item.label}
          </button>
        ))}
      </div>
      {kind && (
        <form onSubmit={(event) => void saveMailbox(event)} className="mb-5 grid gap-2 md:grid-cols-3">
          <input value={mailName} onChange={(event) => setMailName(event.target.value)} placeholder="Your name" className="ua-field" style={{ padding: "6px 8px" }} />
          <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Username/email" className="ua-field" style={{ padding: "6px 8px" }} />
          {kind === "other" && (
            <input required value={host} onChange={(event) => setHost(event.target.value)} placeholder="Mail server" className="ua-field" style={{ padding: "6px 8px" }} />
          )}
          <input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className="ua-field" style={{ padding: "6px 8px" }} />
          <button type="submit" className="ua-btn" style={{ padding: "6px 10px", width: "fit-content" }} disabled={busy === "mail"}>{busy === "mail" ? "Checking…" : "Save"}</button>
        </form>
      )}

      <h3 className="mb-2 font-semibold">Dropbox Sign test signers</h3>
      <form
        className="mb-5 grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy("signers");
          void saveTestSigners({ data: { slug: desk.slug, code, emails: testSigners } }).then((result) => {
            setBusy("");
            setNote(result.ok ? `${result.count} test signer address${result.count === 1 ? "" : "es"} saved. No signature request was sent.` : result.error);
            if (result.ok) setTestSigners("");
          });
        }}
      >
        <input value={testSigners} onChange={(event) => setTestSigners(event.target.value)} placeholder="Test signer emails, separated by commas" className="ua-field" style={{ padding: "6px 8px" }} autoComplete="off" />
        <button type="submit" className="ua-btn" style={{ padding: "6px 10px", width: "fit-content" }} disabled={busy === "signers"}>Save test signers</button>
      </form>
      <h3 className="mb-2 font-semibold">Zoom and file storage</h3>
      <p className="mb-3 text-sm" style={{ color: "#5a6a7a" }}>
        Outlook and Google calendars are signed in on the Calendar tab. Zoom, Dropbox, and Dropbox Sign stay here. Each advisor signs in to their own account. Dropbox Sign sends stay in test mode until you save test signer addresses here and approve one exact document.
      </p>
      <label className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={saveRecordings}
          onChange={(event) => {
            setSaveRecordings(event.target.checked);
            void saveFileStore({ data: { slug: desk.slug, code, saveRecordings: event.target.checked, store } });
          }}
        />
        Save Zoom recordings to client files
      </label>
      <div className="mb-4 flex flex-wrap gap-2">
        {([
          ["dropbox", "Dropbox"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={store === id ? "ua-btn" : "ua-btn-line"}
            onClick={() => {
              setStore(id);
              void saveFileStore({ data: { slug: desk.slug, code, saveRecordings, store: id } });
            }}
          >
            {label}{store === id ? " (default)" : ""}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {links.filter((link) => link.provider === "zoom" || link.provider === "dropbox" || link.provider === "dropbox_sign").map((link) => (
          <div key={link.provider} className="grid gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "#e1e8ef" }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{link.label}</p>
                <p className="text-xs" style={{ color: "#5a6a7a" }}>{link.connected ? `Connected as ${link.account}` : "Not connected"}</p>
              </div>
              {link.connected && (
                <button type="button" className="ua-btn-line" style={{ padding: "4px 8px" }} disabled={busy === link.provider} onClick={() => void disconnectConnection({ data: { slug: desk.slug, code, provider: link.provider } }).then(() => refresh())}>
                  Disconnect
                </button>
              )}
            </div>
            {link.provider === "zoom" && !link.connected && (
              <button type="button" className="ua-btn" style={{ padding: "6px 10px", width: "fit-content" }} disabled={busy === "zoom"} onClick={() => void connectZoom()}>{busy === "zoom" ? "Opening Zoom…" : "Sign in with Zoom"}</button>
            )}
            {(link.provider === "dropbox" || link.provider === "dropbox_sign") && (!link.connected || link.provider === "dropbox") && (
              link.ready ? (
              <form method="post" action={browserPublicUrl("/api/link/start")}>
                <input type="hidden" name="slug" value={desk.slug} />
                <input type="hidden" name="code" value={code} />
                <input type="hidden" name="provider" value={link.provider} />
                <input type="hidden" name="redirectUri" value={browserPublicUrl("/api/link/callback")} />
                <button type="submit" className="ua-btn" style={{ padding: "6px 10px", width: "fit-content" }}>
                  {link.connected ? "Sign in again" : `Sign in with ${link.label}`}
                </button>
              </form>
              ) : <p className="text-xs" style={{ color: "#5a6a7a" }}>Not ready. Save this app in Superadmin first. A sign-in button is not a connection.</p>
            )}
            {link.provider === "dropbox_sign" && (
              <button
                type="button"
                className="ua-btn-line"
                style={{ padding: "6px 10px", width: "fit-content" }}
                disabled={busy === "signature-status"}
                onClick={() => {
                  setBusy("signature-status");
                  void checkSignatureStatus({ data: { slug: desk.slug, code } }).then((result) => {
                    setBusy("");
                    setNote(result.ok ? result.detail : result.error);
                  }).catch(() => {
                    setBusy("");
                    setNote("Signature status could not be checked. Nothing was sent.");
                  });
                }}
              >
                {busy === "signature-status" ? "Checking…" : "Check signature status"}
              </button>
            )}
          </div>
        ))}
        {links.length === 0 && <p className="text-sm" style={{ color: "#5a6a7a" }}>Zoom and file storage will appear here after the page finishes loading.</p>}
      </div>
      {note && <p className="mt-3 text-sm font-semibold" style={{ color: note.includes("is connected") ? "#0d7a4f" : "#b42318" }}>{note}</p>}
    </section>
  );
}
