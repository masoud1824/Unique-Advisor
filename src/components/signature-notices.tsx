import { useEffect, useState } from "react";
import { loadSignatureNotices, markSignatureNoticesRead, retrySignatureNotice } from "@/lib/advisor-links.functions";

type Notice = {
  id: number;
  requestId: string;
  kind: string;
  body: string;
  signedUrl: string;
  auditUrl: string;
  unread: boolean;
};

export function SignatureNotices({ code, slug }: { code: string; slug: string }) {
  const [notes, setNotes] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState("");
  function apply(result: { ok?: boolean; notices?: Notice[]; unread?: number } | null) {
    if (!result?.ok || !result.notices) return;
    setNotes(result.notices);
    setUnread(result.unread || 0);
  }
  useEffect(() => {
    void loadSignatureNotices({ data: { slug, code } }).then(apply).catch(() => undefined);
  }, [slug, code]);
  if (!notes.length) return null;
  return (
    <section className="mb-4 rounded-lg border px-4 py-3" style={{ borderColor: "#0f4c81", background: "#f4f8fc" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-extrabold" style={{ color: "#0f4c81" }}>
          Signature notices {unread > 0 ? <span className="ml-2 rounded-full px-2 py-0.5 text-white" style={{ background: "#b42318" }}>{unread} unread</span> : null}
        </h2>
        {unread > 0 ? (
          <button type="button" className="ua-btn-line" style={{ padding: "6px 12px" }} onClick={() => {
            setUnread(0);
            setNotes((current) => current.map((note) => ({ ...note, unread: false })));
            void markSignatureNoticesRead({ data: { slug, code } });
          }}>Mark read</button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-3">
        {notes.map((note) => (
          <article key={note.id} className="rounded-lg bg-white px-3 py-3 text-sm" style={{ borderLeft: note.unread ? "4px solid #b42318" : "4px solid #d5dde6" }}>
            <p className="whitespace-pre-wrap font-semibold">{note.body}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {note.signedUrl ? <a className="ua-btn" style={{ padding: "6px 12px" }} href={note.signedUrl} target="_blank" rel="noreferrer">Open signed PDF</a> : null}
              {note.auditUrl ? <a className="ua-btn-line" style={{ padding: "6px 12px" }} href={note.auditUrl} target="_blank" rel="noreferrer">Open audit file</a> : null}
              {note.kind === "filing-failed" ? (
                <button type="button" className="ua-btn" style={{ padding: "6px 12px" }} disabled={busy === note.requestId} onClick={() => {
                  setBusy(note.requestId);
                  void retrySignatureNotice({ data: { slug, code, requestId: note.requestId } }).then(apply).finally(() => setBusy(""));
                }}>{busy === note.requestId ? "Retrying…" : "Retry filing"}</button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
