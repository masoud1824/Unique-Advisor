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
  const [email, setEmail] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    sessionStorage.setItem(`ua:${result.slug}`, accessCode.trim());
    savePhoneLogin({ slug: result.slug, code: accessCode.trim() });
    await navigate({ to: "/a/$slug/desk", params: { slug: result.slug } });
  }

  return (
    <div className="ua-auth">
      <form className="ua-auth-card" onSubmit={onSubmit}>
        <h1>Advisor Login</h1>
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
          {busy ? "Checking…" : "Log In"}
        </button>
        <Link to="/admin" style={{ display: "block", textAlign: "center", marginTop: 16, background: "#14324f", color: "#fff", borderRadius: 8, padding: "14px", fontWeight: 700, textDecoration: "none" }}>
          Open Superadmin
        </Link>
        <p className="ua-auth-link">
          <Link to="/signup">Create an account</Link>
        </p>
      </form>
    </div>
  );
}
