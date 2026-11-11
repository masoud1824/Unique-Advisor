import { Link } from "@tanstack/react-router";

export function SiteHeader({
  practiceName = "Unique Advisor",
  slug,
  mode = "public",
  showCoverage = true,
  showFacts = true,
  showForm = true,
  menu,
  logo = "",
  photo = "",
  advisorName = "",
  advisorTitle = "",
  details = [],
}: {
  practiceName?: string;
  slug?: string;
  mode?: "public" | "desk" | "studio";
  showCoverage?: boolean;
  showFacts?: boolean;
  showForm?: boolean;
  menu?: { href: string; label: string; external?: boolean }[];
  logo?: string;
  photo?: string;
  advisorName?: string;
  advisorTitle?: string;
  details?: string[];
}) {
  const name = advisorName || practiceName;
  const mark = (
    <span className="flex flex-col items-start gap-1 leading-none">
      {photo ? <img src={photo} alt="" className="ua-advisor-photo" /> : null}
      {logo ? <img src={logo} alt="" className="ua-site-logo" /> : null}
      <span className="font-display text-xl tracking-tight text-primary">{name}</span>
      {advisorTitle ? <span className="text-xs text-muted">{advisorTitle}</span> : null}
      {advisorName && practiceName && advisorName !== practiceName ? <span className="text-xs text-muted">{practiceName}</span> : null}
      {details.filter(Boolean).map((line) => (
        <span key={line} className="text-xs text-muted">{line}</span>
      ))}
    </span>
  );
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
        {slug ? (
          <Link to="/a/$slug/desk" params={{ slug }} className="group flex items-center gap-3 leading-none">
            {mark}
          </Link>
        ) : (
          <Link to="/" className="group flex flex-col leading-none">
            <span className="font-display text-xl tracking-tight text-primary">Unique Advisor</span>
            <span className="mt-1 text-xs tracking-wide text-muted">A service for each practice</span>
          </Link>
        )}
        <nav className="flex items-center gap-1 text-sm font-medium sm:gap-2">
          {slug && mode !== "public" ? (
            <>
              <Link
                to="/a/$slug/desk"
                params={{ slug }}
                className={`rounded-full px-3 py-2 ${mode === "desk" ? "bg-surface text-primary" : "text-fg/80 hover:bg-surface"}`}
              >
                Desk
              </Link>
              <Link
                to="/a/$slug/studio"
                params={{ slug }}
                className={`rounded-full px-3 py-2 ${mode === "studio" ? "bg-surface text-primary" : "text-fg/80 hover:bg-surface"}`}
              >
                Studio
              </Link>
            </>
          ) : (
            <>
              {menu ? (
                <div className="flex max-w-[62vw] items-center gap-1 overflow-x-auto sm:max-w-none">
                  {menu.map((item) =>
                    item.external ? (
                      <a key={item.href + item.label} href={item.href} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-full px-3 py-2 text-fg/80 hover:bg-surface">
                        {item.label}
                      </a>
                    ) : (
                      <a key={item.href} href={item.href} className="shrink-0 rounded-full px-3 py-2 text-fg/80 hover:bg-surface">
                        {item.label}
                      </a>
                    ),
                  )}
                </div>
              ) : (
                <>
                  {showCoverage && (
                    <a href="#coverage" className="hidden rounded-full px-3 py-2 text-fg/80 hover:bg-surface sm:inline">
                      Coverage
                    </a>
                  )}
                  {showFacts && (
                    <a href="#facts" className="hidden rounded-full px-3 py-2 text-fg/80 hover:bg-surface sm:inline">
                      Did you know
                    </a>
                  )}
                </>
              )}
              {showForm && (
                <a href="#ask" className="shrink-0 rounded-full bg-primary px-4 py-2 text-primary-fg hover:opacity-90">
                  Ask a question
                </a>
              )}
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
