import { createFileRoute, Link } from "@tanstack/react-router";
import { PracticeStudio } from "@/components/practice-studio";
import { getPublicSite } from "@/lib/site.functions";

export const Route = createFileRoute("/a/$slug/studio")({
  loader: ({ params }) => getPublicSite({ data: { slug: params.slug } }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `Studio · ${loaderData.practiceName}` : "Studio" }],
  }),
  component: StudioPage,
});

function StudioPage() {
  const site = Route.useLoaderData();
  if (!site) {
    return (
      <div className="min-h-screen bg-bg px-5 py-20 text-fg">
        <h1 className="font-display text-4xl text-primary">This practice is not on this host.</h1>
        <Link to="/login" className="mt-6 inline-block text-sm font-medium text-primary underline">
          Advisor login
        </Link>
      </div>
    );
  }
  if (site.status === "suspended") {
    return (
      <div className="min-h-screen bg-bg px-5 py-20 text-fg">
        <h1 className="font-display text-4xl text-primary">This service is paused.</h1>
        <p className="mt-3 text-muted">The operator has to turn {site.practiceName} back on.</p>
      </div>
    );
  }
  return <PracticeStudio site={site} />;
}
