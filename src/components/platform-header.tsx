import { Link } from "@tanstack/react-router";

export function PlatformHeader({ admin = false }: { admin?: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
        <Link to="/" className="font-display text-xl tracking-tight text-primary">
          Unique Advisor
        </Link>
        <nav className="flex items-center gap-2 text-sm font-medium">
          {admin ? (
            <Link to="/" className="rounded-full px-3 py-2 text-fg/80 hover:bg-surface">
              Home
            </Link>
          ) : (
            <>
              <Link to="/login" className="rounded-full px-3 py-2 text-fg/80 hover:bg-surface">
                Advisor login
              </Link>
              <Link to="/signup" className="rounded-full bg-primary px-4 py-2 text-primary-fg">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
