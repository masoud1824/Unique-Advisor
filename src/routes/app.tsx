import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { InstallPhone } from "@/components/install-phone";
import { loginAdvisor } from "@/lib/advisor.functions";
import { readPhoneLogin, savePhoneLogin } from "@/lib/phone-app";

export const Route = createFileRoute("/app")({
  head: () => ({ meta: [{ title: "Unique Advisor desk" }] }),
  component: PhoneApp,
});

function PhoneApp() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = readPhoneLogin();
    if (saved) {
      void navigate({ to: "/a/$slug/desk", params: { slug: saved.slug } });
      return;
    }
    setReady(true);
  }, [navigate]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await loginAdvisor({ data: { email, accessCode } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    savePhoneLogin({ slug: result.slug, code: accessCode.trim() });
    await navigate({ to: "/a/$slug/desk", params: { slug: result.slug } });
  }

  if (!ready) {
    return (
      <div className="ua-auth">
        <p>Opening your desk…</p>
      </div>
    );
  }

  return (
    <div className="ua-auth" style={{ alignItems: "stretch" }}>
      <div style={{ width: "min(440px, 100%)", margin: "0 auto" }}>
        <InstallPhone />
        <form className="ua-auth-card" onSubmit={onSubmit}>
          <h1>Unique Advisor</h1>
          <p className="subtitle">Sign in to open your desk</p>
          <label>
            Email
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input type="password" required value={accessCode} onChange={(event) => setAccessCode(event.target.value)} />
          </label>
          {error && <p className="ua-auth-error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Checking…" : "Open desk"}
          </button>
          <a href="/admin" style={{ display: "block", textAlign: "center", marginTop: 16, background: "#14324f", color: "#fff", borderRadius: 8, padding: "14px", fontWeight: 700, textDecoration: "none" }}>
            Open Superadmin
          </a>
          <p className="ua-auth-link">
            <a href="/?site=1">Public website</a>
          </p>
        </form>
      </div>
    </div>
  );
}
