import { createFileRoute } from "@tanstack/react-router";
import { loadPreviewSetup } from "@/lib/preview-setup";

export const Route = createFileRoute("/setup")({
  loader: () => loadPreviewSetup(),
  head: () => ({ meta: [{ title: "Preview setup — Unique Advisor" }] }),
  component: SetupPage,
});

function SetupPage() {
  const status = Route.useLoaderData();
  if (!status.isolated) {
    return (
      <div className="ua-auth">
        <div className="ua-auth-card">
          <h1>Production database</h1>
          <p className="subtitle">This screen is for the preview only. Nothing here reads or copies production records.</p>
        </div>
      </div>
    );
  }
  const missing = status.items.filter((item) => !item.ready);
  return (
    <div className="ua-auth">
      <div className="ua-auth-card" style={{ maxWidth: 640 }}>
        <h1>Preview setup</h1>
        <p className="subtitle">Advisor accounts and saved settings stay in a private preview file. A preview restart does not erase them. Production is a different database and is not used or copied.</p>
        <p className="subtitle">Storage marker: {status.markerAt || "not written"}</p>
        <ul style={{ listStyle: "none", padding: 0, margin: "20px 0" }}>
          {status.items.map((item) => (
            <li key={item.id} style={{ padding: "12px 0", borderTop: "1px solid var(--t-line)" }}>
              <strong>{item.ready ? "Saved" : "Missing"} — {item.label}</strong>
              <p className="subtitle" style={{ margin: "4px 0 0" }}>{item.detail}</p>
              {!item.ready ? <p style={{ margin: "8px 0 0" }}><a href={item.href}>{item.id === "admin" || item.id === "openai" ? "Open Superadmin" : item.id === "advisor" ? "Create an advisor account" : "Continue"}</a></p> : null}
            </li>
          ))}
        </ul>
        <p className="subtitle">{missing.length === 0 ? "Every prerequisite is saved. The calendar test can run." : `${missing.length} item${missing.length === 1 ? "" : "s"} still missing. Saved items do not need to be entered again.`}</p>
      </div>
    </div>
  );
}
