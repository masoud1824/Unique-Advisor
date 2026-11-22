import { useEffect, useState } from "react";
import { loadDocumentMailPreview } from "@/lib/document-mail.functions";

type Attachment = { path: string; name: string; size: number; hash: string };
type Loaded = {
  ok: boolean;
  isolated?: boolean;
  preserved?: boolean;
  error?: string;
  preview?: string;
  sender?: string;
  recipient?: string;
  subject?: string;
  body?: string;
  attachment?: Attachment;
  monitoring?: string;
  setup?: string[];
};

export function DocumentMailPreview({ code, slug }: { code: string; slug: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancel = false;
    void loadDocumentMailPreview({ data: { slug, code } }).then((result) => {
      if (!cancel) setLoaded(result as Loaded);
    });
    return () => { cancel = true; };
  }, [slug, code]);

  const file = loaded?.attachment;
  return (
    <section className="ua-panel mb-4 p-6">
      <h2 className="text-lg font-semibold">Document email preview</h2>
      <p className="mt-1 text-sm" style={{ color: "#5a6a7a" }}>
        {loaded?.isolated
          ? "Nothing is sent. This isolated test copy does not contact the mailbox or Dropbox."
          : "Nothing is sent. This uses only this advisor's mailbox."}
      </p>
      {!loaded && <p className="mt-3 text-sm">Checking the mailbox…</p>}
      {loaded?.isolated && <p className="mt-3 text-sm">{loaded.error}</p>}
      {loaded && !loaded.isolated && (
        <div className="mt-4 grid gap-2 text-sm">
          <p>From: {loaded.sender || "No mailbox is connected for this advisor."}</p>
          <p>To: {loaded.recipient || "reviewer@example.invalid"}</p>
          <p>Subject: {loaded.subject || "Signature Workflow Test — fictional document"}</p>
          <p>Body: {loaded.body || "This is a fictional test email, not a client message."}</p>
          {file && <p>Attachment: {file.path} · {file.size} bytes · {file.hash}</p>}
          {loaded.preview && <pre className="whitespace-pre-wrap">{loaded.preview}</pre>}
          {loaded.error && <p>{loaded.error}</p>}
          {loaded.setup && (
            <ol className="list-decimal pl-5">
              {loaded.setup.map((step) => <li key={step}>{step}</li>)}
            </ol>
          )}
          {loaded.monitoring && <p>{loaded.monitoring}</p>}
        </div>
      )}
    </section>
  );
}
