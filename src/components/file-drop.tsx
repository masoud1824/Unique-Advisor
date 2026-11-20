import { useEffect, useRef, useState } from "react";
import { Paperclip, Upload, X } from "lucide-react";
import { fileAllowed, takeDroppedFiles } from "@/lib/file-drop";

export type FileDropItem = { name: string; preview?: string };

export function FileDrop({
  label,
  accept,
  multiple = false,
  max,
  files,
  items,
  preview,
  previewName,
  onFiles,
  onRemove,
  onClearPreview,
  hint,
  shape = "file",
  compact = false,
  className = "",
}: {
  label: string;
  accept?: string;
  multiple?: boolean;
  max?: number;
  files?: File[];
  items?: FileDropItem[];
  preview?: string;
  previewName?: string;
  onFiles: (files: File[]) => void;
  onRemove?: (index: number) => void;
  onClearPreview?: () => void;
  hint?: string;
  shape?: "file" | "photo" | "wide" | "logo";
  compact?: boolean;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [warn, setWarn] = useState("");
  const [thumbs, setThumbs] = useState<string[]>([]);
  const limit = max ?? (multiple ? 4 : 1);

  useEffect(() => {
    if (!files?.length) return;
    const urls: string[] = [];
    const next = files.map((file) => {
      if (!file.type.startsWith("image/")) return "";
      const url = URL.createObjectURL(file);
      urls.push(url);
      return url;
    });
    setThumbs(next);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  const fromFiles: FileDropItem[] = (files ?? []).map((file, index) => ({ name: file.name, preview: thumbs[index] }));
  const shown = fromFiles.length ? fromFiles : items?.length ? items : preview ? [{ name: previewName || "Selected file", preview }] : [];

  function choose(list: File[]) {
    if (!list.length) return;
    const allowed = list.filter((file) => fileAllowed(file, accept));
    const kept = takeDroppedFiles(allowed, { multiple, max: limit });
    if (!kept.length) {
      setWarn("That file is not allowed here.");
      return;
    }
    if (allowed.length < list.length) setWarn("Some files were left out. Use an allowed file type.");
    else if (kept.length < allowed.length) setWarn(multiple ? `Only ${limit} files can be added.` : "Only one file can be added.");
    else setWarn("");
    onFiles(kept);
  }

  function remove(index: number) {
    if ((files && files.length) || (items && items.length)) onRemove?.(index);
    else onClearPreview?.();
  }

  const Icon = /attach/i.test(label) ? Paperclip : Upload;

  return (
    <div
      className={`ua-drop${compact ? " is-compact" : ""}${over ? " is-over" : ""}${className ? ` ${className}` : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        choose(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="ua-upload-line">
        <button
          type="button"
          className="ua-upload-btn"
          title={hint || undefined}
          style={{ background: "var(--ua-gold, #c9a227)", color: "#fff", fontWeight: 700 }}
          onClick={() => input.current?.click()}
        >
          <Icon size={18} aria-hidden="true" />
          {label}
        </button>
        {shown.length > 0 && <span className="ua-file-beside">{shown.map((item) => item.name).join(", ")}</span>}
      </div>
      {compact ? null : <p className="ua-drop-hint">{over ? "Drop to add" : hint || (multiple ? "Or drop files here." : "Or drop a file here.")}</p>}
      {warn ? <p className="ua-drop-warn">{warn}</p> : null}
      {shown.map((item, index) => (
        <div key={`${item.name}-${index}`} className={`ua-file-row${shape === "wide" ? " is-wide" : ""}`}>
          {item.preview ? (
            <img src={item.preview} alt="" className={`ua-file-thumb is-${shape}`} />
          ) : (
            <span className="ua-file-badge">{extension(item.name)}</span>
          )}
          <span className="ua-file-name">{item.name}</span>
          <button type="button" className="ua-file-x" aria-label={`Remove ${item.name}`} onClick={() => remove(index)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
      <input
        ref={input}
        type="file"
        className="ua-file-native"
        style={{ display: "none" }}
        accept={accept}
        multiple={multiple || undefined}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          event.target.value = "";
          choose(picked);
        }}
      />
    </div>
  );
}

function extension(name: string) {
  const part = name.split(".").pop()?.slice(0, 4).toUpperCase();
  return part && part !== name.toUpperCase() ? part : "FILE";
}
