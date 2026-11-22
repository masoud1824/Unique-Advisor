import { sendPayload, type SignRequest } from "./dropbox-sign.ts";

export const SIGNATURE_TEST = {
  advisorSlug: "masoud-zangeneh-2",
  title: "TEST ONLY",
  statement: "This is a system test, not a client document.",
  signerName: "Test Signer",
  signerEmail: "reviewer@example.invalid",
  testMode: true,
  folder: "/Unique Advisor/Dropbox Sign Test",
  documentId: "test-only",
  page: { width: 612, height: 792 },
  field: { kind: "signature" as const, page: 1, x: 72, y: 640, width: 200, height: 36 },
};

export function testFilingNames(requestId: string) {
  return {
    signed: `${SIGNATURE_TEST.documentId}-signed-${requestId}.pdf`,
    audit: `${SIGNATURE_TEST.documentId}-audit-${requestId}.zip`,
  };
}

export function buildTestOnlyPdf() {
  const stream = [
    "BT",
    "/F1 22 Tf",
    "72 700 Td",
    "(TEST ONLY) Tj",
    "/F1 12 Tf",
    "0 -40 Td",
    "(This is a system test, not a client document.) Tj",
    "ET",
    "0.15 0.15 0.15 RG",
    "72 116 200 36 re",
    "S",
    "BT",
    "/F1 9 Tf",
    "76 130 Td",
    "(Signature) Tj",
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

export function approvedTestForm(clientId: string) {
  const request: SignRequest = {
    advisorId: SIGNATURE_TEST.advisorSlug,
    documentId: SIGNATURE_TEST.documentId,
    version: "1",
    filename: "TEST-ONLY.pdf",
    subject: SIGNATURE_TEST.title,
    message: SIGNATURE_TEST.statement,
    signers: [{ name: SIGNATURE_TEST.signerName, email: SIGNATURE_TEST.signerEmail, order: 0 }],
    fields: [{ ...SIGNATURE_TEST.field, signerEmail: SIGNATURE_TEST.signerEmail }],
    testMode: true,
  };
  const built = sendPayload(request, clientId);
  if (!built.ok) return built;
  built.form.set("title", SIGNATURE_TEST.title);
  built.form.append("file[0]", new Blob([Buffer.from(buildTestOnlyPdf())], { type: "application/pdf" }), "TEST-ONLY.pdf");
  return built;
}

