import { useEffect, useRef } from "react";
import { sanitizeArticleHtml } from "@/lib/article-library";

/** Visual article editor. The stored value is cleaned HTML, not a raw markup box. */
export function RichTextEditor({ value, onChange, label }: { value: string; onChange: (html: string) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || document.activeElement === node) return;
    const clean = sanitizeArticleHtml(value);
    if (node.innerHTML !== clean) node.innerHTML = clean;
  }, [value]);
  function apply(command: string) {
    ref.current?.focus();
    document.execCommand(command);
    onChange(sanitizeArticleHtml(ref.current?.innerHTML || ""));
  }
  return (
    <div>
      <div role="toolbar" aria-label={`${label} formatting`} style={{ display: "flex", gap: 8, margin: "8px 0" }}>
        <button type="button" onMouseDown={(event) => { event.preventDefault(); apply("bold"); }}>Bold</button>
        <button type="button" onMouseDown={(event) => { event.preventDefault(); apply("italic"); }}>Italic</button>
        <button type="button" onMouseDown={(event) => { event.preventDefault(); apply("insertUnorderedList"); }}>List</button>
      </div>
      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        suppressContentEditableWarning
        onInput={() => onChange(sanitizeArticleHtml(ref.current?.innerHTML || ""))}
        style={{ minHeight: 160, border: "1px solid #1C3D36", padding: 12, background: "#fff", color: "#1A1916" }}
      />
    </div>
  );
}
