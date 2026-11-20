import { useEffect, useRef, useState } from "react";
import { loadFormPreview } from "@/lib/form-preview.functions";

type Line = { label: string; field: string; value: string; status: "filled" | "left blank"; source: string };
type Preview = {
  link: string;
  form: string;
  file: string;
  pageDate: string;
  edition: string;
  folder: string;
  files: string[];
  plan: Line[];
  bytes: Uint8Array;
};

export function FormPreview({ code, slug }: { code: string; slug: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(3);

  useEffect(() => {
    let cancel = false;
    void loadFormPreview({ data: { slug, code } }).then((result) => {
      if (cancel) return;
      if (!result.ok || !("pdfBase64" in result)) {
        setError("error" in result ? String(result.error) : "The form preview could not be prepared.");
        return;
      }
      const raw = atob(result.pdfBase64);
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
      setPreview({
        link: result.link,
        form: result.form,
        file: result.file,
        pageDate: result.pageDate,
        edition: result.edition,
        folder: result.folder,
        files: result.files,
        plan: result.plan,
        bytes,
      });
    });
    return () => { cancel = true; };
  }, [slug, code]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !preview) return;
    let cancel = false;
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const doc = await pdfjs.getDocument({ data: preview.bytes.slice(0) }).promise;
      if (cancel) return;
      const sheet = await doc.getPage(Math.min(page, doc.numPages));
      const view = sheet.getViewport({ scale: 1.25 });
      canvas.width = view.width;
      canvas.height = view.height;
      const context = canvas.getContext("2d");
      if (!context) return;
      await sheet.render({ canvasContext: context, viewport: view }).promise;
    })();
    return () => { cancel = true; };
  }, [preview, page]);

  const filled = preview?.plan.filter((line) => line.status === "filled") || [];
  const open = preview?.plan.filter((line) => line.status === "left blank") || [];

  return (
    <section className="ua-panel mb-4 p-6">
      <h2 className="text-lg font-semibold">Prepared form</h2>
      <p className="mt-1 text-sm" style={{ color: "#5a6a7a" }}>
        Fictional client C-1001 only. This preview was not uploaded, sent, or published. Signature placement stays closed until you ask to sign.
      </p>
      {error && <p className="mt-3 text-sm">{error}</p>}
      {preview && (
        <div className="mt-4 grid gap-4">
          <p className="text-sm">
            {preview.form}. Saved link: {preview.link}. Forms-page date: {preview.pageDate || "not stated"}. Visible footer: {preview.edition || "not found"}.
            Folder: {preview.folder}. Files read: {preview.files.join(", ")}.
          </p>
          <label className="grid w-28 gap-1 text-sm font-semibold">
            Page
            <input className="ua-field font-normal" type="number" min={1} max={37} value={page} onChange={(event) => setPage(Number(event.target.value) || 1)} />
          </label>
          <div className="max-w-full overflow-auto rounded border" style={{ borderColor: "#d7d1c8" }}>
            <canvas ref={canvasRef} className="block max-w-full" />
          </div>
          <div>
            <h3 className="font-semibold">Filled</h3>
            <ul className="mt-2 grid gap-2 text-sm">
              {filled.map((line) => (
                <li key={line.label}><strong>{line.label}:</strong> {line.value}. {line.source}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-semibold">Unresolved</h3>
            <ul className="mt-2 grid gap-2 text-sm">
              {open.map((line) => (
                <li key={line.label}><strong>{line.label}:</strong> left blank. {line.source}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
