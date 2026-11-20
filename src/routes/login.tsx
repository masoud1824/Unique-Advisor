import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { loginAdvisor } from "@/lib/advisor.functions";
import { savePhoneLogin } from "@/lib/phone-app";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Log In — Unique Advisor" }] }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "");
    const accessCode = String(form.get("password") || "");
    setBusy(true);
    setError("");
    const result = await loginAdvisor({ data: { email, accessCode } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    sessionStorage.setItem(`ua:${result.slug}`, accessCode.trim());
    savePhoneLogin({ slug: result.slug, code: accessCode.trim() });
    await navigate({ to: "/a/$slug/desk", params: { slug: result.slug } });
  }

  return (
    <div className="ua-auth">
      <form className="ua-auth-card" onSubmit={onSubmit}>
        <h1>Advisor Login</h1>
        <p className="subtitle">No advisor exists until you create one. On this preview, the account stays after a restart. It is not a production account.</p>
        <label>
          Email
          <input name="email" type="email" required autoComplete="username" />
        </label>
        <label>
          Password
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        {error && <p className="ua-auth-error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Checking…" : "Log In"}
        </button>
        <Link to="/admin" style={{ display: "block", textAlign: "center", marginTop: 16, background: "#14324f", color: "#fff", borderRadius: 8, padding: "14px", fontWeight: 700, textDecoration: "none" }}>
          Open Superadmin
        </Link>
        <p className="ua-auth-link">
          <Link to="/a/$slug/desk" params={{ slug: "masoud-zangeneh-2" }}>Open Masoud Zangeneh 2 desk</Link>
        </p>
        <p className="ua-auth-link">
          <Link to="/signup">Create an account</Link>
        </p>
      </form>
    </div>
  );
}
