import { createServerFn } from "@tanstack/react-start";
import { gateAdvisor } from "@/lib/advisor-db";
import { accessToken } from "@/lib/advisor-links";
import { factsFromFolder } from "@/lib/desk-workflows";
import { fictionalAddress, placementPreview } from "@/lib/signature-placement";
import { PREPARED_DRAFT, preparedDraftPreviewText, selectPreparedDraft } from "@/lib/signature-conversation";

export const loadSignatureDocument = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  const token = await accessToken(gate.row.id, "dropbox");
  if (!token) return { ok: false as const, error: "Dropbox is not connected. I did not open a folder." };
  const { readAssistantClient } = await import("@/lib/assistant-test-live");
  const read = await readAssistantClient(token, "C-1001");
  if (!read.ok) return { ok: false as const, error: read.detail };
  const pdf = selectPreparedDraft(read.pdfs);
  if (!pdf?.binary) return { ok: false as const, error: "The prepared draft is not in the test folder. I did not choose another PDF." };
  const records = read.files.map((file) => ({ path: file.path, name: file.name, modified: file.modified.slice(0, 10), text: file.text, clientId: "C-1001", advisorId: String(gate.row.id) }));
  const email = factsFromFolder(records, "email");
  let binary = "";
  const bytes = pdf.binary;
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return {
    ok: true as const,
    name: pdf.name,
    path: pdf.path,
    pages: pdf.pages,
    edition: pdf.edition,
    pageWidth: pdf.pageWidth,
    pageHeight: pdf.pageHeight,
    signerName: PREPARED_DRAFT.signerName,
    fileEmail: email.conflict || email.missing ? "" : email.values[0],
    testEmail: PREPARED_DRAFT.signerEmail,
    pdfBase64: btoa(binary),
  };
});

export const previewSignaturePlacement = createServerFn({ method: "POST" }).validator((input: unknown) => input).handler(async ({ data }) => {
  const body = data as { slug?: string; code?: string; page?: number; x?: number; y?: number; width?: number; height?: number; signerName?: string; deliveryEmail?: string };
  const gate = await gateAdvisor(body.slug || "", body.code || "");
  if (!gate.ok) return gate;
  if (fictionalAddress(String(body.deliveryEmail || ""))) {
    return { ok: false as const, error: "That email is fictional test data. I did not send to it. A delivery test must use your approved test email and a fresh preview." };
  }
  if (String(body.signerName || "").trim() !== PREPARED_DRAFT.signerName || String(body.deliveryEmail || "").trim().toLowerCase() !== PREPARED_DRAFT.signerEmail) {
    return { ok: false as const, error: "This preview is only for the test signer at the approved test address. Nothing was sent." };
  }
  const token = await accessToken(gate.row.id, "dropbox");
  if (!token) return { ok: false as const, error: "Dropbox is not connected. Nothing was sent." };
  const { readAssistantClient, pageBox } = await import("@/lib/assistant-test-live");
  const read = await readAssistantClient(token, "C-1001");
  if (!read.ok) return { ok: false as const, error: read.detail };
  const pdf = selectPreparedDraft(read.pdfs);
  if (!pdf?.binary) return { ok: false as const, error: "The prepared draft is not in the test folder. Nothing was sent." };
  const box = await pageBox(pdf.binary, Number(body.page));
  const preview = placementPreview({
    path: pdf.path,
    edition: pdf.edition,
    page: Number(body.page),
    x: Number(body.x),
    y: Number(body.y),
    width: Number(body.width),
    height: Number(body.height),
    signerName: String(body.signerName || ""),
    deliveryEmail: String(body.deliveryEmail || ""),
    pageWidth: box.width,
    pageHeight: box.height,
    pageCount: pdf.pages,
  });
  if (!preview.ok) return preview;
  const placed = [Number(body.x), Number(body.y), Number(body.width), Number(body.height)].map((value) => Math.round(value));
  const text = preparedDraftPreviewText({
    path: pdf.path,
    edition: pdf.edition,
    placement: `Signature field: page ${Number(body.page)}, x ${placed[0]}, y ${placed[1]}, width ${placed[2]}, height ${placed[3]}. You placed this box. “Signed at (city)” was not used.`,
  });
  return { ok: true as const, preview: text, sent: false as const };
});
