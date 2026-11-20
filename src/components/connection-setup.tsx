import { useEffect, useState } from "react";
import { loadLinkApps, saveConnectionApp } from "@/lib/advisor-links.functions";
import { browserPublicUrl } from "@/lib/preview-path-prefix";

type AppRow = { provider: string; label: string; configured: boolean; clientId: string };

export function ConnectionSetup({ code }: { code: string }) {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [secrets, setSecrets] = useState<Record<string, { id: string; secret: string }>>({});
  const [note, setNote] = useState("");

  useEffect(() => {
    void loadLinkApps({ data: { code } }).then((result) => {
      if (result.ok) setApps(result.apps);
    });
  }, [code]);

  async function save(provider: string) {
    const form = secrets[provider] ?? { id: "", secret: "" };
    const result = await saveConnectionApp({ data: { code, provider, clientId: form.id, clientSecret: form.secret } });
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    setApps(result.apps);
    setSecrets((current) => ({ ...current, [provider]: { id: "", secret: "" } }));
    setNote("Saved. Each advisor still connects their own account in Settings.");
  }

  return (
    <div style={{ marginTop: 28 }}>
      <h2 style={{ marginBottom: 8 }}>Advisor accounts</h2>
      <p style={{ color: "#5a6a7a", marginBottom: 12, maxWidth: 720 }}>
        One Unique Advisor connection can be saved here. It is not an advisor’s login. Each advisor then signs in with their own username and password. Return address, if a company asks for one: {browserPublicUrl("/api/link/callback")}
      </p>
      {apps.filter((app) => app.provider !== "outlook_calendar").map((app) => (
        <form
          key={app.provider}
          onSubmit={(event) => {
            event.preventDefault();
            void save(app.provider);
          }}
          style={{ background: "#fff", padding: 16, borderRadius: 12, marginBottom: 12, maxWidth: 720 }}
        >
          <p style={{ fontWeight: 600 }}>{app.label} {app.configured ? "· saved" : "· not set up"}</p>
          {app.clientId && <p style={{ color: "#5a6a7a", fontSize: 13 }}>Current app ID {app.clientId}</p>}
          <input
            placeholder="App ID"
            value={secrets[app.provider]?.id ?? ""}
            onChange={(event) => setSecrets((current) => ({ ...current, [app.provider]: { id: event.target.value, secret: current[app.provider]?.secret ?? "" } }))}
            style={{ width: "100%", marginTop: 8 }}
          />
          <input
            placeholder="Secret"
            type="password"
            value={secrets[app.provider]?.secret ?? ""}
            onChange={(event) => setSecrets((current) => ({ ...current, [app.provider]: { id: current[app.provider]?.id ?? "", secret: event.target.value } }))}
            style={{ width: "100%", marginTop: 8 }}
          />
          <button type="submit" className="btn-sm btn-primary" style={{ marginTop: 8 }}>Save {app.label}</button>
        </form>
      ))}
      {note && <p style={{ color: "#0d7a4f" }}>{note}</p>}
    </div>
  );
}
