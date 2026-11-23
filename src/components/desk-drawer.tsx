import { useEffect, useRef, type ReactNode } from "react";

export function DeskDrawer({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <div className="ua-modal" role="presentation" onClick={() => onCloseRef.current()}>
      <div className="ua-context-drawer" role="dialog" aria-modal="true" aria-label={label} onClick={(event) => event.stopPropagation()}>
        <button ref={closeRef} type="button" className="ua-btn-line" data-drawer-close onClick={() => onCloseRef.current()}>Close</button>
        <div className="ua-context-body">{children}</div>
      </div>
    </div>
  );
}
