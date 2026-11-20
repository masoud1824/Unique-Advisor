import { createFileRoute, Link } from "@tanstack/react-router";
import { PlatformHeader } from "@/components/platform-header";

export const Route = createFileRoute("/studio")({
  head: () => ({
    meta: [{ title: "Studio moved · Unique Advisor" }],
  }),
  component: Moved,
});

function Moved() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <PlatformHeader />
      <main className="mx-auto max-w-xl px-5 py-16">
        <h1 className="font-display text-4xl text-primary">Each practice has its own studio.</h1>
        <p className="mt-4 text-muted">
          There is no longer one shared studio. An advisor signs in and opens the studio on their temporary domain. You manage the list from Super admin.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/login" className="rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-fg">
            Advisor login
          </Link>
          <Link to="/admin" className="rounded-full border border-line px-5 py-3 text-sm font-medium">
            Super admin
          </Link>
        </div>
      </main>
    </div>
  );
}
