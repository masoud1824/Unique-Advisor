import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCorporateSite, signupAdvisor } from "@/lib/advisor.functions";
import { browserPublicUrl } from "@/lib/preview-path-prefix";
import { PLAN_LABELS, PLANS, PRICING_APPROVED, type PlanId } from "@/lib/site-types";

export const Route = createFileRoute("/signup")({
  loader: () => getCorporateSite(),
  head: () => ({ meta: [{ title: "Sign Up — Unique Advisor" }] }),
  component: Signup,
});

function Signup() {
  const corporate = Route.useLoaderData();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<PlanId>(corporate.defaultPlan);
  const [promoCode, setPromoCode] = useState("");
  const [promo, setPromo] = useState<{ code: string; kind: string; amount: number; applies: string; monthlyPercent: number; setupPercent: number } | null>(null);
  const [promoNote, setPromoNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  useEffect(() => {
    setCallbackUrl(browserPublicUrl("/api/microsoft/callback"));
  }, []);
  const trial =
    corporate.trialDays > 0
      ? `Start your free ${corporate.trialDays}-day trial of Unique Advisor`
      : "Create your Unique Advisor account";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "");
    const email = String(form.get("email") || "");
    const phone = String(form.get("phone") || "");
    const company = String(form.get("company") || "");
    const password = String(form.get("password") || "");
    const parts = name.trim().split(/\s+/);
    const firstName = parts[0] ?? "";
    const lastName = parts.slice(1).join(" ") || parts[0] || "";
    setBusy(true);
    setError("");
    const result = await signupAdvisor({ data: { firstName, lastName, email, accessCode: password, plan, promoCode } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    sessionStorage.setItem(`ua:${result.slug}`, password);
    if (phone || company) {
      localStorage.setItem(
        `ua-profile:${result.slug}`,
        JSON.stringify({ name, phone, company: company || name, email }),
      );
    }
    setSlug(result.slug);
    await navigate({ to: "/a/$slug/desk", params: { slug: result.slug } });
  }

  async function applyCode() {
    setError("");
    setPromo(null);
    setPromoNote("");
    if (!promoCode.trim()) return;
    setPromoNote("Pricing is not set, so a promotion code cannot change a price. Checkout is off.");
  }

  return (
    <div className="ua-auth">
      <form className="ua-auth-card wide" onSubmit={onSubmit}>
        <h1>Create Your Account</h1>
        <p className="subtitle">{trial}</p>
        <p className="subtitle">This creates a preview advisor. Use a fictional name and email. The account is not kept if the preview restarts.</p>
        <p className="subtitle">Microsoft Entra Web redirect for this preview. Copy this address. Do not paste any secret into chat.</p>
        <p className="subtitle" style={{ wordBreak: "break-all", fontWeight: 700 }}>{callbackUrl || "The return address appears when this page finishes loading."}</p>
        <p className="subtitle">The path stays /api/microsoft/callback. The site address, and any /hds- prefix, can change when the preview restarts. Add this as another Web redirect on the existing Entra app. Do not remove the production redirect, and do not create a new app unless you want one.</p>
        <label>
          Full Name
          <input name="name" required autoComplete="name" />
        </label>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Phone
          <input name="phone" type="tel" autoComplete="tel" />
        </label>
        <label>
          Company Name
          <input name="company" autoComplete="organization" />
        </label>
        <label>
          Plan
          <select
            value={plan}
            onChange={(event) => setPlan(event.target.value as PlanId)}
          >
            {PLANS.map((id) => (
              <option key={id} value={id}>
                {PLAN_LABELS[id]} — pricing is not set
              </option>
            ))}
          </select>
        </label>
        <label>
          Promotion code
          <input value={promoCode} onChange={(event) => { setPromoCode(event.target.value.toUpperCase()); setPromo(null); }} placeholder="Optional" disabled={!PRICING_APPROVED} />
        </label>
        <button type="button" onClick={() => void applyCode()} style={{ marginBottom: 12 }} disabled={!PRICING_APPROVED}>
          Apply code
        </button>
        {promoNote && <p className="subtitle" style={{ color: "#b42318", fontWeight: 700 }}>{promoNote}</p>}
        <p className="subtitle">Pricing is not set. No monthly fee or setup fee is offered. Checkout is off.</p>
        <label>
          Password
          <input name="password" type="password" required minLength={6} autoComplete="new-password" />
        </label>
        {error && <p className="ua-auth-error">{error}</p>}
        {slug && <p className="subtitle">Your copy is {slug}. Opening the desk…</p>}
        <button type="submit" disabled={busy} style={{ background: corporate.site.buttonColor, color: corporate.site.fonts.button.color }}>
          {busy ? "Creating…" : "Create Account & Start Trial"}
        </button>
        <p className="ua-auth-link">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
