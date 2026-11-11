import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/a/$slug/")({
  component: RedirectToDesk,
});

function RedirectToDesk() {
  const { slug } = Route.useParams();
  return <Navigate to="/a/$slug/desk" params={{ slug }} />;
}
