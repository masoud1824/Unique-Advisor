import { useEffect, useRef, useState } from "react";
import { loadWorkflowPreview } from "@/lib/signature-workflow.functions";

type Field = { page: number; x: number; y: number; width: number; height: number };
type Loaded = { path: string; preview: string; field: Field; width: number; height: number; bytes: Uint8Array };

export function WorkflowSignaturePreview({ code, slug }: { code: string; slug: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    void loadWorkflowPreview({ data: { slug, code } }).then((result) => {
      if (cancel) return;
      if (!result.ok || !("pdfBase64" in result)) {
        setError("error" in result ? String(result.error) : "The document was not selected.");
        return;
      }
      const raw = atob(result.pdfBase64);
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
      setLoaded({ path: result.path, preview: result.preview, field: result.field, width: result.width, height: result.height, bytes });
    });
    return () => { cancel = true; };
  }, [slug, code]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    let cancel = false;
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const doc = await pdfjs.getDocument({ data: loaded.bytes.slice(0) }).promise;
      if (cancel) return;
      const sheet = await doc.getPage(1);
      const view = sheet.getViewport({ scale: 1.4 });
      canvas.width = view.width;
      canvas.height = view.height;
      const context = canvas.getContext("2d");
      if (!context) return;
      await sheet.render({ canvasContext: context, viewport: view }).promise;
    })();
    return () => { cancel = true; };
  }, [loaded]);

  function boxStyle() {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return { display: "none" };
    const rect = canvas.getBoundingClientRect();
    const { field, width, height } = loaded;
    return {
      left: (field.x / width) * rect.width,
      top: (field.y / height) * rect.height,
      width: (field.width / width) * rect.width,
      height: (field.height / height) * rect.height,
    };
  }

  return (
    <section className="ua-panel mb-4 p-6">
      <h2 className="text-lg font-semibold">Signature workflow preview</h2>
      <p className="mt-1 text-sm" style={{ color: "#5a6a7a" }}>
        {error || "The LP257 prepared draft has no signature placement. This is a separate document selected from Dropbox. Nothing is sent."}
      </p>
      {!error && loaded && (
        <div className="mt-4 grid gap-3">
          <div className="relative max-w-full overflow-auto rounded border" style={{ borderColor: "#d7d1c8" }}>
            <canvas ref={canvasRef} className="block max-w-full" />
            <div className="pointer-events-none absolute border-2" style={{ ...boxStyle(), borderColor: "#9C5A38", background: "rgba(156,90,56,0.12)" }} />
          </div>
          <pre className="whitespace-pre-wrap text-sm">{loaded.preview}</pre>
        </div>
      )}
    </section>
  );
}
