import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { HeartPulse, Shield, Umbrella, Users } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { submitLead } from "@/lib/site.functions";
import { INTEREST_LABELS, PALETTE_COLORS, PALETTES, type Interest, type Palette, type PublicSite } from "@/lib/site-types";
import { readWebsite, BANNER_FRAME, type SiteLayout, type WebSite, type WebTab } from "@/lib/website";

const COVERAGES = [
  {
    key: "life" as const,
    flag: "showLife" as const,
    title: "Life insurance",
    image: "/photos/life.jpg",
    icon: Shield,
    lede: "A contract that pays the people you name if you die while the policy is in force.",
    points: [
      "Term coverage is priced for a set number of years. Permanent coverage is built to last, and costs more because of it.",
      "The death benefit is generally paid as a lump sum to the beneficiary, outside the delays of a will.",
      "The amount should track debts, income your household would lose, and how long that gap lasts — not a round number from an ad.",
    ],
  },
  {
    key: "critical" as const,
    flag: "showCritical" as const,
    title: "Critical illness",
    image: "/photos/critical.jpg",
    icon: HeartPulse,
    lede: "A lump sum paid to you if you are diagnosed with a condition the contract lists.",
    points: [
      "It is not life insurance. You are alive, and the money is yours to spend — income, travel for care, or paying down a mortgage.",
      "Definitions matter. “Cancer,” “heart attack,” and “stroke” mean what the policy says, not what a headline says.",
      "It can sit beside disability coverage. One replaces income. The other is a one-time cheque.",
    ],
  },
  {
    key: "disability" as const,
    flag: "showDisability" as const,
    title: "Disability income",
    image: "/photos/disability.jpg",
    icon: Umbrella,
    lede: "A monthly amount if illness or injury keeps you from doing your work.",
    points: [
      "Your ability to earn is usually the largest asset on the balance sheet, and the one with no spare key.",
      "Workplace plans often replace only part of pay, may be taxable, and can end when the job does.",
      "Own-occupation wording, waiting period, and benefit period change the price more than the brand name on the letterhead.",
    ],
  },
  {
    key: "group" as const,
    flag: "showGroup" as const,
    title: "Group benefits",
    image: "/photos/group.jpg",
    icon: Users,
    lede: "Coverage an employer buys for a group. Useful, and rarely the whole plan.",
    points: [
      "You usually cannot take the life or disability amount with you if you leave.",
      "The maximum is chosen for the group, not for your mortgage or your dependants.",
      "A personal policy can fill the part the group plan does not reach, and stay in force if you change firms.",
    ],
  },
];

const FACTS: { interest: Interest; kicker: string; text: string }[] = [
  {
    interest: "life",
    kicker: "Life insurance",
    text: "Many people only look at coverage after a health change. By then, the price and the options are no longer the ones they would have had at the last birthday.",
  },
  {
    interest: "critical",
    kicker: "Critical illness",
    text: "A life policy pays someone else. Critical illness pays you, while you are dealing with the diagnosis — and only for conditions written into that contract.",
  },
  {
    interest: "disability",
    kicker: "Disability",
    text: "A group long-term disability plan often covers a slice of salary and stops if you change employers. The gap is your household’s actual spending.",
  },
  {
    interest: "group",
    kicker: "Group plans",
    text: "Employer life insurance is convenient and usually not enough on its own. The amount was set for a workforce, not for your debts.",
  },
];

function joinList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function PracticeSite({ site }: { site: PublicSite }) {
  const custom = readWebsite(site.siteContent);
  if (custom) return <ManagedSite site={site} web={custom} />;
  const visible = COVERAGES.filter((item) => site[item.flag]);
  const facts = FACTS.filter((fact) => {
    if (fact.interest === "life") return site.showLife;
    if (fact.interest === "critical") return site.showCritical;
    if (fact.interest === "disability") return site.showDisability;
    return site.showGroup;
  });

  return (
    <ThemePaint palette={site.palette}>
      <SiteHeader
        slug={site.slug}
        practiceName={site.practiceName}
        showCoverage={visible.length > 0}
        showFacts={site.showFacts && facts.length > 0}
        showForm={site.showForm}
        photo={site.publicPhoto}
        advisorName={site.publicName || site.advisorName}
        advisorTitle={site.publicTitle}
        details={[site.publicPhone, site.publicCardEmail, site.publicCompany]}
      />
      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-12 md:grid-cols-2 md:py-20">
          <div>
            <p className="text-sm font-medium tracking-wide text-accent">{site.practiceName}</p>
            <h1 className="mt-3 font-display text-4xl leading-tight text-primary sm:text-5xl">
              What the policy is actually for.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              {visible.length > 0
                ? `${joinList(visible.map((item) => item.title))} ${visible.length === 1 ? "does a different job" : "do different jobs"}. This page says which job, in plain language.`
                : "This page is a plain-language place to start a coverage conversation."}{" "}
              If you want that mapped to your own numbers, leave a note.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {site.showForm && (
                <a href="#ask" className="rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-fg">
                  Ask a question
                </a>
              )}
              {visible.length > 0 && (
                <a href="#coverage" className="rounded-full border border-line bg-surface px-5 py-3 text-sm font-medium">
                  Read the coverage
                </a>
              )}
            </div>
          </div>
          <figure className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
            <img src="/photos/hero.jpg" alt="" className="aspect-video w-full object-cover" />
          </figure>
        </section>

        {site.showFacts && facts.length > 0 && (
          <section id="facts" className="border-y border-line bg-surface">
            <div className="mx-auto max-w-6xl px-5 py-14">
              <div className="max-w-2xl">
                <p className="text-sm font-medium tracking-wide text-accent">Did you know</p>
                <h2 className="mt-2 font-display text-3xl text-primary">Things people usually learn too late.</h2>
              </div>
              <div className="mt-8 grid gap-4 md:grid-cols-2">
                {facts.map((fact) => (
                  <article key={fact.interest} className="flex flex-col justify-between rounded-card border border-line bg-bg p-6">
                    <div>
                      <p className="text-xs font-semibold tracking-wide text-accent uppercase">{fact.kicker}</p>
                      <p className="mt-3 text-base leading-relaxed">{fact.text}</p>
                    </div>
                    {site.showForm && (
                      <a
                        href="#ask"
                        onClick={() => {
                          const el = document.getElementById("interest") as HTMLSelectElement | null;
                          if (el) el.value = fact.interest;
                        }}
                        className="mt-5 text-sm font-medium text-primary underline decoration-accent underline-offset-4"
                      >
                        Ask about this
                      </a>
                    )}
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {visible.length > 0 && (
          <section id="coverage" className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="font-display text-3xl text-primary">The coverage, side by side</h2>
            <p className="mt-3 max-w-2xl text-muted">
              None of this is a quote, and none of it replaces the contract. It is the distinction that makes a conversation useful.
            </p>
            <div className="mt-10 grid gap-8">
              {visible.map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.key} className="grid overflow-hidden rounded-card border border-line bg-surface md:grid-cols-5">
                    <img src={item.image} alt="" className="h-56 w-full object-cover md:col-span-2 md:h-full" />
                    <div className="p-6 md:col-span-3 md:p-8">
                      <div className="flex items-center gap-2 text-primary">
                        <Icon className="size-5" aria-hidden />
                        <h3 className="font-display text-2xl">{item.title}</h3>
                      </div>
                      <p className="mt-3 text-muted">{item.lede}</p>
                      <ul className="mt-5 space-y-3 text-sm leading-relaxed">
                        {item.points.map((point) => (
                          <li key={point} className="border-l-2 border-accent pl-3">
                            {point}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {site.showForm && <LeadForm site={site} />}

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 text-sm text-muted sm:flex-row sm:items-end sm:justify-between">
            <p className="max-w-xl">
              General information only. It is not a recommendation, a quote, or a promise that a policy will pay.
              Whether coverage fits depends on your health, your budget, and the wording of the contract.
            </p>
            <Link
              to="/a/$slug/desk"
              params={{ slug: site.slug }}
              className="font-medium text-primary underline decoration-accent underline-offset-4"
            >
              Advisor desk
            </Link>
          </div>
        </footer>
      </main>
    </ThemePaint>
  );
}

function ManagedSite({ site, web }: { site: PublicSite; web: WebSite }) {
  const pages = web.tabs.filter((tab) => tab.visible && tab.kind === "page");
  const menu = web.tabs
    .filter((tab) => tab.visible && (tab.kind === "page" || tab.url))
    .map((tab) =>
      tab.kind === "link"
        ? { href: tab.url, label: tab.label, external: true }
        : { href: `#${tab.id}`, label: tab.label },
    );
  const topics = [
    ...pages.map((tab) => ({ value: tab.id === "life" || tab.id === "critical" || tab.id === "disability" || tab.id === "group" ? tab.id : tab.label, label: tab.label })),
    { value: "unsure", label: "Not sure yet" },
  ];
  const name = site.publicName || site.advisorName;
  const layout = web.layout || "classic";
  const palette: Palette = web.palette && PALETTES.includes(web.palette) ? web.palette : site.palette;

  if (layout === "sidebar") {
    return (
      <ThemePaint palette={palette}>
        {web.bannerOn !== false && web.heroImage ? <img src={web.heroImage.startsWith("/banners/") ? `${web.heroImage}?v=5` : web.heroImage} alt="" style={BANNER_FRAME} /> : null}
        <div className="md:grid md:grid-cols-[260px_1fr]">
        <aside className="bg-primary px-6 py-8 text-primary-fg md:min-h-screen">
          {site.publicPhoto ? <img src={site.publicPhoto} alt="" style={{ display: "block", width: "auto", maxWidth: "100%", maxHeight: 220, height: "auto", borderRadius: 12 }} /> : null}
          <p className="mt-5 font-display text-2xl leading-tight">{name}</p>
          {site.publicTitle ? <p className="mt-1 text-sm text-primary-fg/75">{site.publicTitle}</p> : null}
          {[site.publicPhone, site.publicCardEmail, site.publicCompany].filter(Boolean).map((line) => (
            <p key={line} className="mt-1 text-sm text-primary-fg/75">{line}</p>
          ))}
          <p className="mt-4 text-xs tracking-wide text-accent uppercase">{site.practiceName}</p>
          <nav className="mt-6 grid gap-1 text-sm">
            {menu.map((item) =>
              item.external ? (
                <a key={item.href + item.label} href={item.href} target="_blank" rel="noopener noreferrer" className="rounded-lg px-3 py-2 hover:bg-white/10">{item.label}</a>
              ) : (
                <a key={item.href} href={item.href} className="rounded-lg px-3 py-2 hover:bg-white/10">{item.label}</a>
              ),
            )}
          </nav>
        </aside>
        <div>
          <main>
            <section className="px-6 py-12 md:px-12">
              <h1 className="max-w-3xl font-display text-4xl leading-tight text-primary sm:text-5xl">{web.heroTitle}</h1>
              {web.heroText ? <p className="mt-5 max-w-2xl whitespace-pre-wrap text-lg text-muted">{web.heroText}</p> : null}
            </section>
            {pages.map((tab) => <PageSection key={tab.id} tab={tab} layout="sidebar" />)}
            {web.ask && <LeadForm site={site} topics={topics} />}
            <SiteFooter site={site} web={web} />
          </main>
        </div>
        </div>
      </ThemePaint>
    );
  }

  return (
    <ThemePaint palette={palette}>
      <SiteHeader slug={site.slug} practiceName={site.practiceName} showForm={web.ask} menu={menu} logo={web.logo} photo={site.publicPhoto} advisorName={name} advisorTitle={site.publicTitle} details={[site.publicPhone, site.publicCardEmail, site.publicCompany]} />
      {web.bannerOn !== false && web.heroImage ? <img src={web.heroImage.startsWith("/banners/") ? `${web.heroImage}?v=5` : web.heroImage} alt="" style={BANNER_FRAME} /> : null}
      <main>
        {layout === "banner" && <BannerHero site={site} web={web} name={name} />}
        {layout === "editorial" && <EditorialHero site={site} web={web} />}
        {layout === "cards" && <CardsHero site={site} web={web} name={name} />}
        {layout === "classic" && <ClassicHero site={site} web={web} name={name} pages={pages} />}
        {layout === "cards" ? (
          <div className="mx-auto grid max-w-6xl gap-5 px-5 py-12 md:grid-cols-2">
            {pages.map((tab) => <PageSection key={tab.id} tab={tab} layout="cards" />)}
          </div>
        ) : (
          pages.map((tab, index) => <PageSection key={tab.id} tab={tab} layout={layout} index={index} />)
        )}
        {web.ask && <LeadForm site={site} topics={topics} />}
        <SiteFooter site={site} web={web} />
      </main>
    </ThemePaint>
  );
}

function ThemePaint({ palette, className = "", children }: { palette: Palette; className?: string; children: ReactNode }) {
  const c = PALETTE_COLORS[palette];
  const css = `
    .paint-${palette} { background: ${c.bg} !important; color: ${c.fg} !important; }
    .paint-${palette} [class~="bg-bg"],
    .paint-${palette} [class~="bg-bg/90"] { background-color: ${c.bg} !important; }
    .paint-${palette} [class~="bg-surface"] { background-color: ${c.surface} !important; }
    .paint-${palette} [class~="bg-primary"] { background-color: ${c.primary} !important; }
    .paint-${palette} [class~="bg-accent"] { background-color: ${c.accent} !important; }
    .paint-${palette} [class~="text-primary"] { color: ${c.primary} !important; }
    .paint-${palette} [class~="text-accent"] { color: ${c.accent} !important; }
    .paint-${palette} [class~="text-muted"] { color: ${c.muted} !important; }
    .paint-${palette} [class~="text-fg"],
    .paint-${palette} [class~="text-fg/80"] { color: ${c.fg} !important; }
    .paint-${palette} [class~="text-primary-fg"],
    .paint-${palette} [class~="text-primary-fg/75"],
    .paint-${palette} [class~="text-primary-fg/80"] { color: ${c.primaryFg} !important; }
    .paint-${palette} [class~="border-line"] { border-color: ${c.line} !important; }
    .paint-${palette} [class~="border-accent"] { border-color: ${c.accent} !important; }
    .paint-${palette} [class~="decoration-accent"] { text-decoration-color: ${c.accent} !important; }
  `;
  return (
    <div data-palette={palette} className={`paint-${palette} min-h-screen ${className}`} style={{ overflowAnchor: "none" }}>
      <style>{css}</style>
      {children}
    </div>
  );
}

function ClassicHero({ site, web, name, pages }: { site: PublicSite; web: WebSite; name: string; pages: WebTab[] }) {
  const showingBanner = Boolean(web.bannerOn && web.heroImage);
  return (
    <section className={`mx-auto grid max-w-6xl items-center gap-10 px-5 py-12 md:py-20 ${showingBanner ? "" : "md:grid-cols-2"}`}>
        <div>
          <p className="text-sm font-medium tracking-wide text-accent">{site.practiceName}</p>
          <h1 className="mt-3 font-display text-4xl leading-tight text-primary sm:text-5xl">{web.heroTitle}</h1>
          {web.heroText ? <p className="mt-5 max-w-xl whitespace-pre-wrap text-lg text-muted">{web.heroText}</p> : null}
          <HeroActions web={web} pages={pages} />
        </div>
        {!showingBanner && (
          <figure className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
            <img src="/photos/hero.jpg" alt="" className="aspect-video w-full object-cover" />
          </figure>
        )}
      </section>
  );
}

function BannerHero({ site, web, name }: { site: PublicSite; web: WebSite; name: string }) {
  return (
    <section>
      <div className="relative min-h-72 bg-primary">
        <div className="relative flex min-h-72 items-end">
          <div className="mx-auto w-full max-w-6xl px-5 py-10 text-white">
            <p className="text-sm font-medium tracking-wide text-accent">{site.practiceName}</p>
            <h1 className="mt-2 max-w-3xl font-display text-4xl leading-tight sm:text-6xl">{web.heroTitle}</h1>
            <p className="mt-4 text-lg">{name}{site.publicTitle ? ` · ${site.publicTitle}` : ""}</p>
          </div>
        </div>
      </div>
      {web.heroText ? <p className="mx-auto max-w-3xl whitespace-pre-wrap px-5 py-8 text-lg text-muted">{web.heroText}</p> : null}
    </section>
  );
}

function EditorialHero({ site, web }: { site: PublicSite; web: WebSite }) {
  return (
    <section className="mx-auto max-w-3xl px-5 py-16 text-center">
      <p className="text-sm font-medium tracking-[0.2em] text-accent uppercase">{site.practiceName}</p>
      <h1 className="mt-4 font-display text-5xl leading-tight text-primary sm:text-6xl">{web.heroTitle}</h1>
      <div className="mx-auto mt-6 h-1 w-16 bg-accent" />
      {web.heroText ? <p className="mt-6 whitespace-pre-wrap text-lg text-muted">{web.heroText}</p> : null}
    </section>
  );
}

function CardsHero({ site, web, name }: { site: PublicSite; web: WebSite; name: string }) {
  return (
    <section className="bg-primary text-primary-fg">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <p className="text-sm font-medium tracking-wide text-accent">{site.practiceName}</p>
        <h1 className="mt-3 max-w-3xl font-display text-4xl leading-tight sm:text-5xl">{web.heroTitle}</h1>
        {web.heroText ? <p className="mt-4 max-w-2xl whitespace-pre-wrap text-primary-fg/80">{web.heroText}</p> : null}
        <p className="mt-6 text-sm">{name}{site.publicTitle ? ` · ${site.publicTitle}` : ""}</p>
      </div>
    </section>
  );
}

function HeroActions({ web, pages }: { web: WebSite; pages: WebTab[] }) {
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      {web.ask && (
        <a href="#ask" className="rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-fg">Ask a question</a>
      )}
      {pages[0] && (
        <a href={`#${pages[0].id}`} className="rounded-full border border-line bg-surface px-5 py-3 text-sm font-medium">{pages[0].label}</a>
      )}
    </div>
  );
}

function SiteFooter({ site, web }: { site: PublicSite; web: WebSite }) {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 text-sm text-muted sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-xl whitespace-pre-wrap">{web.footer}</p>
        <Link to="/a/$slug/desk" params={{ slug: site.slug }} className="font-medium text-primary underline decoration-accent underline-offset-4">
          Advisor desk
        </Link>
      </div>
    </footer>
  );
}

function PageSection({ tab, layout = "classic", index = 0 }: { tab: WebTab; layout?: SiteLayout; index?: number }) {
  if (layout === "editorial") {
    return (
      <section id={tab.id} className="border-t border-line">
        <article className="mx-auto grid max-w-3xl gap-6 px-5 py-12 md:grid-cols-[auto_1fr]">
          <p className="font-display text-3xl text-accent">{String(index + 1).padStart(2, "0")}</p>
          <div>
            {tab.image ? <img src={tab.image} alt="" className="mb-5 h-56 w-full rounded-xl object-cover" /> : null}
            <h2 className="font-display text-3xl text-primary">{tab.headline || tab.label}</h2>
            {tab.intro ? <p className="mt-3 whitespace-pre-wrap text-lg text-muted">{tab.intro}</p> : null}
            <BlockList tab={tab} />
          </div>
        </article>
      </section>
    );
  }
  if (layout === "cards") {
    return (
      <article id={tab.id} className="overflow-hidden rounded-card border border-line bg-surface">
        {tab.image ? <img src={tab.image} alt="" className="h-44 w-full object-cover" /> : <div className="h-3 bg-accent" />}
        <div className="p-6">
          <h2 className="font-display text-2xl text-primary">{tab.headline || tab.label}</h2>
          {tab.intro ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{tab.intro}</p> : null}
          <BlockList tab={tab} />
        </div>
      </article>
    );
  }
  return (
    <section id={tab.id} className="mx-auto max-w-6xl px-5 py-14">
      <article className="grid overflow-hidden rounded-card border border-line bg-surface md:grid-cols-5">
        {tab.image ? <img src={tab.image} alt="" className="h-56 w-full object-cover md:col-span-2 md:h-full" /> : null}
        <div className={tab.image ? "p-6 md:col-span-3 md:p-8" : "p-6 md:col-span-5 md:p-8"}>
          <h2 className="font-display text-3xl text-primary">{tab.headline || tab.label}</h2>
          {tab.intro ? <p className="mt-3 whitespace-pre-wrap text-muted">{tab.intro}</p> : null}
          <BlockList tab={tab} />
        </div>
      </article>
    </section>
  );
}

function BlockList({ tab }: { tab: WebTab }) {
  return (
    <>
      {tab.blocks.length > 0 && (
        <div className="mt-6 grid gap-4">
          {tab.blocks.map((block) => (
            <div key={block.id} className="border-l-2 border-accent pl-3">
              {block.image ? <img src={block.image} alt="" className="mb-3 h-40 w-full rounded-lg object-cover" /> : null}
              {block.heading ? <h3 className="font-display text-xl text-primary">{block.heading}</h3> : null}
              {block.body ? <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{block.body}</p> : null}
            </div>
          ))}
        </div>
      )}
      {tab.links.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {tab.links.map((link) => (
            <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" className="rounded-full border border-line bg-bg px-4 py-2 text-sm font-medium text-primary">
              {link.label}
            </a>
          ))}
        </div>
      )}
    </>
  );
}

function LeadForm({ site, topics }: { site: PublicSite; topics?: { value: string; label: string }[] }) {
  const options = topics ?? (
    [
      site.showLife ? { value: "life", label: INTEREST_LABELS.life } : null,
      site.showCritical ? { value: "critical", label: INTEREST_LABELS.critical } : null,
      site.showDisability ? { value: "disability", label: INTEREST_LABELS.disability } : null,
      site.showGroup ? { value: "group", label: INTEREST_LABELS.group } : null,
      { value: "unsure", label: INTEREST_LABELS.unsure },
    ] as const
  ).filter(Boolean) as { value: string; label: string }[];

  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus("sending");
    setMessage("");
    const result = await submitLead({
      data: {
        slug: site.slug,
        fullName: String(data.get("fullName") ?? ""),
        email: String(data.get("email") ?? ""),
        phone: String(data.get("phone") ?? ""),
        interest: String(data.get("interest") ?? "unsure"),
        note: String(data.get("note") ?? ""),
      },
    });
    if (result.ok) {
      form.reset();
      setStatus("sent");
    } else {
      setStatus("error");
      setMessage(result.error);
    }
  }

  return (
    <section id="ask" className="border-t border-line bg-primary text-primary-fg">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-2">
        <div>
          <p className="text-sm font-medium tracking-wide text-accent">Did you know — and now a question</p>
          <h2 className="mt-2 font-display text-3xl">Tell this practice what you want clarified.</h2>
          <p className="mt-4 text-primary-fg/80">
            Your name and how to reach you are saved in this practice’s own database. Nothing is sold on this page,
            and you are not applying for a policy.
          </p>
        </div>
        {status === "sent" ? (
          <div className="rounded-card bg-surface p-8 text-fg">
            <h3 className="font-display text-2xl text-primary">Received.</h3>
            <p className="mt-3 text-muted">
              Someone from {site.practiceName} will reply using the email or phone you left. If it is urgent, call the practice directly.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4 rounded-card bg-surface p-6 text-fg sm:p-8">
            <label className="grid gap-1 text-sm font-medium">
              Name
              <input name="fullName" required autoComplete="name" className="rounded-xl border border-line bg-bg px-3 py-3 text-base font-normal" />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Email
              <input name="email" type="email" required autoComplete="email" className="rounded-xl border border-line bg-bg px-3 py-3 text-base font-normal" />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Phone <span className="font-normal text-muted">(optional)</span>
              <input name="phone" type="tel" autoComplete="tel" className="rounded-xl border border-line bg-bg px-3 py-3 text-base font-normal" />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              What is this about
              <select id="interest" name="interest" className="rounded-xl border border-line bg-bg px-3 py-3 text-base font-normal">
                {options.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Note <span className="font-normal text-muted">(optional)</span>
              <textarea name="note" rows={3} className="rounded-xl border border-line bg-bg px-3 py-3 text-base font-normal" />
            </label>
            {status === "error" && <p className="text-sm text-primary">{message}</p>}
            <button
              type="submit"
              disabled={status === "sending"}
              className="rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-fg disabled:opacity-60"
            >
              {status === "sending" ? "Sending…" : "Send to the practice"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
