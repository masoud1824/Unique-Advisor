import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { PracticeSite } from "@/components/practice-site";
import { getPublicSite } from "@/lib/site.functions";

export const Route = createFileRoute("/a/$slug/site")({
  staleTime: 0,
  loader: ({ params }) => getPublicSite({ data: { slug: params.slug } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.siteMode === "builtin" ? loaderData.publicName || loaderData.advisorName : "Not published",
      },
    ],
  }),
  component: AdvisorSite,
});

function AdvisorSite() {
  const site = Route.useLoaderData();
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    return () => {
      history.scrollRestoration = previous;
    };
  }, []);
  if (!site || site.status !== "active" || site.siteMode !== "builtin") {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold text-[#0a3a66]">This page is not published</h1>
        <p className="mt-3 text-sm text-[#5a6a7a]">
          The advisor is using their own website. The coverage page is turned off.
        </p>
        <Link to="/" className="mt-6 text-sm font-semibold text-[#0f4c81]">
          Unique Advisor
        </Link>
      </main>
    );
  }
  return <PracticeSite site={site} />;
}
