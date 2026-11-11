import { Link, createFileRoute } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { getCorporateSite } from "@/lib/advisor.functions";
import { SETUP_FEES, type SiteFonts } from "@/lib/site-types";

export const Route = createFileRoute("/")({
  loader: () => getCorporateSite(),
  head: () => ({ meta: [{ title: "Unique Advisor" }] }),
  component: Home,
});

function setupFor(name: string) {
  const key = name.toLowerCase();
  if (key.includes("starter")) return SETUP_FEES.starter;
  if (key.includes("professional")) return SETUP_FEES.professional;
  if (key.includes("team")) return SETUP_FEES.team;
  return 0;
}

function Home() {
  const { site } = Route.useLoaderData();
  const paint = (key: keyof SiteFonts): CSSProperties => ({ fontSize: site.fonts[key].size, color: site.fonts[key].color });
  const trialButton: CSSProperties = { background: site.buttonColor, color: site.fonts.button.color, fontSize: site.fonts.button.size };

  return (
    <div className="ua-marketing">
      <nav className="m-nav">
        <img src="/logo.png" alt="Unique Advisor" />
        <div>
          {site.links.map((link: { label: string; href: string }) => (
            link.href.startsWith("/") ? <Link key={link.label + link.href} to={link.href} style={paint("menu")}>{link.label}</Link> : <a key={link.label + link.href} href={link.href} style={paint("menu")}>{link.label}</a>
          ))}
          <Link to="/admin" style={{ marginLeft: 22, background: "#14324f", color: "#fff", borderRadius: 999, padding: "8px 14px", fontWeight: 700 }}>Superadmin</Link>
        </div>
      </nav>
      <header className="m-hero">
        <div className="m-wrap">
          {site.kicker && <p className="m-kicker" style={paint("kicker")}>{site.kicker}</p>}
          {site.accent && <p className="m-hero-accent" style={paint("accent")}>{site.accent}</p>}
          {site.headline && <h1 style={paint("title")}>{site.headline}</h1>}
          {site.subhead && <p style={paint("intro")}>{site.subhead}</p>}
          <div className="m-hero-actions">
            {site.primaryButton && <Link to="/signup" className="m-btn m-btn-gold" style={trialButton}>{site.primaryButton}</Link>}
            {site.secondaryButton && <a href="#pricing" className="m-btn m-btn-ghost" style={paint("ghost")}>{site.secondaryButton}</a>}
          </div>
        </div>
      </header>
      {site.assistantVisible && (
        <section className="m-section" id="assistant">
          <div className="m-wrap">
            {site.assistantKicker && <p className="m-kicker" style={paint("sectionLabel")}>{site.assistantKicker}</p>}
            {site.assistantTitle && <h2 style={paint("sectionTitle")}>{site.assistantTitle}</h2>}
            {site.assistantLead && <p className="m-lead" style={paint("sectionText")}>{site.assistantLead}</p>}
            <div className="m-features">
              {site.assistantCards.map((card: { title: string; body: string }) => (
                <article key={card.title} className="m-feature">
                  <h3 style={paint("cardTitle")}>{card.title}</h3>
                  <p style={paint("cardText")}>{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}
      {site.featuresVisible && (
        <section className="m-section m-section-alt" id="features">
          <div className="m-wrap">
            {site.featuresKicker && <p className="m-kicker" style={paint("sectionLabel")}>{site.featuresKicker}</p>}
            {site.featuresTitle && <h2 style={paint("sectionTitle")}>{site.featuresTitle}</h2>}
            <div className="m-features">
              {site.features.map((card: { title: string; body: string }) => (
                <article key={card.title} className="m-feature">
                  <h3 style={paint("cardTitle")}>{card.title}</h3>
                  <p style={paint("cardText")}>{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}
      {site.pricingVisible && (site.pricingTitle || site.plans.length > 0) && (
        <section className="m-section" id="pricing">
          <div className="m-wrap">
            {site.pricingKicker && <p className="m-kicker" style={paint("sectionLabel")}>{site.pricingKicker}</p>}
            {site.pricingTitle && <h2 style={paint("sectionTitle")}>{site.pricingTitle}</h2>}
            <div className="m-pricing">
              {site.plans.map((plan: { name: string; note: string; price: string; points: string; button: string; featured: boolean }) => {
                const setup = setupFor(plan.name);
                return (
                  <article key={plan.name + plan.price} className={plan.featured ? "m-price-card featured" : "m-price-card"}>
                    {plan.name && <h3 style={paint("planName")}>{plan.name}</h3>}
                    {plan.note && <p className="m-plan-note" style={paint("planNote")}>{plan.note}</p>}
                    {plan.price && <div className="m-price" style={paint("price")}>{plan.price}<span style={paint("planList")}>/month</span></div>}
                    {setup > 0 && <p className="m-plan-note" style={{ textTransform: "none", letterSpacing: 0, fontSize: 16, color: "#14324f" }}>One-time setup fee ${setup.toLocaleString()}</p>}
                    <ul style={paint("planList")}>
                      {plan.points.split("\n").map((point) => point.trim()).filter((point) => Boolean(point) && !/^one-time setup/i.test(point)).map((point) => <li key={point}>{point}</li>)}
                    </ul>
                    {plan.button && <Link to="/signup" className="m-btn" style={trialButton}>{plan.button}</Link>}
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}
      <footer className="m-footer">
        <img src="/logo.png" alt="Unique Advisor" />
        {site.footer && <p style={paint("footer")}>{site.footer}</p>}
        <p>
          {site.footerLinks.map((link: { label: string; href: string }) => (
            <Link key={link.label + link.href} to={link.href} style={paint("footerLink")}>{link.label}</Link>
          ))}
        </p>
      </footer>
    </div>
  );
}
