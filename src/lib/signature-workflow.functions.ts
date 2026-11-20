import { createServerFn } from "@tanstack/react-start";
import { gateAdvisor } from "@/lib/advisor-db";
import { accessToken, storedAdvisorLink } from "@/lib/advisor-links";
import { externalSideEffectsBlocked, isolatedProviderNotice } from "@/lib/isolated-test-desk";

export const loadWorkflowPreview = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  if (externalSideEffectsBlocked()) {
    return { ok: false as const, isolated: true as const, error: isolatedProviderNotice("dropbox", await storedAdvisorLink(gate.row.id, "dropbox")) };
  }
  const token = await accessToken(gate.row.id, "dropbox");
  if (!token) return { ok: false as const, error: "Dropbox is not connected. Nothing was sent." };
  const { readSelectedWorkflow } = await import("@/lib/signature-workflow-live");
  const selected = await readSelectedWorkflow(token);
  if (!selected.ok || !("bytes" in selected)) return selected;
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < selected.bytes.length; index += chunk) {
    binary += String.fromCharCode(...selected.bytes.subarray(index, index + chunk));
  }
  return {
    ok: true as const,
    sent: false as const,
    path: selected.path,
    name: selected.name,
    pages: selected.pages,
    width: selected.width,
    height: selected.height,
    field: selected.field,
    preview: selected.preview,
    pdfBase64: btoa(binary),
  };
});
