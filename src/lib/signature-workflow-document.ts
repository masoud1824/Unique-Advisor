import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SignRequest } from "./dropbox-sign.ts";

export const WORKFLOW_DOCUMENT = {
  title: "Signature Workflow Test",
  fileName: "Signature Workflow Test.pdf",
  folder: "/Unique Advisor/Assistant Test",
  statement: "Fictional document for the signature workflow. Not a client file.",
  signerName: "Test signer",
  signerEmail: "reviewer@example.invalid",
  documentId: "signature-workflow-test",
  page: { width: 612, height: 792 },
  box: { page: 1, x: 72, y: 116, width: 240, height: 48 },
};

export function workflowDocumentPath() {
  return `${WORKFLOW_DOCUMENT.folder}/${WORKFLOW_DOCUMENT.fileName}`;
}

export function workflowSignField(pageHeight = WORKFLOW_DOCUMENT.page.height) {
  const box = WORKFLOW_DOCUMENT.box;
  return { page: box.page, x: box.x, y: Math.round(pageHeight - box.y - box.height), width: box.width, height: box.height };
}

export function chooseDropboxDocument(files: Array<{ name: string; path: string }>, title: string) {
  const wanted = title.trim().toLowerCase();
  if (!wanted) return { ok: false as const, error: "Which Dropbox document should I use? I did not choose one." };
  if (wanted === "test only") return { ok: false as const, error: "That is the old TEST ONLY document. I did not use it." };
  const matches = files.filter((file) => file.name.toLowerCase().replace(/\.pdf$/i, "") === wanted);
  if (matches.length === 1) return { ok: true as const, file: matches[0] };
  if (matches.length > 1) return { ok: false as const, error: `More than one Dropbox file is titled “${title}”. I did not choose one.` };
  const listed = files.map((file) => file.name).join(", ") || "none";
  return { ok: false as const, error: `No Dropbox file is titled “${title}”. I found ${listed}. I did not use another document.` };
}

export function workflowPreviewText(input: { path: string; field: { page: number; x: number; y: number; width: number; height: number } }) {
  const field = input.field;
  return [
    `Document: ${input.path}`,
    `Title: ${WORKFLOW_DOCUMENT.title}`,
    "Selected from the Dropbox folder listing. This is not the old TEST ONLY document and not the LP257 prepared draft.",
    `Test signer: ${WORKFLOW_DOCUMENT.signerName} <${WORKFLOW_DOCUMENT.signerEmail}>`,
    "Mode: Dropbox Sign test mode",
    `Signature area: page ${field.page}, x ${field.x}, y ${field.y}, width ${field.width}, height ${field.height}. This is the box labelled Signature on the page.`,
    `Destination: ${WORKFLOW_DOCUMENT.folder}`,
    "A completed copy would be a new file. Existing files, including the LP257 prepared draft, would not be replaced.",
    "Nothing was sent. I will wait for your approval of this exact preview.",
  ].join("\n");
}

export function workflowSignRequest(advisorId: string): SignRequest {
  const field = workflowSignField();
  return {
    advisorId,
    documentId: WORKFLOW_DOCUMENT.documentId,
    version: "1",
    filename: WORKFLOW_DOCUMENT.fileName,
    subject: WORKFLOW_DOCUMENT.title,
    message: WORKFLOW_DOCUMENT.statement,
    signers: [{ name: WORKFLOW_DOCUMENT.signerName, email: WORKFLOW_DOCUMENT.signerEmail, order: 0 }],
    fields: [{ ...field, signerEmail: WORKFLOW_DOCUMENT.signerEmail, kind: "signature" }],
    testMode: true,
  };
}

export async function buildSignatureWorkflowPdf() {
  const doc = await PDFDocument.create();
  doc.setTitle(WORKFLOW_DOCUMENT.title);
  const page = doc.addPage([WORKFLOW_DOCUMENT.page.width, WORKFLOW_DOCUMENT.page.height]);
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const ink = rgb(0.1, 0.1, 0.1);
  page.drawText(WORKFLOW_DOCUMENT.title, { x: 72, y: 700, size: 22, font: bold, color: ink });
  page.drawText(WORKFLOW_DOCUMENT.statement, { x: 72, y: 660, size: 12, font, color: ink });
  page.drawText("Signature", { x: WORKFLOW_DOCUMENT.box.x, y: 172, size: 12, font: bold, color: ink });
  page.drawRectangle({
    x: WORKFLOW_DOCUMENT.box.x,
    y: WORKFLOW_DOCUMENT.box.y,
    width: WORKFLOW_DOCUMENT.box.width,
    height: WORKFLOW_DOCUMENT.box.height,
    borderWidth: 1.5,
    borderColor: ink,
  });
  return doc.save();
}
