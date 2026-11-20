import { useEffect, useRef, useState } from "react";
import { loadSignatureDocument, previewSignaturePlacement } from "@/lib/signature-placement.functions";

type Box = { x: number; y: number; width: number; height: number };
type Loaded = {
  name: string;
  path: string;
  pages: number;
  edition: string;
  signerName: string;
  fileEmail: string;
  testEmail: string;
  bytes: Uint8Array;
};

export function SignaturePlacement({ code, slug }: { code: string; slug: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [box, setBox] = useState<Box | null>(null);
  const [signer, setSigner] = useState("");
  const [delivery, setDelivery] = useState("");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    void loadSignatureDocument({ data: { slug, code } }).then((result) => {
      if (cancel) return;
      if (!result.ok || !("pdfBase64" in result)) {
        setError("error" in result ? String(result.error) : "The PDF could not be opened.");
        return;
      }
      const raw = atob(result.pdfBase64);
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
      setLoaded({ name: result.name, path: result.path, pages: result.pages, edition: result.edition, signerName: result.signerName, fileEmail: result.fileEmail, testEmail: result.testEmail, bytes });
      setSigner(result.signerName);
      setDelivery(result.testEmail);
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
      const task = pdfjs.getDocument({ data: loaded.bytes.slice(0) });
      const doc = await task.promise;
      if (cancel) return;
      const sheet = await doc.getPage(page);
      const view = sheet.getViewport({ scale: 1.25 });
      canvas.width = view.width;
      canvas.height = view.height;
      const context = canvas.getContext("2d");
      if (!context) return;
      await sheet.render({ canvasContext: context, viewport: view }).promise;
    })();
    return () => { cancel = true; };
  }, [loaded, page]);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const pageWidth = canvas.width / 1.25;
    const pageHeight = canvas.height / 1.25;
    const px = ((event.clientX - rect.left) / rect.width) * pageWidth;
    const py = pageHeight - ((event.clientY - rect.top) / rect.height) * pageHeight;
    return { x: px, y: py, pageWidth, pageHeight };
  }

  function overlayStyle() {
    const canvas = canvasRef.current;
    if (!canvas || !box) return { display: "none" };
    const rect = canvas.getBoundingClientRect();
    const pageWidth = canvas.width / 1.25;
    const pageHeight = canvas.height / 1.25;
    const left = (box.x / pageWidth) * rect.width;
    const top = ((pageHeight - (box.y + box.height)) / pageHeight) * rect.height;
    const width = (box.width / pageWidth) * rect.width;
    const height = (box.height / pageHeight) * rect.height;
    return { left, top, width, height };
  }

  return (
    <section className="ua-panel mb-4 p-6">
      <h2 className="text-lg font-semibold">Signature preview</h2>
      <p className="mt-1 text-sm" style={{ color: "#5a6a7a" }}>
        This is the prepared draft only, in Dropbox Sign test mode. The signer is the test signer, not the fictional client. Draw the signature box yourself. Nothing is sent.
      </p>
      {error && <p className="mt-3 text-sm">{error}</p>}
      {loaded && (
        <div className="mt-4 grid gap-3">
          <p className="text-sm">
            {loaded.path}. Visible footer edition: {loaded.edition || "not found"}. Destination when completed: /Unique Advisor/Assistant Test/C-1001, as a new file.
            {loaded.fileEmail ? ` File email ${loaded.fileEmail} stays fictional and is not the recipient.` : ""}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm font-semibold">
              Page
              <input className="ua-field font-normal" type="number" min={1} max={loaded.pages} value={page} onChange={(event) => { setPage(Number(event.target.value) || 1); setBox(null); setPreview(""); }} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Signer
              <select className="ua-field font-normal" value={signer} onChange={(event) => setSigner(event.target.value)}>
                <option value="">Choose</option>
                <option value={loaded.signerName}>{loaded.signerName} — approved test recipient</option>
              </select>
            </label>
            <label className="grid min-w-64 flex-1 gap-1 text-sm font-semibold">
              Delivery email
              <input className="ua-field font-normal" value={delivery} placeholder="Approved test email" onChange={(event) => setDelivery(event.target.value)} />
            </label>
          </div>
          <div className="relative max-w-full overflow-auto rounded border" style={{ borderColor: "#d7d1c8" }}>
            <canvas
              ref={canvasRef}
              className="block max-w-full cursor-crosshair"
              onPointerDown={(event) => {
                const start = point(event);
                if (!start) return;
                dragRef.current = start;
                setBox(null);
                setPreview("");
              }}
              onPointerMove={(event) => {
                const start = dragRef.current;
                const current = point(event);
                if (!start || !current || !event.buttons) return;
                const x = Math.min(start.x, current.x);
                const y = Math.min(start.y, current.y);
                setBox({ x, y, width: Math.abs(current.x - start.x), height: Math.abs(current.y - start.y) });
              }}
              onPointerUp={() => { dragRef.current = null; }}
            />
            {box && <div className="pointer-events-none absolute border-2" style={{ ...overlayStyle(), borderColor: "#9C5A38", background: "rgba(156,90,56,0.15)" }} />}
          </div>
          <p className="text-sm" style={{ color: "#5a6a7a" }}>
            {box ? `Box: page ${page}, x ${Math.round(box.x)}, y ${Math.round(box.y)}, width ${Math.round(box.width)}, height ${Math.round(box.height)}.` : "No box yet. Drag on the page to draw one."}
          </p>
          <button
            type="button"
            className="ua-btn w-fit"
            disabled={busy || !box}
            onClick={() => {
              if (!box) return;
              setBusy(true);
              setPreview("");
              void previewSignaturePlacement({ data: { slug, code, page, x: box.x, y: box.y, width: box.width, height: box.height, signerName: signer, deliveryEmail: delivery } }).then((result) => {
                setBusy(false);
                if (!result.ok) {
                  setError("error" in result ? String(result.error) : "That preview was not saved.");
                  return;
                }
                setError("");
                setPreview("preview" in result ? result.preview : "");
              });
            }}
          >
            {busy ? "Checking…" : "Show preview"}
          </button>
          {preview && <pre className="whitespace-pre-wrap text-sm">{preview}</pre>}
        </div>
      )}
    </section>
  );
}
